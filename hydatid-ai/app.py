"""Doctor screen.  Run:  streamlit run app.py"""
import csv
import datetime
import os

import streamlit as st

from clues import BINARY_CLUES, LABELS, STAGES, empty_case
from engine import assess
from extractor import extract
from test_cases import REPORTS

st.set_page_config(page_title="CystStage AI", page_icon="🩺", layout="wide")
st.title("CystStage AI")
st.caption("Evidence-based hydatid cyst staging (WHO-IWGE). Decision support only: "
           "every result must be confirmed by a clinician.")

left, right = st.columns([1, 1.3], gap="large")

with left:
    mode = st.radio("Input", ["Scan report (text)", "Clue checklist"], horizontal=True)
    evidence, engine_used = {}, "checklist"
    if mode == "Scan report (text)":
        sample = st.selectbox("Load a sample report", ["(none)"] + list(REPORTS))
        text = st.text_area("Paste the ultrasound / CT report", height=180,
                            value="" if sample == "(none)" else REPORTS[sample])
        use_llm = st.toggle("Use LLM extractor (needs API key)", value=False)
        if not text.strip():
            st.info("Paste a report or load a sample.")
            st.stop()
        case, evidence, engine_used = extract(text, use_llm=use_llm)
    else:
        case = empty_case()
        for c in BINARY_CLUES:
            case[c] = st.radio(LABELS[c], ["unknown", "yes", "no"], horizontal=True, key=c)
        case["calcification"] = st.radio(LABELS["calcification"],
                                         ["unknown", "none", "partial", "complete"], horizontal=True)
        size = st.number_input("Cyst size in cm (0 = unknown)", 0.0, 40.0, 0.0, 0.5)
        case["size_cm"] = size or None
        case["organ"] = st.radio("Organ", ["liver", "lung", "other"], horizontal=True)

    with st.expander("Clues the system read", expanded=mode.startswith("Scan")):
        for k, v in case.items():
            quote = f' — "{evidence[k]}"' if k in evidence else ""
            st.markdown(f"- **{LABELS.get(k, k)}:** `{v}`{quote}")
        st.caption(f"Extractor: {engine_used}")

r = assess(case)

with right:
    colour = {"High": "green", "Medium": "orange", "Low": "red"}[r["confidence"]]
    st.subheader(f"Stage {r['stage']} · {r['phase']}")
    st.markdown(f"Confidence: :{colour}[**{r['confidence']}**]")
    if r["ml_probs"]:
        st.bar_chart({s: r["ml_probs"][s] for s in STAGES}, height=180)

    st.markdown("#### Why")
    st.markdown(f"- Rule fired: **{r['rule']['rule']}**")
    for clue, val in r["rule"]["fired_on"].items():
        q = evidence.get(clue)
        st.markdown(f"- {LABELS[clue]} = `{val}`" + (f'  \n  > "{q}"' if q else ""))
    for clue, val in r["ml_reasons"]:
        st.markdown(f"- Model weight: {LABELS.get(clue, clue)} ({'+' if val > 0 else ''}{val:.2f})")

    if r["differential"] or r["ask_for"]:
        st.markdown("#### What could change this")
        for d in r["differential"]:
            st.warning(d)
        if r["ask_for"]:
            st.info("Please check: " + ", ".join(LABELS.get(c, c) for c in r["ask_for"]))

    st.markdown("#### Treatment options (for clinician review)")
    for o in r["treatment"]["options"]:
        st.markdown(f"- {o}")
    st.caption(r["treatment"]["reason"])
    for n in r["treatment"]["notes"]:
        st.caption("⚠ " + n)

    st.markdown("#### Clinician decision")
    final = st.selectbox("Final stage", STAGES, index=STAGES.index(r["stage"]))
    note = st.text_input("Note (optional)")
    if st.button("Confirm decision", type="primary"):
        new = not os.path.exists("decisions.csv")
        with open("decisions.csv", "a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "ai_stage", "ai_confidence", "final_stage", "override", "note"])
            w.writerow([datetime.datetime.now().isoformat(timespec="seconds"), r["stage"],
                        r["confidence"], final, final != r["stage"], note])
        st.success("Saved" + (" as an override: this case will be used to retrain the model."
                              if final != r["stage"] else "."))
