"""The drill-down pages: W-Engine stats, disc set bonuses, team synergy.

Two things are worth pinning down here.

**The stat maths.** A W-Engine's displayed ATK is not a field in the payload; it
is the base value grown by two independent tables (level and modification) that
the game states in basis points. Getting that wrong would print a plausible but
false number next to a real one, which is worse than printing nothing, so the
arithmetic is checked against the catalog's own ``atk`` field.

**Degrading without the network.** These lookups happen on a click, not during a
sync, so being offline is an ordinary case rather than an error. The page must
still render what the local cache knows.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any

import httpx
import pytest

from zzz_sidecar.cache.db import Cache
from zzz_sidecar.services.codex import CodexService, _drop_prefix, _strip_markup

# Hailstorm Shrine, trimmed to the fields the mapper reads. The level and star
# rates are the real ones for level 60 / modification 5; the catalog lists this
# engine at 743 ATK and 24% CRIT Rate.
ENGINE_PAYLOAD: dict[str, Any] = {
    "id": 14109,
    "name": "Hailstorm Shrine",
    "desc3": "Hail falls before the shrine, waking her.",
    "rarity": 4,
    "weapon_type": {"3": "Anomaly"},
    "base_property": {"name": "Base ATK", "format": "{0:0.#}", "value": 50},
    "rand_property": {"name": "CRIT Rate", "format": "{0:0.#%}", "value": 960},
    "level": {"1": {"rate": 1568}, "60": {"rate": 94090}},
    "stars": {"0": {"star_rate": 0, "rand_rate": 0}, "5": {"star_rate": 44610, "rand_rate": 15000}},
    "talents": {
        "1": {"name": "Frost-Stained Star", "desc": "CRIT DMG increases by <color=#2BAD00>50%</color>."},
        "5": {"name": "Frost-Stained Star", "desc": "CRIT DMG increases by <color=#2BAD00>80%</color>."},
    },
}

INDEX_PAYLOAD: dict[str, Any] = {
    "14109": {"en": "Hailstorm Shrine", "rank": 4, "type": 3},
    "13001": {"en": "Street Superstar", "rank": 3, "type": 1},
}

DISC_PAYLOAD: dict[str, Any] = {
    "31000": {
        "en": {
            "name": "Woodpecker Electro",
            "desc2": "CRIT Rate +8%",
            "desc4": "Landing a critical hit with a <color=#FFFFFF>Basic Attack</color> ...",
        }
    }
}

CHARACTER_PAYLOAD: dict[str, Any] = {
    "name": "Miyabi",
    "passive": {
        "level": {
            "1091501": {
                "level": 1,
                "name": ["Core Passive: Searing Cold", "Additional Ability: Bask in Frost"],
                "desc": ["She applies Icefire.", "When another character in your squad is a Support..."],
            }
        }
    },
}


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> CodexService:
    cache = Cache(Path(tempfile.mkdtemp()) / "cache.sqlite3")
    monkeypatch.setattr("zzz_sidecar.services.codex.get_cache", lambda: cache)
    return CodexService()


def _serve(monkeypatch: pytest.MonkeyPatch, routes: dict[str, Any]) -> list[str]:
    """Stub the CDN. Returns the list of URLs actually requested."""
    requested: list[str] = []

    class _Response:
        def __init__(self, payload: Any) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> Any:
            return self._payload

    class _Client:
        def __init__(self, **_: Any) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, url: str) -> _Response:
            requested.append(url)
            for fragment, payload in routes.items():
                if fragment in url:
                    return _Response(payload)
            raise httpx.ConnectError(f"no stub for {url}")

    monkeypatch.setattr("zzz_sidecar.services.codex.httpx.AsyncClient", _Client)
    return requested


ROUTES = {
    "manifest.json": {"zzz": {"live": "3.2", "latest": "3.3"}},
    "weapon.json": INDEX_PAYLOAD,
    "weapon/14109.json": ENGINE_PAYLOAD,
    "equipment.json": DISC_PAYLOAD,
    "character/1091.json": CHARACTER_PAYLOAD,
}


# -- W-Engine stats ---------------------------------------------------------- #


def test_engine_stats_match_the_catalogs_own_numbers(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Base ATK grows by the level *and* modification rates; the advanced stat
    grows by the modification rate alone. Both are truncated, not rounded,
    which is what the game's detail screen shows."""
    _serve(monkeypatch, ROUTES)
    detail = asyncio.run(service.engine("Hailstorm Shrine"))

    assert detail.known is True
    assert detail.base_atk == 743
    assert detail.adv_stat is not None
    assert detail.adv_stat.name == "CRIT Rate"
    assert detail.adv_stat.value == "24%"
    assert detail.rarity == "S"
    assert detail.specialty == "Anomaly"


