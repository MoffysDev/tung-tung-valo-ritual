<div align="center">
  <img src="https://media.valorant-api.com/weapons/9c82e19d-4575-0200-1a81-3eacf00cf872/displayicon.png" width="300" alt="Vandal" />
  <h1>🎯 Tung Tung Tracker</h1>
  <p><strong>A local, read-only Valorant tracker that links your performance to your skins.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/API-read--only-brightgreen" alt="Read-only" />
    <img src="https://img.shields.io/badge/data-100%25%20local-blue" alt="Local data" />
    <img src="https://img.shields.io/badge/Python-3.10+-yellow" alt="Python 3.10+" />
    <img src="https://img.shields.io/badge/tests-pytest%20%2B%20node-informational" alt="Tests" />
  </p>
</div>

## Overview

**Tung Tung Tracker** runs on your PC next to Valorant and keeps a permanent local history of your matches. Its signature feature: **it knows which skin you had equipped in each match**, so it can tell you whether you really frag harder with your Kuronami Vandal or your Prime one.

## Features

| | |
|---|---|
| 📊 **Dashboard** | Player card banner, rank with RR ring, peak rank, act record. 8 KPIs (winrate, K/D, ACS, ADR, HS%, KAST…) with sparklines and a trend versus your previous matches. ACS + K/D chart (hover any bar), best agent, recent matches, highlights (first bloods, clutches, aces, multi-kills, best streak), top agents, maps and weapons. |
| 🕒 **History** | Every match grouped by day with daily record and RR, filterable by result / agent / map, searchable by player, map or agent, with a summary of the selection (winrate, K/D, ACS, net RR). Click a match for the full scoreboard (ACS, parties, ranks, MVP), your detailed stats and kills per weapon with the skin you used. Import up to 100 older matches in one click. |
| 🧑‍🚀 **Agents** | Portrait cards for your mains plus a sortable table (matches, winrate, K/D, KDA, ACS, ADR, HS%, KAST, first bloods, playtime). Click an agent for its detail: stats versus your average, per-map results, recent matches. |
| 🔫 **Locker** | Every weapon with your equipped skin (exact chroma) and its kills. Click a weapon to rank all the skins you've used with it (kills/match weighted by sample size). |
| 🕵️ **Live** | Opens automatically in agent select: agents (locked or not), ranks + RR, peak rank, act winrate, level, Vandal/Phantom/knife skins, your party, and **players you've already met** (with/against). Players in streamer mode stay hidden. |
| 🔎 **Filters** | Every view can be filtered by game mode and period (current act, 30 days, 7 days, today). |

## Getting started

**Windows, easiest:** download `TungTungTracker.exe` from the [latest release](https://github.com/MoffysDev/tung-tung-valo-ritual/releases/latest) and double-click it. Nothing to install: the server starts in the background and the tracker opens in its own window (closing the window stops everything). Your data is stored in a `db\` folder next to the exe.

> Windows SmartScreen may warn about an unsigned app on first launch: click *More info* → *Run anyway*.

**Build the exe yourself:** run `build.bat` once. It produces `dist\TungTungTracker.exe`, a single file you can put anywhere. Double-click it: the server starts in the background and the tracker opens in its own window (closing the window stops everything). Your data is stored in a `db\` folder next to the exe, so copy your existing `db\` there to keep your history.

Alternatively, `start.bat` runs it from source (creates a virtual environment, installs dependencies, opens the app).

**Manual:**

```bash
git clone https://github.com/MoffysDev/tung-tung-valo-ritual.git
cd tung-tung-valo-ritual
pip install -r requirements.txt
python app.py
```

The dashboard opens at <http://127.0.0.1:5000>. Launch Valorant (or just the Riot Client) and your last 20 matches are imported automatically.

| Option | Effect |
|---|---|
| `--port 5001` | Use another port |
| `--browser` | Open in your web browser instead of the app window |
| `--offline` | Browse your saved stats without contacting Riot |
| `--no-browser` | Server only, open nothing |
| `--data PATH` | Store the database somewhere else (default: `db/`) |
| `--verbose` | Debug logs |

Designed for desktop screens. Keyboard shortcuts: `1`–`5` switch pages, `R` syncs now, `Esc` closes a dialog.

## How it works

```
Riot Client (lockfile) ──► tracker/worker.py ──► db/*.json ──► Flask API ──► static/ (browser)
          ▲                 background sync loop     local       /api/state      ES modules,
          └── local API + Valorant remote endpoints  database    /api/matches    no build step
```

- **One background thread** does all the Riot calls. The browser only reads cached state from the local server, so opening several tabs never multiplies requests.
- **Presence-driven polling:** the game phase (menus, agent select, in game) comes from the *local* chat presence. Remote endpoints are only called when something actually changes; history is re-checked every 90 s, plus a few quick retries right after a match ends.
- **Rate-limit aware:** timeouts on every request, `Retry-After` handling on HTTP 429, player ranks cached for 10 minutes, and spacing between match downloads.
- **Skin attribution:** your loadout is locked the moment a match is detected. For matches the tracker didn't see live, it uses the latest loadout snapshot taken before the match started (flagged as *estimated* when there is none).
- **Storage:** one JSON file per collection under `db/`, written atomically (no corruption if the PC crashes). Corrupted files are copied aside instead of silently discarded. Databases from v1 are migrated automatically; the old files are moved to `db/backup-v1-*/`.

### Project layout

```
app.py                 entry point (CLI)
tracker/
  riot.py              Riot Client auth, region detection, HTTP (timeouts, 429, token refresh)
  parser.py            pure functions: match details → stats (ACS, ADR, KAST, clutches…), loadouts, MMR
  worker.py            background sync loop, live match, history import
  storage.py           JSON database, atomic writes, migrations
  static_data.py       agents/weapons/skins/maps/ranks from valorant-api.com (fr-FR), cached on disk
  server.py            Flask API + security headers
static/                frontend (HTML/CSS/ES modules, no framework)
tests/                 pytest (backend) + node:test (stats)
```

## Releasing

Pushing a tag such as `v2.0.1` makes GitHub Actions run the tests, build `TungTungTracker.exe` on Windows and attach it to a new release:

```bash
git tag v2.0.1
git push origin v2.0.1
```

## Development

```bash
pip install pytest
python -m pytest          # backend: parser, storage/migrations, worker with a fake Riot client
node --test tests/stats.test.mjs   # frontend stats
```

## Privacy & compliance

- **Read-only.** The tracker only reads data. Every Riot request is a `GET`, except `name-service`, which Riot exposes as a `PUT` that only *reads* display names (the game client does the same). Nothing is ever written to your account, and the game's memory is never touched.
- **Streamer mode respected.** Names of players in streamer mode are never requested nor stored, and their hidden account level stays hidden.
- **Local only.** Your data stays in `db/` on your PC. The web server only listens on `127.0.0.1`, rejects requests addressed to other hostnames (DNS-rebinding protection) and has no CORS, so websites you visit can't read your stats.

This is a personal, educational project using Riot's unofficial client APIs, in the same spirit as tools like VRY or WAIUA. It isn't endorsed by Riot Games. Keep it read-only: automating actions (instalock, changing loadouts, etc.) would break Riot's terms. **Use at your own risk.**

<div align="center">
  <br>
  <i>Developed with ❤️ for the Valorant community.</i>
</div>
