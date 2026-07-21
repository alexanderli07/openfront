# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A standalone **userscript** for [OpenFront.io](https://openfront.io/) that bundles three feature sets into one `openfront-helper.user.js` file: **auto-join** (poll the public lobby list and join the first match for your filters), **in-game overlays** (gold-per-minute, team build stats, trade balances, nuke/boat prediction, heatmaps, …), and an **auto-bot** (a private/public-lobby training bot configurable live in-game). It runs under Tampermonkey / Violentmonkey / Userscripts with `@grant none`, so everything executes in one page context — there is no extension background.

## Commands

```bash
npm install
npm run build        # → openfront-helper.user.js (minified)   — the committed artifact
npm run build:raw    # unminified build (readable engine + console.log); OFH_DEBUG=1 also triggers raw
npm run check        # tsc --noEmit  (type-checks src/**/*.ts ONLY — engine JS is not type-checked)
npm run check:i18n   # audit which locale keys are missing vs. engine t()/tr() usage
npm test             # node test/smoke.mjs — builds the shell IIFE in a mocked DOM and asserts the shims wire up
npm run format       # prettier --write (engine/ and locales/ are prettier-ignored on purpose)
```

There is no test runner/framework and no single-test command — `npm test` is one Node smoke script. The auto-bot has its own in-browser smoke check: run `window.__autoBotDiag()` in the page console; a full object back means the bot wiring is intact.

**The build output `openfront-helper.user.js` is committed to the repo** (see `.gitignore`). After changing any source, rebuild and commit the regenerated file along with your changes — the published userscript is this file, not the sources.

## Two worlds: `src/` (shell) and `engine/`

The codebase has two deliberately separate halves that `build.mjs` stitches together. Understanding this split is the key to the whole project.

### `src/shell/` — TypeScript, ES modules, bundled by esbuild

This is the userscript-manager-facing layer. It re-creates the WebExtension APIs the engine was originally written against, because the engine came from a Chrome extension but here runs with no background page:

