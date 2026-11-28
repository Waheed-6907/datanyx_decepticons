# CystStage AI — DATANYX'26 · MED-02 (Team Decepticons)

Evidence-based hydatid cyst staging (WHO-IWGE) with uncertainty flags and a doctor-in-the-loop web app.

## Run
```bash
cd hydatid-ai
python3 -m venv .venv && source .venv/bin/activate
pip install --default-timeout=200 -r requirements.txt
python make_synthetic.py 5000      # placeholder data -> data/cases.csv
python model.py data/cases.csv     # trains XGBoost -> stage_model.joblib
python test_cases.py               # 7 sample reports, should be 7/7
uvicorn server:app --reload        # open http://localhost:8000
```
Optional LLM report reader: `export ANTHROPIC_API_KEY=...` (or `GEMINI_API_KEY=...`) before starting the server,
then switch on "AI report reader" in the app. Without a key the offline keyword reader is used, so the demo never breaks.

## Easiest way to run (Mac)
Double-click **START_APP.command** — it installs everything, trains the model and opens http://127.0.0.1:8000.
Double-click **PUSH_TO_GITHUB.command** to commit and push your changes.

## Views
| View | What it shows |
|---|---|
| Home | 3D hero cycling through all stages, how it works, feature tour |
| Assess | Self-doubt engine, stage + phase, 3D model, referral priority, evidence, doctor-vs-AI second opinion, management, assessment passport, confirm/override, PDF, save to digital twin, voice dictation, scan quality coach |
| 3D Stages | Interactive 3D model of every WHO-IWGE stage with labelled signs, plain-language explanation, size slider, auto-play |
| Digital Twin | Patient timeline across exams, size/stage chart, cyst change report, 3D model per exam |
| What-if | Change findings, size, organ, complications and watch the guideline pathway respond |
| Knowledge Graph | 3D graph of sign → stage → phase → management (every rule the engine uses) |

## What the web app does
- **Scan report** mode: paste a report (or click a sample) → stage, phase, confidence, evidence sentences highlighted.
- **Findings checklist** mode: tick findings, leave "?" for not assessed → live re-staging and "please check" prompts.
- Stage track CL → CE5 with the predicted stage and the alternatives still possible.
- Confidence checks: judges agree · ML ≥ 70% · key findings reported.
- Management options for clinician review (stage + size + complications).
- Clinician confirm / override (logged to `decisions.csv` for retraining) and **PDF report** with the attached scan image.

## Files
| File | Role |
|---|---|
| `server.py` | FastAPI backend: `/api/assess`, `/api/report` (PDF), `/api/decision`, `/api/meta` |
| `static/` | Frontend: `index.html`, `style.css`, `app.js` (no build step) |
| `clues.py` | Shared clue schema used by every module and dataset |
| `extractor.py` | Report text → clues + evidence sentences (keywords or LLM) |
| `rules.py` | WHO-IWGE rule judge + open alternatives |
| `model.py` | XGBoost judge + SHAP reasons |
| `engine.py` | Uncertainty check and final assessment |
| `treatment.py` | Stage + size → management options (**verify cut-offs vs WHO guidelines**) |
| `report.py` | PDF report |

## Plugging in the team's real data
CSV with columns (values `yes` / `no` / `unknown`):
`wall_visible, hydatid_sand, septations, daughter_cysts, detached_membrane, solid_matrix, ball_of_wool, complicated, calcification (none/partial/complete/unknown), size_cm, organ, stage (CL/CE1/CE2/CE3a/CE3b/CE4/CE5)`
then `python model.py path/to/your.csv` and restart the server.

> Decision support only. Outputs are experimental and must be confirmed by a qualified clinician.
