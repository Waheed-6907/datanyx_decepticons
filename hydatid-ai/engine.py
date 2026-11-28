"""Glue: clues -> two judges -> self-doubt engine -> referral + treatment + passport."""
import datetime
import hashlib
import json
import os
import uuid

import model
import rules
import treatment
from clues import LABELS, PHASE

PROB_THRESHOLD = 0.70
ENGINE_VERSION = "CystStage engine 2.0"
RULESET_VERSION = "WHO-IWGE ultrasound staging rules v1.0"


def _model_tag():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), model.MODEL_PATH)
    if not os.path.exists(path):
        return "none (rules only)"
    h = hashlib.sha256(open(path, "rb").read()).hexdigest()[:10]
    return f"XGBoost {h}"


def self_doubt(stage, level, checks, missing, alternatives, ml_stage, ml_prob, case, image_quality=None, image_pred=None):
    """Decide whether the system should commit to a stage or ask for review."""
    reasons = []
    if not checks["judges_agree"]:
        reasons.append(f"The two judges disagree (rules: {stage}, ML: {ml_stage} {ml_prob:.0%}).")
    if not checks["ml_confident"]:
        reasons.append(f"ML model is only {ml_prob:.0%} sure.")
    if missing:
        reasons.append("Key findings not reported: " + ", ".join(LABELS.get(c, c) for c in missing) + ".")
    if stage == "CL":
        reasons.append("No sign specific to hydatid disease was reported, so the lesion is not confirmed.")
    known = sum(1 for k, v in case.items() if v not in ("unknown", None) and k not in ("organ",))
    if known <= 2:
        reasons.append(f"Very little information: only {known} finding(s) reported.")
    if image_quality and image_quality.get("issues"):
        reasons.append("Image quality: " + "; ".join(image_quality["issues"]) + ".")
    img_disagree = False
    if image_pred and image_pred.get("stage"):
        ist, ip = image_pred["stage"], float(image_pred.get("prob", 0))
        same = ist == stage or (ist == "CE3" and stage in ("CE3a", "CE3b"))
        if not same:
            img_disagree = True
            reasons.append(f"The image model sees {ist} ({ip:.0%}) but the reported findings point to {stage}.")
        elif ip < 0.6:
            reasons.append(f"The image model agrees ({ist}) but is only {ip:.0%} sure.")

    if level == "Low" or known <= 2 or stage == "CL":
        verdict, title = "review", "Review required: insufficient evidence"
        action = "Obtain additional views / complete the report and request specialist assessment."
    elif level == "Medium" or img_disagree or (image_quality and image_quality.get("issues")):
        verdict, title = "caution", "Probable stage, confirm before acting"
        action = "Check the listed findings before choosing treatment."
    else:
        verdict, title = "confident", "Evidence is consistent"
        action = "Clinician confirms the stage."
    return {"verdict": verdict, "title": title, "reasons": reasons, "action": action}


def referral(stage, case, level):
    size = case.get("size_cm") or 0
    if case.get("complicated") == "yes":
        return {"level": "urgent", "label": "Urgent specialist review",
                "why": "A complication (rupture, infection or biliary leak) was reported."}
    if level == "Low" or stage == "CL":
        return {"level": "expert", "label": "Expert review before staging",
                "why": "The assessment is uncertain; a specialist should confirm the stage."}
    if stage in ("CE1", "CE2", "CE3a", "CE3b") and size >= 10:
        return {"level": "priority", "label": "Priority referral",
                "why": f"Large active/transitional cyst ({size:g} cm)."}
    if stage in ("CE1", "CE2", "CE3a", "CE3b"):
        return {"level": "routine", "label": "Routine specialist referral",
                "why": "Active or transitional cyst that usually needs treatment planning."}
    return {"level": "followup", "label": "Routine follow-up imaging",
            "why": "Inactive uncomplicated cyst; usually monitored."}


def passport(case):
    payload = json.dumps(case, sort_keys=True, default=str).encode()
    return {
        "assessment_id": "CS-" + uuid.uuid4().hex[:8].upper(),
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "input_hash": hashlib.sha256(payload).hexdigest()[:16],
        "engine": ENGINE_VERSION,
        "ruleset": RULESET_VERSION,
        "model": _model_tag(),
        "guidelines": ["who-iwge-2003", "who-iwge-2010", "who-2025"],
        "status": "Experimental decision support, not a diagnosis",
    }


def assess(case, image_quality=None, image_pred=None):
    rule = rules.judge(case)
    probs = model.predict(case)
    stage = rule["stage"]

    ml_stage, ml_prob = None, None
    if probs:
        ml_stage = max(probs, key=probs.get)
        ml_prob = probs[ml_stage]

    missing = rules.missing_key_clues(stage, case)
    checks = {
        "judges_agree": ml_stage is None or ml_stage == stage,
        "ml_confident": ml_prob is None or ml_prob >= PROB_THRESHOLD,
        "key_clues_present": not missing,
    }
    if image_pred and image_pred.get("stage"):
        ist = image_pred["stage"]
        checks["image_agrees"] = ist == stage or (ist == "CE3" and stage in ("CE3a", "CE3b"))
    failed = [k for k, ok in checks.items() if not ok]
    level = "High" if not failed else "Medium" if len(failed) == 1 else "Low"

    ask_for = list(missing)
    for alt in rule["alternatives"]:
        ask_for += [c for c in alt["if_present"] if c not in ask_for]

    differential = []
    if ml_stage and ml_stage != stage:
        differential.append(f"ML model leans {ml_stage} ({ml_prob:.0%}); rules say {stage}.")
    for alt in rule["alternatives"]:
        names = [c.replace("_", " ") for c in alt["if_present"]]
        verb = "are" if len(names) > 1 else "is"
        differential.append(f"Could be {alt['stage']} if {' and '.join(names)} {verb} present.")

    # numeric confidence score 0-100 (shown on every result)
    ml_part = ml_prob if ml_prob is not None else 0.8
    key = rules.KEY_CLUES[stage]
    complete = 1 - (len(missing) / len(key)) if key else 1.0
    agree = 1.0 if checks["judges_agree"] else 0.4
    score = 0.45 * ml_part + 0.35 * complete + 0.20 * agree
    if image_pred and image_pred.get("stage"):
        ip = float(image_pred.get("prob", 0))
        score *= (0.7 + 0.3 * ip) if checks.get("image_agrees") else (1 - 0.45 * ip)
    score = int(round(100 * max(0.0, min(1.0, score))))
    sd = self_doubt(stage, level, checks, missing, rule["alternatives"], ml_stage, ml_prob, case, image_quality, image_pred)
    needs_review = sd["verdict"] == "review" or score < 60

    return {
        "stage": stage,
        "phase": PHASE[stage],
        "confidence": level,
        "confidence_score": score,
        "needs_review": needs_review,
        "checks": checks,
        "rule": rule,
        "ml_probs": probs,
        "ml_reasons": model.top_reasons(case) if probs else [],
        "ask_for": ask_for,
        "differential": differential,
        "self_doubt": sd,
        "referral": referral(stage, case, level),
        "passport": passport(case),
        "treatment": treatment.recommend(stage, case.get("size_cm"),
                                         case.get("complicated", "unknown"),
                                         case.get("organ", "unknown")),
    }
