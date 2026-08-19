# Build notes — dependency analysis and removal plan

Reference for this build: auto-join + auto-bot + three helper categories
(build/missile/attack timings · missile/boat/warship routes · money & troop capacity),
built at 575 KB vs 1322 KB for `main`.

This is the analysis the removals were executed from. It documents **load-order invariants**,
the files that look removable but are not, and the silent-degradation cases — all of which are
expensive to rediscover, because `engine/**` is concatenated into one shared scope where a
missing symbol either throws at message-dispatch time or fails silently behind a `typeof` guard.

Read alongside `../CLAUDE.md` and `../engine/ingame/auto-bot/PORT-CONTRACT.md`.

Notes on what shipped differently from this plan:
- `quick-panel.js` was **kept** as the settings control surface (this plan proposed deleting it);
  24 dead toggle rows and the Companion section were pruned from it instead.
- `retaliation-hud.js` was **kept** as an attack-timing display.
- `silo-sam-tracker.js` was deleted, but its accurate `constructionStartTick` read and real
  `SAMCooldown()` lookup were ported into `build-timer.js` — see §7 risk 6 for why that mattered.
- `@updateURL` is per-branch (`build.mjs`); it points at this build's branch.

---

Repo root: `C:\Users\AlexLi\Downloads\Claude\openfront-helper-src` — all paths below are relative to it. Verified against `build.mjs`, and against a fresh TypeScript-AST reverse-dependency pass over the proposed keep set (script: `C:\Users\AlexLi\AppData\Local\Temp\claude\C--Users-AlexLi-Downloads-Claude\97b4a737-7f8d-4a4e-883a-3b1ef56b450a\scratchpad\verify.mjs`, read-only). Nothing in the repo was modified.

---

# 1. FINAL `INGAME_FILES` (37 entries, exact load order)

This is a strict **subsequence of the current array** — every kept file stays in its current relative position, so no ordering hazard is introduced (no new TDZ, no collision-winner flip except the 5 documented in §7).

```js
const INGAME_FILES = [
  "anti-afk.js",
  "runtime.js",
  "ws-hook.js",
  "panel-layout.js",
  "shared-utils.js",
  "selective-trade-policy.js",
  "nuke-prediction.js",
  "boat-prediction.js",
  "warship-routes.js",
  "boat-panel.js",
  "auto-leave.js",
  "auto-bot/core.js",
  "auto-bot/i18n.js",
  "auto-bot/helpers.js",
  "auto-bot/context.js",
  "auto-bot/sensing.js",
  "auto-bot/portutil.js",
  "auto-bot/gameApi.js",
  "auto-bot/emojiBehavior.js",
  "auto-bot/allianceBehavior.js",
  "auto-bot/mirvBehavior.js",
  "auto-bot/warshipBehavior.js",
  "auto-bot/structureBehavior.js",
  "auto-bot/attackBehavior.js",
  "auto-bot/nukeBehavior.js",
  "auto-bot/nationExecution.js",
  "auto-bot/engine.js",
  "auto-bot/panel.js",
  "auto-bot/lifecycle.js",
  "map-overlay-scheduler.js",
  "advisor-intel.js",
  "name-overlay.js",
  "attack-highlight.js",
  "nuke-trajectory.js",
  "build-timer.js",
  "spawn-heatmap.js",
  "bootstrap.js",
].map((f) => `engine/ingame/${f}`);
```

