"""In-memory per-IP sliding-window rate limit middleware.

Tracks recent request timestamps per client IP and rejects with 429 once a
client exceeds RATE_LIMIT_MAX requests inside RATE_LIMIT_WINDOW_SEC. When the
caller supplies their own Groq key via the X-Groq-Key header (BYO-key escape
hatch), the limit is skipped entirely — they're paying their own quota, so
fairness on the shared key isn't our problem.

State is process-local. Restarting the server clears it. That's a tradeoff
we accepted for v1 (see LEARNING.md §7.3).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import BYO_KEY_HEADER, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC

# Only the agent run is gated. Health checks, OPTIONS preflight, etc. should
# never count toward the limit.
_GATED_PATHS = {"/run"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        # Async tasks share one event loop, but BaseHTTPMiddleware can be
        # called concurrently. A small lock around the deque ops keeps the
        # window arithmetic atomic without the cost of an asyncio.Lock per IP.
        self._lock = Lock()

    async def dispatch(self, request: Request, call_next):
        if request.url.path not in _GATED_PATHS or request.method != "POST":
            return await call_next(request)

        # BYO-key path — caller pays for their own Groq quota, skip the gate.
        if request.headers.get(BYO_KEY_HEADER):
            return await call_next(request)

        ip = _client_ip(request)
        now = time.monotonic()
        cutoff = now - RATE_LIMIT_WINDOW_SEC

        with self._lock:
            hits = self._hits[ip]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= RATE_LIMIT_MAX:
                retry_after = int(hits[0] + RATE_LIMIT_WINDOW_SEC - now) + 1
                return _limited_response(retry_after)
            hits.append(now)

        return await call_next(request)


def _client_ip(request: Request) -> str:
    # When deployed behind a proxy (Render/Fly), the real client IP is in
    # X-Forwarded-For. Take the first entry — that's the originating client;
    # the rest are hops we control.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _limited_response(retry_after: int) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        headers={"retry-after": str(retry_after)},
        content={
            "error": "rate_limited",
            "message": (
                f"Free tier is capped at {RATE_LIMIT_MAX} runs per "
                f"{RATE_LIMIT_WINDOW_SEC // 60} minutes. To keep going right "
                f"now, supply your own Groq API key via the "
                f"'{BYO_KEY_HEADER}' header."
            ),
            "retry_after_seconds": retry_after,
            "byo_key_header": BYO_KEY_HEADER,
        },
    )
