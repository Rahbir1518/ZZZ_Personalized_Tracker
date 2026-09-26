"""Pulls tab: how many pulls each S-rank agent took."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_sync
from ..models import PullHistory
from ..services.sync import SyncService

router = APIRouter(tags=["pulls"])


@router.get("/pulls", response_model=PullHistory)
async def pulls(sync: SyncService = Depends(get_sync)) -> PullHistory:
    """Read from the local pull log only. New records arrive via Sync."""
    return sync.pull_history()
