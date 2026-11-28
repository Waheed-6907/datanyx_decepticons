#!/bin/bash
# Double-click to commit and push the CystStage AI project
cd "$(dirname "$0")/.."
echo "== Pushing to GitHub =="
git rm -q --cached hydatid-ai/app.py 2>/dev/null; rm -f hydatid-ai/app.py
grep -qx "stage_model.joblib" .gitignore 2>/dev/null || true
git add -A
git commit -m "Web app: FastAPI backend + new frontend, PDF report, image upload, launchers" || echo "(nothing new to commit)"
git pull --rebase origin main && git push origin main
echo
git log --oneline -3
echo
echo "Done. You can close this window."
