#!/usr/bin/env bash
# Local dev bootstrap: installs deps, starts backend+frontend, tails both.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cd "$ROOT/backend"
[ -d venv ] || python3 -m venv venv
PY=$([ -x "venv/Scripts/python.exe" ] && echo "venv/Scripts/python.exe" || echo "venv/bin/python")
"$PY" -m pip install -q -r requirements.txt

cd "$ROOT/frontend"
[ -d node_modules ] || npm install

cd "$ROOT"
echo "▸ Starting backend on :8000 and frontend on :5173"
( cd backend && exec "$PY" run.py ) &
BACK_PID=$!
( cd frontend && exec npm run dev ) &
FRONT_PID=$!
trap "kill $BACK_PID $FRONT_PID 2>/dev/null || true" EXIT
wait
