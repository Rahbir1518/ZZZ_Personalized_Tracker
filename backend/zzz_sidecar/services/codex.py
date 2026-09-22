"""Game data for the drill-down pages: W-Engines, Drive Disc sets, passives.

The roster and the recommendations tell you *what* to equip. They do not say
what the thing actually does — Prydwen's markup carries a name, an icon and a
rating, and HoYoLAB's carries a level and a refinement. Clicking through to a
W-Engine and reading "CRIT DMG +50%, Ice DMG +20% per stack" is the point of
this module.

Source is the same CDN :mod:`metadata` already uses, with the same patch-keyed
cache policy. Two differences from the sync sources:

* **Fetched on demand, not during a sync.** These are single small JSON files
  behind a click, and there are ~130 of them; pulling them all on every sync to
  serve the handful anyone opens would be the wasteful option. They are not
  Prydwen, so there is no crawl delay to respect.
* **A miss is never fatal.** Offline, or on an entry the CDN does not carry,
  the page still renders from local data — who wears it, whose guide wants it —
  and simply says the game text is unavailable. That is the whole reason
  ``known`` exists on the models.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx

from ..cache import get_cache
from ..config import METADATA_CACHE_MAX_AGE_SECONDS, USER_AGENT
from ..models import (
    AgentSynergy,
    DiscSetDetail,
    EngineDetail,
    EngineEffect,
    Property,
)
from .analysis import normalise_name

CDN_BASE = "https://static.nanoka.cc"

#: Same maps :mod:`metadata` uses; duplicated rather than imported to keep that
#: module's private tables private.
_ENGINE_RARITIES: dict[int, str] = {2: "B", 3: "A", 4: "S"}
_SPECIALTIES: dict[int, str] = {
    1: "Attack",
    2: "Stun",
    3: "Anomaly",
    4: "Support",
    5: "Defense",
    6: "Rupture",
}

#: The game marks up its own strings. ``<color=#RRGGBB>`` carries real meaning
#: — it is how the game distinguishes a buff value from prose — so it survives
#: to the renderer, which parses it into spans. Everything else (icon
#: placeholders, ruby annotations) is dropped.
_TAG = re.compile(r"<[^<>]{1,120}>")
_COLOR_OPEN = re.compile(r"^<color=#[0-9a-fA-F]{6,8}>$")


def _strip_markup(text: Any) -> str:
    """Plain text plus the colour spans, with the game's escapes resolved."""
    if not isinstance(text, str):
        return ""

    def keep(match: re.Match[str]) -> str:
        tag = match.group(0)
        if _COLOR_OPEN.match(tag) or tag == "</color>":
            return tag
        return ""

    cleaned = _TAG.sub(keep, text)
    # Payloads carry both real newlines and literal backslash-n.
    cleaned = cleaned.replace("\\n", "\n").replace("\r\n", "\n")
    return "\n".join(line.strip() for line in cleaned.split("\n")).strip()


def _first_value(mapping: Any) -> str:
    """The single value out of the game's one-entry ``{code: label}`` maps."""
    if isinstance(mapping, dict):
        for value in mapping.values():
            if isinstance(value, str) and value:
                return value
    return ""


def _rate(mapping: Any, key: str) -> float:
    """One of the game's basis-point growth rates, as a plain multiplier."""
    if not isinstance(mapping, dict):
        return 0.0
    try:
        return float(mapping.get(key, 0)) / 10_000.0
    except (TypeError, ValueError):
        return 0.0


def _max_entry(table: Any) -> dict[str, Any]:
    """The highest-numbered row of a level/star table."""
    if not isinstance(table, dict) or not table:
        return {}
    try:
        key = max(table, key=lambda k: int(k))
    except (TypeError, ValueError):
        return {}
    row = table[key]
    return row if isinstance(row, dict) else {}


