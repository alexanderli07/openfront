# Auto-Bot Port Contract — how to faithfully translate a src Nation behavior into a page-bridge JS module

This is the single source of truth for porting `src/core/execution/.../Nation*Behavior.ts`
(and `utils/AiAttackBehavior.ts`) into the extension auto-bot. The goal is a
**1:1 faithful translation** — preserve every branch, constant, probability,
strategy order, and call order. Do NOT summarize, simplify, "improve", or add
heuristics. The ONLY changes allowed are the mechanical API substitutions below.

## File shape

- Plain classic script, no `import`/`export`. Start with a top comment then
  `"use strict";`. Top-level `class XxxBehavior { ... }` (shared global lexical
  scope — the class name is visible to `nationExecution.js`). 2-space body indent
  to match sibling modules.
- Class names + constructor signatures are FIXED (nationExecution.js constructs them):
  - `class EmojiBehavior { constructor(random, game, player) }`
  - `class MirvBehavior { constructor(random, game, player, emojiBehavior) }`
  - `class AllianceBehavior { constructor(random, game, player, emojiBehavior) }`
  - `class WarshipBehavior { constructor(random, game, player, emojiBehavior) }`
  - `class StructureBehavior { constructor(random, game, player) }`
  - `class AttackBehavior { constructor(random, game, player, triggerRatio, reserveRatio, expandRatio, allianceBehavior, emojiBehavior) }`
  - `class NukeBehavior { constructor(random, game, player, attackBehavior, emojiBehavior) }`
- `random` is a `PseudoRandom` (portutil) — use `random.nextInt/chance/randElement/randFromSet/shuffleArray/next` exactly as src does.
- `game` is the gameApi core-shaped object; `player` is the gameApi wrapped "me".

## Difficulty (IMPORTANT)

src reads `this.mg.config().gameConfig().difficulty`. REPLACE every such read with
`currentDifficulty()` (portutil) — the user-selected difficulty the bot replicates.
Compare against `Difficulty.Easy|Medium|Hard|Impossible` (portutil constants).
EXCEPTION: `config().maxTroops(player)` internally uses the real lobby difficulty —
leave those calls as-is (they read true enemy/our stats).

## Enums & unit constants (portutil.js / gameApi.js / core.js — already global)

- `UNIT.City|Port|Factory|SAMLauncher|MissileSilo|DefensePost|TransportShip|TradeShip|Warship|AtomBomb|HydrogenBomb|MIRV|MIRVWarhead` (string UnitType values). Replace `UnitType.City` → `UNIT.City`, etc.
- `Difficulty`, `GameMode` (`.FFA`/`.Team`), `GameType`, `PlayerType` (`.Bot`/`.Human`/`.Nation`), `TerrainType` (portutil).
- `Relation` (`.Hostile`=0/`.Distrustful`=1/`.Neutral`=2/`.Friendly`=3) (gameApi).

## gameApi surface (what `game` and `player` expose)

### game (sync, core-shaped)
`ticks()`, `inSpawnPhase()`, `isSpawnImmunityActive()`, `config()` (passthrough to
the real Config — has maxTroops/isUnitDisabled/unitInfo/nukeMagnitudes/samRange/
defaultSamRange/maxSamRange/SAMCooldown/defaultNukeSpeed/defaultNukeTargetableRange/
boatMaxNumber/donateTroops/numSpawnPhaseTurns/startingGold/trainGold/
trainStationMinRange/trainStationMaxRange/minDistanceBetweenPlayers/gameConfig()…),
`myPlayer()`, `players()`, `playerViews()`, `playerBySmallID(sid)`, `nations()`,
`terraNullius()`, `owner(t)`, `ownerID(t)` (null if unowned), `hasOwner(t)`,
`numLandTiles()`, `numTilesWithFallout()`, `getWinner()`, `units(...types)`,
`unitCount(type)`, and GameMap routes: `ref(x,y)`, `x(t)`, `y(t)`, `cell`,
`width()`, `height()`, `isValidCoord(x,y)`, `isOnMap(cell)`, `isLand/isWater/
isOcean/isShore/isOceanShore/magnitude/hasFallout/terrainType(t)`, `neighbors(t)`,
`manhattanDist(a,b)`, `euclideanDistSquared(a,b)`, `nearbyUnits(tile,range,types[,…])`,
`hasUnitNearby(...)`.

