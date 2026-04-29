"""Throwaway smoke test — exercises each tool once and prints the result."""
import asyncio
import json

from app.tools import ALL_TOOLS, TOOLS_BY_NAME


async def main():
    print(f"Registered tools: {[t.name for t in ALL_TOOLS]}\n")

    cases = [
        ("calculator", {"expression": "(125000000 / 13960000) * 100"}),
        ("calculator", {"expression": "__import__('os').system('echo pwned')"}),
        ("wikipedia", {"title": "Tokyo"}),
        ("wikipedia", {"title": "this_article_definitely_does_not_exist_123"}),
        ("url_fetcher", {"url": "https://example.com"}),
    ]

    for name, args in cases:
        tool = TOOLS_BY_NAME[name]
        print(f"--- {name}({args}) ---")
        try:
            result = await tool.execute(args)
        except Exception as e:
            print(f"  raised {type(e).__name__}: {e}")
            continue
        out = json.dumps(result, indent=2, default=str)
        # truncate long text bodies for readability
        if len(out) > 600:
            out = out[:600] + "... [truncated]"
        print(out)
        print()


if __name__ == "__main__":
    asyncio.run(main())
