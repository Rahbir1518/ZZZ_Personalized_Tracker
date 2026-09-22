"""Translate upstream failures into stable, machine-checkable API errors.

The renderer branches on ``code``, never on a message string. In particular
``GAME_RECORD_DISABLED`` must stay distinguishable from ``INVALID_COOKIES`` so
the UI can show the "turn on your battle record" fix instead of "re-paste your
cookies".
"""

from __future__ import annotations

from enum import StrEnum

import genshin
from fastapi import HTTPException


class ErrorCode(StrEnum):
    INVALID_COOKIES = "INVALID_COOKIES"
    GAME_RECORD_DISABLED = "GAME_RECORD_DISABLED"
    NO_ZZZ_ACCOUNT = "NO_ZZZ_ACCOUNT"
    RATE_LIMITED = "RATE_LIMITED"
    CAPTCHA_REQUIRED = "CAPTCHA_REQUIRED"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"
    PARSE_FAILED = "PARSE_FAILED"
    UNKNOWN = "UNKNOWN"


class ApiError(HTTPException):
    def __init__(self, code: ErrorCode, message: str, *, status: int = 400, hint: str = "") -> None:
        super().__init__(
            status_code=status,
            detail={"code": str(code), "message": message, "hint": hint},
        )
        self.code = code


_RECORD_DISABLED_HINT = (
    "In HoYoLAB, open your profile settings and turn on the Battle Chronicle / "
    "game record for Zenless Zone Zero, then sync again."
)


def translate(exc: Exception) -> ApiError:
    """Map a genshin.py exception onto an ApiError. Never leaks cookie values."""
    match exc:
        case genshin.errors.DataNotPublic():
            return ApiError(
                ErrorCode.GAME_RECORD_DISABLED,
                "Your ZZZ battle record is not enabled on HoYoLAB.",
                status=403,
                hint=_RECORD_DISABLED_HINT,
            )
        case genshin.errors.InvalidCookies():
            return ApiError(
                ErrorCode.INVALID_COOKIES,
                "Those cookies were rejected by HoYoLAB. They may have expired.",
                status=401,
                hint="Log in to hoyolab.com again and copy a fresh ltoken_v2 / ltuid_v2.",
            )
        case genshin.errors.AccountNotFound():
            return ApiError(
                ErrorCode.NO_ZZZ_ACCOUNT,
                "No Zenless Zone Zero account is linked to this HoYoLAB login.",
                status=404,
            )
        case genshin.errors.TooManyRequests():
            return ApiError(
                ErrorCode.RATE_LIMITED,
                "HoYoLAB's daily request limit for these cookies has been reached.",
                status=429,
                hint="Try again tomorrow.",
            )
        case genshin.errors.VisitsTooFrequently():
            return ApiError(
                ErrorCode.RATE_LIMITED,
                "HoYoLAB is rate limiting this account. Wait a few minutes.",
                status=429,
            )
        case genshin.errors.GeetestError():
            return ApiError(
                ErrorCode.CAPTCHA_REQUIRED,
                "HoYoLAB asked for a captcha. Open HoYoLAB in a browser once, then retry.",
                status=403,
            )
        case genshin.errors.GenshinException():
            return ApiError(ErrorCode.UNKNOWN, f"HoYoLAB error: {exc.msg or exc!s}", status=502)
        case _:
            return ApiError(ErrorCode.UNKNOWN, str(exc), status=500)
