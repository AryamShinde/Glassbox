"""End-to-end smoke test of the agent loop. Requires GROQ_API_KEY in .env."""
import asyncio
import json

from app.agent.loop import run_agent


async def main():
    goal = "What is the population of Tokyo, and what percent of Japan's total population is that?"
    print(f"GOAL: {goal}\n")

    async for event in run_agent(goal):
        payload = event.model_dump()
        kind = payload.pop("type")
        if kind == "thought":
            # Token-stream — print without newline so it reads as flowing text.
            print(payload["text"], end="", flush=True)
        else:
            print(f"\n\n[{kind}] {json.dumps(payload, default=str)[:400]}\n")


if __name__ == "__main__":
    asyncio.run(main())
