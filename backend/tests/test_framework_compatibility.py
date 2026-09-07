"""Bounded synthetic contracts for the FastAPI/Starlette upgrade.

SSE must use a raw ASGI harness: TestClient buffers an infinite response. The
normal conftest owns all configuration/database isolation before app imports.
"""

from __future__ import annotations

import asyncio
from builtins import ExceptionGroup
from contextlib import nullcontext
from datetime import datetime
from http.cookies import SimpleCookie
from importlib.metadata import version
from pathlib import Path
import secrets
import socket

from packaging.requirements import Requirement
from packaging.version import Version
import pytest


@pytest.mark.parametrize("asgi_spec", ["2.3", "2.4"])
def test_sse_releases_auth_db_before_first_chunk(monkeypatch, asgi_spec):
    from app.db import get_db
    from app.main import app
    from app.models import User
    from app.realtime import broadcast, subscriber_count
    from app.security import create_access_token

    trace = []
    user = User(id=98765, username="framework-sse", role="admin", active=True)

    class TrackingSession:
        def get(self, model, user_id):
            assert model is User
            assert user_id == user.id
            trace.append("lookup")
            return user

    def tracked_db():
        trace.append("open")
        try:
            yield TrackingSession()
        finally:
            trace.append("close")

    monkeypatch.setitem(app.dependency_overrides, get_db, tracked_db)
    token = create_access_token(user.id, user.role)

    async def exercise():
        disconnect = asyncio.Event()
        received_request = False
        messages = []
        baseline = subscriber_count()

        async def receive():
            nonlocal received_request
            if not received_request:
                received_request = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)
            if message["type"] != "http.response.body":
                return
            body = message.get("body", b"")
            if b"event: hello" in body:
                trace.append("first_chunk")
                assert subscriber_count() == baseline + 1
                broadcast({"type": "customers", "framework_probe": "bounded"})
            if b'"framework_probe": "bounded"' in body:
                trace.append("event")
                disconnect.set()

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": asgi_spec},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/sse/events",
            "raw_path": b"/sse/events",
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"testserver"),
                (b"authorization", f"Bearer {token}".encode()),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        }
        await asyncio.wait_for(app(scope, receive, send), timeout=5)
        assert subscriber_count() == baseline
        start = next(m for m in messages if m["type"] == "http.response.start")
        assert start["status"] == 200
        headers = dict(start["headers"])
        assert headers[b"content-type"].startswith(b"text/event-stream")
        assert headers[b"x-content-type-options"] == b"nosniff"
        assert headers[b"x-accel-buffering"] == b"no"

    asyncio.run(exercise())
    assert trace == ["open", "lookup", "close", "first_chunk", "event"]


def test_declared_and_resolved_framework_match_tested_security_tuple():
    # A fresh resolver choosing latest is not a declared security floor: FastAPI
    # itself also permits older, affected Starlette. Keep the tested tuple pinned.
    lines = (
        (Path(__file__).resolve().parents[1] / "requirements.txt")
        .read_text()
        .splitlines()
    )
    requirements = {
        req.name: req
        for line in lines
        if line.strip() and not line.startswith("#")
        for req in [Requirement(line)]
    }
    for package, expected in {"fastapi": "0.141.1", "starlette": "1.6.0"}.items():
        assert package in requirements, f"missing direct tested pin for {package}"
        assert str(requirements[package].specifier) == f"=={expected}"
        assert Version(version(package)) == Version(expected)
    assert not requirements["starlette"].specifier.contains("1.3.0")


def _static_get_paths(app):
    from fastapi.routing import iter_route_contexts

    # New FastAPI keeps include_router branches nested in app.routes. Walking
    # only app.routes would silently skip most business endpoints. RouteContext
    # applies include prefixes and also sees routes omitted from OpenAPI.
    return {
        route.path
        for route in iter_route_contexts(app.routes)
        if isinstance(getattr(route, "path", None), str)
        and "GET" in (getattr(route, "methods", None) or set())
        and "{" not in route.path
    }


