from typing import Any
from urllib.parse import quote

import httpx

from app.tools.base import Tool

_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
_TIMEOUT = httpx.Timeout(10.0)
# Wikipedia's API policy requires a descriptive User-Agent identifying
# the project + a contact path. Requests without one get a 403.
# https://api.wikimedia.org/wiki/Documentation/User-Agent_policy
_HEADERS = {
    "accept": "application/json",
    "user-agent": "GlassboxAgent/0.1 (https://github.com/; portfolio demo)",
}


async def _execute(args: dict[str, Any]) -> dict[str, Any]:
    title = args["title"]
    url = _SUMMARY_URL.format(title=quote(title.replace(" ", "_")))

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, headers=_HEADERS)

    if resp.status_code == 404:
        return {"error": f"no Wikipedia article found for '{title}'"}
    resp.raise_for_status()

    data = resp.json()
    return {
        "title": data.get("title"),
        "extract": data.get("extract"),
        "url": data.get("content_urls", {}).get("desktop", {}).get("page"),
    }


tool = Tool(
    name="wikipedia",
    description=(
        "Look up a Wikipedia article by title and return a short factual "
        "summary. Use this for definitions, facts, people, places, events. "
        "If the first title doesn't match, try variations."
    ),
    schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The article title, e.g. 'Tokyo' or 'Alan Turing'.",
            },
        },
        "required": ["title"],
    },
    execute=_execute,
)
