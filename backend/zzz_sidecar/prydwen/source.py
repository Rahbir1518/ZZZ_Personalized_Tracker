"""The boundary between "recommendations" and "how we obtained them".

Nothing outside this package knows whether a guide came from HTML, a JSON
endpoint, or a fixture. If Prydwen ever reinstates a structured endpoint, only a
new implementation of this protocol is needed.
"""

from __future__ import annotations

from typing import Protocol

from ..models import AgentGuide


class PrydwenUnavailable(RuntimeError):
    """Network-level failure: unreachable, timed out, non-200. Retryable."""


class PrydwenParseError(RuntimeError):
    """The page loaded but did not look the way we expect.

    Raised loudly and on purpose: it means Prydwen changed their markup and the
    adapter needs updating. The golden-file tests exist to catch this before a
    user does. Carries the selector that failed so the fix is obvious.
    """

    def __init__(self, message: str, *, selector: str = "", slug: str = "") -> None:
        super().__init__(message)
        self.selector = selector
        self.slug = slug


class PrydwenSource(Protocol):
    """Read recommendations for one agent."""

    async def fetch_guide(self, slug: str) -> AgentGuide:
        """Return the parsed guide for an agent slug, e.g. ``"miyabi"``.

        Raises ``PrydwenUnavailable`` on transport failure and
        ``PrydwenParseError`` when the document structure is unrecognisable.
        """
        ...

    async def list_agent_slugs(self) -> list[str]:
        """Return every ZZZ agent slug Prydwen has a guide page for."""
        ...

    async def aclose(self) -> None: ...
