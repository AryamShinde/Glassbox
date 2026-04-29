import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

from app.tools.base import Tool

_TIMEOUT = httpx.Timeout(10.0)
_MAX_CHARS = 3000
_USER_AGENT = "GlassboxAgent/0.1 (+https://github.com/)"


def _extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    # Strip elements that contain code, not human-readable content.
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    # Collapse runs of whitespace into single spaces — HTML extraction
    # leaves a lot of indentation noise.
    return re.sub(r"\s+", " ", text).strip()


async def _execute(args: dict[str, Any]) -> dict[str, Any]:
    url = args["url"]

    async with httpx.AsyncClient(
        timeout=_TIMEOUT,
        follow_redirects=True,
        headers={"user-agent": _USER_AGENT},
    ) as client:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as e:
            return {"error": f"could not fetch '{url}': {e}"}

    if resp.status_code >= 400:
        return {"error": f"fetch failed: HTTP {resp.status_code}"}

    text = _extract_text(resp.text)
    truncated = len(text) > _MAX_CHARS
    return {
        "url": str(resp.url),
        "text": text[:_MAX_CHARS],
        "truncated": truncated,
    }


tool = Tool(
    name="url_fetcher",
    description=(
        "Fetch a URL and return the readable text content. Use this to read "
        "an article, documentation page, or any web page in detail. Output "
        "is truncated to 3000 chars."
    ),
    schema={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The full URL to fetch, including https://.",
            },
        },
        "required": ["url"],
    },
    execute=_execute,
)
