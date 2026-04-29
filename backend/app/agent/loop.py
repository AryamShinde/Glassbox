import json
from typing import Any, AsyncIterator

from groq import APIError, AsyncGroq, GroqError

from app.agent.events import AgentEvent, ErrorEvent, FinalAnswer, Thought, ToolCall, ToolResult
from app.agent.system_prompt import SYSTEM_PROMPT
from app.config import GROQ_API_KEY, GROQ_MODEL, MAX_ITERATIONS
from app.tools import ALL_TOOLS, TOOLS_BY_NAME, Tool


def _to_groq_tool(tool: Tool) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.schema,
        },
    }


async def run_agent(
    goal: str, api_key: str | None = None
) -> AsyncIterator[AgentEvent]:
    """Run the agent loop for a single user goal, yielding events as they happen.

    The loop alternates between asking the LLM what to do next and executing
    the tool it chose. It exits via FinalAnswer when the LLM stops calling
    tools, or via ErrorEvent on failure / iteration cap.

    `api_key` overrides the server's GROQ_API_KEY when supplied — this is the
    BYO-key path that lets a rate-limited user bring their own Groq credentials.
    """
    key = api_key or GROQ_API_KEY
    if not key:
        yield ErrorEvent(message="GROQ_API_KEY is not set")
        return

    client = AsyncGroq(api_key=key)
    tool_defs = [_to_groq_tool(t) for t in ALL_TOOLS]
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": goal},
    ]

    for _ in range(MAX_ITERATIONS):
        content_buf = ""
        # Each tool_call streams in pieces across multiple chunks. We collect
        # the deltas keyed by `index` and assemble them when the stream ends.
        tool_calls_buf: dict[int, dict[str, str]] = {}

        try:
            stream = await client.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                tools=tool_defs,
                parallel_tool_calls=False,
                stream=True,
                # gpt-oss exposes its planning as a separate `reasoning`
                # stream. We render it as Thought events; content stays
                # reserved for the final answer.
                extra_body={
                    "reasoning_effort": "medium",
                    "reasoning_format": "parsed",
                },
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                # `reasoning` isn't a typed field on the Groq SDK 0.13 delta
                # object — it arrives via `model_extra` (Pydantic's bag for
                # unknown fields). Check both for forward compatibility.
                reasoning = getattr(delta, "reasoning", None) or (
                    delta.model_extra or {}
                ).get("reasoning")
                if reasoning:
                    yield Thought(text=reasoning)

                if delta.content:
                    content_buf += delta.content

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        slot = tool_calls_buf.setdefault(
                            tc.index, {"id": "", "name": "", "arguments": ""}
                        )
                        if tc.id:
                            slot["id"] = tc.id
                        if tc.function and tc.function.name:
                            slot["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            slot["arguments"] += tc.function.arguments
        except APIError as e:
            # Groq attaches a `body` with `failed_generation` for tool-call
            # validation failures — surface it so the user knows what broke.
            detail = ""
            body = getattr(e, "body", None)
            if isinstance(body, dict):
                err = body.get("error", {})
                if isinstance(err, dict):
                    fg = err.get("failed_generation")
                    if fg:
                        detail = f" | failed_generation: {str(fg)[:300]}"
            yield ErrorEvent(message=f"groq api error: {e}{detail}")
            return
        except GroqError as e:
            yield ErrorEvent(message=f"groq request failed: {e}")
            return

        # No tool calls means the LLM is done — content is the final answer.
        if not tool_calls_buf:
            yield FinalAnswer(text=content_buf)
            return

        # Persist the assistant turn (content + tool_calls) so the next
        # iteration's messages reflect what the model actually said.
        messages.append(
            {
                "role": "assistant",
                "content": content_buf or None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for tc in tool_calls_buf.values()
                ],
            }
        )

        for tc in tool_calls_buf.values():
            try:
                args = json.loads(tc["arguments"]) if tc["arguments"] else {}
            except json.JSONDecodeError as e:
                yield ErrorEvent(message=f"bad tool args from LLM: {e}")
                return

            yield ToolCall(name=tc["name"], args=args)

            tool = TOOLS_BY_NAME.get(tc["name"])
            if tool is None:
                result: Any = {"error": f"unknown tool: {tc['name']}"}
            else:
                try:
                    result = await tool.execute(args)
                except Exception as e:
                    # Unexpected tool failure — feed the error back to the LLM
                    # so it can decide whether to retry or give up gracefully.
                    result = {"error": f"{type(e).__name__}: {e}"}

            yield ToolResult(name=tc["name"], result=result)

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, default=str),
                }
            )

    yield ErrorEvent(
        message=f"max iterations ({MAX_ITERATIONS}) reached without a final answer"
    )
