"""CSRF protection via double-submit cookie pattern.

The browser holds a non-httpOnly `golf_csrf` cookie. JS reads it and echoes the
value in `X-CSRF-Token` on every state-changing request. Server checks header
matches cookie (constant-time compare). Without the matching pair we 403.

CSRF only matters for authenticated mutating requests, so we skip the check when
no session cookie is present (lets logout/login flow itself work, /docs in dev,
unauthenticated demo routes, etc.).
"""
from __future__ import annotations
import secrets

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .config import settings

CSRF_COOKIE = "golf_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
EXEMPT_PATHS = {"/auth/login"}


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _set_csrf_cookie(response, token: str) -> None:
    response.set_cookie(
        key=CSRF_COOKIE,
        value=token,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cookie_token = request.cookies.get(CSRF_COOKIE)
        session_token = request.cookies.get(settings.COOKIE_NAME)
        is_mutating = request.method not in SAFE_METHODS
        path = request.url.path

        if is_mutating and session_token and path not in EXEMPT_PATHS:
            header_token = request.headers.get(CSRF_HEADER)
            if (
                not cookie_token
                or not header_token
                or not secrets.compare_digest(cookie_token, header_token)
            ):
                return JSONResponse(
                    {"detail": "CSRF check failed"}, status_code=403
                )

        response = await call_next(request)
        if not cookie_token:
            _set_csrf_cookie(response, _new_token())
        return response
