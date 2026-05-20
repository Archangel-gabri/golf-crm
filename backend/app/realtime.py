"""Server-Sent Events fan-out.

Lightweight in-process broadcaster: any synchronous code path can call
`broadcast({"type": "bookings"})` after a commit, and every connected SSE
client receives that JSON payload.

Designed for the current single-uvicorn-worker deployment. If we ever scale
out to multiple workers/replicas we'll need a Redis pub/sub instead — but at
6 simultaneous users this in-memory bus is plenty.

Each SSE connection holds a per-client asyncio.Queue. The endpoint coroutine
streams items off that queue forever, with a heartbeat every 20 s so reverse
proxies don't drop the connection.
"""
from __future__ import annotations
import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import Request

log = logging.getLogger("golfadmin.realtime")

# Subscriber queues — populated when an SSE connection opens, removed when it closes.
_subscribers: set[asyncio.Queue] = set()


def broadcast(payload: dict) -> None:
    """Fan-out a JSON-serializable payload to every connected SSE client.

    Safe to call from synchronous request handlers — failures (queue full, etc.)
    are swallowed: realtime is best-effort, the underlying DB write is
    authoritative anyway.
    """
    if not _subscribers:
        return
    dead: list[asyncio.Queue] = []
    for q in _subscribers:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            log.warning("SSE subscriber queue full — dropping client")
            dead.append(q)
        except Exception as e:  # noqa: BLE001
            log.warning("SSE broadcast error: %s", e)
            dead.append(q)
    for q in dead:
        _subscribers.discard(q)


async def event_stream(request: Request) -> AsyncIterator[str]:
    """Async generator that yields SSE-formatted strings for one client."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.add(queue)
    try:
        # Greet — lets the client mark itself "connected".
        yield "event: hello\ndata: {}\n\n"
        while True:
            if await request.is_disconnected():
                break
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                # Heartbeat. Many proxies (and our own nginx) close idle SSE
                # streams after ~60 s without traffic.
                yield ": ping\n\n"
    finally:
        _subscribers.discard(queue)


def subscriber_count() -> int:
    return len(_subscribers)
