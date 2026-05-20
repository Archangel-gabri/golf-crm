import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import select

from .config import settings
from .csrf import CSRFMiddleware
from .db import Base, engine, SessionLocal
from .enums import BookingStatus, AuditAction
from .models import Booking
from .routers import (
    auth, resources, bookings, customers, catalog, dashboard,
    analytics, admin, search, calendar, memberships, specializations, catalog_admin,
    coupons, tags, demo, me, sse,
)
from .catalog_sync import ensure_official_price_catalog
from .migrations import apply_migrations
from . import audit

log = logging.getLogger("golfadmin.autocomplete")

# Как часто проверяем checked_in брони, чьё время уже истекло, и confirmed без чек-ина.
AUTOCOMPLETE_INTERVAL_SECONDS = 60
# Сколько ждём после starts_at, прежде чем пометить confirmed-бронь как no_show.
NO_SHOW_GRACE_MINUTES = 30


def _autocomplete_finished_bookings() -> int:
    """Переводит check-in'нутые брони в completed, если их ends_at уже прошёл.
    Возвращает число завершённых записей."""
    now = datetime.utcnow()
    completed = 0
    with SessionLocal() as db:
        rows = list(db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.CHECKED_IN.value,
                Booking.ends_at <= now,
            )
        ).scalars())
        for b in rows:
            before = {"status": b.status}
            b.status = BookingStatus.COMPLETED.value
            b.completed_at = now
            audit.log(
                db, None, AuditAction.COMPLETE.value, "booking", b.id,
                summary=f"Авто-завершение по истечении времени (#{b.id})",
                before=before, after={"status": b.status},
            )
            completed += 1
        if completed:
            db.commit()
    return completed


def _autocomplete_no_show_bookings() -> int:
    """Переводит confirmed-брони в no_show, если прошло NO_SHOW_GRACE_MINUTES после starts_at,
    а гость так и не сделал check-in. Возвращает число помеченных записей."""
    now = datetime.utcnow()
    cutoff = now - timedelta(minutes=NO_SHOW_GRACE_MINUTES)
    marked = 0
    with SessionLocal() as db:
        rows = list(db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.CONFIRMED.value,
                Booking.starts_at <= cutoff,
            )
        ).scalars())
        for b in rows:
            before = {"status": b.status}
            b.status = BookingStatus.NO_SHOW.value
            b.no_show_at = now
            audit.log(
                db, None, AuditAction.NO_SHOW.value, "booking", b.id,
                summary=(
                    f"Авто-«не пришёл» — нет чек-ина в течение "
                    f"{NO_SHOW_GRACE_MINUTES} мин после начала (#{b.id})"
                ),
                before=before, after={"status": b.status},
            )
            marked += 1
        if marked:
            db.commit()
    return marked


async def _autocomplete_loop():
    """Фоновая задача: раз в минуту авто-завершает истекшие check-in'нутые брони и помечает no_show."""
    while True:
        try:
            done = await asyncio.to_thread(_autocomplete_finished_bookings)
            if done:
                log.info("Auto-completed %d bookings", done)
            no_show = await asyncio.to_thread(_autocomplete_no_show_bookings)
            if no_show:
                log.info("Auto-marked %d bookings as no_show", no_show)
        except Exception:
            log.exception("Auto-complete loop error (will retry)")
        await asyncio.sleep(AUTOCOMPLETE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    apply_migrations(engine)
    from .seed import seed_if_empty
    seed_if_empty()
    with SessionLocal() as db:
        ensure_official_price_catalog(db)
        db.commit()
    task = asyncio.create_task(_autocomplete_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(
    title="GolfAdmin API",
    version="2.0.0",
    description="FastAPI backend for Крылатское",
    lifespan=lifespan,
    docs_url="/docs" if settings.DOCS_ENABLED else None,
    redoc_url="/redoc" if settings.DOCS_ENABLED else None,
    openapi_url="/openapi.json" if settings.DOCS_ENABLED else None,
)

app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-CSRF-Token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    # HSTS: only meaningful behind HTTPS, nginx will add it, but safe to include.
    if settings.COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.include_router(auth.router)
app.include_router(resources.router)
app.include_router(bookings.router)
app.include_router(customers.router)
app.include_router(catalog.router)
app.include_router(dashboard.router)
app.include_router(analytics.router)
app.include_router(admin.router)
app.include_router(search.router)
app.include_router(calendar.router)
app.include_router(memberships.router)
app.include_router(specializations.router)
app.include_router(catalog_admin.router)
app.include_router(coupons.router)
app.include_router(tags.router)
if not settings.is_production:
    app.include_router(demo.router)
app.include_router(me.router)
app.include_router(sse.router)


@app.get("/health")
def health():
    return {"ok": True, "club": settings.CLUB_NAME}


@app.get("/")
def root():
    return {
        "app": "GolfAdmin API",
        "club": settings.CLUB_NAME,
        "env": settings.ENV,
        "docs": "/docs" if settings.DOCS_ENABLED else None,
    }
