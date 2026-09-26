"""The Sync button's engine: one run, every source, reported per source.

Design rules that matter (see the brief's Sync section):

* **Partial failure is normal.** If Prydwen is down but HoYoLAB worked, we keep
  the fresh account data and keep serving stale cached guides. One dead source
  never blanks the UI.
* **Single-flight.** A run already in progress cannot be started again.
* **Cancellable**, because a cold Prydwen pass takes minutes at a 10s crawl
  delay.
* **Account data is always refetched**; metadata and guides are skipped when
  their cache is still fresh.
"""

from __future__ import annotations

import asyncio
import time
import uuid

from ..cache import get_cache
from ..config import (
    GUIDE_SCHEMA_VERSION,
    MAX_SYNCS_PER_DAY,
    PRYDWEN_CACHE_MAX_AGE_SECONDS,
)
from ..models import (
    Agent,
    AgentBuild,
    AgentGuide,
    Analysis,
    PullHistory,
    SourceProgress,
    SourceState,
    SyncStatus,
)
from ..prydwen import HtmlPrydwenSource, PrydwenParseError, PrydwenUnavailable
from ..prydwen.http import card_image_url, character_image_url
from .analysis import _normalise, build_guide_index, find_guide, run_analysis
from .hoyolab import HoyolabService
from .metadata import MetadataService
from .pulls import SIGNAL_BANNERS, build_pull_history

SOURCE_ACCOUNT = "account"
SOURCE_METADATA = "metadata"
SOURCE_GUIDES = "guides"
SOURCE_PULLS = "pulls"

#: Pulls-tab channel thumbnails that are items, as casefolded names to look up
#: in the cached icon map. Agent channels use Ellen's portrait, which the UI
#: already has from the roster. The Bangboo is "Butler" in HoYoLAB's data.
_CHANNEL_ART: dict[str, tuple[str, ...]] = {
    "wengine": ("the brimstone",),
    "bangboo": ("butler", "butlerboo"),
}
_SOURCES = (SOURCE_ACCOUNT, SOURCE_PULLS, SOURCE_METADATA, SOURCE_GUIDES)


