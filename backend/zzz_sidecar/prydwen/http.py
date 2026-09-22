"""URL helpers for Prydwen pages.

Fetching itself lives in ``transport.py``; this module is just the bits of
Prydwen's URL shape that both the adapter and the transports need.
"""

from __future__ import annotations

from urllib.parse import parse_qs, unquote, urlparse

from .transport import BASE_URL

__all__ = ["BASE_URL", "card_image_url", "character_image_url", "clean_image_url"]

#: Every agent portrait Prydwen publishes lives under this stem, named by
#: the same slug the agent's guide page uses.
CHARACTER_IMAGE_BASE = "https://cdn.prydwen.gg/images/zenless-zone-zero/characters"


def clean_image_url(src: str) -> str:
    """Unwrap Next.js image-optimizer URLs into the real CDN URL.

    Prydwen renders ``/_next/image?url=<encoded cdn url>&w=128&q=75``. We want
    the underlying ``https://cdn.prydwen.gg/...`` so the app can load it
    directly at full resolution.
    """
    if not src:
        return ""
    if src.startswith("/_next/image"):
        query = parse_qs(urlparse(src).query)
        inner = query.get("url", [""])[0]
        if inner:
            return unquote(inner)
    if src.startswith("/"):
        return f"{BASE_URL}{src}"
    return src


def card_image_url(icon_url: str) -> str:
    """Derive the large portrait URL from a character thumbnail.

    Prydwen publishes three sizes per agent under the same stem:
    ``<slug>.webp`` (160x160), ``<slug>_card.webp`` (374x512) and
    ``<slug>_full.webp`` (2048x2048). Only the thumbnail appears in the markup,
    so the portrait is derived rather than scraped — no extra request, and the
    UI falls back to the thumbnail if a given agent has no card art.
    """
    if not icon_url.endswith(".webp") or "/characters/" not in icon_url:
        return ""
    return icon_url[: -len(".webp")] + "_card.webp"


def character_image_url(slug: str) -> str:
    """The thumbnail URL for an agent, from their guide slug.

    Team rows are the only place the markup spells an agent's image out, so an
    agent nobody recommends alongside anyone else - most A-ranks - had no art
    at all and fell back to HoYoLAB's 152x186 avatar, which is a face crop. In
    a grid of 374x512 full-body cards that one tile reads as a different
    component entirely.

    The slug is enough: ``billy-kid`` -> ``.../characters/billy-kid.webp``.
    """
    if not slug:
        return ""
    return f"{CHARACTER_IMAGE_BASE}/{slug}.webp"
