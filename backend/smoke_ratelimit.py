"""Smoke test the RateLimitMiddleware in isolation.

We mount it on a tiny FastAPI app with a non-SSE /run handler so the test
exercises only the gate logic — no Groq, no sse-starlette event-loop quirks.
"""
import os

os.environ["RATE_LIMIT_MAX"] = "2"
os.environ["RATE_LIMIT_WINDOW_SEC"] = "60"
os.environ.setdefault("GROQ_API_KEY", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.rate_limit import RateLimitMiddleware  # noqa: E402


def build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware)

    @app.post("/run")
    async def run():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


def main():
    client = TestClient(build_app())
    body = {"goal": "test"}

    print("=== first 2 POSTs to /run (under limit of 2) ===")
    for i in range(1, 3):
        r = client.post("/run", json=body)
        print(f"  req {i}: status={r.status_code}")
        assert r.status_code == 200, f"req {i} unexpected status"

    print("=== 3rd POST (over limit, expect 429) ===")
    r = client.post("/run", json=body)
    print(f"  status={r.status_code}, body={r.json()}")
    assert r.status_code == 429
    payload = r.json()
    assert payload["error"] == "rate_limited"
    assert payload["byo_key_header"] == "x-groq-key"
    assert isinstance(payload["retry_after_seconds"], int)
    assert r.headers.get("retry-after") is not None

    print("=== BYO-key bypass (X-Groq-Key set, expect 200) ===")
    r = client.post("/run", json=body, headers={"X-Groq-Key": "user-key"})
    print(f"  status={r.status_code}")
    assert r.status_code == 200

    print("=== many BYO-key requests, all should bypass ===")
    for i in range(5):
        r = client.post("/run", json=body, headers={"X-Groq-Key": "user-key"})
        assert r.status_code == 200
    print("  5x BYO-key all 200 OK")

    print("=== /health never gated ===")
    for _ in range(10):
        r = client.get("/health")
        assert r.status_code == 200
    print("  10x /health all 200 OK")

    print("=== X-Forwarded-For separates IPs ===")
    # Same TestClient, but a different forwarded IP gets its own bucket.
    r = client.post("/run", json=body, headers={"X-Forwarded-For": "9.9.9.9"})
    print(f"  fresh IP req: status={r.status_code}")
    assert r.status_code == 200

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
