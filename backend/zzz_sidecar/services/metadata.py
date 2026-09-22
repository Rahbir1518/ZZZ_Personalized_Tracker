"""Full-agent catalog and the current game version, from hakush.in's CDN.

**Why not the `hakushin-py` wrapper?** It was the plan, but as of 2026-09-21 the
published version (0.6.1, March 2026) cannot parse live game data: its
``ZZZElement`` enum predates element ``204``, so ``fetch_characters()`` dies
with a Pydantic ValidationError on the real payload.

We only need a thin slice — id, name, element, specialty, rarity — to render
un-owned agents as "ghost" tiles. So we read the same JSON the wrapper reads and
map it ourselves, **defensively**: unknown element/specialty codes degrade to a
readable label instead of raising. A new agent type on patch day dims one tile;
it does not break the grid.

Endpoints (both confirmed working):
    https://static.nanoka.cc/manifest.json            -> {"zzz": {"latest", "live", ...}}
    https://static.nanoka.cc/zzz/<version>/character.json

HoYoLAB already returns portrait URLs for agents the user *owns*, so this source
is only responsible for the un-owned remainder.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..cache import get_cache
from ..config import METADATA_CACHE_MAX_AGE_SECONDS, USER_AGENT
from ..models import Agent

CDN_BASE = "https://static.nanoka.cc"

#: Confirmed against live data by spot-checking known agents (Ellen/Miyabi =
#: Ice, Anby/Qingyi = Electric, Nicole = Ether). Unknown codes fall through to
#: a generic label rather than raising - this map *will* gain entries on patch
#: days and must never be load-bearing.
_ELEMENTS: dict[int, str] = {
    200: "Physical",
    201: "Fire",
    202: "Ice",
    203: "Electric",
    204: "Frost",
    205: "Ether",
    300: "Auric Ink",
}

#: Verified: Ellen=Attack, Anby/Qingyi=Stun, Miyabi=Anomaly, Nicole/Soukaku=Support.
_SPECIALTIES: dict[int, str] = {
    1: "Attack",
    2: "Stun",
    3: "Anomaly",
    4: "Support",
    5: "Defense",
    6: "Rupture",
}

#: The payload uses numeric ranks, not the "S"/"A" letters the UI shows.
_RARITIES: dict[int, str] = {3: "A", 4: "S"}


class MetadataService:
    """Catalog + version lookups, cached in SQLite, refreshed on patch days."""

    def __init__(self) -> None:
        self._cache = get_cache()

    # -- public ------------------------------------------------------------ #

    async def fetch_catalog(self, *, force: bool = False) -> list[Agent]:
        """Every ZZZ agent that exists, owned or not.

        Serves fresh cache without touching the network, so a sync that only
        needs account data does no work here.
        """
        if not force:
            cached = self._cache.get_metadata("agents")
            if cached is not None:
                payload, fetched_at = cached
                if time.time() - fetched_at < METADATA_CACHE_MAX_AGE_SECONDS:
                    return [Agent.model_validate(row) for row in payload]

        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, timeout=30.0, follow_redirects=True
        ) as client:
            version = await self._fetch_version(client)
            response = await client.get(f"{CDN_BASE}/zzz/{version}/character.json")
            response.raise_for_status()
            raw: dict[str, Any] = response.json()

        agents = [
            agent
            for agent in (self._to_agent(key, value) for key, value in raw.items())
            if agent is not None
        ]

        self._cache.put_metadata("agents", version, [a.model_dump() for a in agents])
        self._cache.put_metadata("version", version, [{"version": version}])
        return agents

    async def game_version(self) -> str:
        """Current game version, used as part of the Prydwen cache key.

        Prefers the cached value; returns "" on failure, in which case guide
        caching falls back to age-based expiry.
        """
        cached = self._cache.get_metadata("version")
        if cached is not None:
            payload, fetched_at = cached
            if payload and time.time() - fetched_at < METADATA_CACHE_MAX_AGE_SECONDS:
                first = payload[0]
                if isinstance(first, dict):
                    return str(first.get("version", ""))

        try:
            async with httpx.AsyncClient(
                headers={"User-Agent": USER_AGENT}, timeout=15.0, follow_redirects=True
            ) as client:
                version = await self._fetch_version(client)
            self._cache.put_metadata("version", version, [{"version": version}])
            return version
        except (httpx.HTTPError, KeyError, ValueError):
            # A missing version is not fatal; it only costs us patch-keyed
            # caching precision.
            return ""

    # -- internals ---------------------------------------------------------- #

    @staticmethod
    async def _fetch_version(client: httpx.AsyncClient) -> str:
        response = await client.get(f"{CDN_BASE}/manifest.json")
        response.raise_for_status()
        zzz = response.json()["zzz"]
        # "latest" tracks the newest datamined build; "live" lags behind it.
        # Recommendations are written against live, so prefer it when present.
        return str(zzz.get("live") or zzz["latest"])

    @classmethod
    def _to_agent(cls, key: str, raw: Any) -> Agent | None:
        """Map one catalog entry. Returns None for anything unrecognisable."""
        if not isinstance(raw, dict):
            return None
        try:
            agent_id = int(key)
        except (TypeError, ValueError):
            return None

        # "en" is the English display name; "code" is an internal codename and
        # is only a fallback.
        name = str(raw.get("en") or raw.get("code") or "").strip()
        if not name:
            return None

        return Agent(
            id=agent_id,
            name=name,
            element=_label(_ELEMENTS, raw.get("element"), "Unknown"),
            specialty=_label(_SPECIALTIES, raw.get("type"), ""),
            rarity=_label(_RARITIES, raw.get("rank"), ""),
            owned=False,
            # Deliberately blank: hakush.in's published image URLs 404 as of
            # 2026-09-21. Owned agents get portraits from HoYoLAB; un-owned
            # tiles fall back to initials, which suits a dimmed ghost tile.
            square_icon="",
            rectangle_icon="",
        )


def _label(mapping: dict[int, str], value: Any, default: str) -> str:
    """Look up a numeric code, tolerating new values added on patch days."""
    try:
        return mapping.get(int(value), default)
    except (TypeError, ValueError):
        return default
