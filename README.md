# ZZZ Team Tracker

A local desktop app for **Zenless Zone Zero**. It signs in to *your own* HoYoLAB
account, pulls your full agent roster (mindscapes, W-Engines, Drive Discs and
their substats), fetches community build recommendations, and cross-references
the two to tell you:

- which recommended teams you can actually field right now,
- how far each of your builds is from the recommendation, and
- what to farm next.

Comic-book styling throughout. Everything runs on your machine.

> **Not affiliated with HoYoverse or Prydwen.** This is a personal, non-commercial
> hobby project. All data is fetched at runtime, on your computer, for your own
> account. Nothing is hosted, and no data is sent anywhere except to the services
> it came from.

---

## Status

Scaffolded and wired end to end; milestone 1 is functional. See
[`zzz-tracker-brief.md`](zzz-tracker-brief.md) for the full plan.

| Milestone | State |
| --- | --- |
| 1. Auth + roster fetch | Working |
| 2. Roster grid | Built, needs a live account to verify |
| 3. Character modal | Built, needs a live account to verify |
| 4. Teams tab | Built, needs a live account to verify |
| 5. Sync | Built, capped at 5/day |
| 6. QR login | Dropped. `genshin.py`'s QR helper is Chinese-Miyoushe-only, not Global HoYoLAB — cookie paste is the one auth path. |

---

## How it is put together

```
frontend/          Electron app
  main/            app lifecycle, spawns + supervises the sidecar, credential storage
  preload/         the narrow contextBridge API the UI is allowed to touch
  ui/              React + TypeScript renderer
backend/           Python FastAPI sidecar
  zzz_sidecar/
    routers/       the local HTTP API
    services/      HoYoLAB, metadata, codex lookups, sync orchestration, and the join/analysis
    prydwen/       recommendation adapter (see "About the Prydwen adapter")
    cache/         SQLite cache
  tests/           parser + analysis tests
scripts/           sidecar build, debugging helpers
```

