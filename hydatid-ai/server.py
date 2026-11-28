"""CystStage AI web app.

Run:  uvicorn server:app --reload        then open http://localhost:8000
"""
import base64
import csv
import datetime
import json
import os
import threading
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import hospitals
import image_model
import secrets
import socket
import knowledge
import model
from clues import BINARY_CLUES, LABELS, PHASE, STAGES, empty_case
from engine import assess
from extractor import extract
from report import build_pdf
from rules import KEY_CLUES, RULES
from test_cases import REPORTS

HERE = os.path.dirname(os.path.abspath(__file__))
PATIENTS = os.path.join(HERE, "data", "patients.json")
_lock = threading.Lock()
app = FastAPI(title="CystStage AI")
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


class AssessIn(BaseModel):
    mode: str = "text"                      # "text" | "checklist"
    text: str = ""
    case: Optional[Dict[str, Any]] = None
    use_llm: bool = False
    image_quality: Optional[Dict[str, Any]] = None
    image_pred: Optional[Dict[str, Any]] = None


class ReportIn(AssessIn):
    patient: Dict[str, Any] = {}
    decision: Optional[Dict[str, Any]] = None
    image_b64: Optional[str] = None


def _clean_case(raw):
    case = empty_case()
    for k, v in (raw or {}).items():
        if k in case:
            case[k] = v
    if case["size_cm"] in ("", 0, "0", None):
        case["size_cm"] = None
    else:
        case["size_cm"] = float(case["size_cm"])
    return case


def _run(body: AssessIn):
    if body.mode == "text":
        case, evidence, engine_used = extract(body.text, use_llm=body.use_llm)
    else:
        case, evidence, engine_used = _clean_case(body.case), {}, "checklist"
    return case, evidence, engine_used, assess(case, body.image_quality, body.image_pred)


@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "static", "index.html"))


@app.get("/doctor")
@app.get("/patient")
def portal_page():
    """Separate sign-in pages: /doctor for clinicians, /patient for patients (portal.js reads the path)."""
    return FileResponse(os.path.join(HERE, "static", "portal.html"))


@app.get("/p/{token}")
def pass_page(token: str):
    """The page a patient's QR opens. It shows no data until a signed-in clinician is confirmed in the browser."""
    return FileResponse(os.path.join(HERE, "static", "pass.html"))


class QrIn(BaseModel):
    text: str


@app.post("/api/qr")
def api_qr(b: QrIn):
    if not b.text or len(b.text) > 500:
        return JSONResponse({"error": "Text is required (max 500 characters)."}, status_code=400)
    return {"qr": _qr_data_url(b.text)}


@app.get("/login")
@app.get("/signup")
def old_auth_pages():
    return RedirectResponse("/doctor")


def _sb_config():
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY")
    path = os.path.join(HERE, "supabase_config.json")
    if (not url or not key) and os.path.exists(path):
        try:
            c = json.load(open(path))
            url, key = url or c.get("url"), key or c.get("anon_key")
        except Exception:
            pass
    return url, key


@app.get("/api/config")
def api_config():
    url, key = _sb_config()
    # the anon (publishable) key is meant for browsers; row-level security protects the data
    return {"supabase_url": url or None, "supabase_anon_key": key or None}


@app.get("/api/meta")
def meta():
    return {"stages": STAGES, "phase": PHASE, "labels": LABELS, "binary": BINARY_CLUES,
            "samples": REPORTS, "model_loaded": model.load() is not None,
            "llm_available": bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("GEMINI_API_KEY")),
            "stage_info": knowledge.stage_info(), "guidelines": knowledge.GUIDELINES,
            "rules": [{"stage": r[0], "rule": r[1], "triggers": r[3]} for r in RULES],
            "key_clues": KEY_CLUES}


class ImageIn(BaseModel):
    image_b64: str


DEMO_DIR = os.path.join(HERE, "static", "demo_scans")
IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

