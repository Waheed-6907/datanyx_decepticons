"""Glue: clues -> two judges -> uncertainty check -> treatment + explanation."""
import model
import rules
import treatment
from clues import PHASE

PROB_THRESHOLD = 0.70


def assess(case):
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
    failed = [k for k, ok in checks.items() if not ok]
    level = "High" if not failed else "Medium" if len(failed) == 1 else "Low"

    ask_for = list(missing)
    for alt in rule["alternatives"]:
        ask_for += [c for c in alt["if_present"] if c not in ask_for]

    differential = []
    if ml_stage and ml_stage != stage:
        differential.append(f"ML model leans {ml_stage} ({ml_prob:.0%}); rules say {stage}.")
    for alt in rule["alternatives"]:
        differential.append(f"Could be {alt['stage']} if {', '.join(alt['if_present'])} is present.")

    return {
        "stage": stage,
        "phase": PHASE[stage],
        "confidence": level,
        "checks": checks,
        "rule": rule,
        "ml_probs": probs,
        "ml_reasons": model.top_reasons(case) if probs else [],
        "ask_for": ask_for,
        "differential": differential,
        "treatment": treatment.recommend(stage, case.get("size_cm"),
                                         case.get("complicated", "unknown"),
                                         case.get("organ", "unknown")),
    }
