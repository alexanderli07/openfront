# OpenFront Helper

> GitHub: <https://github.com/nguyenvancaokyfpt/openfront-helper-userscript>
> Greasy Fork: <https://greasyfork.org/en/scripts/584309-openfront-helper-userscript>

A single `.user.js` for [OpenFront.io](https://openfront.io/) that adds **auto-join**, **in-game intelligence overlays**, and a **training bot** — all configurable from a built-in multi-language popup, no extension required.

Works with [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), and [quoid/Userscripts (Safari)](https://github.com/quoid/userscripts).

---

## Install

1. Install a userscript manager (Tampermonkey or Violentmonkey).
2. Click the install link — your manager shows the install prompt; confirm it:
   <https://raw.githubusercontent.com/nguyenvancaokyfpt/openfront-helper-userscript/main/openfront-helper.user.js>
3. Open <https://openfront.io/>. A draggable **⊕** icon appears in the corner — click it to open the settings popup.

Auto-updates via the manager's built-in `@updateURL` check.

---

## Quick Start

The **⊕ launcher** is your entry point. Click it to open the popup; drag it anywhere on screen. Four tabs:

| Tab | What it controls |
|---|---|
| **Auto-Join** | Lobby search filters and notifications |
| **Helpers** | Toggle individual overlays and panels |
| **Auto Bot** | Enable and tune the training bot |
| **Settings** | Language picker and global options |

---

## Features

### Auto-Join

Continuously polls the public lobby list and joins the first match that passes your filters. A compact floating panel shows live search status and a forecast (estimated wait time and hit rate).

**Filters:**

| Category | Options |
|---|---|
| Team size | Min / Max players per team |
| Team count | Min / Max number of teams |
| Lobby size | Minimum total players |
| Starting gold | 0 M, 1 M, 5 M, 25 M |
| Maps | 40+ individual maps (include or exclude) |
| Modifiers | Alliances, ports, nukes, SAMs, water nukes, random spawn, 4-min peace, 2× gold |

Each modifier category uses **include** mode (must match at least one selected) or **exclude** mode (skip if matched). Defaults are tuned for medium-sized Baikal and Luna matches.

Optional: **Keep searching after a match ends** + **desktop notification + chime** when a lobby is found.

---

### In-Game Overlays

Toggle each overlay independently from the **Helpers** tab. All panels are draggable and remember their position.

#### Economy

**Gold-Per-Minute (GPM) Panel** — ranked table of all players showing owned tiles, current gold, GPM, and max-troop count. Hover a row to highlight that player on the map.

**Team Build Stats Panel** — per-team structure counts (City, Port, Factory, Defense Post, SAM Launcher, Missile Silo), plus team GPM, tile %, and troop cap. Displays a prominent alert the first time any team builds a Missile Silo.

**Trade Balances** — tracks your ship and train imports/exports per partner. Color-coded: green (profitable), red (unprofitable), grey (unknown).

#### Military

**Nuke Prediction** — draws landing-zone circles for all in-flight nukes before they land. Circle color indicates type (Atom = gold, Hydrogen = blue, MIRV = magenta); stroke color indicates allegiance (cyan = yours, green = ally, red = enemy). Atom and Hydrogen show a countdown timer; blast radius rings included.

**Nuke Suggestions** — when you hover the nuke UI, highlights high-value targets for Atom, Hydrogen, or economic-destruction strikes.

**Boat Prediction** — shows where incoming and outgoing transport ships will land, color-coded by relation (your boats = blue, team = teal, ally = green, enemy = red/orange). Displays ETA from live motion plans. Each relation type has a separate "always show" toggle independent of hover.

**Warship Routes** — dashed route lines and destination markers for all warships. Same relation-based color coding. Only draws when the warship is actually moving (filters idle noise).

#### Map Intelligence

**Economy Heatmap** — WebGL overlay that colors the map by economic activity intensity (Low / Default / High).

**Export Partner Heatmap** — highlights your active trade partners on the map.

#### Alliance

**Alliance Markers** — green lines from you to each ally with a countdown to expiry; tooltip shows ally name and time remaining.

**Hovered Ally Highlight** — fills allied territory in green while you hover their name.

**Mark Bot Nations** — adds a red marker to any nation identified as an AI player.

---

### Helper Panels

**Boat Panel** — two tabs: *Sent* (boats you dispatched) and *Incoming* (boats heading toward you). Each row shows the boat, destination, and real-time ETA. Hover a row to pin-highlight it on the map.

**Estate Panel** — lists every disconnected parcel of your territory ranked by tile count. Click a row to pan the camera to that parcel. Click the column header to reverse-sort.

**Alliance Requests Panel** — separates alliance traffic from the main event log. Shows incoming requests and expiring alliances with Accept / Reject / Extend buttons. Floats on the right edge, draggable.

---

### Macro Tools

**Send 1% Boat** — right-click context menu shortcut that sends a transport ship with exactly 1% of your troops, then restores your previous attack ratio automatically.

**Auto-Nuke** — automatically fires nukes at high-value targets. Options:
- Standard auto-nuke (economy and structure targeting)
- SAM-saturation mode: runs a SAM-burn pass to exhaust enemy defenses, then a destruction wave, then optional follow-up waves
- Ally-safe toggle (skip allied territory)
- Real-time launch progress panel

**Atom Bomb Batch Fire** — configurable batch size and per-shot delay (minimum 140 ms gap, ~7 shots/sec server-safe). Settings are persisted across sessions.

**Auto Leave on Win** — automatically leaves the match when a win modal appears, pairs naturally with "keep searching" to chain games continuously.

---

### Auto-Bot

A faithful 1:1 port of the game's built-in Nation AI (`NationExecution`). Reads the live `GameView`/`PlayerView` client objects and emits the same intents as a human player. Designed for private-lobby practice, but also works in public lobbies.

Enable and configure it live in-game from the **Auto Bot** popup tab. A status log inside the panel shows every decision the bot makes in real time. Run `window.__autoBotDiag()` in the browser console to verify the bot is wired correctly.

**Behavior modules** (each can be toggled individually):

| Module | What it does |
|---|---|
| Spawn | Picks the best spawn tile automatically |
| Expand / Attack | Claims tiles, manages troop ratios, retaliates |
| Build | Constructs and upgrades structures |
| Boat | Sends and lands transport ships |
| Nuke | Selects nuke targets and fires |
| Warship | Builds and dispatches warships |
| Alliance | Requests and accepts alliances |
| MIRV | Manages MIRV warhead targeting |
| Emoji | Reacts with in-game emojis |
| Donate | Donates troops to allies |

**Configurable settings:**

| Setting | Options |
|---|---|
| Difficulty | Easy / Medium / Hard / Impossible |
| Tick speed | Decision interval in ms |
| Per-structure build | Enable/disable City, Port, Factory, Defense Post, SAM, Silo individually |
| Betray mode | Allow or block turning on allies |
| Hidden mode | Bot runs without displaying the panel |

---

### Internationalization

The Settings tab has a searchable language picker. Every language falls back to English for untranslated strings, including inside the auto-bot log and all in-game panels.

**To add a language:** copy `locales/en/common.json` to `locales/<code>/common.json`, translate the values (keep the keys as-is), rebuild — it appears in the picker automatically.

---

## Build from Source

```bash
npm install
npm run build       # → openfront-helper.user.js  (minified, the committed artifact)
npm run build:raw   # unminified + console.log debugging
npm run check       # TypeScript type-check (src/ only)
npm test            # Node smoke test
```

After any source change, rebuild and commit both the source and the regenerated `openfront-helper.user.js` — the published userscript is that file.

---

## Credits

In-game overlays and helper panels are adapted from **[phil0010-gh/openfront-helper](https://github.com/phil0010-gh/openfront-helper)** by [phil0010-gh](https://github.com/phil0010-gh). Several helper and auto-bot features — spawn scoring/heatmap, the advisor, threat intel, and map overlays — reference **[OpenFront Tactical Assistant](https://greasyfork.org/en/scripts/581664-openfront-tactical-assistant)**. The Quick Panel's silo/SAM tracker, skin unlocker, atom batch-fire, warship smart combat (battle simulation + safe waypoint BFS), low-lag mode, kill shot, and embargo controls reference **[Project Blon Openfront](https://greasyfork.org/en/scripts/580641-project-blon-openfront-cheats)** by [goonertd](https://greasyfork.org/en/users/1607113-goonertd). The auto-bot, macro tools, multi-language UI, and several additional features are original to this project.

Not affiliated with or endorsed by OpenFront.io. Use at your own discretion and in line with the game's rules.
