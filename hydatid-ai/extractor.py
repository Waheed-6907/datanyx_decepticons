"""Clue extractor: free-text ultrasound report -> clues + evidence quotes.

Two engines:
  * keyword engine  - offline, instant, never fails in a demo (default)
  * LLM engine      - used when ANTHROPIC_API_KEY or GEMINI_API_KEY is set;
                      falls back to the keyword engine on any error.
Both return (case_dict, evidence_dict) where evidence[clue] = source sentence.
"""
import json
import os
import re

from clues import BINARY_CLUES, YES, NO, UNKNOWN, empty_case

NEG = r"(?:no|without|absent|absence of|not seen|not visualized|not visualised|negative for|free of)\b[^.;]{0,40}?"

PATTERNS = {
    "wall_visible": r"double[- ]?line|double[- ]?wall|(?:visible|distinct|well[- ]defined|thick(?:ened)?) (?:cyst )?wall|wall (?:is )?(?:visible|seen)",
    "hydatid_sand": r"hydatid sand|snow ?flake|mobile echogenic (?:foci|debris|particles)",
    "septations": r"septat|honey ?comb|multi[- ]?loculat|multi[- ]?vesicular|rosette|cartwheel",
    "daughter_cysts": r"daughter (?:cyst|vesicle)s?",
    "detached_membrane": r"(?:detached|floating|undulating|collapsed) (?:laminated )?membrane|membrane (?:is )?detach|water[- ]?lil(?:y|ies)|serpent sign|snake sign",
    "solid_matrix": r"solid (?:matrix|component|content)|echogenic matrix|heterogeneous matrix|mixed echogenic",
    "ball_of_wool": r"ball[- ]of[- ]wool|wool|canalicular|serpiginous|heterogeneous (?:solid |degenerat\w* )?content",
    "complicated": r"ruptur|infected|abscess|cysto[- ]?biliary|biliary communication|bile leak|fistula",
}
CALC_COMPLETE = r"egg[- ]?shell calcif|complete(?:ly)? calcif|densely calcified|thick(?:ly)? calcified|calcified (?:cyst|wall|lesion)"
CALC_PARTIAL = r"partial(?:ly)? calcif|focal calcif|calcific foci|rim calcif|calcif"
SIZE = r"(\d+(?:\.\d+)?)\s*(?:x\s*\d+(?:\.\d+)?\s*)*(cm|mm)"


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.;\n])\s+", text) if s.strip()]


def keyword_extract(text):
    case, ev = empty_case(), {}
    for sent in _sentences(text):
        low = sent.lower()
        for clue, pat in PATTERNS.items():
            if re.search(NEG + "(?:" + pat + ")", low):
                case[clue], ev[clue] = NO, sent
            elif re.search(pat, low) and case[clue] != YES:
                case[clue], ev[clue] = YES, sent
        if re.search(NEG + "calcif", low):
            case["calcification"], ev["calcification"] = "none", sent
        elif re.search(CALC_COMPLETE, low):
            case["calcification"], ev["calcification"] = "complete", sent
        elif re.search(CALC_PARTIAL, low) and case["calcification"] != "complete":
            case["calcification"], ev["calcification"] = "partial", sent
        m = re.search(SIZE, low)
        if m and case["size_cm"] is None:
            val = float(m.group(1))
            case["size_cm"] = val / 10 if m.group(2) == "mm" else val
            ev["size_cm"] = sent
        if case["organ"] == UNKNOWN:
            if re.search(r"liver|hepatic", low) or (re.search(r"lobe", low) and not re.search(r"lung|pulmonary|thorax|chest", low)):
                case["organ"], ev["organ"] = "liver", sent
            elif re.search(r"lung|pulmonary|thorax|chest", low):
                case["organ"], ev["organ"] = "lung", sent
        if case.get("segment") is None:
            ms = re.search(r"segment\s*(viii|vii|vi|ivb|iva|iv|v|iii|ii|i|[1-8])\b", low)
            if ms:
                roman = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI", "7": "VII", "8": "VIII", "IVA": "IVa", "IVB": "IVb"}
                v = ms.group(1).upper(); case["segment"] = roman.get(v, v); ev["segment"] = sent
                if case["organ"] == UNKNOWN:
                    case["organ"] = "liver"
            elif re.search(r"right (?:hepatic )?lobe", low):
                case["segment"], ev["segment"] = "right lobe", sent
            elif re.search(r"left (?:hepatic )?lobe", low):
                case["segment"], ev["segment"] = "left lobe", sent
        # lung lobe (RUL/RML/RLL/LUL/LLL), from words like "right lower lobe" or "RLL"
        if case.get("lobe") is None:
            lm = re.search(r"\b(right|left)\s+(upper|middle|lower)\s+lobe\b", low) or re.search(r"\b(rul|rml|rll|lul|lll)\b", low)
            if lm:
                if lm.lastindex == 2:
                    code = {("right", "upper"): "RUL", ("right", "middle"): "RML", ("right", "lower"): "RLL",
                            ("left", "upper"): "LUL", ("left", "lower"): "LLL"}.get((lm.group(1), lm.group(2)))
                else:
                    code = lm.group(1).upper()
                if code:
                    case["lobe"], ev["lobe"] = code, sent
                    if case["organ"] == UNKNOWN:
                        case["organ"] = "lung"
        # implied negatives from 'simple / unilocular / anechoic'
        if re.search(r"unilocular|simple cyst|uniloculated", low):
            for c in ("septations", "daughter_cysts"):
                if case[c] == UNKNOWN:
                    case[c], ev[c] = NO, sent
        if re.search(r"anechoic|homogeneous", low):
            for c in ("solid_matrix", "ball_of_wool"):
                if case[c] == UNKNOWN:
                    case[c], ev[c] = NO, sent
    return case, ev


LLM_PROMPT = """You extract findings from a hydatid cyst ultrasound/CT report.
Return ONLY JSON with these keys:
{keys}
Rules: binary clues are "yes", "no" or "unknown" (unknown = report does not say).
calcification is "none", "partial", "complete" or "unknown". size_cm is the largest
diameter in cm as a number, or null. organ is "liver", "lung", "other" or "unknown".
segment is the Couinaud liver segment as a Roman numeral ("I".."VIII"), "right lobe", "left lobe" or null.
Also return "evidence": an object mapping each non-unknown key to the exact sentence
from the report that supports it. Never guess; prefer "unknown".

REPORT:
{report}"""


def _llm_call(prompt):
    if os.getenv("ANTHROPIC_API_KEY"):
        import anthropic
        msg = anthropic.Anthropic().messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5"), max_tokens=1000,
            messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    if os.getenv("GEMINI_API_KEY"):
        import google.generativeai as genai
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.0-flash"))
        return model.generate_content(prompt).text
    return None


def llm_extract(text):
    keys = BINARY_CLUES + ["calcification", "size_cm", "organ", "segment"]
    raw = _llm_call(LLM_PROMPT.format(keys=", ".join(keys), report=text))
    if raw is None:
        return None
    data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    case = empty_case()
    for k in keys:
        if k in data and data[k] is not None:
            case[k] = data[k]
    if case["size_cm"] is not None:
        case["size_cm"] = float(case["size_cm"])
    return case, data.get("evidence", {})


def extract(text, use_llm=True):
    if use_llm:
        try:
            out = llm_extract(text)
            if out:
                return out + ("llm",)
        except Exception as e:  # demo must never crash
            print("LLM extraction failed, using keywords:", e)
    return keyword_extract(text) + ("keywords",)
