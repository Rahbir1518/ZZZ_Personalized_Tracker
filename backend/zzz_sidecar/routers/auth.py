"""Cookie auth. Manual paste now; QR login is milestone 6."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_hoyolab, get_sync
from ..errors import translate
from ..models import AuthResult, CookiePayload
from ..services.hoyolab import HoyolabService
from ..services.sync import SyncService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=AuthResult)
async def login(
    payload: CookiePayload,
    hoyolab: HoyolabService = Depends(get_hoyolab),
    sync: SyncService = Depends(get_sync),
) -> AuthResult:
    """Validate pasted cookies with one real ZZZ call.

    Failure modes are translated into distinct codes so the UI can tell
    "your battle record is switched off" from "your cookies are wrong".
    """
    try:
        result = await hoyolab.login(payload)
    except Exception as exc:  # noqa: BLE001 - every failure becomes an ApiError
        raise translate(exc) from exc

    # Show whatever we already have while the first sync runs.
    sync.load_from_cache()
    return result


@router.get("/status", response_model=AuthResult)
async def status(hoyolab: HoyolabService = Depends(get_hoyolab)) -> AuthResult:
    return AuthResult(ok=hoyolab.authenticated, uid=hoyolab.uid)


@router.post("/logout")
async def logout(hoyolab: HoyolabService = Depends(get_hoyolab)) -> dict[str, bool]:
    hoyolab.logout()
    return {"ok": True}
