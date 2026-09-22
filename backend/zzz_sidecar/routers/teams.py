"""Teams tab: the two sub-tabs plus farming priorities."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_sync
from ..models import Analysis
from ..services.sync import SyncService

router = APIRouter(tags=["teams"])


@router.get("/analysis", response_model=Analysis)
async def analysis(sync: SyncService = Depends(get_sync)) -> Analysis:
    """Build gaps, My Teams, Suggested teams and farming priorities.

    One call because the UI shows these together and they are all derived from
    the same join; splitting them would just mean three round trips.
    """
    return sync.analysis