@app.get("/api/demo_scans")
def demo_scans():
    """Real scans the team copied in with ADD_DEMO_SCANS.command (kept out of git)."""
    out = {}
    if os.path.isdir(DEMO_DIR):
        for st in sorted(os.listdir(DEMO_DIR)):
            d = os.path.join(DEMO_DIR, st)
            if os.path.isdir(d):
                fs = sorted(f for f in os.listdir(d) if f.lower().endswith(IMG_EXT))
                if fs:
                    out[st] = [f"/static/demo_scans/{st}/{f}" for f in fs]
    if out:
        return {"scans": out, "count": sum(len(v) for v in out.values()), "simulated": False}
    sim = os.path.join(HERE, "static", "sim_scans")
    if os.path.isdir(sim):
        for st in sorted(os.listdir(sim)):
            d = os.path.join(sim, st)
            if os.path.isdir(d):
                fs = sorted(f for f in os.listdir(d) if f.lower().endswith(IMG_EXT))
                if fs:
                    out[st] = [f"/static/sim_scans/{st}/{f}" for f in fs]
    return {"scans": out, "count": sum(len(v) for v in out.values()), "simulated": True}


@app.get("/api/image/status")
def image_status():
    if not image_model.available():
        return {"available": False, "message": "Image model: not trained."}
    try:
        _, ck = image_model._load()
        return {"available": True, "metrics": ck["metrics"]}
    except Exception as e:
        return {"available": False, "message": f"Image model could not load: {e}"}


@app.post("/api/image")
def api_image(body: ImageIn):
    if not image_model.available():
        return JSONResponse({"error": "Image model not trained yet"}, status_code=503)
    try:
        return image_model.predict(base64.b64decode(body.image_b64.split(",")[-1]))
    except Exception as e:
        return JSONResponse({"error": f"Could not read this image: {e}"}, status_code=400)


# ---------------- USP 7: stage-based referral ----------------
class RouteIn(BaseModel):
    stage: str
    options: List[str]
    organ: str = "liver"
    complicated: str = "no"
    lat: Optional[float] = None
    lng: Optional[float] = None


@app.post("/api/hospitals")
def api_hospitals(b: RouteIn):
    return hospitals.route(b.stage, b.options, b.organ, b.complicated, b.lat, b.lng)


# ---------------- USP 8: secure QR share links ----------------
SHARES = os.path.join(HERE, "data", "shares")


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("10.255.255.255", 1)); ip = s.getsockname()[0]; s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class ShareIn(BaseModel):
    patient: Dict[str, Any] = {}
    case: Dict[str, Any]
    result: Dict[str, Any]
    heatmap: Optional[str] = None
    image_pred: Optional[Dict[str, Any]] = None
    days: int = 7


@app.post("/api/share")
def api_share(b: ShareIn, request: Request):
    os.makedirs(SHARES, exist_ok=True)
    token = secrets.token_urlsafe(18)
    now = datetime.datetime.now()
    rec = {"token": token, "created": now.isoformat(timespec="seconds"),
           "expires": (now + datetime.timedelta(days=max(1, min(b.days, 30)))).isoformat(timespec="seconds"),
           "patient": {k: b.patient.get(k) for k in ("id", "age", "sex")}, "case": b.case, "result": b.result,
           "heatmap": b.heatmap, "image_pred": {k: v for k, v in (b.image_pred or {}).items() if k != "heatmap"} or None}
    json.dump(rec, open(os.path.join(SHARES, token + ".json"), "w"))
    host = request.url.hostname or ""
    if host in ("127.0.0.1", "localhost", "::1"):
        # running on this machine: the phone opens the LAN address on the same Wi-Fi
        port = request.url.port or 8000
        local_url = f"http://{host}:{port}/r/{token}"
        url = f"http://{_lan_ip()}:{port}/r/{token}"
    else:
        # hosted (e.g. Render): use the public https host the browser used, no port.
        # Render terminates TLS and forwards the original scheme/host in X-Forwarded-* headers.
        scheme = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip() or "https"
        public_host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or host).split(",")[0].strip()
        local_url = url = f"{scheme}://{public_host}/r/{token}"
    return {"token": token, "url": url, "local_url": local_url, "expires": rec["expires"], "qr": _qr_data_url(url)}


def _qr_data_url(text):
    import io as _io
    import qrcode
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    q.add_data(text); q.make(fit=True)
    buf = _io.BytesIO(); q.make_image(fill_color="#0F172A", back_color="white").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _db_share(token):
    """Hosted fallback: the share row is also stored in Supabase, so links survive a server restart.
    The get_share_link() function returns the row only while it has not expired."""
    url, key = _sb_config()
    if not url or not key:
        return None
    import urllib.request
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/rpc/get_share_link", method="POST",
                                 data=json.dumps({"p_token": token}).encode(),
                                 headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read() or b"null")
    except Exception:
        return None


