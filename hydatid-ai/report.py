"""PDF assessment report (fpdf2, core fonts only -> keep text latin-1)."""
import datetime
import io

from fpdf import FPDF

from clues import LABELS

TEAL = (13, 110, 110)
GREY = (90, 90, 90)


def _t(s):
    s = str(s)
    for a, b in {"—": "-", "–": "-", "≥": ">=", "≤": "<=", "·": "-",
                 "‘": "'", "’": "'", "“": '"', "”": '"', "⚠": "!"}.items():
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


class _PDF(FPDF):
    def header(self):
        self.set_fill_color(*TEAL)
        self.rect(0, 0, 210, 22, "F")
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 16)
        self.set_xy(12, 6)
        self.cell(0, 10, "CystStage AI - Hydatid Cyst Assessment")
        self.set_text_color(0, 0, 0)
        self.ln(20)

    def footer(self):
        self.set_y(-18)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*GREY)
        self.multi_cell(0, 4, _t("Experimental decision-support output for clinician review only. "
                                 "Not a diagnosis. Staging per WHO-IWGE ultrasound classification. "
                                 f"Page {self.page_no()}"), align="C")


def _section(pdf, title):
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, _t(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*TEAL)
    pdf.line(pdf.l_margin, pdf.get_y(), 210 - pdf.r_margin, pdf.get_y())
    pdf.ln(2)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 10)


def _line(pdf, text, bold=False):
    pdf.set_font("Helvetica", "B" if bold else "", 10)
    pdf.multi_cell(0, 5.5, _t(text), new_x="LMARGIN", new_y="NEXT")


def build_pdf(patient, case, result, evidence, report_text=None, decision=None, image_bytes=None):
    pdf = _PDF()
    pdf.set_auto_page_break(True, margin=22)
    pdf.add_page()
    pdf.set_font("Helvetica", "", 10)
    now = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    _line(pdf, f"Patient: {patient.get('id') or '-'}    Age: {patient.get('age') or '-'}    "
               f"Sex: {patient.get('sex') or '-'}    Generated: {now}")

    sd = result.get("self_doubt")
    if sd:
        _section(pdf, "Self-doubt engine")
        _line(pdf, sd["title"], bold=True)
        for x in sd["reasons"]:
            _line(pdf, f"- {x}")
        _line(pdf, f"Suggested action: {sd['action']}")

    _section(pdf, "AI assessment")
    _line(pdf, f"Stage: {result['stage']}  ({result['phase']})", bold=True)
    if result.get("referral"):
        _line(pdf, f"Referral priority: {result['referral']['label']} - {result['referral']['why']}")
    _line(pdf, f"Confidence: {result['confidence']}")
    if result["ml_probs"]:
        top = sorted(result["ml_probs"].items(), key=lambda kv: -kv[1])[:3]
        _line(pdf, "Model probabilities: " + ", ".join(f"{s} {p:.0%}" for s, p in top))
    checks = {"judges_agree": "Rule judge and ML judge agree",
              "ml_confident": "ML probability >= 70%",
              "key_clues_present": "All key findings for this stage reported",
              "image_agrees": "Image AI agrees with the reported findings"}
    for k, ok in result["checks"].items():
        _line(pdf, f"[{'x' if ok else ' '}] {checks[k]}")

    _section(pdf, "Evidence")
    _line(pdf, f"Rule applied: {result['rule']['rule']}")
    for clue, val in result["rule"]["fired_on"].items():
        q = evidence.get(clue)
        _line(pdf, f"- {LABELS.get(clue, clue)}: {val}" + (f'   "{q}"' if q else ""))
    for clue, val in result["ml_reasons"]:
        _line(pdf, f"- Model weight: {LABELS.get(clue, clue)} ({val:+.2f})")

    if result["differential"] or result["ask_for"]:
        _section(pdf, "Uncertainty and differential")
        for d in result["differential"]:
            _line(pdf, f"- {d}")
        if result["ask_for"]:
            _line(pdf, "Please check: " + ", ".join(LABELS.get(c, c) for c in result["ask_for"]))

    _section(pdf, "Management options (for clinician review)")
    for o in result["treatment"]["options"]:
        _line(pdf, f"- {o}")
    _line(pdf, result["treatment"]["reason"])
    for n in result["treatment"]["notes"]:
        _line(pdf, f"Note: {n}")

    _section(pdf, "Findings recorded")
    for k, v in case.items():
        _line(pdf, f"{LABELS.get(k, k)}: {v if v is not None else 'unknown'}")

    if report_text:
        _section(pdf, "Source report")
        _line(pdf, report_text)

    if image_bytes:
        try:
            _section(pdf, "Attached image")
            pdf.image(io.BytesIO(image_bytes), w=90)
        except Exception:
            _line(pdf, "(image could not be embedded)")

    p = result.get("passport")
    if p:
        _section(pdf, "Assessment passport")
        _line(pdf, f"ID {p['assessment_id']}  |  {p['timestamp']}  |  input hash {p['input_hash']}")
        _line(pdf, f"{p['engine']}  |  {p['ruleset']}  |  model: {p['model']}")
        _line(pdf, "Guidelines: " + ", ".join(p["guidelines"]))

    _section(pdf, "Clinician decision")
    if decision:
        _line(pdf, f"Final stage: {decision['final']}   "
                   f"{'(override of AI)' if decision['final'] != result['stage'] else '(agrees with AI)'}")
        if decision.get("note"):
            _line(pdf, f"Note: {decision['note']}")
    else:
        _line(pdf, "Pending review.  Signature: ____________________")
    return bytes(pdf.output())
