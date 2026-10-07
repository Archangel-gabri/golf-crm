"""Персональные данные клиентов не остаются в журналах (все данные синтетические)."""
from __future__ import annotations

import logging
import secrets
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest

from tests.test_framework_compatibility import synthetic_login  # noqa: F401  (fixture)

BACKEND = Path(__file__).resolve().parents[1]

PII_NAME = "Синтетикус Тестович"
PII_PHONE = "+70000000042"
PII_EMAIL = "synthetic.client@example.invalid"
PII_CAR = "Z999ZZ"
PII_NOTE = "синтетическая-заметка-про-здоровье"
ALL_PII = (PII_NAME, PII_PHONE, PII_EMAIL, PII_CAR, PII_NOTE, "Синтетикус", "70000000042")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_real_uvicorn_access_log_has_no_query_values(capfd):
    """Поднимаем настоящий uvicorn и ходим по сети: смотрим реальные записи access log."""
    import uvicorn

    from app.main import app

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, lifespan="off", log_level="info", access_log=True,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    # uvicorn сам ставит свой handler (propagate=False): читаем настоящий вывод
    if True:
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.1)
            assert server.started
            r = httpx.get(f"http://127.0.0.1:{port}/customers",
                          params={"q": PII_NAME, "phone": PII_PHONE})
            assert r.status_code == 401  # без входа, но запрос всё равно в журнале
        finally:
            server.should_exit = True
            thread.join(10)
    out = capfd.readouterr()
    text = out.out + out.err
    assert '"GET /customers?q=[скрыто]&phone=[скрыто] HTTP/1.1" 401' in text
    for secret in ALL_PII + ("%D0",):
        assert secret not in text


def test_filter_handles_unexpected_record_shapes():
    from app.log_safety import RedactQueryFilter

    rec = logging.LogRecord("gunicorn.access", logging.INFO, "", 0,
                            '1.2.3.4 "GET /customers?q=%s HTTP/1.1" 200' % PII_PHONE, None, None)
    RedactQueryFilter().filter(rec)
    assert PII_PHONE not in rec.getMessage()
    assert "GET /customers?q=[скрыто]" in rec.getMessage()
    plain = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "1.2.3.4 GET /health 200", None, None)
    RedactQueryFilter().filter(plain)
    assert plain.getMessage() == "1.2.3.4 GET /health 200"


def test_gunicorn_launch_config_does_not_log_query_string():
    for path in (BACKEND / "Dockerfile", BACKEND.parent / "deploy" / "golf-backend.service"):
        text = path.read_text(encoding="utf-8")
        assert "--access-logformat" in text or '"--access-logformat"' in text, path
        assert "%(r)s" not in text and "%(f)s" not in text, path
        assert "%(U)s" in text and "%(m)s" in text and "%(s)s" in text, path


def test_customer_audit_keeps_who_what_but_no_pii(synthetic_login):  # noqa: F811
    from app.csrf import CSRF_COOKIE, CSRF_HEADER
    from app.db import SessionLocal
    from app.models import AuditLog
    from sqlalchemy import select

    http, credentials, user_id = synthetic_login
    assert http.post("/auth/login", json=credentials).status_code == 200
    h = {CSRF_HEADER: http.cookies[CSRF_COOKIE]}
    full = {"name": PII_NAME, "phone": PII_PHONE, "email": PII_EMAIL, "car_brand": "SynthCar",
            "car_number": PII_CAR, "birthdate": "1990-01-02", "notes": PII_NOTE,
            "consent_marketing": False}
    created = http.post("/customers", json=full, headers=h)
    assert created.status_code == 201
    cid = created.json()["id"]
    changed = {**full, "phone": "+70000000043", "email": "other.synthetic@example.invalid",
               "consent_marketing": True}
    assert http.put(f"/customers/{cid}", json=changed, headers=h).status_code == 200
    assert http.delete(f"/customers/{cid}", headers=h).status_code == 204

    with SessionLocal() as db:
        rows = list(db.execute(
            select(AuditLog).where(AuditLog.entity == "customer", AuditLog.entity_id == cid)
            .order_by(AuditLog.id)).scalars())
    assert [r.action for r in rows] == ["create", "update", "delete"]
    dump = repr([(r.summary, r.before, r.after, r.ip) for r in rows])
    for secret in ALL_PII + ("+70000000043", "other.synthetic", "SynthCar", "1990-01-02"):
        assert secret not in dump
    # полезное осталось: кто, что, над какой сущностью, что изменилось
    for r in rows:
        assert r.actor_user_id == user_id and r.actor_username == credentials["username"]
        assert f"#{cid}" in r.summary
    update = rows[1]
    assert update.before == {"consent_marketing": False}
    assert update.after == {"consent_marketing": True, "changed_fields": ["email", "phone"]}


def test_audit_log_strips_pii_even_if_caller_passes_full_model():
    from app import audit
    from app.db import SessionLocal

    with SessionLocal() as db:
        entry = audit.log(db, None, "update", "customer", 1,
                          before={"phone": PII_PHONE, "consent_marketing": False},
                          after={"name": PII_NAME, "consent_marketing": True})
        db.rollback()
    assert entry.before == {"consent_marketing": False}
    assert entry.after == {"consent_marketing": True}
