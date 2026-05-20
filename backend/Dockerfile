FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps for argon2 / cryptography wheels + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt && pip install gunicorn

COPY app ./app
COPY alembic.ini .
COPY alembic ./alembic
COPY scripts ./scripts
COPY run.py .

RUN useradd --create-home --shell /bin/bash app && \
    chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# gunicorn with a single uvicorn worker — sufficient for current 6-user scale.
# IMPORTANT: stays at --workers 1 until two prerequisites are met (Phase 5 plan):
#   1. The autocomplete/no-show scheduler in app/main.py is moved to a separate
#      worker container — otherwise N workers run N copies of the loop and
#      double-mark bookings.
#   2. The booking-creation race protection (threading.Lock in routers/bookings.py)
#      is replaced by a DB-level lock (Postgres SELECT FOR UPDATE) — the
#      threading.Lock is process-local and useless across multiple workers.
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "1", \
     "--bind", "0.0.0.0:8000", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--timeout", "60"]
