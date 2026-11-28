# CystStage AI — DATANYX'26 · MED-02 (Team Decepticons)

Evidence-based hydatid cyst staging (WHO-IWGE) with uncertainty and doctor-in-the-loop.

## Run (5 minutes)
```bash
pip install -r requirements.txt
python make_synthetic.py 5000      # placeholder data -> data/cases.csv
python model.py data/cases.csv     # trains XGBoost -> stage_model.joblib
python test_cases.py               # 7 sample reports, should be 7/7
streamlit run app.py               # doctor screen
```
Optional LLM extractor: `export ANTHROPIC_API_KEY=...` (or `GEMINI_API_KEY=...`) and flip the toggle in the app.
Without a key the offline keyword extractor is used, so the demo never breaks.

## Files
| File | Station | What it does |
|---|---|---|
| `clues.py` | schema | The clue names every dataset row must use |
| `extractor.py` | 1 | Report text -> clues + evidence sentences |
| `rules.py` | 2a | WHO-IWGE rule judge + open alternatives |
| `model.py` | 2b | XGBoost judge + SHAP reasons |
| `engine.py` | 3 | Uncertainty check (agree? confident? key clues known?) |
| `treatment.py` | 4 | Stage + size -> treatment options (VERIFY cut-offs vs WHO-IWGE 2010) |
| `app.py` | 5 | Streamlit doctor screen, decisions logged to `decisions.csv` |

## Plugging in the team's real data
Save it as CSV with these columns (values `yes` / `no` / `unknown`):
`wall_visible, hydatid_sand, septations, daughter_cysts, detached_membrane, solid_matrix, ball_of_wool, complicated, calcification (none/partial/complete/unknown), size_cm, organ, stage (CL/CE1/CE2/CE3a/CE3b/CE4/CE5)`
then `python model.py path/to/your.csv`.