**Why a Python sidecar?** The best-maintained HoYoLAB tooling
([`genshin.py`](https://github.com/seriaati/genshin.py)) is Python. The Electron
main process spawns the sidecar on an ephemeral **loopback-only** port and hands
the renderer a per-run token; every request must carry it, so another process on
your machine cannot drive your HoYoLAB session by guessing the port.

For release builds the sidecar is compiled with PyInstaller and shipped inside
the installer, so **users do not need Python installed**.

---

## Running it from source

Requires **Node 20+** and **Python 3.12** (3.11+ is the floor; 3.13/3.14 are
ahead of what PyInstaller and these libraries are reliably tested against).
Build recommendations additionally need **webclaw** installed — see
[Installing webclaw](#installing-webclaw).

```bash
npm install
npm run sidecar:install     # creates backend/.venv and installs Python deps
npm run dev                 # launches Electron; the sidecar starts automatically
```

Useful extras:

```bash
npm run typecheck           # main, preload and renderer
npm run sidecar:test        # parser + analysis tests
npm run sidecar:dev         # run the sidecar alone on :8777 with autoreload
npm run dist                # build the Windows installer into release/
```

### Signing in

1. Log in at [hoyolab.com](https://www.hoyolab.com).
2. Open DevTools (<kbd>F12</kbd>) → **Application → Cookies**.
3. Copy `ltoken_v2` and `ltuid_v2` into the app.

You also need HoYoLAB's **Battle Chronicle / game record** enabled for ZZZ. If it
is off, the app detects that specific case and tells you how to fix it rather
than just failing.

---

## About your cookies

**Treat HoYoLAB cookies like a password.**

- They are stored **only on your machine**, encrypted with the OS keystore
  (Windows DPAPI, via Electron's `safeStorage`).
- They are never logged, never committed, and never sent anywhere except
  HoYoLAB's own domains.
- Clearing them is one button in the app, or delete `credentials.bin` from the
  app's user-data folder.

**Honest risk framing:** a leaked HoYoLAB cookie exposes account *data* (with
email and phone partially masked). It cannot by itself take over your account —
that would also need your password, access to your email, and clearing 2FA. Real
enough to handle carefully; not catastrophic.

---

## Syncing

One **Sync** button refreshes everything: your roster and builds from HoYoLAB,
the agent catalog, and the recommendation guides. It reports per-source
progress, survives partial failure (one dead source never blanks the UI), and is
cancellable.

**It is capped at 5 full syncs per day**, resetting at local midnight and
persisted across restarts. The remaining count sits under the button. This keeps
the app a light, predictable consumer of upstream services — HoYoLAB enforces
its own per-cookie daily limit, and a cold guide refresh is slow by design at a
10-second crawl delay.

One thing sits outside the sync: the **detail pages** for a W-Engine, a disc set
or an agent's passives fetch a single small JSON file from the game-data CDN the
first time you open them, then cache it for the patch. They are behind a click
and there are well over a hundred of them, so pulling the lot on every sync to
serve the handful anyone reads would be the wasteful choice. The CDN is not
Prydwen and sets no crawl delay. Offline, those pages still open — they lose the
game text and keep the part derived from your own roster.

---

## About the Prydwen adapter

The brief originally assumed Prydwen was a Gatsby site serving structured JSON
at `/page-data/<path>/page-data.json`. **That is no longer true.** Verified
2026-09-21:

| Probe | Result |
| --- | --- |
| `/page-data/**/page-data.json` | **410 Gone** (all paths) |
| `/_next/data/**.json` | 404 — App Router, not Pages Router |
| RSC flight (`?_rsc=`, `RSC: 1`) | infinite **307** loop |
| `/api/*` | 404, and `Disallow`ed in robots.txt |
| `api.prydwen.gg` | does not resolve |

Prydwen has migrated to **Next.js**, and recommendations now exist only in
server-rendered HTML. The adapter therefore parses HTML — but it is kept honest:

- it sits behind a narrow `PrydwenSource` interface, so swapping in a JSON
  source later touches exactly one construction site;
- it targets Prydwen's **semantic, hand-authored class names** (`.zzz-set-min`,
  `.team-row`, `.single-item`), not hashed CSS-module names, so it survives
  ordinary rebuilds;
- **golden-file tests** pin every selector, so a redesign fails loudly in CI
  instead of silently producing empty recommendations;
- every field degrades independently — a changed section blanks that one field,
  not the whole guide.

Being a good citizen: robots.txt sets `Crawl-delay: 10`, so requests are
**serialized with a 10s gap**, results are cached aggressively in local SQLite
keyed by patch, and the `User-Agent` identifies this project and links back here.
Prydwen's ToS grants a limited licence for personal, non-commercial use; a local
per-user app is within that grant. **Cached content stays on your machine** and
is gitignored — it is not redistributed.

### Cloudflare, and the webclaw transport

As of 2026-09-21 prydwen.gg runs an active Cloudflare bot challenge. Plain
`httpx` gets **403** with `cf-mitigated: challenge` on every path, regardless of
`User-Agent`, `Accept`, `Accept-Language`, `Accept-Encoding` or HTTP version —
the check is on the TLS/client fingerprint, and it fires on the very first
request, not after any volume of them.

Fetching therefore goes through [**webclaw**](https://github.com/0xMassi/webclaw),
which requests using a browser TLS profile and passes. Be clear about what that
means: **it works by impersonating Chrome**, which circumvents an anti-bot
control the site owner deliberately enabled. That was a deliberate choice for
this project, not a default — `HttpxTransport` is still in the tree as the
honest, non-impersonating option, and the transport is selected in exactly one
place ([`transport.py`](backend/zzz_sidecar/prydwen/transport.py)).

Rate limiting still applies on top: requests are serialized with the robots.txt
10-second crawl delay, guides are cached by patch, and full syncs are capped at
5 per day.

#### webclaw is not bundled, on purpose

webclaw is **AGPL-3.0**; this project is MIT. Two consequences:

- It is invoked as a **separate process**, never linked as a library, so it does
  not make this codebase a derivative work.
- The binary is **not shipped in the installer**. Redistributing an AGPL binary
  would oblige this project to carry the AGPL licence text and a corresponding
  source offer. Keeping it a user-installed prerequisite avoids that entirely
  and keeps this MIT repo clean.

If you ever decide to bundle it, settle those obligations first.

#### Installing webclaw

```bash
# any one of these
brew tap 0xMassi/webclaw && brew install webclaw
cargo install --git https://github.com/0xMassi/webclaw.git --locked webclaw-cli
# or download a prebuilt binary from the project's GitHub releases
```

The app looks for it in three places, in order:

1. the `WEBCLAW_BIN` environment variable, pointing at the executable,
2. anywhere on `PATH`,
3. `tools/webclaw.exe` in this repo — gitignored, so dropping a copy there is a
   local convenience and is never committed.

Without it the app still runs; the sync just reports the block and the
recommendation views stay empty.

If you are from Prydwen and would like to discuss this, please open an issue.

---

## What is never committed

The `.gitignore` covers this from the start, but to be explicit — the repo
contains **no** cookies or credential files, **no** UIDs or account dumps, **no**
cache database or fetched JSON/HTML, and **no** game art or Prydwen assets.
Icons are fetched at runtime. The app ships empty and populates itself.

The checked-in parser fixture is **synthetic** — invented agent and set names in
real DOM shape — for the same reason.

---

## Licence

[MIT](LICENSE). That covers **this code only** — not the upstream game data,
recommendations, or artwork, which belong to their respective owners.

Built on [`genshin.py`](https://github.com/seriaati/genshin.py) and
[`hakushin-py`](https://github.com/seriaati/hakushin-py) by seriaati.