@app.get("/api/share/{token}")
def get_share(token: str):
    valid = token.replace("-", "").replace("_", "").isalnum()
    path = os.path.join(SHARES, os.path.basename(token) + ".json")
    if valid and os.path.exists(path):
        rec = json.load(open(path))
        if datetime.datetime.fromisoformat(rec["expires"]) < datetime.datetime.now():
            return JSONResponse({"error": "This report link has expired. Ask your doctor for a new QR code."}, status_code=410)
    else:
        rec = _db_share(token) if valid else None
        if not rec:
            return JSONResponse({"error": "This report link is invalid or has expired."}, status_code=404)
    rec["stage_info"] = knowledge.stage_info().get(rec["result"]["stage"])
    return rec


@app.get("/r/{token}")
def report_page(token: str):
    return FileResponse(os.path.join(HERE, "static", "report.html"))


# ---------------- USP 4: doctor feedback -> retraining ----------------
FEEDBACK = os.path.join(HERE, "data", "feedback.jsonl")


class FeedbackIn(BaseModel):
    case: Dict[str, Any]
    ai_stage: str
    final_stage: str


@app.post("/api/feedback")
def api_feedback(f: FeedbackIn):
    os.makedirs(os.path.dirname(FEEDBACK), exist_ok=True)
    with open(FEEDBACK, "a") as fh:
        fh.write(json.dumps({"time": datetime.datetime.now().isoformat(timespec="seconds"), "case": f.case,
                             "ai_stage": f.ai_stage, "final_stage": f.final_stage}) + "\n")
    return feedback_status()


@app.get("/api/feedback/status")
def feedback_status():
    rows = []
    if os.path.exists(FEEDBACK):
        rows = [json.loads(l) for l in open(FEEDBACK) if l.strip()]
    b = model.load()
    return {"total": len(rows), "overrides": sum(r["ai_stage"] != r["final_stage"] for r in rows),
            "model_metrics": (b or {}).get("metrics", {})}


@app.post("/api/retrain")
def api_retrain():
    import pandas as pd
    base = pd.read_csv(os.path.join(HERE, "data", "cases.csv"))
    rows = [json.loads(l) for l in open(FEEDBACK)] if os.path.exists(FEEDBACK) else []
    extra = []
    for r in rows:
        c = dict(r["case"]); c["stage"] = r["final_stage"]
        extra += [c] * 5  # clinician-confirmed cases count 5x
    df = pd.concat([base, pd.DataFrame(extra)], ignore_index=True) if extra else base
    path = os.path.join(HERE, "data", "cases_plus_feedback.csv")
    df[[c for c in base.columns]].to_csv(path, index=False)
    before = ((model.load() or {}).get("metrics", {}) or {}).get("XGBoost + isotonic")
    model.train(path)
    model._model = None
    after = (model.load() or {}).get("metrics", {}).get("XGBoost + isotonic")
    return {"used_feedback": len(rows), "training_rows": len(df), "before": before, "after": after}


@app.get("/api/graph")
def api_graph():
    return knowledge.graph()


@app.post("/api/assess")
def api_assess(body: AssessIn):
    if body.mode == "text" and not body.text.strip():
        return JSONResponse({"error": "Paste a report first."}, status_code=400)
    case, evidence, engine_used, result = _run(body)
    return {"case": case, "evidence": evidence, "engine": engine_used, "result": result}


@app.post("/api/report")
def api_report(body: ReportIn):
    case, evidence, _, result = _run(body)
    img = None
    if body.image_b64:
        try:
            img = base64.b64decode(body.image_b64.split(",")[-1])
        except Exception:
            img = None
    pdf = build_pdf(body.patient, case, result, evidence,
                    report_text=body.text if body.mode == "text" else None,
                    decision=body.decision, image_bytes=img)
    name = f"cyststage_{(body.patient.get('id') or 'patient')}.pdf".replace(" ", "_")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


class DecisionIn(BaseModel):
    patient_id: str = ""
    ai_stage: str
    ai_confidence: str
    final_stage: str
    note: str = ""


@app.post("/api/decision")
def api_decision(d: DecisionIn):
    path = os.path.join(HERE, "decisions.csv")
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["time", "patient_id", "ai_stage", "ai_confidence", "final_stage", "override", "note"])
        w.writerow([datetime.datetime.now().isoformat(timespec="seconds"), d.patient_id, d.ai_stage,
                    d.ai_confidence, d.final_stage, d.final_stage != d.ai_stage, d.note])
    return {"saved": True, "override": d.final_stage != d.ai_stage}