def test_engine_carries_every_refinement_step(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A player deciding whether a copy is worth pulling needs S1 *and* S5, so
    the page keeps all of them rather than only the one they own."""
    _serve(monkeypatch, ROUTES)
    detail = asyncio.run(service.engine("Hailstorm Shrine"))

    assert [effect.refinement for effect in detail.effects] == [1, 5]
    assert detail.effect_name == "Frost-Stained Star"
    assert "50%" in detail.effects[0].description
    assert "80%" in detail.effects[1].description


def test_engine_name_matching_ignores_punctuation_and_case(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Names arrive from three sources that disagree on spacing and case."""
    _serve(monkeypatch, ROUTES)
    assert asyncio.run(service.engine("hailstorm  shrine")).known is True


def test_unknown_engine_is_a_blank_page_not_an_error(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A guide can name an engine the catalog has not shipped yet. The page
    still opens; the router fills in who wears it."""
    _serve(monkeypatch, ROUTES)
    detail = asyncio.run(service.engine("Engine Of Tomorrow"))

    assert detail.known is False
    assert detail.name == "Engine Of Tomorrow"
    assert detail.effects == []


# -- caching and offline behaviour ------------------------------------------- #


def test_second_open_is_served_from_cache(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Opening the same engine twice must not hit the CDN twice."""
    requested = _serve(monkeypatch, ROUTES)
    asyncio.run(service.engine("Hailstorm Shrine"))
    before = len(requested)
    asyncio.run(service.engine("Hailstorm Shrine"))

    assert len(requested) == before


def test_offline_serves_stale_cache(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Once seen, an engine stays readable with the network gone."""
    _serve(monkeypatch, ROUTES)
    asyncio.run(service.engine("Hailstorm Shrine"))

    _serve(monkeypatch, {})  # every request now raises
    # Expire the entries so the fetch path is genuinely entered.
    monkeypatch.setattr("zzz_sidecar.services.codex.METADATA_CACHE_MAX_AGE_SECONDS", -1)
    detail = asyncio.run(service.engine("Hailstorm Shrine"))

    assert detail.known is True
    assert detail.base_atk == 743


def test_offline_with_no_cache_is_still_a_page(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(monkeypatch, {})
    detail = asyncio.run(service.engine("Hailstorm Shrine"))

    assert detail.known is False
    assert detail.name == "Hailstorm Shrine"


# -- disc sets and synergy --------------------------------------------------- #


def test_disc_set_carries_both_bonuses(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(monkeypatch, ROUTES)
    detail = asyncio.run(service.disc_set("Woodpecker Electro"))

    assert detail.known is True
    assert detail.two_piece == "CRIT Rate +8%"
    assert "Basic Attack" in detail.four_piece


def test_synergy_splits_core_passive_from_additional_ability(
    service: CodexService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Additional Ability is the team-synergy mechanic and must not be
    conflated with the core passive, which is about the agent alone."""
    _serve(monkeypatch, ROUTES)
    synergy = asyncio.run(service.synergy(1091))

    assert synergy.known is True
    assert synergy.core_name == "Searing Cold"
    assert synergy.additional_name == "Bask in Frost"
    assert synergy.additional_ability.startswith("When another character in your squad")


# -- the game's own markup --------------------------------------------------- #


def test_colour_spans_survive_and_everything_else_is_dropped() -> None:
    """Colour is how the game distinguishes a buff value from prose, so the
    renderer gets to keep it. Icon placeholders are noise and go."""
    cleaned = _strip_markup(
        "<IconMap:Icon_Special>Deals <color=#2BAD00>50%</color> more<unknown/> DMG"
    )
    assert cleaned == "Deals <color=#2BAD00>50%</color> more DMG"


def test_literal_newlines_become_real_ones() -> None:
    assert _strip_markup("first\\nsecond") == "first\nsecond"


def test_passive_label_is_not_printed_twice() -> None:
    """The UI heads the block with "Additional Ability" itself."""
    assert _drop_prefix("Additional Ability: Bask in Frost") == "Bask in Frost"
    assert _drop_prefix("Bask in Frost") == "Bask in Frost"
