"""Rank badges must never show a rank we do not actually have.

Prydwen's recommendation markup carries no rank for a W-Engine, and the UI was
previously hard-coding "S" on every recommended engine and every disc set. That
reads as data on a badge a player would use to decide what to pull, so the rank
now comes from the game catalog, and anything the catalog does not know stays
blank - which the UI renders as no badge at all.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

import pytest

from zzz_sidecar.cache.db import Cache
from zzz_sidecar.config import METADATA_CACHE_MAX_AGE_SECONDS
from zzz_sidecar.services.metadata import _ENGINE_RARITIES, MetadataService, _label


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> MetadataService:
    cache = Cache(Path(tempfile.mkdtemp()) / "cache.sqlite3")
    monkeypatch.setattr("zzz_sidecar.services.metadata.get_cache", lambda: cache)
    return MetadataService()


# -- the rank mapping -------------------------------------------------------- #


def test_engine_ranks_are_one_tier_below_agent_ranks() -> None:
    """Agents use 3=A/4=S; engines add a B tier at 2. Spot-checked on live data
    against Steel Cushion (4, S) and Starlight Engine (3, A)."""
    assert _label(_ENGINE_RARITIES, 4, "") == "S"
    assert _label(_ENGINE_RARITIES, 3, "") == "A"
    assert _label(_ENGINE_RARITIES, 2, "") == "B"


def test_unknown_rank_code_yields_no_letter() -> None:
    """A tier added on a patch day must not be guessed into an existing one."""
    assert _label(_ENGINE_RARITIES, 5, "") == ""
    assert _label(_ENGINE_RARITIES, None, "") == ""


# -- the cache read ---------------------------------------------------------- #


def test_missing_cache_reads_as_none_not_empty(service: MetadataService) -> None:
    """None means "no badge"; an empty dict would too, but the distinction
    matters to callers deciding whether to fetch."""
    assert service.engine_ranks_from_cache() is None


def test_cached_ranks_round_trip(service: MetadataService) -> None:
    service._cache.put_metadata(
        "engine_ranks",
        "3.2",
        [{"name": "Steel Cushion", "rarity": "S"}, {"name": "Starlight Engine", "rarity": "A"}],
    )
    assert service.engine_ranks_from_cache() == {
        "Steel Cushion": "S",
        "Starlight Engine": "A",
    }


def test_stale_cache_is_ignored(service: MetadataService, monkeypatch: pytest.MonkeyPatch) -> None:
    service._cache.put_metadata("engine_ranks", "3.2", [{"name": "Steel Cushion", "rarity": "S"}])
    later = time.time() + METADATA_CACHE_MAX_AGE_SECONDS + 1
    monkeypatch.setattr("zzz_sidecar.services.metadata.time.time", lambda: later)
    assert service.engine_ranks_from_cache() is None


def test_malformed_rows_are_dropped_not_defaulted(service: MetadataService) -> None:
    """A half-written row must not become a badge with a blank or wrong rank."""
    service._cache.put_metadata(
        "engine_ranks",
        "3.2",
        [
            {"name": "Steel Cushion", "rarity": "S"},
            {"name": "", "rarity": "S"},
            {"name": "Nameless", "rarity": ""},
            "not a dict",
        ],
    )
    assert service.engine_ranks_from_cache() == {"Steel Cushion": "S"}
