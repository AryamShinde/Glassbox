"""Diagnostic — tests Groq tool-calling with minimal moving parts.

Tries (model x stream) combinations to isolate where the failure is.
"""
import asyncio

from groq import APIError, AsyncGroq

from app.config import GROQ_API_KEY

from app.agent.system_prompt import SYSTEM_PROMPT
from app.tools import ALL_TOOLS

OUR_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description,
            "parameters": t.schema,
        },
    }
    for t in ALL_TOOLS
]

MESSAGES = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {"role": "user", "content": "What is the population of Tokyo, and what percent of Japan's total population is that?"},
]


CALC_TOOL = OUR_TOOLS  # reuse the variable name; it's a list now


async def try_combo(model: str, stream: bool) -> str:
    client = AsyncGroq(api_key=GROQ_API_KEY)
    try:
        if stream:
            s = await client.chat.completions.create(
                model=model, messages=MESSAGES, tools=CALC_TOOL,
                parallel_tool_calls=False, stream=True,
            )
            tcs = []
            content = ""
            async for chunk in s:
                if not chunk.choices:
                    continue
                d = chunk.choices[0].delta
                if d.content:
                    content += d.content
                if d.tool_calls:
                    tcs.extend(d.tool_calls)
            return f"OK (content={content[:120]!r} | {len(tcs)} tool_call deltas)"
        else:
            resp = await client.chat.completions.create(
                model=model, messages=MESSAGES, tools=CALC_TOOL,
                parallel_tool_calls=False,
            )
            msg = resp.choices[0].message
            tcs = msg.tool_calls or []
            return f"OK (content={(msg.content or '')[:120]!r} | {len(tcs)} tool_calls)"
    except APIError as e:
        body = getattr(e, "body", None)
        return f"FAIL: {e} | body={body!r}"
    except Exception as e:
        return f"FAIL: {type(e).__name__}: {e}"


async def try_reasoning():
    """Does gpt-oss expose a separate reasoning stream we can render as 'thought'?"""
    client = AsyncGroq(api_key=GROQ_API_KEY)
    s = await client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=MESSAGES,
        tools=CALC_TOOL,
        parallel_tool_calls=False,
        stream=True,
        extra_body={"reasoning_effort": "medium", "reasoning_format": "parsed"},
    )
    reasoning_buf = ""
    content_buf = ""
    tcs = 0
    async for chunk in s:
        if not chunk.choices:
            continue
        d = chunk.choices[0].delta
        # The SDK may surface reasoning either as a top-level attr or in extras.
        r = getattr(d, "reasoning", None) or (d.model_extra or {}).get("reasoning")
        if r:
            reasoning_buf += r
        if d.content:
            content_buf += d.content
        if d.tool_calls:
            tcs += len(d.tool_calls)
    print(f"reasoning ({len(reasoning_buf)} chars): {reasoning_buf[:300]!r}")
    print(f"content ({len(content_buf)} chars): {content_buf[:200]!r}")
    print(f"tool_call deltas: {tcs}")


async def main():
    combos = [
        ("openai/gpt-oss-20b", True),
    ]
    for model, stream in combos:
        result = await try_combo(model, stream)
        print(f"{model} stream={stream}: {result}\n")
    print("--- reasoning probe ---")
    await try_reasoning()


if __name__ == "__main__":
    asyncio.run(main())
