"""Общая обвязка тестов.

База — временный SQLite-файл на каждый прогон: тесты не должны видеть ни dev-базу,
ни тем более боевую. SECRET_KEY задаём явно, иначе config сгенерирует случайный
и подписанные в одном тесте токены перестанут проверяться в другом.
"""
from __future__ import annotations

import atexit
import os
from pathlib import Path
import secrets
import sys
import tempfile

import pytest

# Own the database even for direct pytest: inherited shell configuration is not
# permission to run app lifespan/migrations against a developer or production DB.
if any(name == "app" or name.startswith("app.") for name in sys.modules):
    raise pytest.UsageError("Application modules were imported before test isolation")

_database_directory = tempfile.TemporaryDirectory(prefix="golf-pytest-")
atexit.register(_database_directory.cleanup)
os.environ.update(
    ENV="local",
    SECRET_KEY=secrets.token_hex(64),
    DATABASE_URL="sqlite:///" + str(Path(_database_directory.name) / "test.sqlite"),
    CORS_ORIGINS="http://127.0.0.1:5173",
    GOLF_TEST_ISOLATED="1",
)


def pytest_sessionfinish(session, exitstatus):
    # Dispose only an already imported test engine before removing its owned DB.
    db_module = sys.modules.get("app.db")
    engine = getattr(db_module, "engine", None)
    if engine is not None:
        engine.dispose()
    _database_directory.cleanup()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
