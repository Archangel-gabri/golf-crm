"""Tiny in-memory rate limiter for single-process deployments.

Keyed by arbitrary string (typically client IP). Sliding window via a deque of
timestamps. Thread-safe. Designed for /login and similar low-volume endpoints —
when we move to multiple workers / distributed setup, replace with Redis.
"""
from __future__ import annotations
import time
from collections import deque
from threading import Lock


class RateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max = max_attempts
        self.window = window_seconds
        self._buckets: dict[str, deque[float]] = {}
        self._lock = Lock()

    def check(self, key: str) -> bool:
        """Return True if request is allowed, False if over the limit."""
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            q = self._buckets.setdefault(key, deque())
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max:
                return False
            q.append(now)
            return True


login_limiter = RateLimiter(max_attempts=5, window_seconds=60)