# ---------------- Cyst digital twin (patient timeline) ----------------
DEMO = {
    "DEMO-001": {"name": "Demo patient (illustrative data)", "age": 38, "sex": "F", "exams": [
        {"date": "2026-01-12", "case": {"wall_visible": "yes", "hydatid_sand": "yes", "septations": "no",
                                        "daughter_cysts": "no", "detached_membrane": "no", "size_cm": 6.2,
                                        "organ": "liver", "calcification": "none"}},
        {"date": "2026-04-20", "case": {"wall_visible": "yes", "detached_membrane": "yes", "daughter_cysts": "no",
                                        "size_cm": 5.8, "organ": "liver", "calcification": "none"}},
        {"date": "2026-08-03", "case": {"ball_of_wool": "yes", "daughter_cysts": "no", "solid_matrix": "yes",
                                        "size_cm": 4.9, "organ": "liver", "calcification": "partial"}},
    ]},
}


def _load():
    if not os.path.exists(PATIENTS):
        db = {}
        for pid, p in DEMO.items():
            exams = []
            for e in p["exams"]:
                c = _clean_case(e["case"])
                r = assess(c)
                exams.append({"date": e["date"], "case": c, "stage": r["stage"], "confidence": r["confidence"],
                              "final_stage": r["stage"], "source": "illustrative"})
            db[pid] = {"name": p["name"], "age": p["age"], "sex": p["sex"], "exams": exams}
        _save(db)
    with open(PATIENTS) as f:
        return json.load(f)


def _save(db):
    os.makedirs(os.path.dirname(PATIENTS), exist_ok=True)
    with open(PATIENTS, "w") as f:
        json.dump(db, f, indent=1)


FEATS = ["wall_visible", "hydatid_sand", "septations", "daughter_cysts", "detached_membrane",
         "solid_matrix", "ball_of_wool", "calcification", "complicated"]


def _changes(prev, cur):
    out = []
    a, b = prev["case"], cur["case"]
    if prev["final_stage"] != cur["final_stage"]:
        order = STAGES
        direction = "towards inactive" if order.index(cur["final_stage"]) > order.index(prev["final_stage"]) else "towards active"
        out.append(f"Stage {prev['final_stage']} -> {cur['final_stage']} ({direction})")
    if a.get("size_cm") and b.get("size_cm"):
        d = b["size_cm"] - a["size_cm"]
        if abs(d) >= 0.2:
            out.append(f"Size {a['size_cm']:g} -> {b['size_cm']:g} cm ({'+' if d > 0 else ''}{d:.1f} cm)")
    for k in FEATS:
        if a.get(k) != b.get(k) and "unknown" not in (a.get(k), b.get(k)):
            out.append(f"{LABELS[k].split(' (')[0]}: {a.get(k)} -> {b.get(k)}")
    return out or ["No structural change reported"]


@app.get("/api/patients")
def list_patients():
    db = _load()
    return [{"id": k, "name": v["name"], "exams": len(v["exams"]),
             "last_stage": v["exams"][-1]["final_stage"] if v["exams"] else None} for k, v in db.items()]


@app.get("/api/patients/{pid}")
def get_patient(pid: str):
    db = _load()
    if pid not in db:
        return JSONResponse({"error": "Patient not found"}, status_code=404)
    p = db[pid]
    exams = sorted(p["exams"], key=lambda e: e["date"])
    for i, e in enumerate(exams):
        e["changes"] = _changes(exams[i - 1], e) if i else ["Baseline examination"]
    return dict(p, id=pid, exams=exams)


class ExamIn(BaseModel):
    patient_id: str
    name: str = ""
    age: Optional[str] = None
    sex: Optional[str] = None
    date: Optional[str] = None
    case: Dict[str, Any]
    stage: str
    confidence: str
    final_stage: str


@app.post("/api/patients/exam")
def add_exam(e: ExamIn):
    pid = e.patient_id.strip() or "UNNAMED"
    with _lock:
        db = _load()
        p = db.setdefault(pid, {"name": e.name or pid, "age": e.age, "sex": e.sex, "exams": []})
        p["exams"].append({"date": e.date or datetime.date.today().isoformat(), "case": _clean_case(e.case),
                           "stage": e.stage, "confidence": e.confidence, "final_stage": e.final_stage,
                           "source": "clinician"})
        _save(db)
    return {"saved": True, "patient_id": pid, "exams": len(p["exams"])}
