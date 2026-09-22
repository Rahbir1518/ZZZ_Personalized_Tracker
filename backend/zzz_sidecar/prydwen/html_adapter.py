"""Parse Prydwen's server-rendered HTML into our own models.

Why HTML and not JSON: verified 2026-09-21, the old Gatsby `/page-data/*.json`
endpoints all return HTTP 410, `/_next/data/*` 404s, the RSC flight endpoint is
a deliberate 307 loop, and there is no public API. See the brief's Prydwen
section for the full probe list.

This is workable because Prydwen writes **semantic class names** from their own
SCSS rather than hashed CSS-module names. The selectors below were read off a
real guide page, not guessed:

    .single-item               one rated recommendation (engine OR 4-PC set)
      .percentage p            its rating, e.g. "100.00%"
      .zzz-engine              -> it is a W-Engine
        .zzz-set-name          engine name
        .cone-super            recommended superimpose, e.g. "(S1)"
      .zzz-weapon-accordion    -> it is the primary disc set
        .zzz-weapon-name       "Branch & Blade Song (4-PC)"
    .information (sibling)     the write-up for the item above it
    ul.small-sets li           the 2-PC pairing options
      .zzz-set-min             one set (name in the img alt)
    .main-stats .box           per-slot main stat
      .stats-inside strong     "Disk 4"
      .list-stats              "CRIT Rate% >= ATK%"
    .box.sub-stats p           "Substats: CRIT RATE (Until 80%) >= ..."
    .team-row                  a team from the Shiyu Defense usage table

Every extractor is individually defensive: a section that disappears yields an
empty field rather than blowing up the whole guide. Only a page that looks
nothing like an agent guide raises ``PrydwenParseError``.
"""

from __future__ import annotations

import re
import time

from selectolax.parser import HTMLParser, Node

from ..config import GUIDE_SCHEMA_VERSION
from ..models import (
    AgentGuide,
    DiscSetRecommendation,
    EngineRecommendation,
    TeamMember,
    TeamRecommendation,
)
from .http import BASE_URL, clean_image_url
from .transport import Transport, build_transport
from .source import PrydwenParseError

#: "(4-PC)", "2P", "4 PC" -> piece count.
_PIECES_RE = re.compile(r"(\d)\s*-?\s*(?:PC\b|P\b)", re.IGNORECASE)

#: "(S1)" / "(S5)" -> recommended superimpose level.
_SUPERIMPOSE_RE = re.compile(r"\(?\s*S\s*(\d)\s*\)?", re.IGNORECASE)

#: Splits a priority line on its ">" / ">=" / "=" separators.
_PRIORITY_SPLIT_RE = re.compile(r"\s*(?:>=|=>|>|=)\s*")

#: An agent guide URL, in either an HTML href or a markdown link.
_SLUG_RE = re.compile(r"/zenless/characters/([a-z0-9][a-z0-9-]*)")

#: Paths under /zenless/characters/ that are not agents.
_NON_AGENT_SLUGS = frozenset({"characters", "index"})

#: Title/heading suffixes Prydwen appends to the agent's name.
_NAME_SUFFIX_RE = re.compile(
    r"\s*(?:Best\s+Build\s+Guide|Build\s+and\s+Teams?|Guide|Build).*$", re.IGNORECASE
)


def _text(node: Node | None) -> str:
    """Node text with Prydwen's SSR comment separators and whitespace runs
    collapsed to single spaces."""
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.text(separator=" ", strip=True)).strip()


def _img_name_and_icon(scope: Node | None) -> tuple[str, str]:
    """Prydwen puts the canonical display name in the image's alt attribute."""
    if scope is None:
        return "", ""
    img = scope.css_first("img")
    if img is None:
        return "", ""
    attrs = img.attributes
    return (attrs.get("alt") or "").strip(), clean_image_url(attrs.get("src") or "")


def _badge_text(item: Node) -> str:
    """Text of the ``.percentage`` badge.

    When the badge is ``.percentage.split`` it holds two figures (team and solo
    damage); the first is the headline one, so read that ``<p>`` specifically
    rather than flattening both together.
    """
    badge = item.css_first(".percentage")
    if badge is None:
        return ""
    first = badge.css_first("p")
    return _text(first) if first is not None else _text(badge)


def _rating(item: Node) -> float:
    """Prydwen's score for an item, 0-100.

    Only a badge containing "%" is a score. The same ``.percentage`` class is
    reused for a bare ordinal rank on some pages ("1", "2", "3"), and reading
    that as a rating would render Qingyi's best-in-slot set as "1%".
    """
    raw = _badge_text(item)
    if "%" not in raw:
        return 0.0
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", raw)
    return float(match.group(1)) if match is not None else 0.0


def _ordinal(item: Node) -> int:
    """The bare rank in a ``.percentage`` badge, when it is not a score."""
    raw = _badge_text(item)
    if "%" in raw:
        return 0
    match = re.fullmatch(r"\s*([0-9]{1,2})\s*", raw)
    return int(match.group(1)) if match is not None else 0


