"""Which two Drive Disc sets drop together from the same Routine Cleanup stage.

Unlike everything else in `analysis.py`, this isn't derived from HoYoLAB or
Prydwen — neither source states drop pairings, so it lives in
`domain_pairs.json` next to this file: a small, hand-maintained list you edit
directly and commit whenever a patch adds a new stage (a new S-rank set
almost always arrives paired with an existing A-rank one). Loaded fresh on
every call rather than cached in memory, so an edit takes effect on the next
sync without restarting the sidecar.
"""

from __future__ import annotations

import json
from pathlib import Path

_PAIRS_PATH = Path(__file__).parent / "domain_pairs.json"


def load_domain_pairs() -> list[tuple[str, str]]:
    """Read `domain_pairs.json` fresh. Missing or malformed rows are dropped
    rather than raising, since a bad hand-edit shouldn't break analysis —
    it should just mean that one stage is missing from Farm Together."""
    try:
        raw = json.loads(_PAIRS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    pairs: list[tuple[str, str]] = []
    for row in raw:
        if isinstance(row, list) and len(row) == 2 and all(isinstance(x, str) for x in row):
            pairs.append((row[0], row[1]))
    return pairs
