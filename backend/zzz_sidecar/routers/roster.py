"""Roster grid and per-agent detail."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..cache import get_cache
from ..deps import get_sync
from ..errors import ApiError, ErrorCode
from ..models import Agent, AgentBuild, AgentGuide, BuildGap
from ..services.analysis import _normalise, evaluate_build
from ..services.sync import SyncService

router = APIRouter(tags=["roster"])


@router.get("/agents", response_model=list[Agent])
async def list_agents(sync: SyncService = Depends(get_sync)) -> list[Agent]:
    """The full catalog. Owned agents carry level/mindscape; the rest are the
    dimmed "ghost" tiles in the grid."""
    return sync.agents


@router.get("/agents/{agent_id}")
async def agent_detail(agent_id: int, sync: SyncService = Depends(get_sync)) -> dict[str, object]:
    """Everything the character modal needs in one call: the agent, the
    equipped build, the recommendation, and the gap between them."""
    agent = next((a for a in sync.agents if a.id == agent_id), None)
    if agent is None:
        raise ApiError(ErrorCode.UNKNOWN, f"No agent with id {agent_id}", status=404)

    build: AgentBuild | None = sync.builds.get(agent_id)

    guide: AgentGuide | None = None
    for row in get_cache().all_guides():
        candidate = AgentGuide.model_validate(row)
        if _normalise(candidate.agent_name) == _normalise(agent.name):
            guide = candidate
            break

    gap: BuildGap | None = evaluate_build(agent, build, guide) if agent.owned else None

    return {
        "agent": agent.model_dump(),
        "build": build.model_dump() if build is not None else None,
        "guide": guide.model_dump() if guide is not None else None,
        "gap": gap.model_dump() if gap is not None else None,
    }
