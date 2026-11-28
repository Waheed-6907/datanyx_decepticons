"""ML judge: XGBoost on the clue table.

Train:   python model.py data/cases.csv
Expects one row per case with the columns from clues.py plus 'stage'.
yes/no/unknown -> 1/0/NaN (XGBoost handles NaN natively = 'unknown').
"""
import sys

import joblib
import numpy as np
import pandas as pd

from clues import BINARY_CLUES, STAGES

FEATURES = [c for c in BINARY_CLUES if c != "complicated"] + ["calcification", "size_cm"]
BIN_MAP = {"yes": 1.0, "no": 0.0}
CALC_MAP = {"none": 0.0, "partial": 1.0, "complete": 2.0}
MODEL_PATH = "stage_model.joblib"


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


def train(csv_path):
    from sklearn.metrics import classification_report, confusion_matrix
    from sklearn.model_selection import train_test_split
    from xgboost import XGBClassifier

    df = pd.read_csv(csv_path).fillna({c: "unknown" for c in FEATURES if c != "size_cm"})
    df = df[df["stage"].isin(STAGES)]
    X, y = encode(df), df["stage"].map({s: i for i, s in enumerate(STAGES)})
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    model = XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.1,
                          objective="multi:softprob", eval_metric="mlogloss")
    model.fit(Xtr, ytr)
    pred = model.predict(Xte)
    present = sorted(set(yte) | set(pred))
    print(classification_report(yte, pred, labels=present,
                                target_names=[STAGES[i] for i in present], digits=3))
    print("Confusion matrix (rows = true):\n", confusion_matrix(yte, pred, labels=present))
    joblib.dump(model, MODEL_PATH)
    print("saved", MODEL_PATH)
    return model


_model = None


def load():
    global _model
    if _model is None:
        try:
            _model = joblib.load(MODEL_PATH)
        except FileNotFoundError:
            _model = False
    return _model or None


def predict(case):
    """Return {stage: prob} or None if no trained model yet."""
    model = load()
    if model is None:
        return None
    probs = model.predict_proba(encode(pd.DataFrame([case])))[0]
    return {STAGES[i]: float(p) for i, p in enumerate(probs)}


def top_reasons(case, k=3):
    """SHAP: the k clues that pushed the model most towards its top stage."""
    model = load()
    if model is None:
        return []
    import shap
    X = encode(pd.DataFrame([case]))
    probs = model.predict_proba(X)[0]
    cls = int(np.argmax(probs))
    sv = shap.TreeExplainer(model).shap_values(X)
    vals = sv[cls][0] if isinstance(sv, list) else np.asarray(sv)[0, :, cls]
    order = np.argsort(-np.abs(vals))[:k]
    return [(FEATURES[i], float(vals[i])) for i in order]


if __name__ == "__main__":
    train(sys.argv[1] if len(sys.argv) > 1 else "data/cases.csv")
