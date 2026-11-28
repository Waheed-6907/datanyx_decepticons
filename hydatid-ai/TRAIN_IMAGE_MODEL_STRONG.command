#!/bin/bash
# Double-click to train the CystStage image model on your scans (uses the Mac GPU).
cd "$(dirname "$0")"
echo "== CystStage AI · STRONG image model training (EfficientNet-B2, 5-fold CV, ~45-90 min) =="
IMAGES=$(osascript -e 'POSIX path of (choose folder with prompt "Select the scan folder that contains the 1, 2, 3, 4, 5 sub-folders")' 2>/dev/null)
if [ -z "$IMAGES" ]; then echo "No folder chosen. Close this window and try again."; exit 1; fi
echo "Images: $IMAGES"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
echo "Installing PyTorch + tools (first time only, can take a few minutes on slow Wi-Fi)..."
pip install -q --default-timeout=300 --retries 10 torch torchvision scikit-learn matplotlib pillow pandas xgboost joblib
# XGBoost on Mac needs the OpenMP runtime; without it the trainer falls back to sklearn gradient boosting
if ! python -c "import xgboost" >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then brew install libomp; fi
# keep the scans out of git if the folder is inside the repo
REPO="$(cd .. && pwd)"
case "$IMAGES" in "$REPO"/*) REL="${IMAGES#$REPO/}"; grep -qxF "$REL" ../.gitignore || echo "$REL" >> ../.gitignore; echo "(added $REL to .gitignore so the scans are not uploaded)";; esac
CSV=""
for c in ../hydatid_cyst_attributes.csv "$IMAGES/hydatid_cyst_attributes.csv" "$IMAGES/../hydatid_cyst_attributes.csv"; do [ -f "$c" ] && CSV="$c" && break; done
python image_model.py train --strong --images "$IMAGES" ${CSV:+--csv "$CSV"} 2>&1 | tee image_model_out_train.log
[ -f image_model_out/confusion_matrix.png ] && open image_model_out/confusion_matrix.png
echo
echo "Done. Restart the app (close the START_APP window and double-click START_APP.command) to use the image AI."