async def _asgi_response_start(app, path, headers=()):
    """Capture status/headers and disconnect; never buffer an infinite SSE."""
    disconnect = asyncio.Event()
    sent_request = False
    starts = []

    async def receive():
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.start":
            starts.append(message)
            disconnect.set()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver"), *headers],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    await asyncio.wait_for(app(scope, receive, send), timeout=5)
    assert len(starts) == 1
    return starts[0]


def test_status_harness_disconnects_an_accidentally_public_stream():
    trace = []

    async def public_stream(scope, receive, send):
        assert (await receive())["type"] == "http.request"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        assert (await receive())["type"] == "http.disconnect"
        trace.append("closed")

    async def exercise():
        # Separate shorter deadline protects this test of the harness itself.
        return await asyncio.wait_for(
            _asgi_response_start(public_stream, "/synthetic"), timeout=1
        )

    assert asyncio.run(exercise())["status"] == 200
    assert trace == ["closed"]


@pytest.mark.parametrize("http_protocol", ["h11", "httptools"])
def test_uvicorn_idle_socket_disconnect_releases_sse_subscriber(
    monkeypatch, http_protocol
):
    import uvicorn

    from app.db import get_db
    from app.main import app
    from app.models import User
    from app.realtime import subscriber_count
    from app.security import create_access_token

    trace = []
    user = User(id=98765, username="framework-socket", role="admin", active=True)

    class TrackingSession:
        def get(self, model, user_id):
            assert model is User and user_id == user.id
            trace.append("lookup")
            return user

    def tracked_db():
        trace.append("open")
        try:
            yield TrackingSession()
        finally:
            trace.append("close")

    monkeypatch.setitem(app.dependency_overrides, get_db, tracked_db)
    token = create_access_token(user.id, user.role)

    async def exercise():
        baseline = subscriber_count()
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.setblocking(False)
        port = listener.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                http=http_protocol,
                host="127.0.0.1",
                port=port,
                lifespan="off",
                access_log=False,
                log_level="critical",
                timeout_graceful_shutdown=1,
            )
        )
        # This embedded protocol test must not replace pytest's signal handlers.
        monkeypatch.setattr(server, "capture_signals", nullcontext)
        server_task = asyncio.create_task(server.serve(sockets=[listener]))
        writer = None

        async def started():
            while not server.started:
                if server_task.done():
                    await server_task
                    raise AssertionError("Uvicorn exited before startup")
                await asyncio.sleep(0.01)

        async def subscribers_released():
            while subscriber_count() != baseline:
                await asyncio.sleep(0.01)

        try:
            await asyncio.wait_for(started(), timeout=5)
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(
                (
                    f"GET /sse/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                    f"Authorization: Bearer {token}\r\n\r\n"
                ).encode()
            )
            await writer.drain()
            headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5)
            assert headers.startswith(b"HTTP/1.1 200")
            await asyncio.wait_for(
                reader.readuntil(b"event: hello\ndata: {}\n\n"), timeout=5
            )
            assert subscriber_count() == baseline + 1
            assert trace == ["open", "lookup", "close"]
            # No broadcast/heartbeat to trigger send errors: the idle client just
            # closes a real TCP socket connected to the pinned Uvicorn protocol.
            writer.close()
            await writer.wait_closed()
            await asyncio.wait_for(subscribers_released(), timeout=2)
        finally:
            if writer is not None:
                writer.close()
                await writer.wait_closed()
            server.should_exit = True
            try:
                await asyncio.wait_for(server_task, timeout=3)
            finally:
                listener.close()
        assert subscriber_count() == baseline

    asyncio.run(exercise())
    assert trace == ["open", "lookup", "close"]


