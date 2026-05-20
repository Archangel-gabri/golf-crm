"""One-shot data migration: copy every row from a source SQLite database into
a freshly created Postgres database that has the same schema (created via
`alembic upgrade head`).

Usage:
    cd backend
    SOURCE_SQLITE=/path/to/golf.db \\
    DEST_POSTGRES=postgresql+psycopg://golf:PASSWORD@localhost:5432/golf \\
    python scripts/migrate_sqlite_to_postgres.py

The script is idempotent in the sense that it BAILS OUT if any destination
table is non-empty — overwriting silently is too dangerous. To re-run, drop
and recreate the Postgres DB, run `alembic upgrade head`, then re-run this.

After the copy the script resets each table's id-sequence in Postgres so new
INSERTs don't collide with copied IDs.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

# Make `app` importable when invoked from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, MetaData, select, text
from sqlalchemy.orm import sessionmaker

from app.db import Base  # noqa: F401 — registers all models
from app import models  # noqa: F401


def _required(env: str) -> str:
    val = os.environ.get(env, "").strip()
    if not val:
        sys.exit(f"ERROR: env var {env} is required")
    return val


def main() -> None:
    source_url = _required("SOURCE_SQLITE")
    dest_url = _required("DEST_POSTGRES")

    if not source_url.startswith("sqlite"):
        # Allow raw filesystem paths.
        if Path(source_url).exists():
            source_url = f"sqlite:///{Path(source_url).resolve()}"
        else:
            sys.exit("ERROR: SOURCE_SQLITE must be a sqlite:/// URL or a path to .db file")

    if not dest_url.startswith("postgresql"):
        sys.exit("ERROR: DEST_POSTGRES must start with postgresql+psycopg://")

    print(f"Source: {source_url}")
    print(f"Dest:   {dest_url}")

    src_engine = create_engine(source_url)
    dst_engine = create_engine(dest_url)

    # Reflect source so we copy whatever tables actually exist (handles legacy
    # tables not in current models).
    src_meta = MetaData()
    src_meta.reflect(bind=src_engine)

    # Use destination's metadata via models so insert order respects FKs.
    dst_meta = Base.metadata

    # Verify destination schema is up-to-date and empty.
    SrcSession = sessionmaker(bind=src_engine)
    DstSession = sessionmaker(bind=dst_engine)
    with DstSession() as db:
        for tname in dst_meta.tables:
            cnt = db.execute(text(f'SELECT COUNT(*) FROM "{tname}"')).scalar() or 0
            if cnt > 0:
                sys.exit(f"ERROR: destination table '{tname}' already has {cnt} rows — refusing to overwrite. "
                         f"Drop and recreate the Postgres DB, run `alembic upgrade head`, then re-run.")

    copied: list[tuple[str, int]] = []
    with SrcSession() as src, DstSession() as dst:
        # Iterate in FK-safe order using metadata.sorted_tables.
        for table in dst_meta.sorted_tables:
            tname = table.name
            if tname not in src_meta.tables:
                print(f"  · {tname}: not in source, skipping")
                continue
            src_table = src_meta.tables[tname]
            rows = list(src.execute(select(src_table)).mappings())
            if not rows:
                copied.append((tname, 0))
                continue
            # Match destination columns; drop any that don't exist on dest (legacy).
            dst_cols = {c.name for c in table.columns}
            payload = [{k: v for k, v in r.items() if k in dst_cols} for r in rows]
            dst.execute(table.insert(), payload)
            copied.append((tname, len(payload)))
        dst.commit()

    print("\nCopied rows per table:")
    for tname, n in copied:
        if n:
            print(f"  ✔ {tname}: {n}")

    # Reset id-sequences on Postgres.
    with dst_engine.begin() as conn:
        for table in dst_meta.sorted_tables:
            id_col = next((c for c in table.columns if c.name == "id" and c.primary_key), None)
            if not id_col:
                continue
            seq = f"{table.name}_id_seq"
            conn.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM \"{table.name}\"), 1), true)"
            ))
    print("\n✔ Done — id sequences reset.")


if __name__ == "__main__":
    main()
