#!/usr/bin/env sh
# Periodic Postgres backup for the Docker Compose production stack.
# Runs forever by default. Set RUN_ONCE=1 for a one-shot backup.
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=golf}"
: "${POSTGRES_DB:=golf}"
: "${BACKUP_DIR:=/backups}"
: "${RETAIN_DAYS:=30}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

mkdir -p "$BACKUP_DIR"

backup_once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  out="$BACKUP_DIR/golf-$stamp.dump"

  pg_dump \
    --host="$POSTGRES_HOST" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$out"

  size="$(du -h "$out" | awk '{print $1}')"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] postgres backup created: $out ($size)"

  find "$BACKUP_DIR" -type f -name 'golf-*.dump' -mtime +"$RETAIN_DAYS" -delete
}

while :; do
  backup_once
  if [ "${RUN_ONCE:-0}" = "1" ]; then
    exit 0
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
