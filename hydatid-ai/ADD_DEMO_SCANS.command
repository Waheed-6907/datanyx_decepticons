#!/bin/bash
# Double-click to put real scans from the dataset into the demo (12 per stage).
cd "$(dirname "$0")"
echo "== CystStage AI · add real demo scans =="
IMAGES=$(osascript -e 'POSIX path of (choose folder with prompt "Select the scan folder that contains the 1, 2, 3, 4, 5 sub-folders")' 2>/dev/null)
if [ -z "$IMAGES" ]; then echo "No folder chosen. Close this window and try again."; exit 1; fi
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
pip install -q --default-timeout=200 --retries 10 pillow
python add_demo_scans.py "$IMAGES" 12
REPO="$(cd .. && pwd)"
case "$IMAGES" in "$REPO"/*) REL="${IMAGES#$REPO/}"; grep -qxF "$REL" ../.gitignore || echo "$REL" >> ../.gitignore;; esac
echo
echo "Now restart the app (close the START_APP window, double-click START_APP.command)."
