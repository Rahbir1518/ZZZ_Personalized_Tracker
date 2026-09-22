# ZZZ Team Tracker — Project Brief

A local, open-source Electron desktop app for Zenless Zone Zero. A user
authenticates with their own HoYoLAB account, the app pulls their full agent
roster (with W-Engines, Drive Discs, mindscape levels), fetches recommended
builds/teams from Prydwen, and cross-references the two to tell the user which
recommended teams they can field, how close their builds are to recommendations,
and what to farm next. Comic-book visual style.

> **Context for the assistant:** This is a personal hobby project, non-commercial,
> hosted on the owner's public GitHub. Anyone can clone/download and run it
> locally with their own account. It is never deployed as a hosted service — all
> fetching happens on each user's own machine, for their own account. Keep this
> in mind for every architecture and security decision below.

> **Accuracy note:** The libraries and game APIs below change frequently
> (monthly releases, per-patch data). Do **not** rely on remembered method names,
> field names, or endpoint shapes. Before writing integration code, read the
> current API reference / README / source for each dependency and confirm the
> actual signatures. Prefer reading the real types over guessing.

---

## Core requirements

1. Authenticate a user against HoYoLAB and read **their own** ZZZ account data.
2. Pull the **full** agent roster: each agent's mindscape/cinema level, equipped
   W-Engine, equipped Drive Discs (including substats), core skill levels.
3. Fetch recommended builds, best W-Engines, best disc sets, substat priorities,
   and recommended teams from Prydwen (`https://www.prydwen.gg/zenless`).
4. Join the two datasets and surface, per the user's actual account:
   - which Prydwen-recommended teams the user can fully field (all agents owned),
   - build-gap analysis per owned agent (disc-set match %, substat gaps,
     W-Engine match),
   - suggested farming priorities.
5. A **Sync button** in the app that refetches the newest data from every
   source in one action (see *Sync* below).
6. Comic-book UI.

The join/analysis in (4) is the actual point of the project. Data fetching is
plumbing; spend effort on the analysis layer and the UI, not on reinventing the
scrapers.

---

## Data sources

### Account data — HoYoLAB Battle Chronicle via `genshin.py`
- Library: **`genshin.py`**, currently maintained by **seriaati**
  (`pip install genshin`; source: `github.com/seriaati/genshin.py`). It wraps the
  HoYoLAB/Miyoushe API, returns Pydantic models, and integrates with FastAPI.
- It exposes ZZZ endpoints for the agent roster, per-agent detail, and real-time
  notes. **Confirm the exact ZZZ method and model names against the current API
  reference before use** — they are added/renamed across releases.
