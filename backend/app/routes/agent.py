from typing import AsyncIterator

from fastapi import APIRouter, Header
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.agent.events import AgentEvent
from app.agent.loop import run_agent

router = APIRouter()


class RunRequest(BaseModel):
    goal: str


@router.post("/run")
async def run(req: RunRequest, x_groq_key: str | None = Header(default=None)):
    return EventSourceResponse(_to_sse(run_agent(req.goal, api_key=x_groq_key)))


async def _to_sse(events: AsyncIterator[AgentEvent]) -> AsyncIterator[dict]:
    async for event in events:
        yield {"event": event.type, "data": event.model_dump_json()}
