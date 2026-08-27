"""Общая обвязка тестов.

База — временный SQLite-файл на каждый прогон: тесты не должны видеть ни dev-базу,
ни тем более боевую. SECRET_KEY задаём явно, иначе config сгенерирует случайный
и подписанные в одном тесте токены перестанут проверяться в другом.
"""
from __future__ import annotations

import os
import tempfile

import pytest

os.environ.setdefault("ENV", "local")
os.environ.setdefault("SECRET_KEY", "t" * 64)
os.environ.setdefault("DATABASE_URL", "sqlite:///" + tempfile.mktemp(suffix=".db"))


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
