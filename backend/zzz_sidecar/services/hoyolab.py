"""HoYoLAB account access via genshin.py.

Method and field names verified 2026-09-21 against genshin.py 1.7.30 — see the
brief's appendix. Re-verify after any dependency bump; ZZZ endpoints get added
and renamed between releases.

Cookies live in memory only. They arrive from the Electron main process (which
holds them encrypted at rest via safeStorage) and are never written to the cache
DB, never logged, and never sent anywhere but HoYoLAB's own domains.
"""

from __future__ import annotations

import time

import genshin

from ..models import (
    Agent,
    AgentBuild,
    AuthResult,
    CookiePayload,
    Disc,
    Property,
    Roster,
    Skill,
    WEngine,
)


class HoyolabService:
    """Holds the authenticated client for the current session."""

    def __init__(self) -> None:
        self._client: genshin.Client | None = None
        self._uid: str = ""
        self._nickname: str = ""

    # -- auth --------------------------------------------------------------- #

    @property
    def authenticated(self) -> bool:
        return self._client is not None

    @property
    def uid(self) -> str:
        return self._uid

    def _build_client(self, cookies: CookiePayload) -> genshin.Client:
        # Only non-empty values are passed through; genshin.py identifies the
        # user from ltuid_v2/account_id_v2 and does not require cookie_token_v2
        # for battle-chronicle reads.
        jar = {
            key: value
            for key, value in cookies.model_dump().items()
            if isinstance(value, str) and value.strip()
        }
        return genshin.Client(jar, game=genshin.Game.ZZZ)

    async def login(self, cookies: CookiePayload) -> AuthResult:
        """Validate cookies with one real ZZZ call.

        Raises the underlying genshin exception; the router translates it so the
        "game record disabled" case stays distinguishable from bad cookies.
        """
        client = self._build_client(cookies)

        # get_zzz_user is the cheapest call that proves both that the cookies
        # work and that the ZZZ battle record is readable.
        stats = await client.get_zzz_user()

        self._client = client
        self._uid = str(getattr(stats, "uid", "") or "")
        self._nickname = str(getattr(stats, "nickname", "") or "")

        return AuthResult(
            ok=True,
            uid=self._uid,
            nickname=self._nickname,
            level=int(getattr(stats, "level", 0) or 0),
            region=str(getattr(stats, "region", "") or ""),
        )

    def logout(self) -> None:
        self._client = None
        self._uid = ""
        self._nickname = ""

    def _require_client(self) -> genshin.Client:
        if self._client is None:
            raise PermissionError("Not authenticated. Submit cookies first.")
        return self._client

    # -- roster ------------------------------------------------------------- #

    async def fetch_roster(self) -> Roster:
        """The owned agent list, with level and mindscape."""
        client = self._require_client()
        agents = await client.get_zzz_agents()

        return Roster(
            uid=self._uid,
            nickname=self._nickname,
            agents=[self._to_agent(a) for a in agents],
            fetched_at=time.time(),
        )

    async def fetch_builds(self, agent_ids: list[int]) -> list[AgentBuild]:
        """Equipped W-Engine, discs and skills for the given agents.

        ``get_zzz_agent_info`` accepts a sequence and batches server-side, so
        this is one request for the whole roster rather than one per agent.
        """
        if not agent_ids:
            return []

        client = self._require_client()
        result = await client.get_zzz_agent_info(agent_ids)
        full_agents = list(result) if isinstance(result, list | tuple) else [result]
        return [self._to_build(a) for a in full_agents]

    # -- mapping ------------------------------------------------------------ #
    # Upstream models are converted here and nowhere else, so an upstream field
    # rename is a one-function fix.

    @staticmethod
    def _to_agent(agent: object) -> Agent:
        return Agent(
            id=int(getattr(agent, "id", 0)),
            name=str(getattr(agent, "name", "")),
            full_name=str(getattr(agent, "full_name", "") or ""),
            element=_enum_name(getattr(agent, "element", "")),
            specialty=_enum_name(getattr(agent, "specialty", "")),
            rarity=str(getattr(agent, "rarity", "") or ""),
            faction_name=str(getattr(agent, "faction_name", "") or ""),
            square_icon=str(getattr(agent, "square_icon", "") or ""),
            rectangle_icon=str(getattr(agent, "rectangle_icon", "") or ""),
            owned=True,
            level=int(getattr(agent, "level", 0) or 0),
            # HoYoLAB calls the mindscape/cinema level "rank".
            mindscape=int(getattr(agent, "rank", 0) or 0),
        )

    @classmethod
    def _to_build(cls, agent: object) -> AgentBuild:
        return AgentBuild(
            agent_id=int(getattr(agent, "id", 0)),
            level=int(getattr(agent, "level", 0) or 0),
            mindscape=int(getattr(agent, "rank", 0) or 0),
            w_engine=cls._to_engine(getattr(agent, "w_engine", None)),
            discs=[cls._to_disc(d) for d in getattr(agent, "discs", []) or []],
            skills=[
                Skill(type=_enum_name(getattr(s, "type", "")), level=int(getattr(s, "level", 0)))
                for s in getattr(agent, "skills", []) or []
            ],
            properties=[cls._to_property(p) for p in getattr(agent, "properties", []) or []],
        )

    @staticmethod
    def _to_property(prop: object) -> Property:
        return Property(
            name=str(getattr(prop, "name", "") or ""),
            value=str(getattr(prop, "value", "") or ""),
        )

    @classmethod
    def _to_engine(cls, engine: object | None) -> WEngine | None:
        if engine is None:
            return None
        return WEngine(
            id=int(getattr(engine, "id", 0)),
            name=str(getattr(engine, "name", "")),
            icon=str(getattr(engine, "icon", "") or ""),
            level=int(getattr(engine, "level", 0) or 0),
            rarity=str(getattr(engine, "rarity", "") or ""),
            refinement=int(getattr(engine, "refinement", 1) or 1),
            effect_title=str(getattr(engine, "effect_title", "") or ""),
        )

    @classmethod
    def _to_disc(cls, disc: object) -> Disc:
        main_props = list(getattr(disc, "main_properties", []) or [])
        set_effect = getattr(disc, "set_effect", None)

        return Disc(
            id=int(getattr(disc, "id", 0)),
            name=str(getattr(disc, "name", "")),
            icon=str(getattr(disc, "icon", "") or ""),
            level=int(getattr(disc, "level", 0) or 0),
            rarity=str(getattr(disc, "rarity", "") or ""),
            position=int(getattr(disc, "position", 0) or 0),
            set_name=str(getattr(set_effect, "name", "") or ""),
            main_stat=cls._to_property(main_props[0]) if main_props else None,
            # `properties` on a disc is the substat list.
            substats=[cls._to_property(p) for p in getattr(disc, "properties", []) or []],
        )


def _enum_name(value: object) -> str:
    """genshin.py returns IntEnum/StrEnum members for element, specialty and
    skill type; render the readable member name rather than a bare number."""
    if value is None:
        return ""
    name = getattr(value, "name", None)
    if isinstance(name, str):
        return name.replace("_", " ").title()
    return str(value)