class SyncService:
    """Owns sync state and the merged view the routers read from."""

    def __init__(self, hoyolab: HoyolabService) -> None:
        self._hoyolab = hoyolab
        self._metadata = MetadataService()
        self._cache = get_cache()

        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._cancel = asyncio.Event()
        self._status = SyncStatus(sources=[SourceProgress(source=s) for s in _SOURCES])

        # Latest merged results, held in memory for the UI to read.
        self._agents: list[Agent] = []
        self._builds: dict[int, AgentBuild] = {}
        self._analysis: Analysis = Analysis()

    # -- state -------------------------------------------------------------- #

    @property
    def status(self) -> SyncStatus:
        last = self._cache.last_sync_times()
        for progress in self._status.sources:
            progress.last_success_at = last.get(progress.source)
        self._status.syncs_used_today = self._cache.syncs_today(self._hoyolab.uid)
        self._status.syncs_per_day = MAX_SYNCS_PER_DAY
        return self._status

    @property
    def agents(self) -> list[Agent]:
        return self._agents

    @property
    def builds(self) -> dict[int, AgentBuild]:
        return self._builds

    @property
    def analysis(self) -> Analysis:
        return self._analysis

    def pull_history(self) -> PullHistory:
        """Built from the local pull log on each call; it is a small table."""
        if not self._hoyolab.uid:
            return PullHistory()
        agent_ids = {a.id for a in self._agents}
        icons = self._item_icons()
        history = build_pull_history(self._cache.get_pulls(self._hoyolab.uid), agent_ids, icons)
        history.art = {
            pool: icon
            for pool, names in _CHANNEL_ART.items()
            if (icon := next((icons[n] for n in names if icons.get(n)), ""))
        }
        return history

    def _item_icons(self) -> dict[str, str]:
        """W-Engine / Bangboo name -> art, from what is already cached: the
        account's Bangboo list (stored by the pulls sync), the engines it has
        equipped, then every engine a guide recommends. Pull records carry no
        art of their own."""
        icons: dict[str, str] = {}
        cached_bangboos = self._cache.get_codex("bangboo_icons", self._hoyolab.uid)
        if cached_bangboos is not None:
            for name, icon in cached_bangboos[0].items():
                icons.setdefault(str(name).casefold(), str(icon))
        for build in self._builds.values():
            if build.w_engine is not None and build.w_engine.icon:
                icons.setdefault(build.w_engine.name.casefold(), build.w_engine.icon)
        for row in self._cache.all_guides():
            for engine in row.get("engines", []) or []:
                name, icon = str(engine.get("name") or ""), str(engine.get("icon") or "")
                if name and icon:
                    icons.setdefault(name.casefold(), icon)
        return icons

    def _progress(self, source: str) -> SourceProgress:
        for entry in self._status.sources:
            if entry.source == source:
                return entry
        entry = SourceProgress(source=source)
        self._status.sources.append(entry)
        return entry

    # -- control ------------------------------------------------------------ #

    async def start(self, *, force_guides: bool = False) -> SyncStatus:
        """Begin a run, or return the in-flight one unchanged (single-flight)."""
        async with self._lock:
            if self._status.running:
                return self.status

            # Daily cap, tracked per account: refuse rather than queue, since a
            # sync the user cannot see finish is worse than a clear "not
            # today", and count only this uid's own runs so switching accounts
            # doesn't inherit another account's usage for the day.
            if self._cache.syncs_today(self._hoyolab.uid) >= MAX_SYNCS_PER_DAY:
                self._status.quota_exhausted = True
                self._status.running = False
                return self.status

            self._cancel.clear()
            self._status = SyncStatus(
                run_id=uuid.uuid4().hex,
                running=True,
                started_at=time.time(),
                sources=[SourceProgress(source=s) for s in _SOURCES],
            )
            self._cache.record_sync_run(self._status.run_id, self._hoyolab.uid)
            self._task = asyncio.create_task(self._run(force_guides=force_guides))
            return self.status

    def cancel(self) -> SyncStatus:
        self._cancel.set()
        self._status.cancelled = True
        return self.status

    async def wait(self) -> None:
        """Await the current run. Used by tests and by shutdown."""
        task = self._task
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)

    # -- the run ------------------------------------------------------------ #

    async def _run(self, *, force_guides: bool) -> None:
        try:
            agents = await self._sync_account()
            await self._sync_pulls()
            catalog = await self._sync_metadata()
            self._agents = self._merge_roster(catalog, agents)
            await self._sync_guides(force=force_guides)
            self._recompute()
        finally:
            self._status.running = False
            self._status.finished_at = time.time()
            self._status.partial_failure = any(
                p.state is SourceState.FAILED for p in self._status.sources
            ) and any(p.state is SourceState.OK for p in self._status.sources)

    async def _sync_account(self) -> list[Agent]:
        """Roster + equipped builds. Always refetched — it is the user's own
        live data and the reason the app exists."""
        progress = self._progress(SOURCE_ACCOUNT)
        progress.state = SourceState.RUNNING
        progress.message = "Fetching roster from HoYoLAB"

        if not self._hoyolab.authenticated:
            progress.state = SourceState.SKIPPED
            progress.message = "Not signed in"
            return []

        try:
            roster = await self._hoyolab.fetch_roster()
            progress.total = len(roster.agents)
            progress.message = f"Fetching builds for {len(roster.agents)} agents"

            builds = await self._hoyolab.fetch_builds([a.id for a in roster.agents])
            self._builds = {b.agent_id: b for b in builds}
            progress.done = len(builds)

            uid = roster.uid
            self._cache.put_roster(uid, roster.model_dump())
            for build in builds:
                self._cache.put_build(uid, build.agent_id, build.model_dump())

            progress.state = SourceState.OK
            progress.message = f"{len(roster.agents)} agents"
            self._cache.mark_sync_success(SOURCE_ACCOUNT)
            return roster.agents
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            from ..errors import translate

            api_error = translate(exc)
            progress.state = SourceState.FAILED
            progress.error_code = str(api_error.code)
            progress.message = str(api_error.detail.get("message", ""))
            return self._agents_from_cache()

    async def _sync_pulls(self) -> None:
        """New Signal Search records since the last sync, added to the local
        log. Failure only costs this source; the stored history still shows."""
        progress = self._progress(SOURCE_PULLS)
        progress.state = SourceState.RUNNING
        progress.message = "Fetching Signal Search history"

        if not self._hoyolab.authenticated or not self._hoyolab.uid:
            progress.state = SourceState.SKIPPED
            progress.message = "Not signed in"
            return

        uid = self._hoyolab.uid
        progress.total = len(SIGNAL_BANNERS)
        added = 0
        try:
            for index, banner in enumerate(SIGNAL_BANNERS, start=1):
                if self._cancel.is_set():
                    progress.state = SourceState.CANCELLED
                    return
                rows = await self._hoyolab.fetch_pulls(
                    banner, after_id=self._cache.latest_pull_id(uid, banner)
                )
                added += self._cache.put_pulls(uid, rows)
                progress.done = index

            # Bangboo art for the Pulls tab. Cosmetic: a failure here keeps
            # whatever was stored last time and does not fail the source.
            try:
                self._cache.put_codex(
                    "bangboo_icons", uid, "", await self._hoyolab.fetch_bangboo_icons()
                )
            except Exception:  # noqa: BLE001 - cards fall back to initials
                pass

            progress.state = SourceState.OK
            progress.message = f"{added} new pulls"
            self._cache.mark_sync_success(SOURCE_PULLS)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            from ..errors import translate

            api_error = translate(exc)
            progress.state = SourceState.FAILED
            progress.error_code = str(api_error.code)
            progress.message = str(api_error.detail.get("message", ""))

    def _agents_from_cache(self) -> list[Agent]:
        # Do not skip the lookup when the UID is empty: at process startup,
        # before the saved-cookie auto-login has resolved, the cache falls
        # back to the most recently stored roster for exactly this call, and
        # gating here is what made a restart show an empty grid until the
        # user synced again. Once the UID is known (a real login happened
        # this session), a miss stays a miss — see get_roster's own
        # docstring for why that matters once two accounts are involved.
        cached = self._cache.get_roster(self._hoyolab.uid)
        if cached is None:
            return [a for a in self._agents if a.owned]
        return [Agent.model_validate(row) for row in cached.get("agents", [])]

    async def _sync_metadata(self) -> list[Agent]:
        """Full catalog, for the un-owned ghost tiles."""
        progress = self._progress(SOURCE_METADATA)
        progress.state = SourceState.RUNNING
        progress.message = "Refreshing agent catalog"
        try:
            catalog = await self._metadata.fetch_catalog()
            # Ranks for recommended W-Engines. A failure here must not cost us
            # the catalog, which is the part the grid cannot do without.
            try:
                await self._metadata.fetch_engine_ranks()
            except Exception:  # noqa: BLE001 - engines simply go unbadged
                pass
            progress.state = SourceState.OK
            progress.total = progress.done = len(catalog)
            progress.message = f"{len(catalog)} agents in catalog"
            self._cache.mark_sync_success(SOURCE_METADATA)
            return catalog
        except Exception as exc:  # noqa: BLE001
            progress.state = SourceState.FAILED
            progress.message = f"Catalog unavailable: {exc}"
            cached = self._cache.get_metadata("agents")
            return [Agent.model_validate(r) for r in cached[0]] if cached else []

    @staticmethod
    def _merge_roster(catalog: list[Agent], owned: list[Agent]) -> list[Agent]:
        """Owned agents override catalog entries; the rest stay as ghosts."""
        merged: dict[int, Agent] = {a.id: a for a in catalog}
        by_name = {_normalise(a.name): a.id for a in catalog}

        for agent in owned:
            key = agent.id if agent.id in merged else by_name.get(_normalise(agent.name), agent.id)
            merged[key] = agent

        return sorted(
            merged.values(),
            # Owned first, then rarity, then name — the grid reads top-left down.
            key=lambda a: (not a.owned, a.rarity != "S", a.name.lower()),
        )

    async def _sync_guides(self, *, force: bool) -> None:
        """Prydwen guides, serialized at the crawl delay, cache-first."""
        progress = self._progress(SOURCE_GUIDES)
        progress.state = SourceState.RUNNING
        progress.message = "Checking recommendation cache"

        patch = await self._metadata.game_version()
        source = HtmlPrydwenSource()
        failures = 0

        try:
            slugs = await source.list_agent_slugs()
            progress.total = len(slugs)

            for index, slug in enumerate(slugs, start=1):
                if self._cancel.is_set():
                    progress.state = SourceState.CANCELLED
                    progress.message = f"Cancelled after {index - 1} guides"
                    return

                progress.done = index
                progress.message = f"{index}/{len(slugs)} guides"

                if not force and self._is_guide_fresh(slug, patch):
                    continue

                try:
                    guide = await source.fetch_guide(slug)
                    guide.patch = patch
                    self._cache.put_guide(slug, patch, guide.model_dump(), guide.source_url)
                except PrydwenParseError as exc:
                    # Loud but not fatal: the selector broke for this page.
                    failures += 1
                    progress.message = f"Parse failed on {slug} ({exc.selector})"
                except PrydwenUnavailable:
                    failures += 1

            if failures and failures >= progress.total:
                progress.state = SourceState.FAILED
                progress.message = "Every guide fetch failed"
            else:
                progress.state = SourceState.OK
                progress.message = (
                    f"{progress.total} guides ({failures} failed)"
                    if failures
                    else f"{progress.total} guides"
                )
                self._cache.mark_sync_success(SOURCE_GUIDES)
        except (PrydwenUnavailable, PrydwenParseError) as exc:
            progress.state = SourceState.FAILED
            progress.message = f"Prydwen unavailable: {exc}"
        finally:
            await source.aclose()

    def _is_guide_fresh(self, slug: str, patch: str) -> bool:
        cached = self._cache.get_guide(slug, patch or None)
        if cached is None:
            return False

        payload, fetched_at = cached

        # A guide produced by an older parser is stale even though the patch and
        # the timestamp both look fine — it is missing fields the app now reads.
        if payload.get("schema_version", 0) != GUIDE_SCHEMA_VERSION:
            return False

        return time.time() - fetched_at < PRYDWEN_CACHE_MAX_AGE_SECONDS

    def _recompute(self) -> None:
        guides = [AgentGuide.model_validate(row) for row in self._cache.all_guides()]
        self._backfill_card_art(guides)
        self._backfill_engine_ranks(guides)
        self._backfill_icons(guides)
        self._analysis = run_analysis(self._agents, self._builds, guides)

    def _backfill_engine_ranks(self, guides: list[AgentGuide]) -> None:
        """Stamp each recommended W-Engine with its real rank.

        Prydwen's markup carries no rank, so this comes from the game data the
        catalog already uses. Engines the map does not know keep an empty rank
        and are shown without a badge - the UI never invents one.
        """
        ranks = self._metadata.engine_ranks_from_cache()
        if not ranks:
            return
        by_name = {_normalise(name): rarity for name, rarity in ranks.items()}
        for guide in guides:
            for engine in guide.engines:
                if not engine.rarity:
                    engine.rarity = by_name.get(_normalise(engine.name), "")

    @staticmethod
    def _backfill_card_art(guides: list[AgentGuide]) -> None:
        """Give team members their large portrait URL.

        Guides cached before card art existed only carry the 160px thumbnail.
        The large URL is a pure transform of it, so deriving it here upgrades
        the existing cache without spending one of the day's syncs.
        """
        for guide in guides:
            for team in guide.teams:
                for member in team.members:
                    if not member.card_icon and member.icon:
                        member.card_icon = card_image_url(member.icon)

    def _backfill_icons(self, guides: list[AgentGuide]) -> None:
        """Give every agent the same kind of portrait.

        HoYoLAB only supplies art for agents the user owns, and hakush.in's
        published image URLs 404, so un-owned tiles would otherwise render as
        bare initials.

        Two Prydwen sources, in order of coverage:

        1. The agent's **own guide slug**, which yields the image URL directly.
           This is the one that covers the whole roster.
        2. The team rows, which mention a portrait for each member. This only
           reaches agents somebody is recommended to play alongside, which is
           why most A-ranks were left on HoYoLAB's 152x186 face crop and so
           rendered visibly unlike the full-body cards around them.
        """
        by_slug: dict[str, tuple[str, str]] = {}
        index = build_guide_index(guides)

        portraits: dict[str, tuple[str, str]] = {}
        for guide in guides:
            for team in guide.teams:
                for member in team.members:
                    if member.icon:
                        # Guides cached before card art existed have no
                        # card_icon; deriving it here means they benefit
                        # without forcing a full refetch.
                        card = member.card_icon or card_image_url(member.icon)
                        portraits.setdefault(_normalise(member.name), (member.icon, card))

        for agent in self._agents:
            guide = find_guide(agent, index)
            if guide is not None and guide.slug:
                icon = by_slug.get(guide.slug, ("", ""))[0]
                if not icon:
                    icon = character_image_url(guide.slug)
                    by_slug[guide.slug] = (icon, card_image_url(icon))
                self._apply_art(agent, *by_slug[guide.slug])
                continue

            for key in (agent.name, agent.full_name):
                found = portraits.get(_normalise(key)) if key else None
                if found is None:
                    continue
                icon, card = found
                self._apply_art(agent, icon, card)
                break

    @staticmethod
    def _apply_art(agent: Agent, icon: str, card: str) -> None:
        """Attach portrait URLs, without overwriting anything already set."""
        # Card art is worth setting even on owned agents: HoYoLAB only supplies
        # a 152x186 avatar, which cannot be shown large.
        if card and not agent.card_icon:
            agent.card_icon = card
        if icon and not agent.square_icon:
            agent.square_icon = icon
            if not agent.rectangle_icon:
                agent.rectangle_icon = icon

    def load_from_cache(self) -> None:
        """Populate the in-memory view at startup so the UI has something to
        show before the first sync of the session finishes."""
        cached_catalog = self._cache.get_metadata("agents")
        catalog = [Agent.model_validate(r) for r in cached_catalog[0]] if cached_catalog else []
        owned = self._agents_from_cache()
        self._agents = self._merge_roster(catalog, owned)

        self._builds = {
            agent_id: AgentBuild.model_validate(payload)
            for agent_id, payload in self._cache.get_builds(self._hoyolab.uid).items()
        }
        self._recompute()

    def clear(self) -> None:
        """Drop the in-memory roster/build/analysis view.

        Called on logout, so a person signing back in as someone else sees
        nothing rather than the outgoing account's data for the moment
        between the login call and the next sync. `get_roster`/`get_builds`
        (see cache/db.py) also refuse to leak one account's on-disk cache
        into another's login now, so the next login's own `load_from_cache`
        stays empty too, until a real sync populates that account's own
        cache — this call is what keeps the screen honestly empty for the
        few hundred milliseconds before that happens, rather than showing
        the outgoing account's data one paint longer than it has to.
        """
        self._agents = []
        self._builds = {}
        self._analysis = Analysis()
