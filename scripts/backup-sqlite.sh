#!/usr/bin/env sh
# Legacy SQLite backup for local/bare-metal installs.
# Docker production uses scripts/backup-postgres.sh instead.
set -eu

: "${DB_PATH:=/opt/golf/data/golf.db}"
: "${OUT_DIR:=/opt/golf/backups}"
: "${RETAIN:=30}"

mkdir -p "$OUT_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
out="$OUT_DIR/golf-$stamp.db"

sqlite3 "$DB_PATH" ".backup '$out'"
gzip -9 "$out"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] sqlite backup created: $out.gz"

find "$OUT_DIR" -type f -name 'golf-*.db.gz' -mtime +"$RETAIN" -delete
