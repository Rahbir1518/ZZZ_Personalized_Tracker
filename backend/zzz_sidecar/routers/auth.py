"""Cookie auth.

QR sign-in was scaffolded and removed: HoYoLAB's QR flow (the one
``genshin.py`` ships) is Chinese-Miyoushe-only, not Global HoYoLAB, which is
what this app authenticates against. Cookie paste is the one auth path.
"""

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

    # Drop whatever's in memory *before* reloading from cache. Someone can
    # reach this handler with a still-populated `sync` from a previous
    # session's account without ever hitting /auth/logout first — pasting a
    # fresh cookie straight over an old one. Without this, load_from_cache's
    # own in-memory fallback (see SyncService._agents_from_cache) would
    # happily keep serving the outgoing account's agents, the exact leak
    # the cache-layer uid fix was meant to close.
    sync.clear()
    # Show whatever this account's own cache already has while the first
    # sync runs.
    sync.load_from_cache()
    return result


@router.get("/status", response_model=AuthResult)
async def status(hoyolab: HoyolabService = Depends(get_hoyolab)) -> AuthResult:
    return AuthResult(ok=hoyolab.authenticated, uid=hoyolab.uid)


@router.post("/logout")
async def logout(
    hoyolab: HoyolabService = Depends(get_hoyolab), sync: SyncService = Depends(get_sync)
) -> dict[str, bool]:
    hoyolab.logout()
    # Signing back in as someone else must not show the outgoing account's
    # roster while the new one's first sync is still running. `login()` calls
    # `load_from_cache()`, which falls back to *any* cached roster when the
    # new UID has none yet (a reasonable default for the single-account case
    # this cache layer was built for) — clearing the in-memory view here is
    # what keeps that fallback from surfacing the wrong person's data. The
    # on-disk cache itself is untouched, so the outgoing account's data is
    # still there if they log back in.
    sync.clear()
    return {"ok": True}