@pytest.mark.parametrize(
    "case", ["finish", "disconnect", "send-error", "generator-error", "cancel"]
)
def test_sse_response_awaits_siblings_and_closes_generator(case):
    from starlette.background import BackgroundTask
    from starlette.requests import ClientDisconnect

    from app.routers.sse import _SSEStreamingResponse

    trace = []

    async def exercise():
        listener_started = asyncio.Event()
        body_sent = asyncio.Event()
        disconnect = asyncio.Event()

        async def chunks():
            try:
                yield b"synthetic"
                if case == "finish":
                    return
                if case == "generator-error":
                    raise RuntimeError("synthetic generator error")
                await asyncio.Event().wait()
            finally:
                trace.append("generator-closed")

        async def receive():
            listener_started.set()
            try:
                await disconnect.wait()
                return {"type": "http.disconnect"}
            finally:
                trace.append("listener-closed")

        async def send(message):
            if message["type"] == "http.response.body" and message.get("body"):
                await listener_started.wait()
                body_sent.set()
                if case == "disconnect":
                    disconnect.set()
                elif case == "send-error":
                    raise OSError("synthetic closed socket")

        response = _SSEStreamingResponse(
            chunks(), background=BackgroundTask(lambda: trace.append("background"))
        )
        task = asyncio.create_task(response({"type": "http"}, receive, send))
        try:
            await asyncio.wait_for(body_sent.wait(), timeout=1)
            if case == "cancel":
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await asyncio.wait_for(task, timeout=1)
            elif case in {"send-error", "generator-error"}:
                with pytest.raises(ExceptionGroup) as caught:
                    await asyncio.wait_for(task, timeout=1)
                errors = caught.value.exceptions
                assert len(errors) == 1
                if case == "send-error":
                    assert isinstance(errors[0], ClientDisconnect)
                    assert isinstance(errors[0].__cause__, OSError)
                else:
                    assert isinstance(errors[0], RuntimeError)
                    assert str(errors[0]) == "synthetic generator error"
            else:
                await asyncio.wait_for(task, timeout=1)
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        assert trace.count("listener-closed") == 1
        assert trace.count("generator-closed") == 1
        assert trace.count("background") == int(case in {"finish", "disconnect"})

    asyncio.run(exercise())


def test_route_census_expands_nested_hidden_routes():
    from fastapi import APIRouter, FastAPI

    probe = FastAPI()
    outer = APIRouter(prefix="/outer")
    inner = APIRouter(prefix="/inner")

    @inner.get("/hidden", include_in_schema=False)
    def hidden():
        return {"synthetic": True}

    async def websocket_endpoint(websocket):
        await websocket.close()

    inner.add_websocket_route("/socket", websocket_endpoint)
    outer.include_router(inner)
    probe.include_router(outer)
    assert "/outer/inner/hidden" in _static_get_paths(probe)
    assert "/outer/inner/socket" not in _static_get_paths(probe)
    assert "/outer/inner/hidden" not in probe.openapi()["paths"]


def test_all_effective_business_gets_reject_anonymous(client):
    from app.main import app
    from test_auth_security import PUBLIC

    paths = _static_get_paths(app) - PUBLIC
    # Source-verified static GET census at dependency8 HEAD 160f74e. Keep every
    # existing path visible; any newly discovered routes are checked as well.
    baseline_paths = {
        "/admin/audit",
        "/admin/settings",
        "/admin/staff",
        "/analytics/business",
        "/auth/me",
        "/bookings",
        "/bookings/scenario/catalog",
        "/calendar/events",
        "/catalog/instructors",
        "/catalog/services",
        "/coupons",
        "/customers",
        "/dashboard/stats",
        "/events",
        "/me/schedule",
        "/memberships",
        "/memberships/active",
        "/memberships/sales",
        "/resources",
        "/resources/services-map",
        "/resources/types",
        "/resources/visible",
        "/resources/zones",
        "/search",
        "/specializations",
        "/sse/events",
        "/tags",
    }
    assert baseline_paths <= paths

    async def exercise():
        return {
            path: (await _asgi_response_start(app, path))["status"]
            for path in sorted(paths)
        }

    statuses = asyncio.run(exercise())
    assert not {
        path: code
        for path, code in statuses.items()
        if code not in (401, 403, 404, 405)
    }


