"""ML judge: XGBoost on the clue table, with isotonic probability calibration.

Train:   python model.py data/cases.csv
Expects one row per case with the columns from clues.py plus 'stage'.
yes/no/unknown -> 1/0/NaN (XGBoost handles NaN natively = 'unknown').

Saved bundle: {"model": calibrated classifier (used for probabilities),
               "raw": plain XGBoost (used for SHAP explanations), "metrics": {...}}
"""
import os
import sys

import joblib
import numpy as np
import pandas as pd

from clues import BINARY_CLUES, STAGES

FEATURES = [c for c in BINARY_CLUES if c != "complicated"] + ["calcification", "size_cm"]
BIN_MAP = {"yes": 1.0, "no": 0.0}
CALC_MAP = {"none": 0.0, "partial": 1.0, "complete": 2.0}
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stage_model.joblib")


def encode(df):
    X = pd.DataFrame(index=df.index)
    for c in FEATURES:
        if c == "calcification":
            X[c] = df[c].map(CALC_MAP)
        elif c == "size_cm":
            X[c] = pd.to_numeric(df[c], errors="coerce")
        else:
            X[c] = df[c].map(BIN_MAP)
    return X.astype(float)


def ece(probs, y, bins=10):
    """Expected calibration error: gap between stated confidence and real accuracy."""
    conf, pred = probs.max(1), probs.argmax(1)
    edges, e = np.linspace(0, 1, bins + 1), 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return float(e)


def _xgb():
    from xgboost import XGBClassifier
    return XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.1,
                         objective="multi:softprob", eval_metric="mlogloss")


def train(csv_path):
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, log_loss
    from sklearn.model_selection import train_test_split

    df = pd.read_csv(csv_path).fillna({c: "unknown" for c in FEATURES if c != "size_cm"})
    df = df[df["stage"].isin(STAGES)]
    X, y = encode(df), df["stage"].map({s: i for i, s in enumerate(STAGES)}).values
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    raw = _xgb().fit(Xtr, ytr)
    cal = CalibratedClassifierCV(_xgb(), method="isotonic", cv=5).fit(Xtr, ytr)

    rows = {}
    for name, m in (("XGBoost (raw)", raw), ("XGBoost + isotonic", cal)):
        p = m.predict_proba(Xte)
        rows[name] = {"accuracy": accuracy_score(yte, p.argmax(1)), "macro_f1": f1_score(yte, p.argmax(1), average="macro"),
                      "log_loss": log_loss(yte, np.clip(p, 1e-7, 1), labels=list(range(len(STAGES)))), "ece": ece(p, yte)}
    print("\n%-20s %8s %9s %9s %7s" % ("model", "accuracy", "macro-F1", "log-loss", "ECE"))
    for n, r in rows.items():
        print("%-20s %8.3f %9.3f %9.3f %7.3f" % (n, r["accuracy"], r["macro_f1"], r["log_loss"], r["ece"]))

    pred = cal.predict_proba(Xte).argmax(1)
    present = sorted(set(yte) | set(pred))
    print("\n" + classification_report(yte, pred, labels=present, target_names=[STAGES[i] for i in present], digits=3))
    print("Confusion matrix (rows = true):\n", confusion_matrix(yte, pred, labels=present))
    joblib.dump({"model": cal, "raw": raw, "metrics": {k: {a: round(b, 4) for a, b in v.items()} for k, v in rows.items()}}, MODEL_PATH)
    print("saved", MODEL_PATH)
    return cal


_model = None


def load():
    """Returns the bundle dict, or None if no trained model yet."""
    global _model
    if _model is None:
        try:
            obj = joblib.load(MODEL_PATH)
            _model = obj if isinstance(obj, dict) else {"model": obj, "raw": obj, "metrics": {}}
        except FileNotFoundError:
            _model = False
        except Exception as e:  # e.g. XGBoost runtime missing
            print("ML model could not load:", e)
            _model = False
    return _model or None


def predict(case):
    """Return {stage: prob} (isotonic-calibrated) or None if no trained model yet."""
    b = load()
    if b is None:
        return None
    probs = b["model"].predict_proba(encode(pd.DataFrame([case])))[0]
    probs = probs / probs.sum()
    return {STAGES[i]: float(p) for i, p in enumerate(probs)}


def top_reasons(case, k=3):
    """SHAP on the raw XGBoost: the k clues that pushed the model most towards its top stage."""
    b = load()
    if b is None:
        return []
    import shap
    X = encode(pd.DataFrame([case]))
    cls = int(np.argmax(b["model"].predict_proba(X)[0]))
    sv = shap.TreeExplainer(b["raw"]).shap_values(X)
    vals = sv[cls][0] if isinstance(sv, list) else np.asarray(sv)[0, :, cls]
    order = np.argsort(-np.abs(vals))[:k]
    return [(FEATURES[i], float(vals[i])) for i in order]


if __name__ == "__main__":
    train(sys.argv[1] if len(sys.argv) > 1 else "data/cases.csv")