- Because each user runs the app locally with **their own** cookies reading
  **their own** account, the "make Battle Chronicle public" requirement (which
  only applies to reading *someone else's* account by UID) mostly does not apply.
- The user **does** still need the HoYoLAB "Enable game record / battle record"
  setting turned on for ZZZ. Treat a disabled toggle as an expected error case:
  detect it and show a clear message + link, don't just fail.

### Metadata / icons — `hakushin-py`
- Library: **`hakushin-py`** (also by seriaati), wraps hakush.in for ZZZ game
  data and provides direct icon URLs.
- Use it for agent/W-Engine/disc icons and any name/ID enrichment needed to
  render the UI and to map account data onto Prydwen recommendations.
- Fetch icons at runtime; do not commit game art to the repo.

### Recommendations — Prydwen (`prydwen.gg`)

**Verified 2026-09-21 — the old Gatsby `page-data.json` route is dead.** Prydwen
has migrated from Gatsby to **Next.js (App Router)**. Confirmed by probing:

- `/page-data/**/page-data.json` → **HTTP 410 Gone** (all paths, including
  `app-data.json` and `sq/d/*.json`). Deliberately retired at the edge.
- `/_next/data/**.json` (Pages Router shape) → 404. Not applicable to App Router.
- The RSC flight endpoint (`?_rsc=`, `RSC: 1`, `Next-Router-State-Tree`) → an
  infinite **307** redirect loop. Deliberately blocked.
- No public JSON/GraphQL API: `/api/*` is 404 **and** `Disallow`ed in robots.txt.
  `api.prydwen.gg` does not resolve.

So there is **no clean structured-data endpoint any more**. Recommendations must
be read from the server-rendered HTML. This is workable because Prydwen's markup
uses **hand-authored semantic class names**, not hashed CSS-module names:
`.zzz-set-min`, `.small-sets`, `.team-row`, `.skill-name`, `.percentage`,
`.usage`, `.rank`, `.info-list-row`. Set and W-Engine names are also carried in
`img[alt]`. These come from Prydwen's own SCSS and survive ordinary rebuilds.

**Adapter design (keep the brief's original intent):**
- Define a narrow `PrydwenSource` protocol. The HTML adapter is one
  implementation; a JSON adapter stub stays in place in case a structured
  endpoint ever returns. Nothing outside the adapter knows how data was obtained.
- Parse with `selectolax` (fast, lenient). Extract to typed Pydantic models.
- **Golden-file parse tests:** a saved page snapshot in `tests/golden/` plus its
  expected parse output, so a Prydwen redesign fails loudly and points at the
  exact selector that broke.
- Every field is individually optional — a changed section degrades that one
  field, it does not blank the whole guide.

**Being a good citizen** (robots.txt allows `/` with `Crawl-delay: 10`):
- Honour a **10s crawl delay**; serialize Prydwen requests, never parallelize.
- Cache aggressively in local SQLite, keyed by `character + game patch version`;
  only refetch when the cached patch is stale.
- Set a custom, identifying `User-Agent` naming the project and its repo.
- Prydwen's ToS grants a limited license for **personal, non-commercial** use and
  prohibits reproducing/redistributing their content commercially. A local,
  per-user, non-commercial app is within that grant. Never redistribute the
  cached content — it stays on the user's machine and is `.gitignore`d.

---

## Architecture

Electron front end + local Python sidecar, because the best ZZZ HoYoLAB tooling
is Python.

- **Renderer:** Electron + Vite + React + TypeScript. UI only. Talks to the
  sidecar over `localhost`.
- **Main process (Node):** app lifecycle; spawns and supervises the Python
  sidecar; owns secure local storage of credentials.
- **Sidecar (Python):** FastAPI service using `genshin.py`, `hakushin-py`, and
  the Prydwen adapter. Owns all networking, caching (SQLite), the enrichment, and
  the join/analysis logic. Exposes a small local HTTP API the renderer consumes.
- **Bundling:** package the sidecar with **PyInstaller** into a binary that
  Electron ships and spawns, so end users don't need Python installed. Accept that
  this adds build steps and installer size — it's the cost of the HoYoLAB route.
- **Electron hardening:** `contextIsolation: true`, `nodeIntegration: false`,
  expose a narrow API to the renderer via a preload `contextBridge`. The sidecar
  should bind to localhost only, ideally on a random free port passed to the
  renderer by the main process.

---

## Authentication

Support manual cookies first (fastest to stand up), add QR later.

1. **Manual cookie paste (build first):** user logs into hoyolab.com, copies
   their `ltoken_v2` / `ltuid_v2` (some flows also need `account_mid_v2` /
   `account_id_v2` — confirm what `genshin.py` currently requires). App validates
   them with one test call and stores them locally.
2. **QR-code login (build later):** `genshin.py` ships login helpers including a
   QR flow (scan with the HoYoLAB app). Prefer this for the distributed app —
   the app never handles anyone's password.

---

## Security & privacy (this app handles other people's session tokens)

- Treat HoYoLAB cookies like passwords. Store them **locally only** — OS keychain
  if practical (e.g. `keytar`/`keyring`), otherwise a clearly `.gitignore`'d local
  file. Never log them. Never transmit them anywhere except HoYoLAB's own domains.
- Honest risk framing for the README: a leaked HoYoLAB cookie exposes account
  *data* (with email/phone partially masked) but cannot by itself take over the
  account without also having the password, email access, and clearing 2FA.
  Real enough to handle carefully; not catastrophic. State this plainly.

---

## Repository hygiene (public repo)

- **Never commit fetched data or assets:** `.gitignore` the SQLite cache DB and
  any cached Prydwen JSON. Ship the app empty; it populates at runtime.
- **Never commit** a UID, cookies, or any account dump.
- **Do not bundle** game art or Prydwen assets. Fetch icons at runtime.
- License the code (MIT or similar) — note it covers your code, not upstream data
  or assets.
- README disclaimer: not affiliated with HoYoverse or Prydwen; data fetched for
  personal use. Do not name/brand the app to imply it is official.

---

## Comic-book UI direction

Core styling, achievable in pure CSS/SVG:
- Thick black ink outlines; hard offset box-shadows for a printed-panel feel.
- Ben-Day / halftone dot texture (SVG filter or repeating radial-gradient).
- Panel-grid layout with fat gutters; slight rotation on panels.
- Speech-bubble shapes for callouts and modals; burst/star shapes ("POW") for
  highlights like "team ready" or "build complete".
- Pair a punchy display face for headers with a clean body font.
- All agent art is 2D, pulled at runtime from the metadata source
  (`hakushin-py` portrait/icon URLs). No 3D assets — do not try to recreate the
  in-game 3D renders.

### App structure — two top-level tabs

**1. Characters tab**
- The screen is the **roster grid**, modeled on the right-hand side of the
  in-game agent-selection screen (~6 columns, scrollable). Each agent is a
  trading-card tile: 2D face portrait, colored ink border, a rank / mindscape pip
  in a corner, an element/attribute icon, a rarity marker, and a level label along
  the bottom. Owned & built agents get a gold ink border.
  - **Decided:** show the **full catalog**, with un-owned agents dimmed as
    halftone "ghost" tiles. The catalog comes from `hakushin-py`; ownership is
    the join against the HoYoLAB roster. This makes "what am I missing" legible
    directly in the grid and feeds the Suggested-teams view.
- **Clicking a tile opens the comic-book modal** for that agent (see below).

**2. Teams tab** — contains two sub-tabs:
- **My Teams** — teams currently fieldable from the owned roster (agents the user
  actually has). Show each team's composition and each member's build state.
- **Suggested** — recommended teams and builds produced by consolidating account
  data with Prydwen recommendations: which meta teams the user can build toward,
  what's missing, and suggested farming priorities.

### The character modal (comic "panel burst" transition)

Clicking an agent tile should feel like a comic panel bursting open:
- A **speech bubble emerges from the clicked tile**, expands to fill the whole
  screen, and the agent's information then **fades in** inside it. On close, it
  collapses back toward the originating tile.
- Implementation: animate a shape from the tile's position/size to a fullscreen
  panel using the tile as the transform origin (CSS transform + clip-path, or an
  SVG / Framer-Motion transition) so it reads as "emerging from there." Gate the
  content fade-in until the expand finishes. Provide a simple fade fallback under
  `prefers-reduced-motion`.

**Modal content (owned agent):**
- Current build from the account: equipped W-Engine, Drive Discs and their
  substats, mindscape / core skill levels.
- Prydwen recommendations for that agent: best W-Engines, best disc sets, main-stat
  and substat priorities, recommended teams.
- The comparison: build-gap readout (disc-set match, substat gaps, W-Engine match)
  and which recommended teams the agent belongs to. Surface highlights as in-panel
  speech-bubble callouts and burst badges (e.g. "BUILD COMPLETE", or a callout
  listing missing pieces).

---

## Sync

A single **Sync button**, always visible in the app header, refetches the newest
data from **every** source in one action. It is the only refresh affordance in
the app — no per-panel reload buttons.

**What one sync does, in order:**
1. **Account (HoYoLAB):** re-pull the full agent roster and per-agent detail
   (mindscape, W-Engine, discs + substats, core skill levels). Always fetched
   fresh — this is the user's own live data and the whole point of the app.
2. **Metadata (`hakushin-py`):** refresh the agent / W-Engine / disc catalog and
   icon URLs. Only when the cached game version is stale.
3. **Recommendations (Prydwen):** refetch guides whose cached patch version is
   stale, serialized at the 10s crawl delay. Fresh-cached guides are skipped.
4. **Re-run the join/analysis** and update every derived view.

**Behaviour:**
- **Per-source progress.** The button reports which source is in flight and how
  far along (`3/41 guides`), because a full Prydwen refresh is slow by design.
- **Partial failure is normal and non-fatal.** If Prydwen is unreachable but
  HoYoLAB succeeded, keep the fresh account data, keep serving the stale cached
  guides, and report per-source status. One dead source never blanks the UI.
- **Last-synced timestamp** shown per source next to the button.
- **Single-flight.** A sync already running cannot be started again; the button
  reflects in-flight state.
- **Cancellable**, since a cold Prydwen sync takes minutes at a 10s delay.
- **Cold start:** the first sync after login is a full fetch of everything.
- **Capped at 5 full syncs per calendar day** (local midnight reset), persisted
  in SQLite so it survives restarts. The remaining count is shown under the
  button, which disables itself at zero. This keeps the app a light, predictable
  consumer of upstream services — HoYoLAB enforces its own per-cookie daily
  limit, and a cold Prydwen pass is expensive at a 10s crawl delay. Note this is
  a politeness/quota measure, **not** a workaround for Prydwen's Cloudflare
  challenge, which is fingerprint-based and fires on the first request
  regardless of volume.
- Comic-styled: the button reads as an action burst, and completion pops a
  "SYNCED!" burst badge.

**Endpoints:** `POST /sync` starts a run and returns a run id (refused with
`quota_exhausted` when the daily cap is spent); `GET /sync/status`
streams/reports per-source progress; `POST /sync/cancel` aborts the run.

---

## Build order (ship each slice before moving on)

1. **Auth + one roster call.** Manual cookie auth; land one successful full-roster
   fetch and print agents to a terminal / return them from one sidecar endpoint.
   This proves the whole spine.
2. **Roster grid.** Map roster data to names/icons via `hakushin-py`; render the
   Characters-tab roster grid in the comic style.
3. **Character modal.** Add the comic "panel burst" modal on tile click; pull one
   agent's Prydwen `page-data.json`, cache it to SQLite, and show that agent's
   build vs. the recommendation inside the modal.
4. **Teams tab.** Build the two sub-tabs — My Teams (fieldable from the owned
   roster) and Suggested (recommended teams/builds from consolidating account +
   Prydwen data).
5. **Sync.** Wire the one-button multi-source sync with per-source progress,
   partial-failure handling, and last-synced timestamps.
6. **QR login.** Add the QR auth flow; keep manual cookies as a fallback.

---

## First task

Scaffold milestone 1:

- `electron-vite` project (React + TypeScript) with a hardened main/renderer split
  (contextIsolation on, nodeIntegration off, preload contextBridge).
- A Python FastAPI sidecar with:
  - a `POST` endpoint that accepts pasted cookies, validates them with one
    `genshin.py` ZZZ call, and reports success/failure (including a distinct,
    detectable result for the "game record disabled" case),
  - a `GET` endpoint that returns the authenticated user's full ZZZ agent roster.
- Main process spawns the sidecar on a localhost port and passes it to the
  renderer.
- A minimal renderer screen: paste cookies → fetch roster → list agent names.
- `.gitignore` covering the cache DB, any cached JSON, and any credential file
  from the start.

Before writing integration code, read the current `genshin.py` API reference to
confirm the exact ZZZ client methods and required cookie fields. Ask me if any
product decision is ambiguous rather than guessing.

---

## Appendix — verified API reference (checked 2026-09-21)

Confirmed against current sources, per the accuracy note above. Re-verify before
relying on anything here after a dependency bump.

### `genshin.py` — v1.7.30, `requires_python >=3.9`, deps `aiohttp`, `pydantic 2.*`, `tenacity`

ZZZ battle-chronicle methods actually available on the client:

| Method | Signature (abridged) | Returns |
|---|---|---|
| `get_zzz_user` | `(uid=None, *, lang=None)` | `ZZZUserStats` |
| `get_zzz_agents` | `(uid=None, *, lang=None)` | `Sequence[ZZZPartialAgent]` |
| `get_zzz_agent_info` | `(character_id: int \| Sequence[int], *, uid=None, lang=None)` | `ZZZFullAgent` or `Sequence[ZZZFullAgent]` |
| `get_bangboos` | `(uid=None, *, lang=None)` | `Sequence[ZZZBaseBangboo]` |
| `get_zzz_notes` | `(uid=None, *, lang=None, autoauth=True, return_raw_data=False)` | `ZZZNotes` |

`get_zzz_agent_info` **accepts a sequence of ids and batches them** — use one
batched call for the whole roster, not N calls.

**Model fields that matter for the join:**
- `ZZZBaseAgent`: `id`, `name`, `full_name`, `element`, `rarity`, `specialty`,
  `faction_name`, `faction_icon`, `rectangle_icon`, `square_icon`.
  → **HoYoLAB already returns icon URLs for owned agents.** `hakushin-py` is
  therefore needed mainly for the *un-owned* catalog, not for owned-agent art.
- `ZZZPartialAgent`: `+ level`, `rank` (rank == mindscape/cinema level).
- `ZZZFullAgent`: `+ properties`, `discs` (alias `equip`), `w_engine`
  (alias `weapon`), `skills`, `ranks`, `potential`, `banner_icon`.
- `ZZZDisc`: `id`, `level`, `name`, `icon`, `rarity`, `main_properties`,
  `properties` (substats), `set_effect` (alias `equip_suit`),
  `position` (alias `equipment_type`, the 1–6 slot).
- `WEngine`: `id`, `level`, `name`, `icon`, `refinement` (1–5), `rarity`,
  `properties`, `main_properties`, `effect_title`, `effect_description`.
- `ZZZProperty`: `name` (alias `property_name`), `type`, `value` (alias `base`).
- `AgentSkill`: `level`, `type` (alias `skill_type`), `items`.

**Cookies.** The manager identifies a user from any of `ltuid`, `account_id`,
`ltuid_v2`, `account_id_v2`, falling back to `ltmid_v2` / `account_mid_v2`.
`cookie_token`/`cookie_token_v2` is only enforced for the operations that need
it — **not** for battle-chronicle reads. So for this app: **`ltoken_v2` +
`ltuid_v2` is sufficient**, and `account_mid_v2` / `account_id_v2` are optional
extras worth accepting in the paste box.

**Errors to handle distinctly** (`genshin.errors`):

| Exception | retcode | Meaning for the UI |
|---|---|---|
| `DataNotPublic` | `10102` | **The "game record disabled" case.** Show the fix + link. |
| `InvalidCookies` | `-100` | Cookies wrong/expired → re-paste. |
| `AccountNotFound` | `1009` / `1008` | No ZZZ account on these cookies. |
| `TooManyRequests` | `10101` | Daily cap hit → back off. |
| `VisitsTooFrequently` | `-110` / `1028` | Rate limited → retry later. |
| `GeetestError` | — | Captcha challenge during a chronicle call. |

### `hakushin-py` — v0.6.1, `requires_python >=3.11`

`ZZZClient(lang=Language.EN, *, use_live=False, cache_path=..., cache_ttl=3600,
headers=None, debug=False, session=None)`, used as an async context manager.

`fetch_characters()`, `fetch_character_detail(character_id)`, `fetch_weapons()`,
`fetch_weapon_detail(weapon_id)`, `fetch_drive_discs()`,
`fetch_drive_disc_detail(drive_disc_id)`, `fetch_bangboos()`,
`fetch_bangboo_detail(bangboo_id)`, `fetch_items()` — all async, all take
`use_cache: bool = True`, most take `version: str | None = None`.

> **Python version floor:** `hakushin-py` needs **>= 3.11**. The sidecar targets
> **Python 3.12** — 3.13/3.14 are ahead of what PyInstaller and these libs are
> reliably tested against.

---

## Addendum — what broke when the scaffold was run for real (2026-09-21)

Both of these were found by actually executing a sync, not by reading docs.

### 1. `hakushin-py` cannot parse live game data

`hakushin-py` 0.6.1 (March 2026) raises a Pydantic `ValidationError` on the
current ZZZ payload: its `ZZZElement` enum has no member for element `204`, and
`fetch_characters()` dies before returning.

**Resolution:** read the same CDN JSON directly and map the thin slice we need
(id, name, element, specialty, rarity) with **defensive** lookups, so an unknown
code on patch day degrades one tile instead of breaking the grid.

| Endpoint | Purpose |
| --- | --- |
| `https://static.nanoka.cc/manifest.json` | `{"zzz": {"latest", "live", "available", "new"}}` |
| `https://static.nanoka.cc/zzz/<version>/character.json` | the agent catalog |

Confirmed value mappings (spot-checked against known agents):

- **element** `200` Physical, `201` Fire, `202` Ice, `203` Electric, `204` Frost,
  `205` Ether, `300` Auric Ink
- **type** (specialty) `1` Attack, `2` Stun, `3` Anomaly, `4` Support,
  `5` Defense, `6` Rupture
- **rank** (rarity) `3` = A, `4` = S

Use `zzz.live` rather than `zzz.latest` — `latest` tracks the newest datamined
build, while recommendations are written against the live patch.

> **Open item — icons for un-owned agents.** hakush.in's published image URLs
> (including the example in `hakushin-py`'s own docstring,
> `static.nanoka.cc/zzz/UI/Mindscape_1041_3.webp`) all return 404, and
> `api.hakush.in` does not resolve. Owned agents are unaffected — HoYoLAB
> supplies their portraits. Un-owned ghost tiles currently fall back to the
> agent's initials, which suits a dimmed tile. Revisit if a working image host
> is found.

### 2. Prydwen is behind a Cloudflare bot challenge

Beyond the `/page-data` removal, prydwen.gg now actively challenges automated
clients:

- `httpx` receives **HTTP 403** with `server: cloudflare`,
  `cf-mitigated: challenge` and a "Just a moment..." interstitial — on **every**
  path, including agent pages.
- This is **not** a header problem. Varying `User-Agent`, `Accept`,
  `Accept-Language`, `Accept-Encoding` and forcing HTTP/1.1 all still 403.
  The block is on the TLS/client fingerprint.
- The same URLs return **200 via `curl`**, which is what makes the
  fingerprinting visible.

**Resolved by project decision: fetch via [webclaw](https://github.com/0xMassi/webclaw).**

webclaw is a Rust extraction CLI that requests using a browser TLS profile
(`--browser chrome`), which passes the challenge. Stated plainly: this works by
**impersonating Chrome**, i.e. circumventing an anti-bot control the site owner
deliberately enabled. robots.txt permitting `/` does not by itself settle that —
the challenge is a separate, active signal. This was chosen knowingly.

Verified end to end: 64 agent slugs discovered, and guides parsed identically to
the raw page (Miyabi and Qingyi both correct), with the 10s crawl delay honoured
between requests.

Implementation notes:

- Transport is now a separate concern (`prydwen/transport.py`) behind a
  `Transport` protocol. `WebclawTransport` and `HttpxTransport` both implement
  it; the parser never knows which ran. `build_transport()` prefers webclaw when
  installed and falls back to httpx, which then reports the block rather than
  silently returning nothing.
- **Licensing:** webclaw is AGPL-3.0 and this project is MIT. It is run as a
  **separate process**, never linked, and the binary is **not bundled** — it is
  a user-installed prerequisite found on `PATH` or via `WEBCLAW_BIN`. Bundling
  it would trigger AGPL redistribution obligations (licence text plus a
  corresponding source offer).
- The agent index is client-rendered, so webclaw returns extracted markdown for
  it rather than HTML. Slug discovery therefore matches on the URL shape and
  accepts either form. Slugs **must** come from Prydwen — slugifying catalog
  names fails on about a fifth of the roster (`anby-demara` vs `Anby`,
  `ukinami-yuzuha` vs `Yuzuha`).
- Prydwen reuses `.percentage` for two different things: a real score on
  W-Engines (sometimes `.percentage.split`, team and solo figures) and a **bare
  ordinal rank** on many agents' disc-set sections. These are parsed into
  separate `rating` and `rank` fields; conflating them renders a best-in-slot
  set as "1%".
