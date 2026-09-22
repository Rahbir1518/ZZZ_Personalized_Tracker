"""Drill-down pages: one W-Engine, one disc set, one team's synergy.

Each response is the same shape as everything else here — game data joined with
*your* account — because the useful question about a W-Engine is not only what
it does but who of yours is wearing it and whose guide is asking for it.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query

from ..cache import get_cache
from ..deps import get_sync
from ..models import (
    Agent,
    AgentGuide,
    AgentSynergy,
    CodexMention,
    DiscSetDetail,
    EngineDetail,
)
from ..services.analysis import build_guide_index, find_guide, normalise_name
from ..services.codex import get_codex
from ..services.sync import SyncService

router = APIRouter(tags=["codex"])


def _guides() -> list[AgentGuide]:
    return [AgentGuide.model_validate(row) for row in get_cache().all_guides()]


def _agent_art(agent: Agent) -> str:
    """The small art the mention lists show."""
    return agent.square_icon or agent.card_icon or agent.rectangle_icon


@router.get("/engines", response_model=EngineDetail)
async def engine_detail(
    name: str = Query(..., min_length=1),
    sync: SyncService = Depends(get_sync),
) -> EngineDetail:
    """A W-Engine's page.

    Matched by name, because that is the only key Prydwen, HoYoLAB and the game
    catalog share — the same rule the rest of the app matches on.
    """
    detail = await get_codex().engine(name)
    key = normalise_name(name)

    for agent in sync.agents:
        build = sync.builds.get(agent.id)
        if build is None or build.w_engine is None:
            continue
        if normalise_name(build.w_engine.name) != key:
            continue
        detail.equipped_by.append(
            CodexMention(
                agent_name=agent.name,
                icon=_agent_art(agent),
                owned=True,
                detail=f"Lv {build.w_engine.level} · S{build.w_engine.refinement}",
            )
        )

    index = build_guide_index(_guides())
    for agent in sync.agents:
        guide = find_guide(agent, index)
        if guide is None:
            continue
        for engine in guide.engines:
            if normalise_name(engine.name) != key:
                continue
            detail.recommended_for.append(
                CodexMention(
                    agent_name=agent.name,
                    icon=_agent_art(agent),
                    owned=agent.owned,
                    rank=engine.rank,
                    rating=engine.rating,
                    detail=(
                        f"S{engine.recommended_superimpose}"
                        if engine.recommended_superimpose > 0
                        else ""
                    ),
                )
            )
            break

    # Best endorsement first; un-owned agents sink so the list opens on the
    # ones the reader can act on.
    detail.recommended_for.sort(key=lambda m: (not m.owned, m.rank or 99, -m.rating))
    return detail


@router.get("/disc-sets", response_model=DiscSetDetail)
async def disc_set_detail(
    name: str = Query(..., min_length=1),
    sync: SyncService = Depends(get_sync),
) -> DiscSetDetail:
    """A Drive Disc set's page, with who wears it and how many pieces."""
    detail = await get_codex().disc_set(name)
    key = normalise_name(name)

    for agent in sync.agents:
        build = sync.builds.get(agent.id)
        if build is None:
            continue
        pieces = sum(1 for disc in build.discs if normalise_name(disc.set_name) == key)
        if pieces == 0:
            continue
        detail.equipped_by.append(
            CodexMention(
                agent_name=agent.name,
                icon=_agent_art(agent),
                owned=True,
                pieces=pieces,
                detail=f"{pieces} piece{'' if pieces == 1 else 's'}",
            )
        )

    index = build_guide_index(_guides())
    for agent in sync.agents:
        guide = find_guide(agent, index)
        if guide is None:
            continue
        # An agent's guide can list the same set at both 2-PC and 4-PC; the
        # bigger recommendation is the one worth showing.
        best = None
        for recommendation in guide.disc_sets:
            if normalise_name(recommendation.set_name) != key:
                continue
            if best is None or recommendation.pieces > best.pieces:
                best = recommendation
        if best is None:
            continue
        detail.recommended_for.append(
            CodexMention(
                agent_name=agent.name,
                icon=_agent_art(agent),
                owned=agent.owned,
                rank=best.rank,
                rating=best.rating,
                pieces=best.pieces,
                detail=best.note,
            )
        )

    detail.equipped_by.sort(key=lambda m: -m.pieces)
    detail.recommended_for.sort(key=lambda m: (not m.owned, -m.pieces, m.rank or 99, -m.rating))
    return detail


@router.get("/synergy", response_model=list[AgentSynergy])
async def team_synergy(
    names: list[str] = Query(default_factory=list),
    sync: SyncService = Depends(get_sync),
) -> list[AgentSynergy]:
    """Every named agent's Core Passive and Additional Ability, in order.

    Fetched concurrently: a team is three or four agents, and serialising four
    small CDN reads behind a hover would be felt.
    """
    wanted = [name for name in names if name.strip() != ""]
    if not wanted:
        return []

    roster = {normalise_name(agent.name): agent for agent in sync.agents}
    for agent in sync.agents:
        if agent.full_name:
            roster.setdefault(normalise_name(agent.full_name), agent)

    resolved = [roster.get(normalise_name(name)) for name in wanted]
    codex = get_codex()

    fetched = await asyncio.gather(
        *(
            codex.synergy(agent.id) if agent is not None else _absent()
            for agent in resolved
        )
    )

    results: list[AgentSynergy] = []
    for name, agent, synergy in zip(wanted, resolved, fetched, strict=True):
        # The catalog's name wins for display only when we matched an agent;
        # otherwise keep the name the guide used so the card is not blank.
        synergy.agent_name = agent.name if agent is not None else name
        if agent is not None:
            synergy.icon = agent.card_icon or agent.square_icon
            synergy.owned = agent.owned
            synergy.element = agent.element
            synergy.specialty = agent.specialty
            synergy.faction = agent.faction_name
        results.append(synergy)
    return results


async def _absent() -> AgentSynergy:
    """Placeholder for a team member who is not in the catalog at all."""
    return AgentSynergy(agent_name="")
