-- Local-only cache. Never committed; see .gitignore.
-- Holds fetched third-party content so we re-request as little as possible.

PRAGMA journal_mode = WAL;

-- Prydwen guides, keyed by slug + the game patch they were captured against.
CREATE TABLE IF NOT EXISTS prydwen_guide (
    slug        TEXT NOT NULL,
    patch       TEXT NOT NULL DEFAULT '',
    payload     TEXT NOT NULL,          -- AgentGuide as JSON
    source_url  TEXT NOT NULL DEFAULT '',
    fetched_at  REAL NOT NULL,
    PRIMARY KEY (slug, patch)
);

CREATE INDEX IF NOT EXISTS idx_prydwen_guide_slug ON prydwen_guide (slug);

-- Raw HTML snapshots, kept only for the most recent fetch of each slug so a
-- parser break can be diagnosed offline. Trimmed by vacuum_html_snapshots().
CREATE TABLE IF NOT EXISTS prydwen_snapshot (
    slug        TEXT PRIMARY KEY,
    html        TEXT NOT NULL,
    fetched_at  REAL NOT NULL
);

-- hakushin metadata: the full agent/engine/disc catalog and icon URLs.
CREATE TABLE IF NOT EXISTS metadata (
    kind        TEXT NOT NULL,          -- 'agents' | 'engines' | 'discs'
    version     TEXT NOT NULL DEFAULT '',
    payload     TEXT NOT NULL,
    fetched_at  REAL NOT NULL,
    PRIMARY KEY (kind, version)
);

-- Last successful roster pull, so the UI has something to render before the
-- first sync of a session finishes.
CREATE TABLE IF NOT EXISTS roster_snapshot (
    uid         TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    fetched_at  REAL NOT NULL
);

-- Equipped builds per agent from the last successful sync.
CREATE TABLE IF NOT EXISTS agent_build (
    uid         TEXT NOT NULL,
    agent_id    INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    fetched_at  REAL NOT NULL,
    PRIMARY KEY (uid, agent_id)
);

-- When each source last synced successfully, for the Sync button's timestamps.
CREATE TABLE IF NOT EXISTS sync_log (
    source          TEXT PRIMARY KEY,
    last_success_at REAL NOT NULL
);

-- One row per sync that actually started, so the daily cap survives restarts.
CREATE TABLE IF NOT EXISTS sync_run (
    run_id     TEXT PRIMARY KEY,
    started_at REAL NOT NULL,
    day        TEXT NOT NULL      -- local calendar day, YYYY-MM-DD
);

CREATE INDEX IF NOT EXISTS idx_sync_run_day ON sync_run (day);

-- Game-data lookups behind the drill-down pages: one W-Engine, the disc set
-- table, one agent's passives. Keyed by kind + key and stamped with the game
-- patch they were captured against, so a patch day invalidates them the same
-- way it invalidates the catalog.
CREATE TABLE IF NOT EXISTS codex (
    kind        TEXT NOT NULL,          -- 'engine_index' | 'engine' | 'disc_sets' | 'synergy'
    key         TEXT NOT NULL DEFAULT '',
    version     TEXT NOT NULL DEFAULT '',
    payload     TEXT NOT NULL,
    fetched_at  REAL NOT NULL,
    PRIMARY KEY (kind, key)
);