def _note_for(item: Node) -> str:
    """The write-up belonging to a ``.single-item``.

    Prydwen renders the note as a *following sibling* ``.information`` block
    rather than a child, so collect siblings until the next recommendation
    starts. Falls back to a nested match in case that ever changes.
    """
    nested = _text(item.css_first(".information"))
    if nested:
        return nested

    parts: list[str] = []
    sibling = item.next
    while sibling is not None:
        classes = sibling.attributes.get("class") or ""
        if "single-item" in classes:
            break
        if "information" in classes:
            # ".zzz-special-data" blocks are usage pills, not prose.
            text = _text(sibling.css_first(".notes")) or (
                "" if sibling.css_first(".zzz-special-data") else _text(sibling)
            )
            if text:
                parts.append(text)
        sibling = sibling.next
    return " ".join(parts).strip()


class HtmlPrydwenSource:
    """``PrydwenSource`` backed by the rendered guide pages."""

    def __init__(self, transport: Transport | None = None) -> None:
        # Defaults to webclaw when installed, else plain httpx. See
        # transport.py for why that choice exists at all.
        self._transport = transport if transport is not None else build_transport()

    # -- public API --------------------------------------------------------- #

    async def fetch_guide(self, slug: str) -> AgentGuide:
        html = await self._transport.get_html(f"/zenless/characters/{slug}")
        return self.parse_guide(slug, html)

    async def list_agent_slugs(self) -> list[str]:
        """Every agent slug Prydwen has a guide page for.

        The slugs must come from Prydwen, not from slugifying catalog names:
        Prydwen uses full names where the game data uses short ones
        (``anby-demara`` vs ``Anby``, ``ukinami-yuzuha`` vs ``Yuzuha``), so
        derived slugs would 404 on roughly a fifth of the roster.

        The index is client-rendered, so there is no dependable DOM here — some
        transports return extracted markdown rather than HTML. Both carry the
        links, so match on the URL shape and accept either.
        """
        document = await self._transport.get_html("/zenless/characters")

        slugs: list[str] = []
        for slug in _SLUG_RE.findall(document):
            if slug not in _NON_AGENT_SLUGS and slug not in slugs:
                slugs.append(slug)

        if not slugs:
            raise PrydwenParseError(
                "Found no agent links on the ZZZ character index.",
                selector="/zenless/characters/<slug>",
            )
        return slugs

    async def aclose(self) -> None:
        await self._transport.aclose()

    # -- parsing ------------------------------------------------------------ #

    def parse_guide(self, slug: str, html: str) -> AgentGuide:
        """Pure function over HTML, so the golden-file tests need no network."""
        tree = HTMLParser(html)

        agent_name = self._parse_agent_name(tree)
        if not agent_name:
            raise PrydwenParseError(
                f"{slug!r} does not look like an agent guide page: no title or heading found.",
                selector="title, h1",
                slug=slug,
            )

        disc_sets = self._parse_disc_sets(tree)
        engines = self._parse_engines(tree)
        teams = self._parse_teams(tree)

        # A guide with a heading but none of the three main sections means the
        # markup moved under us. Fail loudly rather than cache an empty guide
        # that would silently show "no recommendations" forever.
        if not disc_sets and not engines and not teams:
            raise PrydwenParseError(
                f"Parsed {agent_name!r} but found no disc sets, W-Engines or teams. "
                "Prydwen's markup has probably changed.",
                selector=".single-item, .zzz-set-min, .team-row",
                slug=slug,
            )

        return AgentGuide(
            slug=slug,
            agent_name=agent_name,
            disc_sets=disc_sets,
            engines=engines,
            substat_priority=self._parse_substat_priority(tree),
            main_stats=self._parse_main_stats(tree),
            teams=teams,
            # patch is stamped by the sync service from the metadata source;
            # Prydwen does not state it in a machine-readable way.
            patch="",
            schema_version=GUIDE_SCHEMA_VERSION,
            fetched_at=time.time(),
            source_url=f"{BASE_URL}/zenless/characters/{slug}",
        )

    def _parse_agent_name(self, tree: HTMLParser) -> str:
        """Strip Prydwen's "<Name> Best Build Guide" framing down to the name."""
        raw = _text(tree.css_first("h1")) or _text(tree.css_first("title"))
        if not raw:
            return ""
        raw = raw.split("|")[0].strip()
        return _NAME_SUFFIX_RE.sub("", raw).strip()

    def _parse_disc_sets(self, tree: HTMLParser) -> list[DiscSetRecommendation]:
        """Two shapes on the page: the rated primary set (usually 4-PC) in a
        ``.zzz-weapon-accordion``, and the 2-PC pairing options listed under
        ``ul.small-sets``."""
        out: list[DiscSetRecommendation] = []
        seen: set[tuple[str, int]] = set()

        def add(rec: DiscSetRecommendation) -> None:
            key = (rec.set_name, rec.pieces)
            if rec.set_name and key not in seen:
                seen.add(key)
                out.append(rec)

        # Primary, rated sets.
        for item in tree.css(".single-item"):
            accordion = item.css_first(".zzz-weapon-accordion")
            if accordion is None:
                continue

            label = _text(accordion.css_first(".zzz-weapon-name"))
            alt_name, icon = _img_name_and_icon(accordion)
            name = alt_name or _PIECES_RE.sub("", label).strip(" ()")
            match = _PIECES_RE.search(label)

            add(
                DiscSetRecommendation(
                    set_name=name,
                    pieces=int(match.group(1)) if match is not None else 4,
                    icon=icon,
                    note=_note_for(item),
                    recommended=True,
                    rating=_rating(item),
                    rank=_ordinal(item),
                )
            )

        # 2-PC pairing options.
        for li in tree.css("ul.small-sets li"):
            block = li.css_first(".zzz-set-min")
            if block is None:
                continue
            name, icon = _img_name_and_icon(block)
            if not name:
                name = _text(block.css_first("p"))
            li_text = _text(li)
            match = _PIECES_RE.search(li_text)

            add(
                DiscSetRecommendation(
                    set_name=name,
                    pieces=int(match.group(1)) if match is not None else 2,
                    icon=icon,
                    recommended="recommended" in li_text.lower(),
                )
            )

        return out

    def _parse_engines(self, tree: HTMLParser) -> list[EngineRecommendation]:
        """W-Engines are the ``.single-item`` blocks carrying a ``.zzz-engine``.

        Rank is counted among engines only — disc-set items share the
        ``.single-item`` class and are interleaved on the page.
        """
        out: list[EngineRecommendation] = []
        seen: set[str] = set()

        for item in tree.css(".single-item"):
            engine_block = item.css_first(".zzz-engine")
            if engine_block is None:
                continue

            name = _text(engine_block.css_first(".zzz-set-name"))
            alt_name, icon = _img_name_and_icon(engine_block)
            if not name:
                name = alt_name
            if not name or name in seen:
                continue
            seen.add(name)

            # ".cone-super" is the recommended superimpose level (S1..S5), not
            # a signature marker — every entry carries one.
            super_match = _SUPERIMPOSE_RE.search(_text(engine_block.css_first(".cone-super")))

            out.append(
                EngineRecommendation(
                    name=name,
                    icon=icon,
                    rank=len(out) + 1,
                    note=_note_for(item),
                    rating=_rating(item),
                    recommended_superimpose=int(super_match.group(1)) if super_match else 0,
                )
            )
        return out

    def _parse_substat_priority(self, tree: HTMLParser) -> list[str]:
        """From ``.box.sub-stats``:
        "Substats: CRIT RATE (Until 80%) >= CRIT DMG = ATK% > Anomaly Proficiency"."""
        raw = _text(tree.css_first(".box.sub-stats"))
        if not raw:
            return []
        # Drop the "Substats:" label before splitting.
        _, _, tail = raw.partition(":")
        parts = [p.strip() for p in _PRIORITY_SPLIT_RE.split(tail or raw) if p.strip()]
        return parts[:10]

    def _parse_main_stats(self, tree: HTMLParser) -> dict[str, list[str]]:
        """Per-slot main stats from ``.main-stats .box``, keyed by slot number.

        ``{"4": ["CRIT Rate%", "ATK%"], "5": [...], "6": ["ATK%"]}``
        """
        out: dict[str, list[str]] = {}
        for box in tree.css(".main-stats .box"):
            label = _text(box.css_first(".stats-inside"))
            slot = re.search(r"\b([1-6])\b", label)
            if slot is None:
                continue
            values = [
                p.strip() for p in _PRIORITY_SPLIT_RE.split(_text(box.css_first(".list-stats")))
            ]
            values = [v for v in values if v]
            if values:
                out[slot.group(1)] = values
        return out

    def _parse_teams(self, tree: HTMLParser) -> list[TeamRecommendation]:
        """``.team-row`` blocks from the Shiyu Defense usage tables.

        Team member portraits come straight off Prydwen's CDN here (plain
        ``cdn.prydwen.gg`` URLs, not the ``/_next/image`` wrapper), so the UI
        can show faces instead of a list of names.
        """
        out: list[TeamRecommendation] = []
        for row in tree.css(".column.characters"):
            members: list[TeamMember] = []
            for span in row.css("span"):
                name, icon = _img_name_and_icon(span)
                if not name:
                    continue
                link = span.css_first("a")
                href = (link.attributes.get("href") or "").rstrip("/") if link is not None else ""
                members.append(
                    TeamMember(name=name, icon=icon, slug=href.rsplit("/", 1)[-1] if href else "")
                )

            if not members:
                continue

            info = row.parent.css_first(".column.info") if row.parent is not None else None
            note_parts = [
                _text(info.css_first(".rank")) if info is not None else "",
                _text(info.css_first(".usage")) if info is not None else "",
            ]
            names = [m.name for m in members]
            out.append(
                TeamRecommendation(
                    name=" / ".join(names),
                    agent_names=names,
                    members=members,
                    note=" - ".join(p for p in note_parts if p),
                )
            )
        return out
