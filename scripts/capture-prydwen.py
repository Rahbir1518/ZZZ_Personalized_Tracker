"""Save a real Prydwen page locally for debugging the parser.

    python scripts/capture-prydwen.py miyabi

Writes to backend/.prydwen-cache/, which is gitignored: Prydwen's content is
theirs and must not be committed to a public repo. The checked-in test fixture
(backend/tests/golden/agent_guide.html) is synthetic for exactly this reason.

Use this when a golden test fails and you need to see what actually changed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

import httpx  # noqa: E402

from zzz_sidecar.config import USER_AGENT  # noqa: E402

OUT_DIR = REPO_ROOT / "backend" / ".prydwen-cache"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="Agent slug, e.g. 'miyabi'")
    parser.add_argument(
        "--parse",
        action="store_true",
        help="Also run the adapter over it and print the parsed guide.",
    )
    args = parser.parse_args()

    url = f"https://www.prydwen.gg/zenless/characters/{args.slug}"
    print(f"GET {url}")

    response = httpx.get(url, headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=30)
    if response.status_code != 200:
        print(f"HTTP {response.status_code}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUT_DIR / f"{args.slug}.html"
    destination.write_text(response.text, encoding="utf-8")
    print(f"Saved {len(response.text):,} bytes to {destination}")

    if args.parse:
        from zzz_sidecar.prydwen.html_adapter import HtmlPrydwenSource

        source = HtmlPrydwenSource.__new__(HtmlPrydwenSource)
        guide = source.parse_guide(args.slug, response.text)
        print(guide.model_dump_json(indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
