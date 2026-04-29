from app.tools.base import Tool
from app.tools.calculator import tool as _calculator
from app.tools.url_fetcher import tool as _url_fetcher
from app.tools.wikipedia import tool as _wikipedia

ALL_TOOLS: list[Tool] = [_wikipedia, _calculator, _url_fetcher]
TOOLS_BY_NAME: dict[str, Tool] = {t.name: t for t in ALL_TOOLS}

__all__ = ["Tool", "ALL_TOOLS", "TOOLS_BY_NAME"]
