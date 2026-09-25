<video src="resources/vid.mp4" controls muted width="100%"></video>

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

Working end to end against a real HoYoLAB account. See
[`zzz-tracker-brief.md`](zzz-tracker-brief.md) for the original project brief —
some of what's below (the Disks tab, Farm Together, the codex pages) came after
it, so treat the brief as historical context, not a current feature list.

| Area | State |
| --- | --- |
| Auth + roster fetch | Working |
| Characters tab (roster grid, build-gap modal) | Working, verified against a live account |
| Teams tab (fieldable / suggested, synergy) | Working, verified against a live account |
| Disks tab (set catalog, Farm Next, Farm Together) | Working, verified against a live account |
| Codex (W-Engine / disc set / agent drill-down pages) | Working |
| Sync | Working, capped at 10 full syncs/day per account |
| QR login | Dropped. `genshin.py`'s QR helper is Chinese-Miyoushe-only, not Global HoYoLAB — cookie paste is the one auth path. |

---

## How it is put together

```
frontend/          Electron app
  main/            app lifecycle, spawns + supervises the sidecar, credential storage,
                    browserFetch.ts (the BrowserWindow transport's Electron half)
  preload/         the narrow contextBridge API the UI is allowed to touch
  ui/              React + TypeScript renderer (Characters / Teams / Disks tabs, codex pages)
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

**It is capped at 10 full syncs per day, per HoYoLAB account**, resetting at
local midnight and persisted across restarts. The remaining count sits under
the button. This keeps
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

Being a good citizen: robots.txt sets `Crawl-delay: 10`, so requests are
**serialized with a 10s gap**, results are cached aggressively in local SQLite
keyed by patch, and the `User-Agent` identifies this project and links back here.
Prydwen's ToS grants a limited licence for personal, non-commercial use; a local
per-user app is within that grant. **Cached content stays on your machine** and
is gitignored — it is not redistributed.

### Cloudflare, and how each transport handles it

As of 2026-09-21 prydwen.gg runs an active Cloudflare bot challenge. Plain
`httpx` gets **403** with `cf-mitigated: challenge` on every path, regardless of
`User-Agent`, `Accept`, `Accept-Language`, `Accept-Encoding` or HTTP version —
the check is on the TLS/client fingerprint, and it fires on the very first
request, not after any volume of them.

[**primp**](https://github.com/deedy5/primp) is a Rust-backed HTTP client with
Python bindings that requests using a browser TLS profile and passes. 

**primp is a local development convenience — it is not what the public
installer ships with.** It's the default for `npm run dev`, kept because it's a
fast, in-process HTTP call rather than spinning up a real browser window on
every guide fetch. The build anyone downloads from GitHub instead uses the
`browser` transport (a real Electron `BrowserWindow` clearing Cloudflare's
challenge honestly — see "Switching Prydwen transport modes" below), which is
the one actually worth trusting at public scale. `HttpxTransport` is a third,
fully honest option, kept for a host that doesn't challenge at all. All three
implement the same interface and the choice is made in exactly one place
([`transport.py`](backend/zzz_sidecar/prydwen/transport.py)).

Rate limiting applies to every transport, not just primp: requests are
serialized with the robots.txt 10-second crawl delay, guides are cached by
patch, and full syncs are capped at 10 per day, per account.

primp is **MIT-licensed**, so — unlike the webclaw CLI this project used until
2026-09-22 — it is just a normal pip dependency: no separate process, no
user-installed binary, no licence-boundary bookkeeping. `npm run sidecar:install`
pulls it in like any other backend requirement, whether or not a given run
ever actually uses it.

If you are from Prydwen and would like to discuss this, please open an issue.

### Switching Prydwen transport modes

There are three transports (`backend/zzz_sidecar/prydwen/transport.py`):

| Transport | What it does | Used when |
| --- | --- | --- |
| `primp` | Impersonates a Chrome TLS fingerprint, in-process | `npm run dev` / `npm run sidecar:dev` (the default for local iteration) |
| `browser` | Loads the page in a real Electron `BrowserWindow`, so Cloudflare's challenge is cleared honestly instead of spoofed | Packaged builds (`npm run dist`) — the default for anyone downloading the installer |
| `httpx` | Plain, honestly-identified HTTP, no impersonation | Opt-in only; currently Cloudflare-blocked |

**Selection is automatic** — `frontend/main/sidecar.ts`'s `resolvePrydwenTransport()` picks `browser` when `app.isPackaged` is true and `primp` otherwise, then passes it to the sidecar as `--prydwen-transport`. Nothing to do at packaging time; `npm run dist` already produces a `browser`-mode build.

**To test the `browser` path locally**, without a full package-and-install cycle, set `ZZZ_PRYDWEN_TRANSPORT` before starting dev mode:

```powershell
$env:ZZZ_PRYDWEN_TRANSPORT = 'browser'
npm run dev
```

This spins up a hidden `BrowserWindow` (`frontend/main/browserFetch.ts`) the first time a guide is fetched. It stays hidden if Cloudflare's ordinary invisible JS challenge clears on its own; if Cloudflare ever serves an interactive one instead, the window is shown so you can click through it, then hides again. A cleared challenge's `cf_clearance` cookie is kept in a persistent session partition (`persist:prydwen-fetch`), so this is normally a one-time thing per machine, not per sync.

**Verified, not just designed this way:** a full 59-guide resync through a packaged build, `browser` transport, cleared Cloudflare's challenge automatically on every single request — the window never had to show itself once.

Unset the variable (or just don't set it) to go back to `primp` for day-to-day dev work — `browser` is slower per-request (a real page load vs. a bare HTTP call) and unnecessary once you've confirmed it works.

`httpx` remains available as an explicit opt-out for either mode via `--prydwen-transport httpx`, kept honest and unused by default.

**Choosing what `npm run dist` bakes into the installer.** `ZZZ_PRYDWEN_TRANSPORT` above is a *runtime* switch — it only ever affects the process it's set for, dev or packaged. What an installer permanently ships with is a separate, **build-time** decision: `ZZZ_DIST_TRANSPORT`, read once while `npm run dist` compiles and compiled into the app as a literal (`electron.vite.config.ts`'s `define`) — not something later readable or overridable from the installed app's environment.

Set it either as a real environment variable, or — easier to not forget about, since a shell variable silently outlives the terminal session and would leak into your *next* build too — as a `.env` file in the repo root (already gitignored):

```powershell
# Your own build, with primp baked in:
echo "ZZZ_DIST_TRANSPORT=primp" > .env
npm run dist

# The public build: delete the file (or just never create it) and rebuild.
# browser is the default the moment ZZZ_DIST_TRANSPORT isn't set to anything.
rm .env
npm run dist
```

Whichever you have set last (env var takes priority over `.env` if both exist) is what that build gets — there is no runtime toggle in the shipped app itself, so double check which one you intend before publishing an installer.

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