- **`chrome-shim.ts`** — a fresh `chrome.*` / `browser.*` object (storage, runtime, tabs, action). Never mutates the page's real `window.chrome.runtime` (non-writable on Chrome). The engine reads it through `window.__OFH.chrome`.
- **`messaging.ts`** — collapses `chrome.runtime`/`chrome.tabs` messaging into a single in-page bus (one page context ⇒ a "message" is just a call into a listener set).
- **`storage.ts`** — `chrome.storage.local` over `localStorage` with cross-tab sync + `onChanged`.
- **`audio.ts`** — Web Audio shim; recognizes a `BEEP_SENTINEL` to synthesize the join chime.
- **`i18n.ts`**, **`assets.ts`**, **`notification.ts`**, **`viewport.ts`**, **`popup/`** — i18n override, game-asset URL resolution (via the game's live `ASSET_MANIFEST` / `CDN_BASE`), OS notifications, viewport clamping, and the launcher (`⊕` icon) + settings popup UI.

`index.ts` is the entry: it installs the shims and publishes the bridge surface the engine relies on:
`window.__OFH = { chrome, Audio, WebAudioElement, installI18nOverride }`, plus globals `__OFH_gameIconUrl`, `__OFH_openPopup`, `__OFH_requestNotifyPermission`.

### `engine/` — classic JS scripts, no modules, shared lexical scope

Ported from a WebExtension's content scripts + page bridge. **No `import`/`export`** — files are concatenated and run in one shared scope, so a top-level `const`/`function`/`class` in one file is visible to all siblings; cross-file state is shared through object references. The build wraps the engine in two `try/catch` IIFEs that are **NOT `"use strict"`** (the originals were sloppy-mode classic scripts). `prettier` is configured to **skip `engine/` and `locales/`** — do not reformat them. Two layers, emitted in this order (lobby first so auto-join survives an in-game fault):

- **Lobby layer** (`map-data.js`, `shared/settings.js`, `shared/i18n.js`, `lobby/*`): auto-join logic + the floating auto-join panel. Talks to the shell via `window.__OFH.chrome`.
- **In-game layer** (`ingame/**`): overlays, helper panels, and the auto-bot. `bootstrap.js` (emitted last) is the `window.postMessage` router — it listens for source-tagged messages (`openfront-autojoin-extension` / `…-page`) and toggles each feature (`SHOW_GOLD_PER_MINUTE`, `SET_AUTO_NUKE`, `SET_AUTO_BOT_I18N`, …). `ingame/companion/` (`core.js`, `commands.js`, `actions.js`, `engine.js`, `panel.js`, loaded in that order, last before `quick-panel.js`) is the Companion Bot: a "slave" tab that supports a named "boss" account (auto-donate, auto-alliance, ring-spawn, boss-target follow-attack, emoji-triggered commands), plus optional Active-mode hooks into the auto-bot's spawn/alliance decisions. Whenever Companion mode is on for a tab, it pins an always-on, non-dismissible warning banner (`pointer-events: none`) across the top of the screen so a mistaken click on the wrong tab is never silent.

**The exact file order in `build.mjs` (`LOBBY_FILES` / `INGAME_FILES`) is load order and it matters.** If you add an engine file, insert it in the right position in those arrays — there is no auto-discovery for engine files (only locales are auto-discovered).

## Build output anatomy (`build.mjs`)

The single `.user.js` is assembled as:

1. `// ==UserScript==` metadata header (`@match https://openfront.io/*`, `@run-at document-start`, `@inject-into page`, `@grant none`).
2. `window.__OFH_ASSETS = { version, locales }` — **all** `locales/<code>/common.json` inlined (auto-discovered; `en` is required as the fallback).
3. Shell IIFE — `esbuild` bundle of `src/shell/index.ts`.
4. Lobby IIFE — concatenated lobby files (sloppy mode, `try/catch`-wrapped).
5. In-game IIFE — concatenated `engine/ingame/**` (sloppy mode, `try/catch`-wrapped).

Minification (when not raw) does `minifyWhitespace` + `minifyIdentifiers` but **`minifySyntax: false`** on purpose — syntax folding risks perturbing the sloppy-mode concatenated-scope semantics for ~2% size. Don't enable it.

## Internationalization

Translation **keys are the English source string itself** (with `{placeholders}`), not symbolic IDs. English source lives in `engine/shared/i18n.js` `DEFAULT_TRANSLATIONS`; per-language overrides live in `locales/<lang>/common.json`. **Adding a language = drop in `locales/<code>/common.json` and rebuild** — no code change (the build auto-discovers it and it appears in the picker). Missing keys fall back to English, so `check:i18n` never fails the build on missing keys (it's advisory).

The auto-bot runs in page context and can't fetch locale bundles, so the lobby layer posts the active bundle to it (`SET_AUTO_BOT_I18N`). In bot code the translate function is **`tr(key)` not `t(key)`** — because `t` is used everywhere as a `TileRef` variable.

## Auto-bot (`engine/ingame/auto-bot/`)

The most intricate subsystem and the one most likely to need care. It is a **faithful 1:1 port of OpenFront's in-game "Nation" AI** (`src/core/execution/*Behavior.ts` in the game repo). It plays the local human player by reading the client-side `GameView`/`PlayerView` and emitting the same intents the UI emits.

**Before modifying or porting bot behavior, read `engine/ingame/auto-bot/PORT-CONTRACT.md` and `engine/ingame/auto-bot/README.md`.** Key rules from the contract:

- Translation must be **1:1 faithful** — preserve every branch, constant, probability, strategy order, and call order. The only permitted changes are the mechanical API substitutions documented there. If something can't be reproduced client-side, leave a `// DIVERGENCE:` comment rather than silently approximating.
- Behaviors are classic scripts with **fixed class names + constructor signatures** (`nationExecution.js` constructs them) and a **fixed load order** in `build.mjs`.
- Player/owner identity compares by `.smallID()`, not `===`. Gold is `bigint`.
- The async boundaries (`buildables`/`canBuild`, `bestTransportShipSpawn`, other players' `borderTiles()`, `actions`) are the only places control flow may differ from src — use the documented **rank-then-probe** pattern and wrap in `withTimeout(...)`.

## Conventions

- 2-space indent, LF endings, UTF-8, final newline (`.editorconfig`); prettier `printWidth: 100`, `trailingComma: all`.
- `.gitattributes` marks the built `.user.js` and `locales/**/common.json` as generated/`-diff` — expect them to be excluded from diffs.

## Attribution

In-game overlays/helper panels are adapted from [phil0010-gh/openfront-helper](https://github.com/phil0010-gh/openfront-helper). Several helper and auto-bot features (spawn scoring/heatmap, advisor, threat intel, map overlays) reference [OpenFront Tactical Assistant](https://greasyfork.org/en/scripts/581664-openfront-tactical-assistant). Companion Bot (`engine/ingame/companion/`) takes its idea and tuning constants from [Openfront Multitab cheat](https://greasyfork.org/scripts/587654) by EcoMaxer (MIT), itself built on Project Blon. The auto-bot, the multi-language vanilla UI, and several features are original to this project.