@pytest.mark.parametrize("case", ["missing", "invalid", "inactive", "unknown"])
def test_sse_auth_errors_close_db_without_subscribing(monkeypatch, case):
    from app.config import settings
    from app.db import get_db
    from app.main import app
    from app.models import User
    from app.realtime import subscriber_count
    from app.security import create_access_token

    trace = []
    user = User(id=98765, username="framework-inactive", role="admin", active=False)

    class TrackingSession:
        def get(self, model, user_id):
            assert model is User and user_id == user.id
            trace.append("lookup")
            return None if case == "unknown" else user

    def tracked_db():
        trace.append("open")
        try:
            yield TrackingSession()
        finally:
            trace.append("close")

    monkeypatch.setitem(app.dependency_overrides, get_db, tracked_db)
    baseline = subscriber_count()
    headers = []
    if case != "missing":
        token = (
            "invalid-synthetic-token"
            if case == "invalid"
            else create_access_token(user.id, user.role)
        )
        headers.append((b"cookie", f"{settings.COOKIE_NAME}={token}".encode()))
    response = asyncio.run(_asgi_response_start(app, "/sse/events", headers))
    assert response["status"] == 401
    assert dict(response["headers"])[b"x-content-type-options"] == b"nosniff"
    assert subscriber_count() == baseline
    expected = (
        ["open", "lookup", "close"]
        if case in {"inactive", "unknown"}
        else ["open", "close"]
    )
    assert trace == expected


@pytest.fixture
def synthetic_login(client, monkeypatch):
    """Real ORM/password/cookies, but only inside conftest's disposable DB."""
    from fastapi.testclient import TestClient

    from app.db import SessionLocal
    from app.main import app
    from app.models import User
    from app.rate_limit import RateLimiter
    from app.routers import auth
    from app.security import hash_password

    # Other tests intentionally exhaust the shared login limiter. Give this
    # fixture its own limiter, not a bypass of the authentication implementation.
    monkeypatch.setattr(auth, "login_limiter", RateLimiter(5, 60))
    credentials = {
        "username": "framework-" + secrets.token_hex(8),
        "password": secrets.token_urlsafe(32),
    }
    with SessionLocal() as db:
        user = User(
            username=credentials["username"],
            password_hash=hash_password(credentials["password"]),
            name="Synthetic Framework User",
            role="admin",
            active=True,
        )
        db.add(user)
        db.commit()
        user_id = user.id
    # No second lifespan: the existing session-scoped client fixture already
    # owns startup/shutdown. This client owns a distinct initially empty jar.
    http = TestClient(app, base_url="https://testserver")
    try:
        yield http, credentials, user_id
    finally:
        http.close()


@pytest.mark.parametrize("secure", [False, True])
def test_real_cookie_csrf_logout_and_orm_date_contract(
    synthetic_login, monkeypatch, secure
):
    from app.config import settings
    from app.csrf import CSRF_COOKIE, CSRF_HEADER

    monkeypatch.setattr(settings, "COOKIE_SECURE", secure)
    http, credentials, user_id = synthetic_login
    login = http.post("/auth/login", json=credentials)
    assert login.status_code == 200
    assert login.json()["id"] == user_id
    cookies = SimpleCookie()
    for header in login.headers.get_list("set-cookie"):
        cookies.load(header)
    assert set(cookies) == {settings.COOKIE_NAME, CSRF_COOKIE}
    assert bool(cookies[settings.COOKIE_NAME]["httponly"])
    assert not cookies[CSRF_COOKIE]["httponly"]
    for name in (settings.COOKIE_NAME, CSRF_COOKIE):
        assert cookies[name]["path"] == "/"
        assert cookies[name]["samesite"] == settings.COOKIE_SAMESITE
        assert bool(cookies[name]["secure"]) is secure
    assert http.get("/auth/me").json()["id"] == user_id

    payload = {"name": "Framework date contract", "birthdate": "2000-01-02"}
    for headers in ({}, {CSRF_HEADER: "mismatch"}):
        rejected = http.post("/customers", json=payload, headers=headers)
        assert rejected.status_code == 403
        assert rejected.json() == {"detail": "CSRF check failed"}
        assert rejected.headers["x-frame-options"] == "DENY"
    matching = {CSRF_HEADER: http.cookies[CSRF_COOKIE]}
    created = http.post("/customers", json=payload, headers=matching)
    assert created.status_code == 201
    assert created.json()["birthdate"] == payload["birthdate"]
    assert datetime.fromisoformat(created.json()["created_at"])
    rows = http.get("/customers", params={"q": payload["name"]})
    assert rows.status_code == 200
    assert any(
        row["id"] == created.json()["id"] and row["birthdate"] == "2000-01-02"
        for row in rows.json()
    )

    logout = http.post("/auth/logout", headers=matching)
    assert logout.status_code == 200
    assert settings.COOKIE_NAME not in http.cookies
    assert http.get("/auth/me").status_code == 401


