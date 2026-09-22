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
    SourceProgress,
    SourceState,
    SyncStatus,
)
from ..prydwen import HtmlPrydwenSource, PrydwenParseError, PrydwenUnavailable
from .analysis import _normalise, run_analysis
from .hoyolab import HoyolabService
from .metadata import MetadataService

SOURCE_ACCOUNT = "account"
SOURCE_METADATA = "metadata"
SOURCE_GUIDES = "guides"
_SOURCES = (SOURCE_ACCOUNT, SOURCE_METADATA, SOURCE_GUIDES)


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
        self._status.syncs_used_today = self._cache.syncs_today()
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

            # Daily cap. Refuse rather than queue: a sync the user cannot see
            # finish is worse than a clear "not today".
            if self._cache.syncs_today() >= MAX_SYNCS_PER_DAY:
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
            self._cache.record_sync_run(self._status.run_id)
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

    def _agents_from_cache(self) -> list[Agent]:
        uid = self._hoyolab.uid
        cached = self._cache.get_roster(uid) if uid else None
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
        self._backfill_icons(guides)
        self._analysis = run_analysis(self._agents, self._builds, guides)

    def _backfill_icons(self, guides: list[AgentGuide]) -> None:
        """Give un-owned agents a portrait.

        HoYoLAB only supplies art for agents the user owns, and hakush.in's
        published image URLs 404, so un-owned tiles would otherwise render as
        bare initials. Prydwen's team rows carry a plain CDN portrait for every
        agent they mention, which covers essentially the whole roster.
        """
        portraits: dict[str, str] = {}
        for guide in guides:
            for team in guide.teams:
                for member in team.members:
                    if member.icon:
                        portraits.setdefault(_normalise(member.name), member.icon)

        if not portraits:
            return

        for agent in self._agents:
            if agent.square_icon:
                continue
            for key in (agent.name, agent.full_name):
                icon = portraits.get(_normalise(key)) if key else None
                if icon:
                    agent.square_icon = icon
                    if not agent.rectangle_icon:
                        agent.rectangle_icon = icon
                    break

    def load_from_cache(self) -> None:
        """Populate the in-memory view at startup so the UI has something to
        show before the first sync of the session finishes."""
        cached_catalog = self._cache.get_metadata("agents")
        catalog = [Agent.model_validate(r) for r in cached_catalog[0]] if cached_catalog else []
        owned = self._agents_from_cache()
        self._agents = self._merge_roster(catalog, owned)

        uid = self._hoyolab.uid
        if uid:
            self._builds = {
                agent_id: AgentBuild.model_validate(payload)
                for agent_id, payload in self._cache.get_builds(uid).items()
            }
        self._recompute()