class CodexService:
    """On-demand game-data lookups, cached in SQLite for the patch's lifetime.

    One in-flight lock per cache key, so three team members opening the same
    engine at once make one request rather than three.
    """

    def __init__(self) -> None:
        self._cache = get_cache()
        self._locks: dict[str, asyncio.Lock] = {}

    # -- public ------------------------------------------------------------- #

    async def engine(self, name: str) -> EngineDetail:
        """One W-Engine's stats and per-refinement passive.

        Returns a ``known=False`` shell rather than raising, so the caller can
        always render the page.
        """
        detail = EngineDetail(name=name.strip())
        if detail.name == "":
            return detail

        index = await self._engine_index()
        entry = index.get(normalise_name(detail.name))
        if entry is None:
            return detail

        raw = await self._fetch_cached(
            "engine", str(entry["id"]), f"{CDN_BASE}/zzz/{{version}}/en/weapon/{entry['id']}.json"
        )
        if raw is None:
            # The index alone still knows the rank and the display name.
            detail.rarity = str(entry.get("rarity", ""))
            detail.specialty = str(entry.get("specialty", ""))
            return detail

        return self._engine_from_raw(detail.name, raw, entry)

    async def disc_set(self, set_name: str) -> DiscSetDetail:
        """A Drive Disc set's 2-piece and 4-piece bonuses."""
        detail = DiscSetDetail(set_name=set_name.strip())
        if detail.set_name == "":
            return detail

        table = await self._disc_set_table()
        entry = table.get(normalise_name(detail.set_name))
        if entry is None:
            return detail

        detail.known = True
        # Prefer the catalog's own spelling; it is the one the effect text was
        # written against.
        detail.set_name = str(entry.get("name") or detail.set_name)
        detail.two_piece = str(entry.get("two_piece", ""))
        detail.four_piece = str(entry.get("four_piece", ""))
        return detail

    async def synergy(self, agent_id: int) -> AgentSynergy:
        """An agent's Core Passive and Additional Ability.

        The Additional Ability is the team-synergy mechanic itself: it names the
        squad condition that switches it on and the buff it grants.
        """
        result = AgentSynergy(agent_name="")
        raw = await self._fetch_cached(
            "synergy", str(agent_id), f"{CDN_BASE}/zzz/{{version}}/en/character/{agent_id}.json"
        )
        if raw is None:
            return result

        result.agent_name = str(raw.get("name") or "")
        names, descriptions = self._passive_texts(raw)
        if not names and not descriptions:
            return result

        result.known = True
        # The payload pairs them positionally: [core, additional].
        result.core_name = _drop_prefix(names[0]) if len(names) > 0 else ""
        result.core_passive = descriptions[0] if len(descriptions) > 0 else ""
        result.additional_name = _drop_prefix(names[1]) if len(names) > 1 else ""
        result.additional_ability = descriptions[1] if len(descriptions) > 1 else ""
        return result

    # -- fetch + cache ------------------------------------------------------- #

    async def _engine_index(self) -> dict[str, dict[str, Any]]:
        """Normalised engine name -> {id, rarity, specialty}."""
        raw = await self._fetch_cached("engine_index", "", f"{CDN_BASE}/zzz/{{version}}/weapon.json")
        if raw is None or not isinstance(raw, dict):
            return {}

        index: dict[str, dict[str, Any]] = {}
        for key, value in raw.items():
            if not isinstance(value, dict):
                continue
            name = str(value.get("en") or "").strip()
            if name == "":
                continue
            try:
                engine_id = int(key)
            except (TypeError, ValueError):
                continue
            index[normalise_name(name)] = {
                "id": engine_id,
                "rarity": _ENGINE_RARITIES.get(_as_int(value.get("rank")), ""),
                "specialty": _SPECIALTIES.get(_as_int(value.get("type")), ""),
            }
        return index

    async def _disc_set_table(self) -> dict[str, dict[str, str]]:
        """Normalised set name -> {name, two_piece, four_piece}.

        One small file covers every set, so unlike engines this is fetched
        whole rather than per entry.
        """
        raw = await self._fetch_cached("disc_sets", "", f"{CDN_BASE}/zzz/{{version}}/equipment.json")
        if raw is None or not isinstance(raw, dict):
            return {}

        table: dict[str, dict[str, str]] = {}
        for value in raw.values():
            if not isinstance(value, dict):
                continue
            english = value.get("en")
            if not isinstance(english, dict):
                continue
            name = str(english.get("name") or "").strip()
            if name == "":
                continue
            table[normalise_name(name)] = {
                "name": name,
                "two_piece": _strip_markup(english.get("desc2")),
                "four_piece": _strip_markup(english.get("desc4")),
            }
        return table

    async def _fetch_cached(self, kind: str, key: str, url_template: str) -> Any | None:
        """Serve a codex entry from cache, fetching it once if it is stale.

        ``url_template`` takes ``{version}``. A network failure returns None and
        leaves any stale cache in place — the caller degrades, and the next
        click tries again.
        """
        version = self._version()
        cached = self._cache.get_codex(kind, key)
        if cached is not None:
            payload, stored_version, fetched_at = cached
            fresh_enough = time.time() - fetched_at < METADATA_CACHE_MAX_AGE_SECONDS
            # An unknown current version means we cannot tell a patch-day miss
            # from a hit, so age alone decides.
            if fresh_enough and (version == "" or stored_version == version):
                return payload

        lock = self._locks.setdefault(f"{kind}:{key}", asyncio.Lock())
        async with lock:
            # Another waiter may have filled it while we queued.
            refreshed = self._cache.get_codex(kind, key)
            if refreshed is not None and refreshed[2] > time.time() - 5:
                return refreshed[0]

            try:
                async with httpx.AsyncClient(
                    headers={"User-Agent": USER_AGENT}, timeout=20.0, follow_redirects=True
                ) as client:
                    resolved = version or await self._fetch_version(client)
                    response = await client.get(url_template.format(version=resolved))
                    response.raise_for_status()
                    payload = response.json()
            except (httpx.HTTPError, ValueError):
                # Offline, or the CDN moved. Stale beats empty.
                return None if cached is None else cached[0]

            self._cache.put_codex(kind, key, resolved, payload)
            return payload

    def _version(self) -> str:
        """The cached game version, or "" when we have not learned one yet."""
        cached = self._cache.get_metadata("version")
        if cached is None:
            return ""
        payload, _ = cached
        if not payload or not isinstance(payload[0], dict):
            return ""
        return str(payload[0].get("version", ""))

    @staticmethod
    async def _fetch_version(client: httpx.AsyncClient) -> str:
        response = await client.get(f"{CDN_BASE}/manifest.json")
        response.raise_for_status()
        zzz = response.json()["zzz"]
        return str(zzz.get("live") or zzz["latest"])

    # -- mapping ------------------------------------------------------------- #

    @staticmethod
    def _engine_from_raw(
        name: str, raw: dict[str, Any], entry: dict[str, Any]
    ) -> EngineDetail:
        """Map one weapon payload, computing the stats at max level.

        Both stats grow with two independent tables: ``level`` (1-60) and
        ``stars`` (the modification tier). Max level plus full modification is
        what the in-game detail screen shows, and it is what a player comparing
        two engines wants. Verified against the catalog's own ``atk`` field.
        """
        detail = EngineDetail(name=str(raw.get("name") or name), known=True)
        detail.rarity = _ENGINE_RARITIES.get(_as_int(raw.get("rarity")), "") or str(
            entry.get("rarity", "")
        )
        detail.specialty = _first_value(raw.get("weapon_type"))
        detail.flavour = _strip_markup(raw.get("desc3") or raw.get("desc"))

        top_level = _max_entry(raw.get("level"))
        top_star = _max_entry(raw.get("stars"))

        base = raw.get("base_property")
        if isinstance(base, dict):
            growth = 1.0 + _rate(top_level, "rate") + _rate(top_star, "star_rate")
            # Truncated, not rounded: that is what the catalog's own `atk`
            # field and the in-game detail screen show.
            detail.base_atk = int(_as_float(base.get("value")) * growth)

        adv = raw.get("rand_property")
        if isinstance(adv, dict):
            stat_name = str(adv.get("name") or "")
            value = _as_float(adv.get("value")) * (1.0 + _rate(top_star, "rand_rate"))
            if stat_name:
                detail.adv_stat = Property(
                    name=stat_name, value=_format_stat(value, str(adv.get("format") or ""))
                )

        talents = raw.get("talents")
        if isinstance(talents, dict):
            for key in sorted(talents, key=lambda k: _as_int(k)):
                step = talents[key]
                if not isinstance(step, dict):
                    continue
                if detail.effect_name == "":
                    detail.effect_name = _strip_markup(step.get("name"))
                detail.effects.append(
                    EngineEffect(
                        refinement=_as_int(key),
                        description=_strip_markup(step.get("desc")),
                    )
                )

        return detail

    @staticmethod
    def _passive_texts(raw: dict[str, Any]) -> tuple[list[str], list[str]]:
        """The ``passive`` block's names and descriptions, at its top level.

        The payload nests them under a level table whose entries are identical
        apart from scaling numbers; the last one is the fully-levelled text.
        """
        passive = raw.get("passive")
        if not isinstance(passive, dict):
            return [], []
        levels = passive.get("level")
        if not isinstance(levels, dict) or not levels:
            return [], []

        try:
            key = max(levels, key=lambda k: _as_int(levels[k].get("level", k)))
        except (AttributeError, TypeError, ValueError):
            key = next(iter(levels))
        block = levels.get(key)
        if not isinstance(block, dict):
            return [], []

        names = [_strip_markup(n) for n in block.get("name", []) if isinstance(n, str)]
        descriptions = [_strip_markup(d) for d in block.get("desc", []) if isinstance(d, str)]
        return names, descriptions


def _format_stat(value: float, fmt: str) -> str:
    """Render a stat the way the game does, from its format string.

    ``{0:0.#%}`` means the raw value is in hundredths of a percent; anything
    else is a flat number.
    """
    if "%" in fmt:
        return f"{value / 100:.1f}".rstrip("0").rstrip(".") + "%"
    return f"{value:.0f}"


def _drop_prefix(name: str) -> str:
    """Drop the game's own "Core Passive: " / "Additional Ability: " label.

    The UI heads each block with that label already, so keeping it would print
    it twice.
    """
    _, separator, tail = name.partition(":")
    return tail.strip() if separator and tail.strip() else name.strip()


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


_codex: CodexService | None = None


def get_codex() -> CodexService:
    global _codex
    if _codex is None:
        _codex = CodexService()
    return _codex
