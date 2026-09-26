"""Pity counting for the Pulls tab, and the local pull log it reads from."""

from __future__ import annotations

from pathlib import Path

from zzz_sidecar.cache.db import Cache
from zzz_sidecar.services.pulls import build_pull_history

ELLEN = 1191
MIYABI = 1321
LYCAON = 1141
S_ENGINE = 14102


def _row(id_: int, banner: int, rank: str = "B", item_id: int = 0, name: str = "junk") -> dict:
    return {
        "id": id_,
        "banner_type": banner,
        "item_id": item_id,
        "name": name,
        "item_type": "Agents" if item_id and item_id < 10000 else "W-Engines",
        "rank": rank,
        "time": "2026-09-01T12:00:00+08:00",
    }


def test_counts_pulls_since_previous_s_in_same_pool() -> None:
    rows = [_row(i, 2) for i in range(1, 60)]  # 59 misses
    rows.append(_row(60, 2, "S", ELLEN, "Ellen"))  # 60th pull
    rows += [_row(i, 2) for i in range(61, 75)]  # 14 misses
    rows.append(_row(75, 2, "S", MIYABI, "Miyabi"))  # 15th pull after Ellen

    history = build_pull_history(rows, {ELLEN, MIYABI})

    by_name = {s.name: s for s in history.s_ranks}
    assert by_name["Ellen"].pulls == 60
    assert by_name["Ellen"].partial is True  # nothing on record before it
    assert by_name["Miyabi"].pulls == 15
    assert by_name["Miyabi"].partial is False
    # Newest first.
    assert [s.name for s in history.s_ranks] == ["Miyabi", "Ellen"]


def test_exclusive_and_rescreening_share_pity_but_standard_does_not() -> None:
    rows = [
        _row(1, 2, "S", ELLEN, "Ellen"),
        _row(2, 2),
        _row(3, 1),  # standard pull between them must not count
        _row(4, 102),
        _row(5, 102, "S", MIYABI, "Miyabi"),  # rescreening: 3 exclusive-pool pulls
    ]
    history = build_pull_history(rows, {ELLEN, MIYABI})
    miyabi = next(s for s in history.s_ranks if s.name == "Miyabi")
    assert miyabi.pool == "exclusive"
    assert miyabi.pulls == 3

    standard = next(p for p in history.pools if p.pool == "standard")
    assert standard.since_last_s == 1
    assert history.total_pulls == 5


def test_s_rank_w_engine_from_standard_resets_pity_and_is_listed_as_engine() -> None:
    rows = [
        _row(1, 1),
        _row(2, 1, "S", S_ENGINE, "The Restrained"),
        _row(3, 1),
        _row(4, 1, "S", LYCAON, "Lycaon"),
    ]
    history = build_pull_history(rows, {LYCAON}, {"the restrained": "engine.png"})
    lycaon, engine = history.s_ranks
    assert (lycaon.name, lycaon.kind, lycaon.pulls, lycaon.result) == ("Lycaon", "agent", 2, "")
    assert (engine.kind, engine.icon) == ("engine", "engine.png")


def test_fifty_fifty_loss_makes_the_next_s_guaranteed() -> None:
    rows = [
        _row(1, 2, "S", ELLEN, "Ellen"),  # won
        _row(2, 2, "S", LYCAON, "Lycaon"),  # standard S on a limited banner: lost
        _row(3, 2, "S", MIYABI, "Miyabi"),  # guaranteed, not a won 50/50
        _row(4, 2),
    ]
    history = build_pull_history(rows, {ELLEN, MIYABI, LYCAON})
    assert {s.name: s.result for s in history.s_ranks} == {
        "Ellen": "won",
        "Lycaon": "lost",
        "Miyabi": "guaranteed",
    }
    exclusive = next(p for p in history.pools if p.pool == "exclusive")
    assert (exclusive.fifty_won, exclusive.fifty_lost) == (1, 1)
    assert exclusive.guaranteed is False
    assert exclusive.since_last_s == 1
    # Ellen has no earlier S on record, so only Lycaon and Miyabi count.
    assert exclusive.average_s == 1.0


def test_a_rank_pity_and_spend() -> None:
    rows = [_row(1, 2), _row(2, 2, "A", 1011, "Anby"), _row(3, 2), _row(4, 2)]
    exclusive = next(p for p in build_pull_history(rows, set()).pools if p.pool == "exclusive")
    assert (exclusive.a_count, exclusive.since_last_a, exclusive.since_last_s) == (1, 2, 4)
    assert exclusive.polychrome == 4 * 160


def test_wengine_channel_is_its_own_pool_with_80_pity() -> None:
    rows = [_row(1, 3), _row(2, 103, "S", S_ENGINE, "Steel Cushion"), _row(3, 3)]
    history = build_pull_history(rows, {ELLEN})
    wengine = next(p for p in history.pools if p.pool == "wengine")
    assert (wengine.hard_pity, wengine.total_pulls, wengine.since_last_s) == (80, 3, 1)
    assert wengine.guaranteed is True  # Steel Cushion is a standard engine
    assert history.s_ranks[0].result == "lost"


def test_pull_log_keeps_old_rows_and_is_per_account(tmp_path: Path) -> None:
    cache = Cache(tmp_path / "cache.db")
    try:
        assert cache.put_pulls("111", [_row(1, 2), _row(2, 2)]) == 2
        # Re-seeing a stored record adds nothing; a new one is added.
        assert cache.put_pulls("111", [_row(2, 2), _row(3, 2)]) == 1
        assert cache.latest_pull_id("111", 2) == 3
        assert cache.latest_pull_id("111", 1) == 0
        assert [r["id"] for r in cache.get_pulls("111")] == [1, 2, 3]
        assert cache.get_pulls("222") == []
    finally:
        cache.close()
