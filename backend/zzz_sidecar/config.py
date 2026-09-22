"""Process-wide settings, populated once from the CLI args Electron passes in."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

#: Identifies this app to Prydwen. Keep the repo URL so they can contact us.
USER_AGENT = (
    "ZZZTeamTracker/0.1 (+https://github.com/rahbir1518/ZZZ_Personalized_Tracker; "
    "personal, non-commercial use)"
)

#: prydwen.gg robots.txt specifies `Crawl-delay: 10` for User-Agent: *.
PRYDWEN_CRAWL_DELAY_SECONDS = 10.0

#: Prydwen guides are re-fetched only when the cached game patch differs, or
#: when the entry is older than this regardless of patch.
PRYDWEN_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

#: Hard cap on full syncs per calendar day (local time).
#:
#: This is about being a light, predictable consumer of upstream services, not
#: about evading anything: HoYoLAB enforces a real per-cookie daily limit, and a
#: full Prydwen pass is expensive at a 10s crawl delay. Five is plenty for a
#: game whose account data changes a few times a day at most.
MAX_SYNCS_PER_DAY = 5

#: hakushin metadata (catalog + icons) changes only on patch days.
METADATA_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 3


@dataclass(slots=True)
class Settings:
    port: int = 8777
    token: str = ""
    data_dir: Path = field(default_factory=lambda: Path.cwd() / ".local")

    @property
    def cache_db_path(self) -> Path:
        return self.data_dir / "cache.sqlite3"

    @property
    def hakushin_cache_path(self) -> Path:
        return self.data_dir / "hakushin-http-cache.sqlite3"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)


_settings = Settings()


def get_settings() -> Settings:
    return _settings


def configure(*, port: int, token: str, data_dir: Path) -> Settings:
    global _settings
    _settings = Settings(port=port, token=token, data_dir=data_dir)
    _settings.ensure_dirs()
    return _settings
