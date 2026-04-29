from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS
from app.rate_limit import RateLimitMiddleware
from app.routes import agent

app = FastAPI(title="Glassbox API")

# CORS is added last so it runs first on the response path — important for
# 429 responses from the rate limiter to still carry CORS headers.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(agent.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
