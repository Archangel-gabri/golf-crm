#!/usr/bin/env bash
# Full security scan across backend + frontend.
# Tools:  bandit (code)  pip-audit (deps)  npm audit (deps)  detect-secrets (leaks)
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'
ERRORS=0

section() { echo ""; echo "━━ $1 ━━"; }
warn() { echo "${YELLOW}  ⚠ $1${NC}"; }
ok() { echo "${GREEN}  ✓ $1${NC}"; }
err() { echo "${RED}  ✘ $1${NC}"; ERRORS=$((ERRORS + 1)); }

section "1/5 · Python SAST (bandit)"
cd "$ROOT/backend"
PY=$([ -x "venv/Scripts/python.exe" ] && echo "venv/Scripts/python.exe" || echo "venv/bin/python")
if ! "$PY" -m pip show bandit >/dev/null 2>&1; then
  "$PY" -m pip install -q bandit
fi
"$PY" -m bandit -r app -f txt -q -ll || err "bandit found HIGH issues"
ok "bandit done"

section "2/5 · Python dependency CVEs (pip-audit)"
if ! "$PY" -m pip show pip-audit >/dev/null 2>&1; then
  "$PY" -m pip install -q pip-audit
fi
"$PY" -m pip_audit -r requirements.txt || err "pip-audit found vulnerable deps"

section "3/5 · Node dependency CVEs (npm audit)"
cd "$ROOT/frontend"
npm audit --production --audit-level=high || err "npm audit found HIGH vulns"

cd "$ROOT/e2e"
npm audit --audit-level=high || warn "e2e has advisories"

section "4/5 · Secrets scan (detect-secrets)"
cd "$ROOT"
if ! "$ROOT/backend/$PY" -m pip show detect-secrets >/dev/null 2>&1; then
  "$ROOT/backend/$PY" -m pip install -q detect-secrets
fi
"$ROOT/backend/$PY" -m detect_secrets scan \
    --exclude-files 'venv/|node_modules/|\.planning/|sessions/|test-results/|playwright-report/|dist/|build/|golf\.db' \
    > /tmp/golf-secrets.json
LEAKS=$("$ROOT/backend/$PY" -c "import json; d=json.load(open('/tmp/golf-secrets.json')); print(sum(len(v) for v in d.get('results', {}).values()))")
if [ "$LEAKS" -gt 0 ]; then
  err "found $LEAKS potential secrets — inspect /tmp/golf-secrets.json"
else
  ok "no secrets detected"
fi

section "5/5 · Default-password check"
cd "$ROOT/backend"
DEFAULT_USERS=$("$PY" - <<'PY'
import sys
from app.db import SessionLocal
from app.models import User
from app.security import verify_password
db = SessionLocal()
weak = []
for u in db.query(User).all():
    if u.username in ("admin","manager","cashier") and verify_password(u, u.username, db):
        weak.append(u.username)
print(",".join(weak))
PY
)
if [ -n "$DEFAULT_USERS" ]; then
  err "seed default passwords still active for: $DEFAULT_USERS (смените!)"
else
  ok "no default passwords in use"
fi

echo ""
if [ $ERRORS -gt 0 ]; then
  echo "${RED}━━ FAILED ($ERRORS findings) ━━${NC}"
  exit 1
fi
echo "${GREEN}━━ OK — ready for production ━━${NC}"
