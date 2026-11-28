"""CystStage AI web app.

Run:  uvicorn server:app --reload        then open http://localhost:8000
"""
import base64
import csv
import datetime
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import model
from clues import BINARY_CLUES, LABELS, PHASE, STAGES, empty_case
from engine import assess
from extractor import extract
from report import build_pdf
from test_cases import REPORTS

HERE = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="CystStage AI")
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


class AssessIn(BaseModel):
    mode: str = "text"                      # "text" | "checklist"
    text: str = ""
    case: Optional[Dict[str, Any]] = None
    use_llm: bool = False


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
    return case, evidence, engine_used, assess(case)


@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "static", "index.html"))


@app.get("/api/meta")
def meta():
    return {"stages": STAGES, "phase": PHASE, "labels": LABELS, "binary": BINARY_CLUES,
            "samples": REPORTS, "model_loaded": model.load() is not None,
            "llm_available": bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("GEMINI_API_KEY"))}


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
