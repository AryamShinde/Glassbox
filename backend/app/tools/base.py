from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class Tool:
    """A single capability the agent can invoke.

    `schema` is the JSON Schema for `args` — the inner `parameters` object of
    OpenAI/Groq's function-call format. The agent loop wraps it into the full
    function-call envelope when sending tool definitions to the LLM.
    """

    name: str
    description: str
    schema: dict[str, Any]
    execute: Callable[[dict[str, Any]], Awaitable[Any]]
