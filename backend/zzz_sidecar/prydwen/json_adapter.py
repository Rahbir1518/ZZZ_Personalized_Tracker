"""Placeholder for a structured-data adapter.

As of 2026-09-21 Prydwen serves no machine-readable endpoint: the Gatsby
`/page-data/*.json` routes return HTTP 410, `/_next/data/*` 404s, the RSC flight
endpoint is a redirect loop, and `/api/*` is both 404 and robots-disallowed.

If that ever changes, implement ``PrydwenSource`` here and swap it in at the one
construction site in ``services/sync.py`` — nothing else needs to know.
"""

from __future__ import annotations

from ..models import AgentGuide
from .source import PrydwenUnavailable


class JsonPrydwenSource:
    """Not implemented: no JSON endpoint currently exists."""

    async def fetch_guide(self, slug: str) -> AgentGuide:
        raise PrydwenUnavailable("Prydwen exposes no JSON endpoint; use HtmlPrydwenSource.")

    async def list_agent_slugs(self) -> list[str]:
        raise PrydwenUnavailable("Prydwen exposes no JSON endpoint; use HtmlPrydwenSource.")

    async def aclose(self) -> None:
        return None