Load-order invariants preserved (do not reorder):
- `anti-afk.js` **must stay first** — it monkey-patches `window.setInterval`/`clearInterval` onto a Web-Worker timer hub. Every later `window.setInterval` caller (`runtime.js` helper tick, `boat-panel.js`, `auto-leave.js`, `bootstrap.js`, the auto-bot) silently loses background-tab keepalive if it moves.
- `map-overlay-scheduler.js` **must precede** `name-overlay.js`, `attack-highlight.js`, `nuke-trajectory.js`, `build-timer.js`, `spawn-heatmap.js` — all five call `registerMapOverlayLayer({...})` **at load time**, which pushes into the `const _mapOverlayLayers` declared in the scheduler. Moving any earlier = TDZ `ReferenceError` that kills the whole in-game IIFE.
- `nuke-prediction.js`, `boat-prediction.js`, `warship-routes.js` stay **before** the scheduler (they run their own `requestAnimationFrame` loops; the scheduler's only reference into them, `resetScreenPointPool`, is typeof-guarded).
- `advisor-intel.js` before `name-overlay.js`; `name-overlay.js` before `attack-highlight.js` (`troopsDisplay`); `nuke-prediction.js` before `nuke-trajectory.js` (`getNukePredictionRelation`, unguarded).
- `bootstrap.js` last.

# 2. FINAL `LOBBY_FILES` — **UNCHANGED**

```js
const LOBBY_FILES = [
  "engine/map-data.js",
  "engine/shared/settings.js",
  "engine/shared/i18n.js",
  "__I18N_OVERRIDE__",
  "engine/lobby/core.js",
  "engine/lobby/floating-autojoin.js",
  "engine/lobby/auto-join.js",
];
```

All six files are the auto-join feature set. `engine/lobby/floating-autojoin.js` **is** the auto-join panel; it references only `engine/lobby/auto-join.js` + `engine/lobby/core.js` and touches no helper setting except `showFloatingAutoJoinPanel`. The lobby IIFE is a separate scope from the in-game IIFE (verified: zero cross-layer bare-name edges), so nothing you delete from `INGAME_FILES` can reach it. Do not touch it.

# 3. ENGINE FILES TO DELETE

**31 built in-game files** (~21,300 lines top-level + 2,122 companion):

| # | File | Why |
|---|---|---|
| 1 | `engine/ingame/alliances.js` | ally hover markers — panel/overlay, out of scope |
| 2 | `engine/ingame/alliance-requests-panel.js` | panel |
| 3 | `engine/ingame/bot-markers.js` | overlay, out of scope |
| 4 | `engine/ingame/gold-per-minute.js` | player-stats / top-GPM **panels** |
| 5 | `engine/ingame/team-build-stats.js` | panel |
| 6 | `engine/ingame/trade-balances.js` | panel |
| 7 | `engine/ingame/nuke-suggestions.js` | 7,723-line suggestion overlay + auto-nuke menu patch |
| 8 | `engine/ingame/estate-panel.js` | panel |
| 9 | `engine/ingame/boat-macro.js` | send-1%-boat macro |
| 10 | `engine/ingame/heatmaps.js` | economy / export-partner heatmaps |
| 11 | `engine/ingame/signal-scheduler.js` | only consumers are #12/#13 |
| 12 | `engine/ingame/helper-users-panel.js` | panel |
| 13 | `engine/ingame/sos-defense.js` | outbound emoji automation |
| 14 | `engine/ingame/advisor-panel.js` | panel |
| 15 | `engine/ingame/retaliation-hud.js` | retaliate card + auto-counter-attack action |
| 16 | `engine/ingame/hide-ads.js` | modifies the game's default UI |
| 17 | `engine/ingame/attack-ratio-hotkey.js` | hotkey feature |
| 18 | `engine/ingame/alliance-policy.js` | only consumer is #19 |
| 19 | `engine/ingame/right-click-conquest.js` | context menu + attack actions |
| 20 | `engine/ingame/round-logger.js` | tooling |
| 21 | `engine/ingame/network-logger.js` | tooling |
| 22 | `engine/ingame/enemy-intent-intel.js` | **renders nothing** — `getEnemyIntentWarnings`/`getActiveEnemyIntentWarning`/`processWsMessage` have zero callers |
| 23 | `engine/ingame/game-time-alert.js` | match-clock alert, not build/missile/attack timing |
| 24 | `engine/ingame/silo-sam-tracker.js` | 1,414-line Silo/SAM **panels** + auto-fire automation |
| 25 | `engine/ingame/auto-donate.js` | automation |
| 26 | `engine/ingame/companion/core.js` | Companion Bot |
| 27 | `engine/ingame/companion/commands.js` | Companion Bot |
| 28 | `engine/ingame/companion/actions.js` | Companion Bot |
| 29 | `engine/ingame/companion/engine.js` | Companion Bot |
| 30 | `engine/ingame/companion/panel.js` | Companion Bot |
| 31 | `engine/ingame/quick-panel.js` | 1,936-line tabbed **panel** (its 35 out-edges are all typeof-guarded, so removal is clean) |

**2 files already on disk but NOT in `build.mjs`** — delete so nobody re-adds them:
- `engine/ingame/nuke-landing-zones.js` (296 lines) — stale predecessor of `nuke-prediction.js`; re-declares `const NUKE_UNIT_TYPES` + 8 more. Adding it to `INGAME_FILES` would be a **duplicate-`const` SyntaxError that kills the entire in-game IIFE**.
- `engine/ingame/auto-bot/atomMacro.js` (12 lines) — dead stub.

**Non-engine deletions required by the above:**
- `test/companion.mjs` — `fs.readFileSync`s the 5 companion paths at lines 105, 461, 683-685, 1073-1076, 1987-1988, 2022-2023, 2447-2448.
- `package.json` → change `"test": "node test/smoke.mjs && node test/companion.mjs"` to `"test": "node test/smoke.mjs"`. **`npm test` hard-fails ENOENT otherwise.** (`CLAUDE.md:17` is stale — it claims `npm test` is smoke-only.)

# 4. FILES THAT MUST BE KEPT DESPITE NOT BEING USER-FACING

| File | One-line reason |
|---|---|
| `engine/ingame/runtime.js` | Hub (36 in-edges): `EXTENSION_SOURCE`, all `*Enabled` flags, all DOM ids, `registerHelperTickListener`, `toFiniteNumber`. |
| `engine/ingame/shared-utils.js` | Hub (24 in-edges): `getCachedPlayerViews`, `getPlayerRelationToMyPlayer`, `getPlayerColor`, `getPlayerDisplayName`, `getPlayerSmallId`, `isNationBotPlayer`, `getPlayerGoldNumber`. |
| `engine/ingame/selective-trade-policy.js` | Sole declarer of **`getOpenFrontGameContext`** — 27 in-edges, the one API every kept overlay uses to reach the live `GameView`; also answers `APPLY_SELECTIVE_TRADE_POLICY`/`SET_SELECTIVE_TRADE_POLICY` and drives `refreshCheatsAvailability` called bare from `bootstrap.js:258-259`. |
| `engine/ingame/map-overlay-scheduler.js` | Owns the shared canvas + `registerMapOverlayLayer`/`requestMapOverlayLoop`/`mapWorldToScreen`/`mapPointOnScreen`/`mapProject`/`mapMakeProjector`/`mapFactionColor`/`drawMapHaloText` for all five kept map layers. |
| `engine/ingame/advisor-intel.js` | Data layer for the kept money/troop-capacity readout — `name-overlay.js:82,99,100,101,106` calls `advTroops`/`advTroopsInCombat`/`advMaxTroops`/`advGoldNumber`/`advEvaluateThreat`/`advNukeBuilderIds` **bare**. Deleting it with `advisor-panel.js` destroys the money overlay. |
| `engine/ingame/boat-panel.js` | **`boat-prediction.js:716, 731, 976, 985` calls `maybeWarnNewIncomingBoats` and `resetIncomingBoatWarningBaseline` BARE.** `_boatUseCanvas` is hard-coded `true` and `syncBoatPrediction` is reassigned to the canvas renderer at :947, so :976/:985 are the live sites, both **before** the `rAF` reschedule — a `ReferenceError` there stops the boat-route overlay **permanently** (self-heal is impossible: `refreshBoatOverlayActivity` only restarts when `boatLandingAnimationFrame === null`, and it holds a stale non-null id). Ship it with `showBoatPanel: false`. |
| `engine/ingame/spawn-heatmap.js` | **Auto-bot dependency.** `auto-bot/core.js:78` defaults `smartSpawn: true`; `auto-bot/nationExecution.js:272-274` and `:390-394` call `getSpawnHeatmapTopSpots` / `computeSpawnTopSpotsForBot` **typeof-guarded** → deleting it silently reverts the bot to unscored spawning with zero diagnostics. `computeSpawnTopSpotsForBot` is explicitly documented to work with the overlay disabled (`spawn-heatmap.js:468-470`), so ship it with both overlay toggles off. |
| `engine/ingame/auto-bot/nukeBehavior.js` | Declares **`UniversalPathFinding`** (line 317) — the parabola factory behind *every* ETA in the product: `nuke-prediction.js` `computeNukeRemainingTicks`, the `nuke-trajectory.js` arc, `lifecycle.js` `estimateFlightTicks`. Guarded, so removal silently deletes all missile ETAs. |
| `engine/ingame/auto-bot/lifecycle.js` | Auto-bot boot + `window.__OFH_autobot` (the bridge `src/shell/popup/panel.ts:958-983` uses to show/configure the bot panel) + `window.__autoBotDiag`. Its `_quickPanelSettingsCache` read at :1381 is `typeof … === "object"`-guarded **inside** a `try` → safe after `quick-panel.js` is deleted. |
| `engine/ingame/auto-bot/sensing.js` | Zero in-edges (dead: `getBorderTiles`/`isOceanAdjacent`/`analyzeBorder`/`boundingBox` superseded by `portutil.js` `calculateBoundingBox`). Keep anyway — `auto-bot/README.md` + `PORT-CONTRACT.md` document a fixed load order, and 104 lines buys zero risk. Optional removal. |
| `engine/ingame/anti-afk.js` | Not a panel; the `setInterval → Web Worker` patch is what keeps the auto-join poll and the auto-bot tick alive in a background tab. Must remain `INGAME_FILES[0]`. |
| `engine/ingame/ws-hook.js` | Only kept consumer is `anti-afk.js:105-108` (`isSocketConnected`/`sendRawPacket`, typeof-guarded) — it is the transport for the 15 s hidden-tab keep-alive ping. Removing it silently downgrades anti-AFK to the Worker path only. `getLastKnownTile` / `_setSkinUnlockerEnabled` become dead but harmless. |
| `engine/ingame/panel-layout.js` | Self-contained one-shot `localStorage` seeder; the only surviving seed that matters is the auto-bot panel position (`openfront-helper-autobot-v1` → `blob.pos`). Zero coupling either way. |
| `engine/ingame/auto-leave.js` | Self-contained (46 lines, zero cross-file refs); it is the "leave on team win → auto-join finds the next match" half of the auto-join loop. Answers `SET_AUTO_LEAVE_ON_TEAM_WIN`. |

**Silent-degradation cases you are accepting (guarded refs into deleted files — no crash, no console error):**
- `auto-bot/allianceBehavior.js:204, 286, 325, 452` → `companionAllianceVeto` (companion/engine.js). Inert unless the user had `companionEnabled: true`; the bot regains the ability to ally with non-boss players.
- `auto-bot/nationExecution.js:309-310` → `companionSpawnCenter`. Same gating.
- `auto-bot/allianceBehavior.js:149-152` → `allianceRequestsPanelEvents`. **The typeof guard is useless** — the array is declared in `runtime.js:236`, so the guard passes and the array is simply always empty. The bot loses one of three alliance-event sources.
- **Loudest one:** deleting `alliance-requests-panel.js` also removes a hook with *no symbol footprint*. `alliance-requests-panel.js:983-993` discards regular-bot alliance requests "**before Vue processes them… prevents Vue watchers from auto-accepting bot alliance requests**", and `:1001-1004` writes `eventsDisplay.events = remainingEvents`, mutating the game's own `<events-display>`. `AllianceBehavior` exists partly to *reject* regular-bot requests ("they spam defensively, blocking attacks against them"). After removal the native Vue path is restored and can auto-accept bot alliance requests before the bot's next tick rejects them — a silent auto-bot strategy regression that no symbol graph can see. Accept it, or keep `alliance-requests-panel.js` with `showAllianceRequestsPanel: false` (the suppression runs from its capture path, so verify it still fires when the panel is hidden before relying on that).
- `spawn-heatmap.js:151-152` → `processWsMessage` becomes `null`. Already dead today (`enemy-intent-intel.js` deliberately stopped patching `window.WebSocket`, so `spawnHeatmapProcessWsMessage` is never called), so `_spawnPlayerPositions` is already always empty. **Zero real loss.**
- `bootstrap.js:230-246` → `setCompanionPanelVisible` / `setCompanionEnabled` / `setQuickPanelEnabled` / `setQuickPanelSettings`, all typeof-guarded.

# 5. KEPT FEATURES → GATING SETTINGS KEYS → DEFAULT CHANGES

| Kept feature file | Gating key(s) in `engine/shared/settings.js` | Current default | Change? |
|---|---|---|---|
| `build-timer.js` — 🏗 construction countdown + ⟳ missile cooldown over Silos/SAMs | `showBuildTimers` (L76) | `true` | **no change** |
| `nuke-prediction.js` — landing zone + `· {eta}s` time-to-impact | `showNukePrediction` (L84) | `true` | **no change** |
| `nuke-trajectory.js` — missile flight arc (needs **both** flags) | `showNukeTrajectory` (L85) + `showNukePrediction` | `true` / `true` | **no change** |
| `boat-prediction.js` — transport routes + landing markers + hover ETA | `showBoatPrediction` (L87) | `true` | **no change** |
| ↳ per-relation "always show route" sub-flags | `alwaysShowOwnBoatRoutes` (L93) | `true` | no change |
| | `alwaysShowTeamBoatRoutes` (L94) | `false` | **→ `true`** ("all the routes") |
| | `alwaysShowAllyBoatRoutes` (L95) | `false` | **→ `true`** ("all the routes") |
| | `alwaysShowEnemyBoatRoutes` (L96) | `true` | no change |
| `warship-routes.js` — warship routes + destination markers | `showWarshipRoutes` (L88) + `showWarshipRoutesOwn/Team/Ally/Enemy` (L89-92) | all `true` | **no change** |
| `name-overlay.js` — money pill (`$…`) + `/maxTroops` = **total troop capacity** + troop ratio bar | `showPlayerMapOverlays` (L63) master | `true` | no change |
| | `showMapMoney` (L66) | `true` | no change |
| | `showMapTroopCounts` (L64) | `true` | no change |
| | `showThreatIndicators` (L65) | `true` | **→ `false`** (☢/danger dots are out of scope; the file stays, `drawThreatMarks` is only reached when this is on) |
| `attack-highlight.js` — incoming-attack rings + dashed attacker lines + `⚔ {total}` incoming troops | `showAttackHighlight` (L67) | `true` | **no change** |
| `boat-panel.js` — kept as a dependency; incoming-boat attack alert only | `showBoatPanel` (L97) | `true` | **→ `false`** (it is a panel) |
| | `warnIncomingBoats` (L98) | `true` | no change — transient center-screen alert, in scope for "attack timings". Flip to `false` if you want it gone. |
| `spawn-heatmap.js` — kept as auto-bot spawn-scoring dep | `showSpawnHeatmap` (L78) | `false` | no change |
| | `showSpawnMarkers` (L79) | `true` | **→ `false`** (numbered spawn markers are out of scope; the bot path does not need them) |
| `anti-afk.js` | `antiAfk` (L71) | `true` | **no change** |
| `auto-leave.js` | `autoLeaveOnTeamWin` (L52) | `false` | no change (user preference) |
| `selective-trade-policy.js` — kept as the `getOpenFrontGameContext` hub | `selectiveTradePolicyEnabled` (L81), `autoCancelDeniedTradesAvailable` (L82), `cheatsAvailable` (L83) | `false` / `true` / `true` | **no change** — leave the feature off |
| `auto-bot/*` — the auto-play panel | `showAutoBotPanel` (L191) mirror; real state is `state.settings.hidden` in `localStorage["openfront-helper-autobot-v1"]`; i18n via `SET_AUTO_BOT_I18N` | `true` | **no change**. Re-show after clicking X is still reachable: `src/shell/popup/panel.ts:980-983` ("Show auto-bot panel" → `window.__OFH_autobot.set({hidden:false})`). |
| `auto-bot/lifecycle.js` atom-batch hotkey | `atomBatchHotkey` (L114) | `"Backslash"` | **KEEP THE KEY** — read at `lifecycle.js:1381` with a `localStorage` fallback |
| lobby / auto-join panel | `enabled`, `showFloatingAutoJoinPanel`, `joinNotification`, `keepAutoJoinAfterMatch`, `minTeamSize`, `maxTeamCount`, `mapFilters`, `includeFilters`, `excludeFilters`, … | — | **no change** |
| `map-overlay-scheduler.js` low-lag path | `lowLagMode` (L165) — read **directly** from `localStorage["ofh:settings"]` at `map-overlay-scheduler.js:36-37` | `false` | keep the key; it stays functional but loses its only UI (the Quick Panel). Add it to the popup if you want it reachable. |
| `ws-hook.js` skin unlocker | `skinUnlocker` (L164) — read directly from `localStorage["ofh:settings"]` at `ws-hook.js:149-152` | `false` | keep the key; loses its only UI. Note it self-arms at load from stored settings. |

**Required code edit inside a KEPT file (do not skip — this is the only one):**

`engine/ingame/boat-panel.js:190-191`, inside `ensureBoatPanel()`, calls two functions declared **only** in the deleted `gold-per-minute.js`, **bare**:
```js
    makeGoldStatPanelDraggable(panel, header, BOAT_PANEL_POS_KEY);
    applyStoredGoldStatPanelPosition(panel, BOAT_PANEL_POS_KEY);
```
Replace with typeof guards (or delete both lines — the panel just stops being draggable):
```js
    if (typeof makeGoldStatPanelDraggable === "function") makeGoldStatPanelDraggable(panel, header, BOAT_PANEL_POS_KEY);
    if (typeof applyStoredGoldStatPanelPosition === "function") applyStoredGoldStatPanelPosition(panel, BOAT_PANEL_POS_KEY);
```

**Optional hygiene edit:** `engine/ingame/runtime.js:278-286` `canStationTradeWith` calls `canPlayersTrade`, which is declared only in the deleted `trade-balances.js`. Nothing calls `canStationTradeWith` after the removals (its only live caller was `trade-balances.js:655`), so it is dead code, not a crash. Deleting `canStationTradeWith` (and optionally `getHeatmapTypePriority`, `addEconomicSource`, `_getEconomicSourceIndex`, `_economicSourceIndexes`, `getUnitLevel`) removes the dangling reference. `toFiniteNumber` must **stay** (used by `getUnitLevel` and it becomes the collision winner — see §7).

# 6. DEAD SETTINGS KEYS AND `bootstrap.js` MESSAGE TYPES

## 6a. `bootstrap.js` — 22 blocks that MUST be deleted (bare setter → guaranteed uncaught `ReferenceError`)

`bootstrap.js:3` opens `window.addEventListener("message", …)` as a **flat, un-`try`/`catch`ed if-chain**; the build's IIFE `try/catch` returned long before. Each helper arrives as its own `postMessage`, so a throw is contained to that one message — but `engine/lobby/core.js` `syncHelpers()` (L783-826) posts **all 43 unconditionally** on every startup and every settings save, so each is a guaranteed error every sync. Delete these blocks **bottom-up** so line numbers stay valid:

| Lines | Message type | Dangling setter (declaring file) |
|---|---|---|
| 206-208 | `SHOW_EXPORT_PARTNER_HEATMAP` | `setExportPartnerHeatmapEnabled` (heatmaps.js) |
| 201-204 | `SHOW_ECONOMY_HEATMAP` | `setEconomyHeatmapIntensity`, `setEconomyHeatmapEnabled` (heatmaps.js) |
| 197-199 | `SET_SEND_1_PERCENT_BOAT` | `setSend1PercentBoatEnabled` (boat-macro.js) |
| 193-195 | `SET_AUTO_NUKE` | `setAutoNukeEnabled` (nuke-suggestions.js) |
| 189-191 | `SHOW_NUKE_SUGGESTIONS` | `setNukeSuggestionsEnabled` (nuke-suggestions.js) |
| 181-183 | `SHOW_ESTATE_PANEL` | `setEstatePanelEnabled` (estate-panel.js) |
| 123-125 | `SHOW_ENEMY_INTENT` | `setEnemyIntentEnabled` (enemy-intent-intel.js) |
| 115-117 | `SET_NETWORK_LOGGER` | `setNetworkLoggerEnabled` (network-logger.js) |
| 111-113 | `SET_ROUND_LOGGER` | `setRoundLoggerEnabled` (round-logger.js) |
| 107-109 | `SET_RIGHT_CLICK_CONQUEST` | `setRightClickMenuEnabled` (right-click-conquest.js) |
| 103-105 | `SET_ATTACK_RATIO_HOTKEY` | `setAttackRatioHotkeyEnabled` (attack-ratio-hotkey.js) |
| 95-97 | `SET_HIDE_ADS` | `setHideAdsEnabled` (hide-ads.js) |
| 91-93 | `SHOW_RETALIATION_HUD` | `setRetaliationEnabled` (retaliation-hud.js) |
| 87-89 | `SHOW_ADVISOR_PANEL` | `setAdvisorPanelEnabled` (advisor-panel.js) — note `engine/lobby/core.js:305-315` posts this **even when `showAdvisorPanel` is false** |
| 63-65 | `SHOW_GAME_TIME_ALERT` | `setGameTimeAlertEnabled` (game-time-alert.js) |
| 59-61 | `SET_SOS_DEFENSE` | `setSosDefenseEnabled` (sos-defense.js) |
| 55-57 | `SHOW_HELPER_USERS` | `setHelperUsersEnabled` (helper-users-panel.js) |
| 51-53 | `SHOW_TRADE_BALANCES` | `setTradeBalancesEnabled` (trade-balances.js) |
| 47-49 | `SHOW_ALLIANCE_REQUESTS_PANEL` | `setAllianceRequestsPanelEnabled` (alliance-requests-panel.js) |
| 43-45 | `MARK_HOVERED_ALLIES_GREEN` | `setAllyMarkersEnabled` (alliances.js) |
| 39-41 | `SHOW_TEAM_BUILD_STATS` | `setTeamBuildStatsEnabled` (team-build-stats.js) |
| 35-37 | `SHOW_TOP_GOLD_PER_MINUTE` | `setTopGoldPerMinuteEnabled` (gold-per-minute.js) |
| 31-33 | `SHOW_GOLD_PER_MINUTE` | `setGoldPerMinuteEnabled` (gold-per-minute.js) |
| 27-29 | `MARK_BOT_NATIONS_RED` | `setBotMarkersEnabled` (bot-markers.js) |

(24 rows; two blocks carry two setters each.)

## 6b. `bootstrap.js` — 4 blocks that are already typeof-guarded (safe to leave, prune for cleanliness)

- `244-248` `SYNC_QUICK_PANEL_SETTINGS`
- `238-242` `SHOW_QUICK_PANEL`
- `229-236` `SET_COMPANION`
- `135-146` `SHOW_MY_GPM_HISTORY` — **already dead today**: `setSelfGpmHistoryEnabled`/`setSelfGpmHistoryPanelPosition` exist nowhere in the repo, and nothing posts the message. Its `else` branch logs a stale extension-era `console.error`.

## 6c. `bootstrap.js` — blocks that MUST STAY

`13-25 JOIN_PUBLIC_LOBBY` (**this is auto-join — deleting it kills the whole feature**), `67-69 SHOW_PLAYER_MAP_OVERLAYS`, `71-73 SHOW_MAP_TROOP_COUNTS`, `75-77 SHOW_THREAT_INDICATORS`, `79-81 SHOW_MAP_MONEY`, `83-85 SHOW_ATTACK_HIGHLIGHT`, `99-101 SET_ANTI_AFK`, `119-121 SHOW_BUILD_TIMERS`, `127-129 SHOW_SPAWN_HEATMAP`, `131-133 SHOW_SPAWN_MARKERS`, `148-153 SHOW_NUKE_PREDICTION`, `155-162 SHOW_BOAT_PREDICTION`, `164-171 SHOW_WARSHIP_ROUTES`, `173-175 SHOW_BOAT_PANEL`, `177-179 SET_BOAT_INCOMING_WARNING`, `185-187 SET_AUTO_LEAVE_ON_TEAM_WIN`, `211-217 APPLY_SELECTIVE_TRADE_POLICY`, `219-221 SET_SELECTIVE_TRADE_POLICY`, `223-227 SET_AUTO_BOT_I18N`, `250-254 RELOCALIZE_PANELS`, `257-264` (the 1 s interval — `refreshSelectiveTradePolicyAvailability`/`refreshCheatsAvailability` are bare calls into the kept `selective-trade-policy.js`).

**`_relocalizeAllPanels` (bootstrap.js:269-291) needs NO edit.** Every `set:` is typeof-guarded *and* every `enabled()` probe reads a flag declared in `runtime.js` (which survives), so the 8 deleted entries silently no-op. Optionally trim the array to the `buildTimer` and `boatPanel` entries. Do prune the two guarded `window.__OFH_updateSiloSamTracker` / `window.__OFH_tickAutoDonate` lines at `:260-261`.

## 6d. `engine/shared/settings.js` — `DEFAULT_SETTINGS` keys that become dead

Pruning is **optional** (a stale key is inert once `bootstrap.js` has no handler), but keeping it means every one still round-trips through `normalizeSettings` and still renders a popup row that does nothing. Delete:

`markBotNationsRed` · `showGoldPerMinute` · `showTopGoldPerMinute` · `showTeamBuildStats` · `markHoveredAlliesGreen` · `showAllianceRequestsPanel` · `showTradeBalances` · `showHelperUsers` · `showGameTimeAlert` · `gameTimeAlertThresholdSec` · `showAdvisorPanel` · `showRetaliationHud` · `hideAds` · `attackRatioHotkey` · `rightClickConquest` · `roundLogger` · `networkLogger` · `showEnemyIntent` · `sosDefense` · `showNukeSuggestions` · `showEstatePanel` · `autoNuke` · `autoNukeIncludeAllies` · `send1PercentBoat` · `showEconomyHeatmap` · `economyHeatmapIntensity` · `showExportPartnerHeatmap` · `showQuickPanel` · `quickPanelActiveTab` · `killShotInstantSend` · `killShotHotkey` · `embargoAutoRepeat` · `autoWarshipEnabled` · `autoWarshipHuntTrade` · `autoWarshipEvade` · `autoWarshipRetreatHealthPct` · `preAttackingEnabled` · `preAttackingDoubleClick` · `combatSiloPanel` · `combatSiloShowAll` · `combatSiloBuildingOnly` · `combatSiloAudioAlert` · `combatSiloOneClickFire` · `combatSiloAutoFireBuilding` · `combatSiloAutoFireMaxQty` · `combatSamTracker` · `combatSamShowAll` · `combatSamBuildingOnly` · `combatSamOneClickFire` · `combatSamAutoFireBuilding` · `combatSamAutoFireMaxQty` · `chatLoopEnabled` · `chatLoopIntervalMs` · `chatLoopTarget` · `autoDonateEnabled` · `autoDonateKeepPct` · `autoDonatePercentage` · `autoDonateTargets` · `autoDonateGoldEnabled` · `autoDonateGoldThreshold` · `autoDonateGoldPercentage` · `autoDonateGoldTargets` · `showCompanionPanel` · `companionEnabled` · `guiAccentColor` · `guiAccentHue` · `guiOpacity` · `overlayOpacity` · `rainbowMode`

Plus keys that are **already dead today** (verified: only `settings.js` references them): `boatScanInterval`, `missileScanInterval`, `nukeScanInterval`, `uiUpdateInterval`, `combatPct1`, `combatPct2`, `combatPct3`, `combatPct4`, `lobby3x2Grid`, and the `floating-helpers.js`-era `showFloatingHelpersPanel` / `floatingHelpersPanelPosition` / `floatingHelpersPanelHeight` (stubbed out in `build.mjs:210-212`).

If you delete `economyHeatmapIntensity` / `gameTimeAlertThresholdSec`, also drop `normalizeEconomyHeatmapIntensity` / `getEconomyHeatmapIntensityLabel` / `normalizeGameTimeAlertThreshold` from `settings.js` (L224-242, L232-238, L476-481, L504-509) **and** their `engine/lobby/core.js` callers. **Keep** `atomBatchHotkey`, `lowLagMode`, `skinUnlocker`, `showThreatIndicators`, `showAutoBotPanel`, `collapsedHelperCategories`.

## 6e. Matching cleanup outside `engine/ingame/`

- `engine/lobby/core.js` — delete the 32 dead `sync*Helper()` functions (`syncBotNationMarkers` L80, `syncGoldPerMinuteHelper` L93, `syncCompanionHelper` L106, `syncTopGoldPerMinuteHelper` L120, `syncTeamBuildStatsHelper` L133, `syncHoveredAlliesHelper` L146, `syncAllianceRequestsPanelHelper` L159, `syncTradeBalancesHelper` L172, `syncHelperUsersHelper` L186, `syncSosDefenseHelper` L199, `syncGameTimeAlertHelper` L226, `syncAdvisorPanelHelper` L305, `syncRetaliationHudHelper` L318, `syncHideAdsHelper` L331, `syncAttackRatioHotkeyHelper` L357, `syncRightClickConquestHelper` L370, `syncRoundLoggerHelper` L383, `syncNetworkLoggerHelper` L396, `syncEnemyIntentHelper` L422, `syncEstatePanelHelper` L521, `syncNukeSuggestionsHelper` L547, `syncAutoNukeHelper` L560, `syncSend1PercentBoatHelper` ~L571, `syncEconomyHeatmapHelper` L588, `syncExportPartnerHeatmapHelper` L602, `syncQuickPanelHelper` L615, `syncQuickPanelSettings` L630) and their call sites in `syncHelpers()` (L783-826) + `loadSettings()` (L849). **This is cleanup, not a correctness requirement** — orphan `postMessage`es are silent no-ops once `bootstrap.js` drops the handlers. Keep `syncQuickPanelSettings` only if you also keep the `ofh-quick-panel-setting` listener (L644+), which `auto-bot/panel.js:504` still fires when the bot panel's X is clicked.
- `src/shell/popup/panel.ts` — delete the rows for every key in §6d, or they render as toggles that persist a setting nothing consumes: the whole `key:"panels"` group except nothing (L202-256: `showTopGoldPerMinute`, `showGoldPerMinute`, `showTeamBuildStats`, `showTradeBalances`, `showAdvisorPanel`, `showBoatPanel`→set to off, `showEstatePanel`, `showAllianceRequestsPanel`, `showHelperUsers`, `showQuickPanel`); in `key:"map"`: `showSpawnHeatmap` L360, `showSpawnMarkers` L365, `showEconomyHeatmap` L375, `showExportPartnerHeatmap` L380; the whole `key:"combat"` group L397-440 (`autoNuke`, `autoNukeIncludeAllies`, `showNukeSuggestions`, `showRetaliationHud`, `sosDefense`, `send1PercentBoat`, `rightClickConquest`, `attackRatioHotkey`); in `key:"alerts"`: `showGameTimeAlert` L448, `gameTimeAlertThresholdSec` L453, `showEnemyIntent` L459; in `key:"tools"`: `hideAds` L475, `roundLogger` L482, `networkLogger` L487. Keep `antiAfk`, `warnIncomingBoats`, `showThreatIndicators` (now default-off), and the whole Auto Bot tab (L957-983).
- `src/shell/viewport.ts:8-19` — `PANEL_SELECTORS` still lists `#openfront-helper-team-build-stats`, `#openfront-helper-alliance-request-panel`, `#openfront-helper-auto-nuke-process`, `#openfront-helper-stats-container`, `#openfront-helper-trade-balance-badge`. Harmless (`querySelectorAll` no-ops); trim to `#openfront-helper-auto-bot-panel`, `#openfront-helper-floating-autojoin-panel`, `#openfront-helper-launcher`.
- `engine/shared/i18n.js` `DEFAULT_TRANSLATIONS` + `locales/*/common.json` — many keys orphan (e.g. `"Script users"`, `"Nuke incoming"`, `"Game-time alert"`, `"Push in"`, the `COMPANION*` block at `i18n.js:358-404`). `npm run check:i18n` only fails on **missing** keys (`scripts/audit-i18n.mjs:79`), so this is cosmetic.
- `engine/ingame/panel-layout.js:45-53` — seeds `…advisor-panel-pos`, `…boat-panel-pos`, `…estate-panel-pos`, `…alliance-request-panel-pos`, `…team-build-stats-pos`, `…quick-panel-pos` for panels that no longer exist. Harmless; trim if you want.
- Rebuild and **commit `openfront-helper.user.js`** — it is the published artifact (`CLAUDE.md:23`).

# 7. RESIDUAL RISKS, RANKED

**1 — THE MOST LIKELY WAY THIS BUILD BREAKS: `engine/ingame/boat-panel.js:190-191`.** It is the *only* bare reference from a kept file into a deleted file, and it is **not** in `bootstrap.js`, so it is the one every checklist misses. `makeGoldStatPanelDraggable` / `applyStoredGoldStatPanelPosition` live in the deleted `gold-per-minute.js`. `setBoatPanelEnabled(true)` sets `boatPanelOpen = true` on line 337 and then throws on line 340 → `ensureBoatPanel()` → line 190, so lines 341-348 never run: `boatPanelUpdateTimer` stays `null`, `refreshBoatOverlayActivity()` is never called, the throw escapes `bootstrap.js:174` uncaught, **and `boatPanelOpen` is left stuck `true`** — which forces `isBoatOverlayActive()` on forever, including outside a match. If you forget to set `showBoatPanel: false`, this fires on the very first `syncHelpers()` for every user. Apply the §5 typeof-guard patch **and** flip the default. Verify by loading a match with the browser console open: zero `ReferenceError`.

**2 — A missed bare setter in `bootstrap.js`.** 24 dangling calls across 22 blocks (§6a), each posted unconditionally by `engine/lobby/core.js` `syncHelpers()` on every load *and* every settings save. The blast radius is bounded — each helper is its own `postMessage`, so the auto-join bridge, the auto-bot, and the other overlays survive — but you get a repeating uncaught error stream and a silently dead toggle. Two traps: `SHOW_ADVISOR_PANEL` is posted even though `showAdvisorPanel` defaults to `false` (`core.js:305-315` sends `enabled: Boolean(...)` regardless of value), and `SHOW_ECONOMY_HEATMAP` carries **two** setters on one block. Grep the finished `bootstrap.js` for every `set…Enabled(` and confirm each identifier still has a declaring file in `INGAME_FILES`.

**3 — `isTeamGame` collision winner flips (real, silent behavior change).** `selective-trade-policy.js:60` and `nuke-suggestions.js:717` both declare top-level `function isTeamGame(game)` with **genuinely different bodies**. `nuke-suggestions.js` loads later, so it wins today, and `selective-trade-policy.js:191` / `:227` currently execute *its* body (`game?.config?.().gameConfig?.().gameMode === "Team"` — different property path, case-sensitive, silent `false` on throw), not the 130-lines-above one. Deleting `nuke-suggestions.js` restores `selective-trade-policy.js`'s own version (reads `config().gameMode`, normalizes case, handles `"ffa"`/`"free for all"`, falls back to counting alive team ids). This changes `isSelectiveTradePolicyAvailable()` and `isAllowedTradePartnerForMyPlayer()`, i.e. the `SELECTIVE_TRADE_POLICY_AVAILABILITY` postMessage and popup toggle visibility. It is almost certainly a **fix**, and `selectiveTradePolicyEnabled` defaults `false` — but it is a behavior delta to expect, not a bug to chase. (The `isTeamGame` hits in `auto-bot/warshipBehavior.js:416` and `auto-bot/emojiBehavior.js:159` are **local** `const`s — no cross-file coupling, verified.) The other four flips are benign: `toFiniteNumber`, `canStationTradeWith`, `getHeatmapTypePriority` fall back from `heatmaps.js` to `runtime.js`, and `normalizeEconomyHeatmapIntensity` from `heatmaps.js` to `shared-utils.js` — all byte-identical after comment/whitespace normalization. **Duplicate top-level declarations remaining in the keep set: zero.**

**4 — Auto-bot alliance strategy regresses with no symbol footprint.** Covered in §4: `alliance-requests-panel.js` was pre-filtering regular-bot alliance requests out of the game's own `<events-display>` before Vue could auto-accept them (`:983-993`, `:1001-1004`), which is exactly what `AllianceBehavior` wants. After removal the native Vue path is restored. Also `allianceRequestsPanelEvents` (`runtime.js:236`) is now permanently empty and the typeof guard at `allianceBehavior.js:149` passes anyway, so the bot loses one alliance-event source silently. And `alliance-requests-panel.js:361, 1033` (`setAllianceRequestsAutoRenewEnabled` / `autoRenewAllianceRequestPanelEvents`) was the **only** auto-renew of expiring alliances anywhere in the bundle. Watch the bot's alliance log for the first few matches.

**5 — `npm test` / `npm run build` hard-fail if the removals are not atomic.** `build.mjs:216` does a `readFileSync` per `INGAME_FILES` entry → a stale entry is a loud `ENOENT` (good). `package.json` `test` runs `node test/companion.mjs`, which `readFileSync`s the 5 companion paths → `ENOENT` unless you delete it and update the script in the **same commit**. `npm run check` (tsc over `src/**` only) is unaffected. `npm run check:i18n` is advisory (never non-zero on orphan keys).

**6 — Timing accuracy degrades in the kept build.** Deleting `silo-sam-tracker.js` removes the only countdown that reads the **real** `unit.state.constructionStartTick`; what survives is `build-timer.js`'s first-seen approximation — it records `game.ticks()` the first time it *observes* `isUnderConstruction()`, so enabling the toggle, joining, or reconnecting mid-build **restarts the countdown from full duration and over-reports remaining time**. `build-timer.js:12` also hard-codes `BUILD_TIMER_COOLDOWN_TICKS = 90` and never consults `game.config().SAMCooldown()`. You also lose the only per-target missile-in-flight ETA (`🚀×N · ⏱Xs`). MIRV warheads are deliberately excluded from the nuke ETA (`NUKE_ETA_TYPES` in `nuke-prediction.js`) — they still get a count marker, no seconds.

**7 — Global monkey-patches you are keeping.** `ws-hook.js` replaces `window.WebSocket`, locks `window.fetch` via `defineProperty`, and lazily swaps `JSON.parse` on join; `anti-afk.js` replaces `window.setInterval`/`clearInterval`. Both are current shipped behavior, so this is not a new risk — but `ws-hook.js`'s only remaining consumer is `anti-afk.js`'s guarded keep-alive ping, so it is the highest-surface / lowest-value file in the keep set. If you drop it, `anti-afk` degrades silently (Worker timers keep working; the 15 s hidden-tab ping stops) — it will not crash.

**8 — Judgment calls, each a one-line revert.** (a) `attack-highlight.js` is kept as the "attacks" display but shows **incoming attackers + total incoming troops, no seconds** — if "timings of attacks" meant an ETA, nothing in the repo provides one and `computeBoatEtaMs` would be the reusable primitive. (b) `hide-ads.js` is deleted on the strict reading that ads are part of the game's default UI. (c) `warnIncomingBoats` is kept `true` as an attack-timing toast; flip to `false` for a fully silent build. (d) `boat-panel.js` and `spawn-heatmap.js` ship present-but-disabled rather than deleted, so a user who flips `showBoatPanel`/`showSpawnMarkers` in stored settings resurrects a panel/overlay you intended gone. (e) `auto-bot/sensing.js` is dead code kept for load-order fidelity.

**9 — Cosmetic leftovers, no runtime impact.** Dead-but-harmless code in kept files: `runtime.js`'s ~30 unused DOM-id/interval consts (`HELPER_STATS_*`, `GOLD_PER_MINUTE_*`, `TRADE_BALANCE_*`, `ECONOMY_HEATMAP_*`, `NUKE_SUGGESTION_*`, `ALLIANCE_*`, `_qpSync`, the 10 unused `Map`/`Set`/`WeakMap` trackers); `shared-utils.js`'s `getHoveredPlayerInfoOverlay`, `escapeCssIdentifier`, `getPlayerMarkerId`, `findPlayerByTradeName`, `getPlayerTeamName`; `ws-hook.js`'s `getLastKnownTile` and `_setSkinUnlockerEnabled`; `boat-prediction.js:882-884`'s DOM boat-ETA label (shadowed by the canvas renderer since `_boatUseCanvas` is `true`); the `boat-panel.js` panel half itself. Also: the `"use strict"` directives in all 18 auto-bot files are **inert** after concatenation (the in-game IIFE starts with `anti-afk.js`, which has none) — `auto-bot/README.md` and `PORT-CONTRACT.md` assert otherwise; `CLAUDE.md:44` is correct.