Tiles are opaque numeric TileRefs. Owner/player identity: compare by `.smallID()`
(NOT `===` — src uses `===` on player identity; REPLACE `a === b` player/owner
comparisons with `a.smallID() === b.smallID()`, and `owner === player` with a
`.smallID()` compare; for TerraNullius check `!x.isPlayer()`).

### player / other players (sync unless noted)
- sync: `isPlayer()`, `isAlive()`, `hasSpawned()`, `smallID()`, `id()`, `type()`,
  `name()`, `displayName()`, `troops()`, `gold()` (BigInt — keep bigint math for
  costs: `BigInt`, compare with `>=`, etc.), `numTilesOwned()`, `team()`,
  `maxTroops()` (= config().maxTroops(self)), `units(...types)`, `unitCount(type)`,
  `unitsOwned(type)` (built count), `unitsConstructed(type)` (bool, has a built one),
  `totalUnitLevels(type)`, `incomingAttacks()`, `outgoingAttacks()`, `targets()`,
  `allies()`, `transitiveTargets()`, `alliances()`, `isFriendly(o)`, `isAlliedWith(o)`,
  `isOnSameTeam(o)`, `isRequestingAllianceWith(o)`, `hasEmbargoAgainst(o)`,
  `isTraitor()`, `isDisconnected()`, `betrayals()`, `getTraitorRemainingTicks()`,
  `nameLocation()` (→ {x,y}).
- `borderTiles()` → returns a SYNC `Set<TileRef>` snapshot. For `player` (me) it is
  pre-fetched each tick. For OTHER players it is EMPTY unless you first
  `await game.__ensureBorderTiles(otherPlayer)` (see Async). (calculateTerritoryCenter
  and randTerritoryTileArray call borderTiles() synchronously — ensure the target's
  border was fetched first.)
- relation (reconstructed, SYNC): `relation(other)` → Relation bucket;
  `allRelationsSorted()` → `[{player, relation}]` asc; `updateRelation(other, delta)`
  → writes the AI-subjective overlay (no intent). Use these exactly where src does.
- `nearby()` → SYNC array of nearby players AND TerraNullius (exact src reconstruction).
- `sharesBorderWith(other)` → SYNC bool.

### Attack objects (from incomingAttacks()/outgoingAttacks())
Each has `troops()`, `attacker()` (wrapped player), `target()` (wrapped player),
`retreating()`, `id()`, `sourceTile()` (TileRef or null). (src AttackUpdate uses the
same accessors.)

### Unit objects (from units()/game.units())
`type()`, `tile()`, `level()`, `id()`, `owner()` (wrapped), `isActive()`,
`isUnderConstruction()`, `isInCombat()`, `hasTrainStation()`, `missileTimerQueue()`,
`targetTile()`, `patrolTile()`, `warshipState()`, `transportShipState()`, `health()`.

## Async boundaries (the ONLY place control flow differs from src)

These client reads are async worker calls. The methods that use them BECOME `async`
(and nationExecution awaits them — already wired for handleStructures/maybeAttack/
considerMIRV/maybeSpawnWarship/counterWarshipInfestation/maybeSendNuke). Wrap each in
`withTimeout(promise, WORKER_TIMEOUT_MS, fallback)` (helpers.js).

1. **buildables / canBuild** — `await player.buildables(tile, [UNIT.X])` → `BuildableUnit[]`
   each `{type, canBuild: TileRef|false, canUpgrade: unitId|false, cost: bigint}`.
   src calls `player.canBuild(type, tile)` SYNCHRONOUSLY inside value loops. REPLACE
   with the **rank-then-probe** pattern: score ALL candidate tiles synchronously by
   the src value function, sort desc, then `await buildables(tile,[type])` DOWN the
   ranked list and take the first whose `canBuild !== false`. To actually build:
   `getBuildMenu().sendBuildOrUpgrade(buildableUnit, tile)` (structures pass the
   snapped `bu.canBuild` tile; WARSHIPS pass the queried WATER tile; nukes/MIRV pass
   the target tile). To UPGRADE: `sendBuildOrUpgrade(bu)` where `bu.canUpgrade !== false`.
