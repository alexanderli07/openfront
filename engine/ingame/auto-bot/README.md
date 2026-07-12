# Auto-Bot

Training tool for OpenFront lobbies. Plays the local human
player automatically (auto-spawn, auto-expand / conquer, auto-build, nukes,
warships, alliances) by reading the client-side `GameView`/`PlayerView` and
emitting the same intents the UI emits. Strategy mirrors the in-game "Nation"
bot (see `src/core/execution/NationExecution.ts` and friends in the game repo).

> **Lobby scope:** the `isPublicLobby` gate in `helpers.js` is **disabled**, so
> the engine runs in **public lobbies too** (not just Private / Singleplayer).
> Feature-level public restrictions ported from the src AI Nation have also been
> lifted where they don't apply to a human-played bot — e.g. auto-donate now runs
> in public **Team** lobbies (the server allows troop donation there), gated only
> by the real `config().donateTroops()` rule. To re-lock to private only, restore
> `isPublicLobby` in `helpers.js`.

## Architecture

These are **classic page-context scripts**, not ES modules — there is no bundler
for `page-bridge/`. Each file is loaded as its own `<script>` (see
`content/auto-join.js` → `bridgeScripts`, and `manifest.json` →
`web_accessible_resources`) and they **share one global lexical scope**, exactly
like every other `page-bridge/*.js` file (`runtime.js`, `alliances.js`, …). A
function or `const` declared at the top of one module is visible to all the
others; cross-module state is shared through object references (`state`,
`_ctors`, `_alliancesActioned`). Each file is `"use strict"`.

**Load order matters** and is fixed in `bridgeScripts` / `web_accessible_resources`:

| # | Module | Responsibility |
|---|--------|----------------|
| 1 | `core.js` | `UNIT`, the shared `state` object, tuning constants, settings load/save. Loaded **first** — its `state` initializer runs `loadSettings()` at load time. |
| 2 | `i18n.js` | `tr(key, params)` translation + `setAutoBotI18n(lang, bundle)`. Loaded right after core so every later module can call `tr()`. |
| 3 | `context.js` | Game/UI handle discovery, intent-constructor discovery, `emitIntent`, `window.__autoBotDiag()`. |
| 4 | `helpers.js` | Lobby gate (`gameType`/`isPublicLobby`) and small shared helpers (`clamp`, `toNum`, game-speed `scaled`, `safeName`, `withTimeout`, …). |
| 5 | `sensing.js` | Reading game state: border tiles, ocean-adjacency, border analysis, bounding boxes. |
| 6 | `spawn.js` | Spawn phase. |
| 7 | `combat.js` | Expand / conquer: land targeting, retaliation, bot attacks, hostility, embargo, donate, boat landings. |
| 8 | `build.js` | Economy/defense building: structure priority, value-scored placement, upgrades, perceived-cost gating. |
| 9 | `nuke.js` | Nuclear strategy: targeting, SAM-saturation launch-sequence sim, MIRV, retaliation. |
| 10 | `warship.js` | Naval: fleet building and warship dispatch (home defense, escort, trade raiding). |
| 11 | `alliance.js` | Accept/renew, proactively court strong players, constructor capture. |
| 12 | `engine.js` | Engine tick orchestration, start/stop, enable, status & action log. |
| 13 | `panel.js` | Floating control panel UI (control/log tabs, sliders, drag). |
| 14 | `lifecycle.js` | Watcher + bootstrap. Loaded **last** — the only module that executes at load time (guarded by `window.__openfrontAutoBotLoaded`). |

Only three things run at load time: `state`'s initializer (core), the
`window.__autoBotDiag` assignment (context), and the guarded bootstrap
(lifecycle). Everything else is a declaration called later at runtime, so module
order between `core` and `lifecycle` is otherwise free.

## Internationalization

All user-visible strings go through `tr(key, params)` (in `i18n.js`), where the
key is the **English source text** (with `{placeholders}`) — the same
convention the rest of the extension uses. English source lives in
`shared/i18n.js` `DEFAULT_TRANSLATIONS`; translations live in
`locales/<lang>/common.json`. The bot runs in the page context and can't fetch
locale bundles, so `content/core.js` posts the bundle for the active language
(`SET_AUTO_BOT_I18N`) and the bot follows the extension's language setting. A
missing translation falls back to the readable English key. The function is
named `tr` (not `t`) because `t` is used everywhere as a `TileRef` variable.

## Smoke test

After reloading the extension, run `window.__autoBotDiag()` in the page console.
It touches `state`, the lobby gate, constructor discovery and many helpers across
modules — if it returns a full object, the wiring is intact.
