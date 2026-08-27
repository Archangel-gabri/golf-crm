"""Ad-hoc SQLite schema patches + cross-backend data fixups.

History: before Phase 03 we used `create_all()` on every boot and patched the
schema with ALTER TABLE here. After Phase 03 schema is owned by Alembic — see
`backend/alembic/`. We keep this module for two reasons:

1. **SQLite legacy schema patches** — for users who upgraded an existing
   pre-Phase-03 SQLite database without running `alembic stamp head` /
   `alembic upgrade head`. These run only on SQLite.

2. **Data fixups** — idempotent, marker-guarded data tasks (audit default
   passwords, top-up driving-range lanes). These run on both SQLite and
   Postgres.

Client-specific staff rosters do NOT belong here. Staff and instructors are
created through the app itself (`/staff`, `/instructors`) or by the initial
seed; a hardcoded roster in shipped code is one deployment's data, not
behaviour every installation needs.
"""
import hashlib
import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine


log = logging.getLogger("golfadmin.migrations")


def _is_sqlite(engine_or_conn) -> bool:
    """Accept either an Engine or a Connection."""
    bind = engine_or_conn if hasattr(engine_or_conn, "url") else engine_or_conn.engine
    return bind.url.get_backend_name() == "sqlite"


def _column_exists(conn, table: str, column: str) -> bool:
    """SQLite-only — Alembic handles schema on Postgres."""
    cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(c[1] == column for c in cols)


def apply_migrations(engine: Engine):
    is_sqlite = _is_sqlite(engine)
    with engine.begin() as conn:
        if is_sqlite:
            _apply_sqlite_schema_patches(conn)
        # Data fixups run on both backends.
        _ensure_24_range_lanes(conn)
        _audit_default_passwords(conn)


def _apply_sqlite_schema_patches(conn):
    """Legacy SQLite ALTER TABLE patches for pre-Phase-03 databases.

    No-op on databases that already match the current model schema (every
    check is `IF NOT EXISTS`-style via PRAGMA table_info).
    """
    if not _column_exists(conn, "services", "tags"):
        conn.execute(text("ALTER TABLE services ADD COLUMN tags JSON DEFAULT '[]'"))
        conn.execute(text("UPDATE services SET tags = '[]' WHERE tags IS NULL"))

    if not _column_exists(conn, "instructors", "tags"):
        conn.execute(text("ALTER TABLE instructors ADD COLUMN tags JSON DEFAULT '[]'"))
        conn.execute(text("UPDATE instructors SET tags = '[]' WHERE tags IS NULL"))

    if not _column_exists(conn, "instructors", "hourly_payout_kopecks"):
        conn.execute(text("ALTER TABLE instructors ADD COLUMN hourly_payout_kopecks BIGINT DEFAULT 0"))

    if not _column_exists(conn, "bookings", "coupon_code"):
        conn.execute(text("ALTER TABLE bookings ADD COLUMN coupon_code VARCHAR(64) DEFAULT ''"))

    if not _column_exists(conn, "membership_plans", "covers_training"):
        conn.execute(text("ALTER TABLE membership_plans ADD COLUMN covers_training BOOLEAN DEFAULT 0"))
    if not _column_exists(conn, "membership_plans", "max_trainings"):
        conn.execute(text("ALTER TABLE membership_plans ADD COLUMN max_trainings INTEGER DEFAULT 0"))
    if not _column_exists(conn, "membership_plans", "covers_all_services"):
        conn.execute(text("ALTER TABLE membership_plans ADD COLUMN covers_all_services BOOLEAN DEFAULT 0"))
    if not _column_exists(conn, "memberships", "trainings_used"):
        conn.execute(text("ALTER TABLE memberships ADD COLUMN trainings_used INTEGER DEFAULT 0"))
    if not _column_exists(conn, "memberships", "purchased_at"):
        conn.execute(text("ALTER TABLE memberships ADD COLUMN purchased_at DATETIME"))
        conn.execute(text("UPDATE memberships SET purchased_at = COALESCE(created_at, starts_on, CURRENT_TIMESTAMP)"))

    if not _column_exists(conn, "users", "instructor_id"):
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN instructor_id INTEGER REFERENCES instructors(id)"
        ))

    if not _column_exists(conn, "users", "must_change_password"):
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT 0 NOT NULL"
        ))

    if not _column_exists(conn, "customers", "created_by_id"):
        conn.execute(text(
            "ALTER TABLE customers ADD COLUMN created_by_id INTEGER REFERENCES users(id)"
        ))

    if not _column_exists(conn, "instructors", "pending_working_hours"):
        conn.execute(text("ALTER TABLE instructors ADD COLUMN pending_working_hours JSON"))
    if not _column_exists(conn, "instructors", "pending_effective_from"):
        conn.execute(text("ALTER TABLE instructors ADD COLUMN pending_effective_from DATE"))
    if not _column_exists(conn, "instructors", "trainer_type"):
        conn.execute(text("ALTER TABLE instructors ADD COLUMN trainer_type VARCHAR(16) DEFAULT 'club' NOT NULL"))
        conn.execute(text("UPDATE instructors SET trainer_type = 'club' WHERE trainer_type IS NULL OR trainer_type = ''"))