2. **bestTransportShipSpawn / canBuildTransportShip** — `await player.bestTransportShipSpawn(tile)`
   → spawn TileRef or `false`. src `canBuildTransportShip(g,p,tile)` == this `!== false`.
   It is called inside RNG loops (findRandomBoatTarget 500 iters, island, TN boat). Apply
   rank-then-probe: COLLECT up to K (≈4) candidate tiles by the cheap sync src criteria,
   then await bestTransportShipSpawn down the list, take the first `!== false`.
3. **borderTiles of OTHER players** — `await game.__ensureBorderTiles(player)` before
   reading that player's `borderTiles()` synchronously (e.g. before calculateTerritoryCenter
   or scanning a target's tiles). Cache is per-tick; only fetch targets you actually need
   (bound the count — e.g. island enemy early-exits at ≤2 reachable).
4. **profile** — already snapshotted into the relation overlay each tick; just use
   `player.relation(...)`. Do NOT call profile() yourself.
5. **actions** — `await player.actions(tile, units)` → `PlayerActions` (`{canAttack,
   buildableUnits, interaction:{canSendAllianceRequest, canBreakAlliance, canDonateTroops,
   canDonateGold, sharedBorder, …}}`) — may be null under the harness; guard and fall back
   to local checks (`sharesBorderWith`, relation, etc.).

## Actuation (emit the same intents the UI emits)

`const ctors = discoverCtors(getEventBus());` then `emitIntent(ctors.X, ...args)`:
- `ctors.spawn` → `(tile)`  | `ctors.attack` → `(targetID|null, troops)` (targetID =
  `target.id()` string, or `null` for TerraNullius) | `ctors.boat` → `(dstTile, troops)`
  | `ctors.moveWarship` → `([unitId], tile)` | `ctors.embargo` → `(targetPlayerView, "start"|"stop")`
  (pass `other.__src ?? other`) | `ctors.donateTroops` → `(recipientView, troops)` |
  `ctors.emoji` → `(recipientView|AllPlayers, emojiNumber)`.
- Build/upgrade/nuke/MIRV/warship: `getBuildMenu().sendBuildOrUpgrade(bu, tile)` (see Async #1).
- Alliance accept/reject/extension: click `<events-display>` event buttons — see the
  AllianceBehavior notes (read the deleted `alliance.js` at git restore for the
  events-display reading pattern, but DO NOT reintroduce its custom strategy; only reuse
  the events-display plumbing). Alliance REQUEST origination: `ctors.allianceRequest`
  (learned lazily). Break alliance: the other `{requestor,recipient}`-shape ctor.
- For args that are players, pass the gameApi wrapper's `.__src` when the real intent
  expects a PlayerView (`emitIntent(ctors.X, p.__src ?? p, …)`); for attack/boat/spawn the
  args are ids/tiles/troops (numbers/strings), pass directly.

## Logging (optional, matches old UX)

`setLastAction(text, cat)` where cat ∈ `"spawn"|"combat"|"naval"|"build"|"nuke"|"diplo"`.
`state.stats.{spawns,attacks,builds,nukes}++`. Keep these light; they are not strategy.

## portutil helpers available

`PseudoRandom`, `simpleHash`, `within(v,min,max)`, `closestTile(gm,refs,tile)`,
`closestTwoTiles(gm,x,y)`, `calculateBoundingBox(gm,set)`, `boundingBoxCenter(box)`,
`calculateBoundingBoxCenter(gm,set)`, `boundingBoxTiles(gm,center,r)`,
`calculateTerritoryCenter(game,target)`, `randTerritoryTileArray(random,gm,player,n)`,
`currentDifficulty()`. (Parabola pathfinder + emoji-id tables are added in nuke/emoji
phases — if your behavior needs `flattenedEmojiTable` or `ParabolaUniversalPathFinder`,
note it and a stub will be provided.)

## Genuine data shims (StructureBehavior only)

`sharedWaterComponents(player)` and `railNetwork()` are NOT client-available. The
StructureBehavior porter must implement the two documented approximations in gameApi
(ocean-shore for coastal; train-station proximity union-find for rail clusters) — these
are the ONLY approximated datasets and affect placement SCORING only. Everything else is
faithful.

## What faithfulness means here

Same strategy ORDER (the difficulty-indexed arrays), same constants/probabilities, same
gold/cost thresholds (bigint), same branch conditions. If you cannot reproduce something
client-side, leave a `// DIVERGENCE:` comment explaining exactly what and why — do not
silently approximate.
