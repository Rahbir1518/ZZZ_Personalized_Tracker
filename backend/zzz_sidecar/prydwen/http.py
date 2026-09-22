"""URL helpers for Prydwen pages.

Fetching itself lives in ``transport.py``; this module is just the bits of
Prydwen's URL shape that both the adapter and the transports need.
"""

from __future__ import annotations

from urllib.parse import parse_qs, unquote, urlparse

from .transport import BASE_URL

__all__ = ["BASE_URL", "clean_image_url"]


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
