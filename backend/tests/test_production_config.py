"""Боевой контур не должен подниматься с настройками разработчика.

Раньше SECRET_KEY генерировался заново на каждом рестарте: сессии слетали,
а старые токены оказывались подписаны чужим секретом. Тесты фиксируют, что
конфиг теперь падает громко, а не запускается тихо.
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile

import pytest

BASE = {"DATABASE_URL": "sqlite:///" + tempfile.mktemp(suffix=".db")}


def _load(env: dict):
    for name in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[name]
    saved = dict(os.environ)
    os.environ.update(BASE)
    os.environ.update(env)
    try:
        return importlib.import_module("app.config").settings
    finally:
        os.environ.clear()
        os.environ.update(saved)


@pytest.mark.parametrize(
    "env, why",
    [
        ({"ENV": "production", "SECRET_KEY": "", "CORS_ORIGINS": "https://example.com"},
         "пустой SECRET_KEY"),
        ({"ENV": "production", "SECRET_KEY": "short", "CORS_ORIGINS": "https://example.com"},
         "SECRET_KEY короче 32 символов"),
        ({"ENV": "production", "SECRET_KEY": "x" * 64, "CORS_ORIGINS": "http://localhost:5173"},
         "localhost в CORS_ORIGINS"),
    ],
)
def test_production_refuses_unsafe_config(env, why):
    with pytest.raises(Exception):
        _load(env)


def test_production_hardens_cookies_and_hides_docs():
    s = _load({"ENV": "production", "SECRET_KEY": "x" * 64, "CORS_ORIGINS": "https://golf.example"})
    assert s.COOKIE_SECURE is True, "cookie в проде обязан быть Secure"
    assert s.DOCS_ENABLED is False, "Swagger в проде должен быть закрыт"
