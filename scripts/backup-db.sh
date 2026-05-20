#!/usr/bin/env sh
# Backward-compatible alias kept for old cron entries.
# New SQLite installs should call backup-sqlite.sh; Docker production uses
# backup-postgres.sh via the backup service.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/sh "$SCRIPT_DIR/backup-sqlite.sh"