@pytest.mark.parametrize("case", ["missing-type", "wrong-type", "malformed-json"])
def test_json_body_requires_valid_json_content_type(synthetic_login, case):
    import json

    http, credentials, _ = synthetic_login
    headers = {}
    body = json.dumps(credentials)
    if case == "wrong-type":
        headers["Content-Type"] = "text/plain"
    elif case == "malformed-json":
        headers["Content-Type"] = "application/json"
        body = "{"
    response = http.post("/auth/login", content=body, headers=headers)
    assert response.status_code == 422
    assert any(error["loc"][0] == "body" for error in response.json()["detail"])


@pytest.mark.parametrize("allowed", [True, False])
def test_cors_simple_and_preflight_contract(client, allowed):
    from app.config import settings

    origin = settings.CORS_ORIGINS[0] if allowed else "https://unlisted.example"
    response = client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200  # CORS is a browser policy, not GET auth.
    preflight = client.options(
        "/customers",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-CSRF-Token, Content-Type",
        },
    )
    if allowed:
        for result in (response, preflight):
            assert result.headers["access-control-allow-origin"] == origin
            assert result.headers["access-control-allow-credentials"] == "true"
            assert "origin" in result.headers["vary"].lower()
        assert preflight.status_code == 200
        assert (
            "x-csrf-token" in preflight.headers["access-control-allow-headers"].lower()
        )
    else:
        assert "access-control-allow-origin" not in response.headers
        assert "access-control-allow-origin" not in preflight.headers
        assert preflight.status_code == 400


def test_lifespan_initializes_once_and_awaits_background_cleanup(monkeypatch):
    from app import main, seed

    events = []
    tasks = []

    class Session:
        def __enter__(self):
            events.append("db-enter")
            return self

        def commit(self):
            events.append("commit")

        def __exit__(self, *args):
            events.append("db-exit")

    async def loop(name):
        tasks.append(asyncio.current_task())
        events.append(name + "-start")
        try:
            await asyncio.Event().wait()
        finally:
            events.append(name + "-stop")

    monkeypatch.setattr(
        main.Base.metadata, "create_all", lambda **kwargs: events.append("create")
    )
    monkeypatch.setattr(
        main, "apply_migrations", lambda engine: events.append("migrate")
    )
    monkeypatch.setattr(seed, "seed_if_empty", lambda: events.append("seed"))
    monkeypatch.setattr(main, "SessionLocal", Session)
    monkeypatch.setattr(
        main, "ensure_official_price_catalog", lambda db: events.append("catalog")
    )
    monkeypatch.setattr(main, "_autocomplete_loop", lambda: loop("autocomplete"))
    monkeypatch.setattr(main, "_membership_expiry_loop", lambda: loop("membership"))

    async def exercise():
        async with main.lifespan(main.app):
            await asyncio.sleep(0)
            assert len(tasks) == 2
            assert all(not task.done() for task in tasks)
        assert all(task.done() and task.cancelled() for task in tasks)

    asyncio.run(exercise())
    assert events[:7] == [
        "create",
        "migrate",
        "seed",
        "db-enter",
        "catalog",
        "commit",
        "db-exit",
    ]
    for event in (
        "autocomplete-start",
        "membership-start",
        "autocomplete-stop",
        "membership-stop",
    ):
        assert events.count(event) == 1


@pytest.mark.parametrize(
    "host", [b"testserver/extra", b"testserver?extra", b"testserver#extra"]
)
def test_url_host_cannot_change_the_security_path(host):
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "scheme": "http",
            "path": "/customers",
            "query_string": b"",
            "headers": [(b"host", host)],
            "server": ("testserver", 80),
        }
    )
    assert request.url.path == "/customers"
    assert request.url.hostname == "testserver"


def test_url_path_cannot_change_the_host():
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "scheme": "http",
            "path": "//different.example/customers",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
            "server": ("testserver", 80),
        }
    )
    assert request.url.hostname == "testserver"
    assert request.url.path == "//different.example/customers"