def _ensure_24_range_lanes(conn):
    """Ensure Resource rows D1..D24 exist and are linked to driving-range services.
    Reads/writes via raw SQL to avoid ORM cycles during startup migrations.

    Uses SQLite-only `INSERT OR IGNORE`. On Postgres we skip — fresh Postgres
    deployments seed D1..D24 from the start (via seed.py + data migration).
    """
    if not _is_sqlite(conn):
        return
    rows = conn.execute(text("SELECT code FROM resources WHERE code LIKE 'D%'")).fetchall()
    existing = {r[0] for r in rows}
    target = {f"D{i}" for i in range(1, 25)}
    missing = sorted(target - existing, key=lambda c: int(c[1:]))
    if not missing:
        return

    # Pull the driving-zone / resource-type ids from an existing D lane (D1 is seeded).
    ref = conn.execute(text(
        "SELECT zone_id, resource_type_id, season FROM resources WHERE code = 'D1'"
    )).fetchone()
    if not ref:
        return  # fresh DB — seed will create the full set
    zone_id, rt_id, season = ref[0], ref[1], ref[2]

    # Copy open hours from D1's first availability rule (if any).
    rule_row = conn.execute(text(
        "SELECT open_time, close_time, season, weekday FROM availability_rules "
        "WHERE resource_id = (SELECT id FROM resources WHERE code='D1') LIMIT 1"
    )).fetchone()

    # Services that D1 is bound to — new lanes inherit the same bindings.
    d1_services = [
        row[0] for row in conn.execute(text(
            "SELECT service_id FROM resource_services WHERE resource_id = "
            "(SELECT id FROM resources WHERE code='D1')"
        )).fetchall()
    ]

    for code in missing:
        n = int(code[1:])
        conn.execute(text(
            "INSERT INTO resources (zone_id, resource_type_id, name, code, sort_order, "
            "season, capacity, color, meta, active, created_at, updated_at) "
            "VALUES (:zone, :rt, :name, :code, :sort, :season, 1, '#2E9A6A', '{}', 1, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {
            "zone": zone_id, "rt": rt_id,
            "name": f"Драйвинг-рэндж {n}", "code": code,
            "sort": n, "season": season,
        })
        rid = conn.execute(text("SELECT id FROM resources WHERE code = :c"),
                           {"c": code}).scalar()
        if rule_row and rid:
            open_t, close_t, rule_season, weekday = rule_row
            conn.execute(text(
                "INSERT INTO availability_rules (resource_id, weekday, open_time, "
                "close_time, season, created_at, updated_at) "
                "VALUES (:rid, :wd, :o, :c, :s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ), {"rid": rid, "wd": weekday, "o": open_t, "c": close_t, "s": rule_season})
        if rid and d1_services:
            for sid in d1_services:
                conn.execute(text(
                    "INSERT OR IGNORE INTO resource_services (resource_id, service_id) "
                    "VALUES (:rid, :sid)"
                ), {"rid": rid, "sid": sid})


# ── default-password audit ───────────────────────────────────────────────────
# One-time pass: any active user whose password equals their username (which is
# the case for the dev seed roster) gets must_change_password=1, forcing them
# to set a real password on next login. Marker-guarded so we run argon2.verify
# at most once per deploy.
_DEFAULT_PW_AUDIT_MARKER = "default_password_audit_v1"


def _audit_default_passwords(conn):
    row = conn.execute(text(
        "SELECT value FROM app_settings WHERE key = :k"
    ), {"k": _DEFAULT_PW_AUDIT_MARKER}).fetchone()
    if row:
        return

    from .security import _hasher
    from argon2.exceptions import VerifyMismatchError, InvalidHash

    rows = conn.execute(text(
        "SELECT id, username, password_hash FROM users WHERE active = :active"
    ), {"active": True}).fetchall()

    flagged = 0
    for uid, username, ph in rows:
        if not username or not ph:
            continue
        matches = False
        # Legacy SHA-256 hashes (64 hex chars).
        if len(ph) == 64 and all(c in "0123456789abcdef" for c in ph):
            matches = hashlib.sha256(username.encode()).hexdigest() == ph
        else:
            try:
                matches = _hasher.verify(ph, username)
            except (VerifyMismatchError, InvalidHash):
                matches = False
        if matches:
            conn.execute(text(
                "UPDATE users SET must_change_password = :must_change WHERE id = :i"
            ), {"i": uid, "must_change": True})
            flagged += 1

    log.info("Default-password audit: flagged %d account(s) for forced change", flagged)
    conn.execute(text(
        "INSERT INTO app_settings (key, value, created_at, updated_at) "
        "VALUES (:k, :v, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
        "ON CONFLICT(key) DO UPDATE SET value = :v"
    ), {"k": _DEFAULT_PW_AUDIT_MARKER, "v": str(flagged)})
