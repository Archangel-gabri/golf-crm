#!/usr/bin/env bash
# Lint: ruff (python) + tsc (typescript)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cd "$ROOT/backend"
PY=$([ -x "venv/Scripts/python.exe" ] && echo "venv/Scripts/python.exe" || echo "venv/bin/python")
"$PY" -m pip show ruff >/dev/null 2>&1 || "$PY" -m pip install -q ruff
echo "▸ ruff"
"$PY" -m ruff check app

cd "$ROOT/frontend"
echo "▸ tsc --noEmit"
npx tsc --noEmit

echo "✓ lint clean"
