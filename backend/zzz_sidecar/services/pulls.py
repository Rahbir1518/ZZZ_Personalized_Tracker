"""Signal Search statistics, from the locally stored pull log.

Pure: takes rows from ``Cache.get_pulls`` and returns the view the Pulls tab
renders. Nothing here talks to the network, and nothing is compared against
other players — every number is this account's own.

Pity is counted per *pool*, not per banner type, because the game shares it:
the Exclusive Channel and Exclusive Rescreening draw down one counter, the
W-Engine Channel and its reverberation banner another.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..models import PoolStats, PullHistory, SRankPull


@dataclass(frozen=True)
class Pool:
    key: str
    banners: tuple[int, ...]
    #: Pull on which an S-rank is certain.
    hard_pity: int
    #: Whether an S-rank here is a featured-or-not coin flip.
    has_fifty_fifty: bool


#: genshin.ZZZBannerType values feeding each pity pool, in display order.
POOLS: tuple[Pool, ...] = (
    Pool("exclusive", (2, 102), 90, True),
    Pool("wengine", (3, 103), 80, True),
    Pool("standard", (1,), 90, False),
    Pool("bangboo", (5,), 80, False),
)

#: Every banner a sync fetches.
SIGNAL_BANNERS: tuple[int, ...] = tuple(b for pool in POOLS for b in pool.banners)

#: The Stable Channel's S-ranks. On a limited channel, pulling one of these is
#: a lost 50/50. Needs a manual update if HoYoverse ever widens that pool.
STANDARD_S_ITEMS: frozenset[str] = frozenset(
    name.casefold()
    for name in (
        # Agents
        "Grace",
        "Rina",
        "Koleda",
        "Nekomata",
        "Soldier 11",
        "Lycaon",
        # Their W-Engines
        "Fusion Compiler",
        "Weeping Cradle",
        "Hellfire Gears",
        "Steel Cushion",
        "The Brimstone",
        "The Restrained",
    )
)

#: Polychrome per pull, for the "spent" figure.
POLYCHROME_PER_PULL = 160


def _kind(row: dict[str, Any], pool: Pool, agent_ids: set[int]) -> str:
    if pool.key == "bangboo":
        return "bangboo"
    if agent_ids:
        return "agent" if int(row["item_id"]) in agent_ids else "engine"
    return "agent" if "agent" in str(row.get("item_type", "")).lower() else "engine"


def build_pull_history(
    rows: list[dict[str, Any]],
    agent_ids: set[int],
    icons: dict[str, str] | None = None,
) -> PullHistory:
    """``icons`` maps casefolded item names to art, for S-ranks that are not
    agents (W-Engines); agents' portraits are looked up by the UI."""
    icons = icons or {}
    history = PullHistory()

    for pool in POOLS:
        pulls = sorted((r for r in rows if int(r["banner_type"]) in pool.banners), key=lambda r: r["id"])
        stats = PoolStats(pool=pool.key, hard_pity=pool.hard_pity, total_pulls=len(pulls))
        since_s = since_a = 0
        seen_s = False
        guaranteed = False
        complete_s: list[int] = []

        for row in pulls:
            since_s += 1
            since_a += 1
            rank = row["rank"]

            if rank == "A":
                stats.a_count += 1
                since_a = 0
                continue
            if rank != "S":
                continue

            result = ""
            if pool.has_fifty_fifty:
                off_banner = str(row["name"]).casefold() in STANDARD_S_ITEMS
                if off_banner:
                    result = "lost"
                    stats.fifty_lost += 1
                elif guaranteed:
                    result = "guaranteed"
                else:
                    result = "won"
                    stats.fifty_won += 1
                guaranteed = off_banner

            kind = _kind(row, pool, agent_ids)
            history.s_ranks.append(
                SRankPull(
                    id=int(row["id"]),
                    item_id=int(row["item_id"]),
                    name=str(row["name"]),
                    kind=kind,
                    icon="" if kind == "agent" else icons.get(str(row["name"]).casefold(), ""),
                    pool=pool.key,
                    pulls=since_s,
                    # With no earlier S-rank on record, pulls made before the
                    # oldest stored record would be uncounted.
                    partial=not seen_s,
                    result=result,
                    time=str(row["time"]),
                )
            )
            if seen_s:
                complete_s.append(since_s)
            stats.s_count += 1
            seen_s = True
            since_s = since_a = 0

        stats.since_last_s = since_s
        stats.since_last_a = since_a
        stats.guaranteed = guaranteed
        stats.polychrome = len(pulls) * POLYCHROME_PER_PULL
        stats.average_s = round(sum(complete_s) / len(complete_s), 1) if complete_s else None

        history.pools.append(stats)
        history.total_pulls += len(pulls)

    history.s_ranks.sort(key=lambda s: s.id, reverse=True)
    return history
