#!/bin/bash
# Double-click to start CystStage AI
cd "$(dirname "$0")"
echo "== CystStage AI =="
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
echo "Installing / checking packages (first time can take a few minutes)..."
pip install -q --default-timeout=200 --retries 10 -r requirements.txt
# XGBoost on Mac needs the OpenMP runtime
if ! python -c "import xgboost" >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then echo "Installing libomp for XGBoost..."; brew install libomp; \
  else echo "NOTE: install Homebrew + 'brew install libomp' to enable the ML model. Running in rules-only mode."; fi
fi
if [ ! -f data/cases.csv ]; then python make_synthetic.py 5000; fi
if [ ! -f stage_model.joblib ] && python -c "import xgboost" >/dev/null 2>&1; then python model.py data/cases.csv; fi
( sleep 4; open "http://127.0.0.1:8000" ) &
echo "Starting server at http://127.0.0.1:8000  (close this window to stop)"
uvicorn server:app --host 127.0.0.1 --port 8000
