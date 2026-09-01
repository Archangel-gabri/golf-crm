#!/usr/bin/env bash
# Hermetic full suite. It never imports the real checkout, reads its .env, or
# opens its ignored golf.db/backups: all mutable work happens in /tmp.
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/golf-test-XXXXXXXX)"

cleanup() {
  local suite_status=$?
  if [ "$suite_status" -ne 0 ] && [ "${GOLF_KEEP_FAILED_TMP:-0}" = "1" ]; then
    echo "failed synthetic test workspace kept at: $TEST_ROOT" >&2
    return
  fi
  python3 - "$TEST_ROOT" <<'PY'
from pathlib import Path
import shutil
import sys

target = Path(sys.argv[1]).resolve()
if target.parent != Path("/tmp") or not target.name.startswith("golf-test-"):
    raise SystemExit(f"refusing unsafe cleanup target: {target}")
if target.exists():
    shutil.rmtree(target)
PY
}
trap cleanup EXIT HUP INT TERM

copy_source() {
  local name="$1"
  mkdir -p "$TEST_ROOT/$name"
  rsync -a \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='venv/' \
    --exclude='venv-mac/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='build/' \
    --exclude='__pycache__/' \
    --exclude='.pytest_cache/' \
    --exclude='.ruff_cache/' \
    --exclude='*.db*' \
    --exclude='*.sqlite*' \
    --exclude='*.sql' \
    --exclude='*.dump' \
    --exclude='*.bak*' \
    --exclude='backups/' \
    --exclude='db-dump/' \
    --exclude='playwright-report/' \
    --exclude='test-results/' \
    --exclude='.auth/' \
    "$SOURCE_ROOT/$name/" "$TEST_ROOT/$name/"
}

for component in backend frontend e2e; do
  copy_source "$component"
done

if find "$TEST_ROOT" -type f \( \
  -name '.env*' -o \
  -name '*.db*' -o \
  -name '*.sqlite*' -o \
  -name '*.sql' -o \
  -name '*.dump' -o \
  -name '*.bak*' \
\) -print -quit | grep -q .; then
  echo "ERROR: source staging copied a forbidden env/database/dump file" >&2
  exit 1
fi

echo "━━ GolfAdmin hermetic test suite ━━"
echo "isolation: temporary source + fresh synthetic SQLite databases"

uv venv --python 3.12 "$TEST_ROOT/backend/venv"
uv pip install \
  --python "$TEST_ROOT/backend/venv/bin/python" \
  -r "$TEST_ROOT/backend/requirements.txt" \
  -r "$TEST_ROOT/backend/requirements-dev.txt"

npm_ci=(npm ci --prefer-offline --no-audit --no-fund --progress=false)
(cd "$TEST_ROOT/frontend" && "${npm_ci[@]}")
(cd "$TEST_ROOT/e2e" && "${npm_ci[@]}")

E2E_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(64))')"
E2E_PASSWORD="$(python3 -c 'import secrets; print("E2E-" + secrets.token_urlsafe(24))')"
PYTEST_DB="sqlite:///$TEST_ROOT/pytest.sqlite"

echo "▸ Backend: import + pytest"
(
  cd "$TEST_ROOT/backend"
  ENV=local \
  SECRET_KEY="$E2E_SECRET" \
  DATABASE_URL="$PYTEST_DB" \
  CORS_ORIGINS='http://127.0.0.1:5173' \
  PYTHONDONTWRITEBYTECODE=1 \
    venv/bin/python -c 'from app.main import app; print("routes", len(app.routes))'
  ENV=local \
  SECRET_KEY="$E2E_SECRET" \
  DATABASE_URL="$PYTEST_DB" \
  CORS_ORIGINS='http://127.0.0.1:5173' \
  PYTHONDONTWRITEBYTECODE=1 \
    venv/bin/python -m pytest -q
)

echo "▸ Frontend: typecheck + production build"
(cd "$TEST_ROOT/frontend" && npm run build)

export CI=1
export GOLF_E2E_ISOLATED=1
export GOLF_E2E_DATABASE_URL="sqlite:///$TEST_ROOT/e2e.sqlite"
export GOLF_E2E_SECRET_KEY="$E2E_SECRET"
export GOLF_E2E_ADMIN_PASSWORD="$E2E_PASSWORD"
export GOLF_E2E_AUTH_STATE="$TEST_ROOT/e2e/.auth/state.json"
export GOLF_E2E_PYTHON="$TEST_ROOT/backend/venv/bin/python"
export PLAYWRIGHT_HTML_OPEN=never

echo "▸ Playwright E2E"
(cd "$TEST_ROOT/e2e" && npm test -- "$@")

echo "✓ All hermetic tests passed"
