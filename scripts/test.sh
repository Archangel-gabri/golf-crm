#!/usr/bin/env bash
# Run all tests: backend unit (pytest if present) + frontend typecheck + Playwright E2E
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GolfAdmin test suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Backend ────────────────────────────────────────────────────────
echo ""
echo "▸ Backend: import smoke test"
cd "$ROOT/backend"
PY=$([ -x "venv/Scripts/python.exe" ] && echo "venv/Scripts/python.exe" || echo "venv/bin/python")
"$PY" -c "from app.main import app; print('  ✓ app imports,', len(app.routes), 'routes')"

if [ -d tests ]; then
  echo "▸ Backend: pytest"
  "$PY" -m pytest -q
fi

# ── Frontend ───────────────────────────────────────────────────────
echo ""
echo "▸ Frontend: TypeScript"
cd "$ROOT/frontend"
npx tsc --noEmit
echo "  ✓ typecheck clean"

# ── E2E ────────────────────────────────────────────────────────────
echo ""
echo "▸ Playwright E2E"
cd "$ROOT/e2e"
npx playwright test

echo ""
echo "✓ All tests passed."
