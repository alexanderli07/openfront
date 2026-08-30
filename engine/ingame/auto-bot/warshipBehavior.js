// Auto-Bot — WarshipBehavior: a faithful 1:1 port of the in-game Nation warship
// AI (src/core/execution/nation/NationWarshipBehavior.ts). Spawns the nation's
// first warship, retaliates with warships when our transport/trade ships are
// captured or when a hostile transport is inbound, repositions idle warships,
// and counters "warship infestations" (an enemy blanketing the ocean to choke
// all trade/transport). Every branch, constant, probability, strategy order and
// call order is preserved exactly. The ONLY changes are the mechanical API
// substitutions mandated by PORT-CONTRACT.md:
//   - DIFFICULTY: src reads the lobby Nation difficulty; the bot REPLICATES a
//     user-chosen difficulty, so each `this.game.config().gameConfig().difficulty`
//     read becomes `currentDifficulty()`.
//   - UnitType.X → UNIT.X.
//   - PLAYER/OWNER IDENTITY: src compares players with `===`; the client wraps
//     players fresh each tick, so identity compares become `.smallID()` (or, where
//     src already used `.id()`, that string-id compare is kept verbatim).
//   - ASYNC + ACTUATION: the client has no synchronous canBuild/addExecution. A
//     warship is built through the build menu: `await player.buildables(waterTile,
//     [UNIT.Warship])` → find the Warship BuildableUnit (`bu.canBuild !== false`)
//     → `getBuildMenu().sendBuildOrUpgrade(bu, waterTile)` (pass the WATER tile, not
//     bu.canBuild — for a warship bu.canBuild is just the in-range port tile). So
//     maybeSpawnWarship() / counterWarshipInfestation() and the build helpers
//     BECOME async (nationExecution awaits maybeSpawnWarship/counterWarshipInfestation).
//     Worker reads are wrapped in withTimeout(p, WORKER_TIMEOUT_MS, fallback).
//   - MOVE WARSHIP: src `warship.updateWarshipState({patrolTile})` is unsupported on
//     the client UnitView. REPLACE with the MoveWarshipIntentEvent:
//     `emitIntent(ctors.moveWarship, [unit.id()], tile)`.
//   - relation: `this.player.updateRelation(enemy, -7.5/-15)` writes the AI-subjective
//     overlay (no intent), exactly as src.
//
// TRACKING-SET IDENTITY: src keeps Set<Unit>/Map<Unit> keyed by engine Unit object
// identity. The client wraps units fresh on every units() call (gameApi wrapUnit has
// NO cache), so a wrapper object never matches across ticks. Per PORT-CONTRACT
// (identity is by id) we key the tracking collections by `unit.id()` (the stable
// engine id) and re-resolve the unit's current state each tick from a per-tick
// id→unit index built off the GLOBAL units list (which still includes a ship after
// it is captured / owned by an enemy). This is the same id-keyed adaptation the
// sibling behaviors use (emojiBehavior.lastEmojiSent, mirvBehavior.recentMirvTargets)
// — not a strategy change.
//
// Loaded with the other behavior modules (after portutil/gameApi and the emoji
// phase, which provides AllPlayers + EMOJI_WARSHIP_RETALIATION), before nationExecution.

"use strict";

  class WarshipBehavior {
    constructor(random, game, player, emojiBehavior) {
      this.random = random;
      this.game = game;
      this.player = player;
      this.emojiBehavior = emojiBehavior;

      // Track our transport ships we currently own (src: Set<Unit>; we key by id).
      this.trackedTransportShips = new Set(); // unitId
      // Track our trade ships we currently own (src: Set<Unit>; we key by id).
      this.trackedTradeShips = new Set(); // unitId
      // Track incoming transport ships (src: Set<Unit>; we key by id).
      this.trackedIncomingTransportShips = new Set(); // unitId
      // Track incoming transport ships we have dealt with (src: Set<Unit>; we key by id).
      this.dealtWithTransportShip = new Set(); // unitId
    }

    // ── per-tick id→unit index over a GLOBAL units list. A captured/handed-off
    //    ship is no longer in me.units() but IS in game.units(type), so resolving
    //    current owner()/isActive()/targetTile() must go through the global list.
    indexById(units) {
      const m = new Map();
      for (const u of units) m.set(u.id(), u);
      return m;
    }

    // maybeSpawnWarship — NationWarshipBehavior.maybeSpawnWarship (now async).
    async maybeSpawnWarship() {
      if (this.player === null) throw new Error("not initialized");
      if (this.game.config().isUnitDisabled(UNIT.Warship)) {
        return false;
      }
      if (!this.random.chance(50)) {
        return false;
      }
      const ports = this.player.units(UNIT.Port);
      const ships = this.player.units(UNIT.Warship);
      if (
        ports.length > 0 &&
        ships.length === 0 &&
        this.player.gold() > this.cost(UNIT.Warship)
      ) {
        const port = this.random.randElement(ports);
        const targetTile = this.warshipSpawnTile(port.tile(), 250);
        if (targetTile === null) {
          return false;
        }
        // src: canBuild = player.canBuild(Warship, targetTile); if false → return.
        // Client: probe buildables on the WATER targetTile, find the Warship
        // BuildableUnit; canBuild !== false stands in for the sync canBuild check.
        const bu = await this.buildableWarship(targetTile);
        if (bu === null || bu === undefined || bu.canBuild === false) {
          return false;
        }
        // src: game.addExecution(new ConstructionExecution(player, Warship, targetTile)).
        // Client: fire through the build menu, aimed at the WATER targetTile.
        const buildMenu = getBuildMenu();
        if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
          return false;
        }
        buildMenu.sendBuildOrUpgrade(bu, targetTile);
        state.stats.builds++;
        setLastAction(tr("🚢 Deploy warship"), "naval");
        return true;
      }
      return false;
    }

    // warshipSpawnTile — NationWarshipBehavior.warshipSpawnTile (private).
    warshipSpawnTile(portTile, radius) {
      for (let attempts = 0; attempts < 50; attempts++) {
        const randX = this.random.nextInt(
          this.game.x(portTile) - radius,
          this.game.x(portTile) + radius,
        );
        const randY = this.random.nextInt(
          this.game.y(portTile) - radius,
          this.game.y(portTile) + radius,
        );
        if (!this.game.isValidCoord(randX, randY)) {
          continue;
        }
        const tile = this.game.ref(randX, randY);
        // Sanity check
        if (!this.game.isWater(tile)) {
          continue;
        }
        return tile;
      }
      return null;
    }

    trackShipsAndRetaliate() {
      this.trackTransportShipsAndRetaliate();
      this.trackTradeShipsAndRetaliate();
      this.trackIncomingTransportsAndRetaliate();
    }

    // Send out a warship if our transport ship got captured
    // trackTransportShipsAndRetaliate — NationWarshipBehavior (private).
    //
    // DIVERGENCE: src distinguishes arrival/retreat from enemy destruction via
    // `ship.wasDestroyedByEnemy()` + `ship.destroyer()`. NEITHER accessor exists on
    // the client UnitView (UnitView.ts:97-280 has no wasDestroyedByEnemy/destroyer,
    // and gameApi wrapUnit does not wrap them — gameApi.js:75-99). UnitState carries
    // `lastOwnerID`, but that is OUR id (the prior owner), not the destroyer, so it
    // cannot identify the `enemy` that maybeRetaliateWithWarship requires. We
    // therefore CANNOT detect a transport-destroyed-by-enemy event client-side: the
    // retaliation branch is ported but guarded so it never fires. (We still maintain
    // the tracking set so the rest of the structure stays a 1:1 diff.)
    trackTransportShipsAndRetaliate() {
      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) {
        return;
      }
      // Add any currently owned transport ships to our tracking set (by id).
      this.player
        .units(UNIT.TransportShip)
        .forEach((u) => this.trackedTransportShips.add(u.id()));

      // Resolve current state from the global transport index (a destroyed ship
      // simply drops out of the index → !isActive()).
      const index = this.indexById(this.game.units(UNIT.TransportShip));

      // Iterate tracked transport ships; if it got destroyed by an enemy: retaliate.
      for (const shipId of Array.from(this.trackedTransportShips)) {
        const ship = index.get(shipId);
        const isActive = ship !== undefined && ship.isActive();
        if (!isActive) {
          // Distinguish between arrival/retreat and enemy destruction.
          // DIVERGENCE: wasDestroyedByEnemy()/destroyer() are unavailable on the
          // client UnitView, so this guard is always false and the retaliation
          // cannot fire (see method header). src body, for reference:
          //   if (ship.wasDestroyedByEnemy() && ship.destroyer() !== undefined) {
          //     this.maybeRetaliateWithWarship(ship.tile(), ship.destroyer(), "transport");
          //   }
          if (
            ship !== undefined &&
            typeof ship.wasDestroyedByEnemy === "function" &&
            typeof ship.destroyer === "function" &&
            ship.wasDestroyedByEnemy() &&
            ship.destroyer() !== undefined
          ) {
            this.maybeRetaliateWithWarship(
              ship.tile(),
              ship.destroyer(),
              "transport",
            );
          }
          this.trackedTransportShips.delete(shipId);
        }
      }
    }

    // Send out a warship if our trade ship got captured
    // trackTradeShipsAndRetaliate — NationWarshipBehavior (private).
    // Trade-capture-by-owner-change IS detectable client-side: a captured trade
    // ship leaves me.units() but remains in the GLOBAL trade index owned by its new
    // owner, so `ship.owner().id() !== this.player.id()` is faithfully observable.
    trackTradeShipsAndRetaliate() {
      // Add any currently owned trade ships to our tracking map (by id).
      this.player
        .units(UNIT.TradeShip)
        .forEach((u) => this.trackedTradeShips.add(u.id()));

      // Resolve current state from the global trade index (includes ships now owned
      // by someone else after capture).
      const index = this.indexById(this.game.units(UNIT.TradeShip));

      // Iterate tracked trade ships; if we no longer own it, it was captured: retaliate.
      for (const shipId of Array.from(this.trackedTradeShips)) {
        const ship = index.get(shipId);
        if (ship === undefined || !ship.isActive()) {
          this.trackedTradeShips.delete(shipId);
          continue;
        }
        if (ship.owner().id() !== this.player.id()) {
          // Ship was ours and is now owned by someone else -> captured
          this.maybeRetaliateWithWarship(ship.tile(), ship.owner(), "trade");
          this.trackedTradeShips.delete(shipId);
        }
      }
    }

    // trackIncomingTransportsAndRetaliate — NationWarshipBehavior (private).
    trackIncomingTransportsAndRetaliate() {
      // Add any transports which are targeting us to our tracking map (by id).
      this.game
        .units(UNIT.TransportShip)
        .filter((p) => {
          const target = p.targetTile();
          return (
            target &&
            p.isActive() &&
            !p.transportShipState()?.isRetreating &&
            this.game.ownerID(target) === this.player?.smallID() &&
            p.owner().smallID() !== this.player?.smallID()
          );
        })
        .forEach((p) => this.trackedIncomingTransportShips.add(p.id()));

      // Per-tick global index so we can re-resolve each tracked transport by id.
      const index = this.indexById(this.game.units(UNIT.TransportShip));

      for (const transportId of Array.from(this.trackedIncomingTransportShips)) {
        const transport = index.get(transportId);
        const target =
          transport !== undefined ? transport.targetTile() : undefined;
        if (
          transport === undefined ||
          !transport.isActive() ||
          target === undefined ||
          transport.transportShipState()?.isRetreating
        ) {
          this.trackedIncomingTransportShips.delete(transportId);
          this.dealtWithTransportShip.delete(transportId);
          continue;
        }
        // Transport has already been dealt with
        if (this.dealtWithTransportShip.has(transportId)) {
          continue;
        }

        const distanceToTarget = this.game.manhattanDist(
          transport.tile(),
          target,
        );
        // Too close to deal with
        if (distanceToTarget < 20) {
          this.dealtWithTransportShip.add(transportId);
          continue;
        }

        // Possible dock snipe counter? Too niche?
        if (!transport.owner().isAlliedWith(this.player)) {
          if (
            this.game.hasUnitNearby(
              target,
              90,
              UNIT.Warship,
              this.player.id(),
              true,
            ) ||
            this.player.units(UNIT.Warship).filter((p) => {
              const patrolTile = p.warshipState().patrolTile;
              return (
                patrolTile !== undefined &&
                this.game.manhattanDist(target, patrolTile) < 90
              );
            }).length > 0
          ) {
            this.dealtWithTransportShip.add(transportId);
            continue;
          }
          const oceanTiles = this.warshipSpawnTile(target, 30);
          if (oceanTiles === null) continue;
          this.maybeRetaliateWithWarship(
            oceanTiles,
            transport.owner(),
            "transport",
          );
          this.dealtWithTransportShip.add(transportId);
          break;
        }
      }
    }

    // maybeRetaliateWithWarship — NationWarshipBehavior (private).
    // This is invoked from the SYNC tracker chain (trackShipsAndRetaliate, which
    // nationExecution calls UN-awaited), so every src gate and the RNG roll stay
    // synchronous — per-branch probability is exact (one nextInt(0,100) per call).
    // Only the warship BUILD is async on the client (buildables probe + build menu),
    // so it is fire-and-forget (`void this._retaliateBuildAsync(...)`). Cross-behavior
    // RNG *ordering* is explicitly not a faithfulness requirement (portutil
    // PseudoRandom note), so deferring the actuation off the RNG draw is fine.
    maybeRetaliateWithWarship(tile, enemy, reason) {
      // Don't retaliate against ourselves (e.g. own nuke destroyed own ship)
      // src: `enemy === this.player` (identity) → smallID compare.
      if (enemy.smallID() === this.player.smallID()) {
        return;
      }

      // Don't send too many warships
      if (this.player.units(UNIT.Warship).length >= 10) {
        this.maybeMoveWarship(tile);
        return;
      }

      const difficulty = currentDifficulty();
      // In Easy never retaliate. In Medium retaliate with 15% chance. Hard with 50%, Impossible with 80%.
      if (
        (difficulty === Difficulty.Medium && this.random.nextInt(0, 100) < 15) ||
        (difficulty === Difficulty.Hard && this.random.nextInt(0, 100) < 50) ||
        // DIVERGENCE (bestAI): 80% -> always.
        (difficulty === Difficulty.Impossible && this.random.nextInt(0, 100) < 100)
      ) {
        // src: canBuild(Warship, tile) → addExecution / else maybeMoveWarship; then
        // emoji + relation. The buildables probe is async, so defer it; the canBuild
        // gate, build-vs-move fallback, and emoji+relation-on-success are preserved
        // inside _retaliateBuildAsync exactly as src ordered them.
        void this._retaliateBuildAsync(tile, enemy, reason);
      }
    }

    // The async tail of maybeRetaliateWithWarship: probe Warship buildability on the
    // WATER `tile`, build it through the menu (passing the WATER tile, not bu.canBuild)
    // and then emote + apply the relation malus — mirroring src order:
    //   canBuild === false → maybeMoveWarship(tile); return;
    //   else addExecution(ConstructionExecution); maybeSendEmoji; updateRelation.
    // The internal try/catch is REQUIRED: this runs un-awaited off the sync tracker
    // chain, so a rejection must not escape into nationExecution's sync catch.
    async _retaliateBuildAsync(tile, enemy, reason) {
      try {
        const bu = await this.buildableWarship(tile);
        if (bu === null || bu === undefined || bu.canBuild === false) {
          this.maybeMoveWarship(tile);
          return;
        }
        const buildMenu = getBuildMenu();
        if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
          this.maybeMoveWarship(tile);
          return;
        }
        buildMenu.sendBuildOrUpgrade(bu, tile);
        state.stats.builds++;
        setLastAction(tr("🚢 Retaliate warship"), "naval");
        this.emojiBehavior.maybeSendEmoji(enemy, EMOJI_WARSHIP_RETALIATION);
        this.player.updateRelation(enemy, reason === "trade" ? -7.5 : -15);
      } catch (_e) {
        /* swallow — un-awaited tracker tail must not reject into nationExecution */
      }
    }

    // maybeMoveWarship — NationWarshipBehavior (private).
    maybeMoveWarship(tile) {
      // Make sure we are targeting water
      if (this.game.isWater(tile)) {
        const warship = this.player
          .units(UNIT.Warship)
          .filter((p) => {
            const patrolTile = p.warshipState().patrolTile;
            return (
              patrolTile !== undefined &&
              // Dont send ships which are already traveling
              this.game.manhattanDist(p.tile(), patrolTile) < 130
            );
          })
          .sort((a, b) => {
            // Sort by distance (closest first)
            const distA = this.game.manhattanDist(a.tile(), tile);
            const distB = this.game.manhattanDist(b.tile(), tile);
            return distA - distB;
          })[0];

        if (warship) {
          // src: warship.updateWarshipState({ patrolTile: tile });
          // Client: MoveWarshipIntentEvent([unitId], tile).
          const ctors = discoverCtors(getEventBus());
          if (ctors.moveWarship) {
            emitIntent(ctors.moveWarship, [warship.id()], tile);
          }
        }
      }
    }

    // Prevent warship infestations: if current player is one of the 3 richest and an enemy has too many warships, send a counter-warship.
    // What is a warship infestation? A player tries to dominate the entire ocean to block all trade and transport boats.
    // counterWarshipInfestation — NationWarshipBehavior (now async: builds a warship).
    async counterWarshipInfestation() {
      if (!this.shouldCounterWarshipInfestation()) {
        return;
      }

      const isTeamGame = this.player.team() !== null;

      if (!this.isRichPlayer(isTeamGame)) {
        return;
      }

      const target = this.findWarshipInfestationCounterTarget(isTeamGame);
      if (target !== null) {
        await this.buildCounterWarship(target);
      }
    }

    // shouldCounterWarshipInfestation — NationWarshipBehavior (private).
    shouldCounterWarshipInfestation() {
      if (this.game.config().isUnitDisabled(UNIT.Warship)) {
        return false;
      }

      // Only the smart nations can do this
      const difficulty = currentDifficulty();
      if (
        difficulty !== Difficulty.Hard &&
        difficulty !== Difficulty.Impossible
      ) {
        return false;
      }

      // Quit early if there aren't many warships in the game
      if (this.game.unitCount(UNIT.Warship) <= 10) {
        return false;
      }

      // Quit early if we can't afford a warship
      if (this.cost(UNIT.Warship) > this.player.gold()) {
        return false;
      }

      // Quit early if we don't have a port to send warships from
      if (this.player.units(UNIT.Port).length === 0) {
        return false;
      }

      // Don't send too many warships
      if (this.player.units(UNIT.Warship).length >= 10) {
        return false;
      }

      return true;
    }

    // Check if current player is one of the 3 richest (We don't want poor nations to use their precious gold on this)
    // isRichPlayer — NationWarshipBehavior (private).
    // DIVERGENCE: src filters out Human players (`p.type() === PlayerType.Human`)
    // because the src Nation is type Nation and stays in the candidate pool. The bot,
    // however, IS myPlayer() with type() === Human, so it filters ITSELF out and can
    // never appear in topThree → isRichPlayer always returns false → the whole
    // counterWarshipInfestation feature is effectively inert for the bot. This is the
    // same "bot is Human, not Nation" class of divergence seen elsewhere; the port is
    // faithful (filter kept verbatim) — only the bot's player-type makes it inert.
    isRichPlayer(isTeamGame) {
      const players = this.game.players().filter((p) => {
        if (p.type() === PlayerType.Human) return false;
        // src: `p.team() === this.player.team()` — team is a team id, keep `===`.
        return isTeamGame ? p.team() === this.player.team() : true;
      });
      const topThree = players
        .sort((a, b) => Number(b.gold() - a.gold()))
        .slice(0, 3);
      // src: `p.id() === this.player.id()` — string id, kept verbatim.
      return topThree.some((p) => p.id() === this.player.id());
    }

    // findWarshipInfestationCounterTarget — NationWarshipBehavior (private).
    findWarshipInfestationCounterTarget(isTeamGame) {
      return isTeamGame
        ? this.findTeamGameWarshipTarget()
        : this.findFreeForAllWarshipTarget();
    }

    // findTeamGameWarshipTarget — NationWarshipBehavior (private).
    findTeamGameWarshipTarget() {
      const enemyTeamWarships = new Map();

      for (const p of this.game.players()) {
        // Skip friendly players (our team and allies)
        // src: `p.id() === this.player.id()` — string id, kept verbatim.
        if (this.player.isFriendly(p) || p.id() === this.player.id()) {
          continue;
        }

        const team = p.team();
        if (team === null) continue;

        const teamKey = team.toString();
        const warshipCount = p.units(UNIT.Warship).length;

        if (!enemyTeamWarships.has(teamKey)) {
          enemyTeamWarships.set(teamKey, {
            count: 0,
            team: teamKey,
            players: [],
          });
        }
        const teamData = enemyTeamWarships.get(teamKey);
        teamData.count += warshipCount;
        teamData.players.push(p);
      }

      // Find team with more than 15 warships
      for (const [, teamData] of enemyTeamWarships.entries()) {
        if (teamData.count > 15) {
          // Find player in that team with most warships
          const playerWithMostWarships = teamData.players.reduce((max, p) => {
            const count = p.units(UNIT.Warship).length;
            const maxCount = max ? max.units(UNIT.Warship).length : 0;
            return count > maxCount ? p : max;
          }, null);

          if (playerWithMostWarships) {
            const warships = playerWithMostWarships.units(UNIT.Warship);
            if (warships.length > 3) {
              return {
                player: playerWithMostWarships,
                warship: this.random.randElement(warships),
              };
            }
          }
        }
      }

      return null;
    }

    // findFreeForAllWarshipTarget — NationWarshipBehavior (private).
    findFreeForAllWarshipTarget() {
      const enemies = this.game
        .players()
        // src: `p.id() === this.player.id()` — string id, kept verbatim.
        .filter((p) => !this.player.isFriendly(p) && p.id() !== this.player.id());

      for (const enemy of enemies) {
        const enemyWarships = enemy.units(UNIT.Warship);
        if (enemyWarships.length > 10) {
          return {
            player: enemy,
            warship: this.random.randElement(enemyWarships),
          };
        }
      }

      return null;
    }

    // buildCounterWarship — NationWarshipBehavior (private, now async).
    async buildCounterWarship(target) {
      const tile = target.warship.tile();
      // src: canBuild = player.canBuild(Warship, target.warship.tile()); if false →
      // move + return. Client: probe buildables on the enemy warship's WATER tile.
      const bu = await this.buildableWarship(tile);
      if (bu === null || bu === undefined || bu.canBuild === false) {
        this.maybeMoveWarship(tile);
        return;
      }

      // src: game.addExecution(new ConstructionExecution(player, Warship, tile)).
      const buildMenu = getBuildMenu();
      if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
        this.maybeMoveWarship(tile);
        return;
      }
      buildMenu.sendBuildOrUpgrade(bu, tile);
      state.stats.builds++;
      setLastAction(tr("🚢 Counter warship"), "naval");
      this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_WARSHIP_RETALIATION);
    }

    // ── build/probe helpers (the client async/build-menu actuation) ────────────

    // Probe buildables for a Warship on a WATER tile. Returns the Warship
    // BuildableUnit ({type, canBuild, canUpgrade, cost}) or null. canBuild !== false
    // is the client stand-in for the src sync canBuild(Warship, tile) check.
    async buildableWarship(waterTile) {
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(waterTile, [UNIT.Warship]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return null;
      }
      return Array.isArray(buildables)
        ? buildables.find((b) => b.type === UNIT.Warship) ?? null
        : null;
    }

    // cost — src reads unitInfo(type).cost(game, player). The Warship cost fn
    // (Config.ts:289-296) is a SELF-CONTAINED pure formula with no client-missing
    // dependency: `min(1_000_000, (numWarships + 1) * 250_000)` where numWarships is
    // the player's BUILT warship count (costWrapper, Config.ts:470-489 →
    // min(unitsOwned, unitsConstructed); for the engine these are count+count, for a
    // Nation with N built warships that is just N). We reproduce the formula directly
    // and synchronously (no engine-cost-fn call: it would run on the raw __src view,
    // whose unitsOwned/unitsConstructed may be absent or boolean-typed, breaking the
    // Math.min). gold is BigInt so we return a BigInt. This behavior only ever
    // queries the Warship cost.
    cost(type) {
      if (type === UNIT.Warship) {
        const numUnits = this.player.unitsOwned(UNIT.Warship); // built warship count
        return BigInt(Math.min(1_000_000, (numUnits + 1) * 250_000));
      }
      return 0n;
    }

    // ── SMART WARSHIP PATROL (WIN-FIX — NOT in src) ────────────────────────────
    // The faithful behavior above mostly BUILDS a warship in response to a threat (and
    // only MOVES an existing one when capped at 10 / it can't build). This winFix layer
    // does the opposite — it REPOSITIONS our EXISTING idle warships to the single
    // highest-priority naval threat each pass, so a 1-2 ship pool actually defends:
    //   P1  an enemy TRANSPORT actively invading OUR land → intercept it mid-sea
    //   P2  a fresh TRADE-RAID lane (our trade ship just captured) → kill the lingering
    //       raider so that lane's FUTURE trade ships survive
    //   P3  a persistent open-water BOAT-LOSS zone (a sea lane where our boats keep
    //       dying, FAR from any coast → a lurking raider). Our boats are cheap 1%
    //       probes, so this clears a recurring loss LANE, never chases one lost probe.
    // Tiny-pool-safe: serves ONLY the top threat per pass, throttled, per-warship
    // debounced, and distance-capped (won't drag a ship across the map to a lost cause).
    // Pure movement (no gold spend); the faithful path still grows the pool by building.
    // Shared winFix scratch state for smartWarshipPatrol + dodgeNukes. Created once
    // with the FULL shape so whichever method runs first this tick can't leave a
    // partial object that starves the other (both read smartState.cooldown).
    ensureSmartState() {
      return (this.smartState = this.smartState || {
        transportPos: new Map(), // ourTransportId -> {x,y,tx,ty}
        tradePos: new Map(), // ourTradeId -> {x,y}
        losses: [], // [{x,y,at}] open-water boat losses
        raids: [], // [{x,y,at}] trade-raid tiles
        cooldown: new Map(), // warshipId -> tick last tasked
        serviced: new Map(), // zoneCellKey -> tick a ship was last sent to that zone
        lastPassMs: 0,
      });
    }

    smartWarshipPatrol() {
      if (this.player === null) return;
      if (this.game.config().isUnitDisabled(UNIT.Warship)) return;

      const s = this.ensureSmartState();

      const now = performance.now();
      const throttle = state.settings.warshipPatrolThrottleMs || 1500;
      if (now - s.lastPassMs < throttle) return;
      s.lastPassMs = now;

      const tick = this.game.ticks();
      const mySid = this.player.smallID();
      const myId = this.player.id();

      // 1) refresh our ship positions + harvest loss / raid events ──────────────
      const transportIndex = this.indexById(this.game.units(UNIT.TransportShip));
      for (const u of this.player.units(UNIT.TransportShip)) {
        try {
          const t = u.targetTile ? u.targetTile() : null;
          s.transportPos.set(u.id(), {
            x: this.game.x(u.tile()),
            y: this.game.y(u.tile()),
            tx: t != null ? this.game.x(t) : null,
            ty: t != null ? this.game.y(t) : null,
          });
        } catch (_e) {
          /* skip */
        }
      }
      // A transport that left our ownership/board whose LAST position was open water FAR
      // from its target didn't land (a landing happens AT the enemy coast) → it was
      // destroyed in transit → a loss-lane data point. Coastal disappearances = landings
      // = noise, so the distance-from-target gate screens them out.
      const farFromTarget = state.settings.warshipLossMinDist || 25;
      for (const [id, pos] of Array.from(s.transportPos)) {
        const cur = transportIndex.get(id);
        const stillOurs =
          cur !== undefined &&
          cur.isActive() &&
          cur.owner().smallID() === mySid;
        if (stillOurs) continue;
        if (pos.tx != null && pos.ty != null) {
          const d = Math.abs(pos.x - pos.tx) + Math.abs(pos.y - pos.ty);
          if (d > farFromTarget) s.losses.push({ x: pos.x, y: pos.y, at: tick });
        }
        s.transportPos.delete(id);
      }

      const tradeIndex = this.indexById(this.game.units(UNIT.TradeShip));
      for (const u of this.player.units(UNIT.TradeShip)) {
        try {
          s.tradePos.set(u.id(), {
            x: this.game.x(u.tile()),
            y: this.game.y(u.tile()),
          });
        } catch (_e) {
          /* skip */
        }
      }
      for (const [id] of Array.from(s.tradePos)) {
        const cur = tradeIndex.get(id);
        if (cur === undefined || !cur.isActive()) {
          s.tradePos.delete(id);
          continue;
        }
        if (cur.owner().id() !== myId) {
          // captured → the raider is AT the ship's current tile
          try {
            s.raids.push({
              x: this.game.x(cur.tile()),
              y: this.game.y(cur.tile()),
              at: tick,
            });
          } catch (_e) {
            /* skip */
          }
          s.tradePos.delete(id);
        }
      }

      // prune stale events
      const lossWindow = state.settings.warshipLossWindowTicks || 900;
      const raidWindow = state.settings.warshipRaidWindowTicks || 400;
      s.losses = s.losses.filter((e) => tick - e.at <= lossWindow);
      s.raids = s.raids.filter((e) => tick - e.at <= raidWindow);

      // 2) build the prioritized threat list ─────────────────────────────────────
      const threats = [];
      const invasion = this.findInvasionThreat(); // P1
      if (invasion !== null) threats.push(invasion);
      if (s.raids.length > 0) {
        const r = s.raids[s.raids.length - 1]; // freshest raid lane
        if (this.game.isValidCoord(r.x, r.y)) {
          const tref = this.game.ref(r.x, r.y);
          if (this.game.isWater(tref)) {
            threats.push({ tile: tref, kind: "trade-lane" }); // P2
          }
        }
      }
      const zone = this.findLossZone(s.losses); // P3
      if (zone !== null) threats.push({ tile: zone, kind: "loss-zone" });
      if (threats.length === 0) return;

      // 3) serve the HIGHEST-priority threat whose ZONE we haven't just serviced and that
      //    an idle warship can actually reach. The per-ZONE debounce (NOT just the
      //    per-warship one) is what stops a 1-2 ship pool from re-tasking ship B to the
      //    same lane ship A is already racing to. One task per pass.
      const cell = state.settings.warshipServiceCellSize || 40;
      const serviceTicks = state.settings.warshipZoneServiceTicks || 90;
      for (const [k, t] of Array.from(s.serviced)) {
        if (tick - t > serviceTicks) s.serviced.delete(k); // prune
      }
      for (const threat of threats) {
        const key =
          Math.floor(this.game.x(threat.tile) / cell) +
          "," +
          Math.floor(this.game.y(threat.tile) / cell);
        const last = s.serviced.get(key);
        if (last !== undefined && tick - last < serviceTicks) continue; // zone already in hand
        if (this.moveBestWarshipTo(threat.tile, threat.kind, s, tick)) {
          s.serviced.set(key, tick);
          break; // tasked one ship → done this pass
        }
        // no idle ship in range for this threat → fall through to the next priority
      }
    }

    // findInvasionThreat — an enemy TRANSPORT heading INTO our land, far enough to
    // intercept and not already covered by one of our warships. Reuses the faithful
    // trackIncoming gates (incl. the exact hasUnitNearby "already covered" check).
    findInvasionThreat() {
      const mySid = this.player.smallID();
      let best = null;
      let bestDist = Infinity;
      for (const p of this.game.units(UNIT.TransportShip)) {
        try {
          if (!p.isActive()) continue;
          const target = p.targetTile();
          if (target == null) continue;
          if (p.transportShipState && p.transportShipState()?.isRetreating) continue;
          if (this.game.ownerID(target) !== mySid) continue; // must target OUR land
          if (p.owner().smallID() === mySid) continue; // not ours
          if (p.owner().isAlliedWith(this.player)) continue; // not an ally's
          const d = this.game.manhattanDist(p.tile(), target);
          if (d < 20) continue; // too close to intercept in time
          if (
            this.game.hasUnitNearby(
              target,
              90,
              UNIT.Warship,
              this.player.id(),
              true,
            )
          ) {
            continue; // already covered by one of our warships
          }
          if (d < bestDist) {
            bestDist = d;
            best = p.tile();
          }
        } catch (_e) {
          /* skip */
        }
      }
      return best === null ? null : { tile: best, kind: "invasion" };
    }

    // findLossZone — centroid of a CLUSTER of recent open-water losses (≥ min within a
    // radius of each other). One loss is noise; a cluster is a raid lane worth clearing.
    findLossZone(losses) {
      const minCount = state.settings.warshipLossZoneMin || 2;
      const radius = state.settings.warshipLossZoneRadius || 35;
      if (losses.length < minCount) return null;
      let best = null;
      let bestCount = 0;
      for (const a of losses) {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (const b of losses) {
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= radius) {
            sumX += b.x;
            sumY += b.y;
            count++;
          }
        }
        if (count >= minCount && count > bestCount) {
          const cx = Math.round(sumX / count);
          const cy = Math.round(sumY / count);
          if (this.game.isValidCoord(cx, cy)) {
            const tref = this.game.ref(cx, cy);
            if (this.game.isWater(tref)) {
              bestCount = count;
              best = tref;
            }
          }
        }
      }
      return best;
    }

    // moveBestWarshipTo — move the nearest IDLE, off-cooldown warship to `tile`, but only
    // if it's within the interception distance cap (else leave it; the faithful build
    // path covers threats no existing ship can reach). Sets a per-warship cooldown so a
    // tiny pool doesn't oscillate between threats. Returns true if a ship was tasked.
    moveBestWarshipTo(tile, kind, s, tick) {
      if (!this.game.isWater(tile)) return false;
      const maxDist = state.settings.warshipMoveMaxDist || 160;
      const cooldownTicks = state.settings.warshipMoveCooldownTicks || 60;
      const idle = this.player.units(UNIT.Warship).filter((w) => {
        try {
          const ps = w.warshipState().patrolTile;
          if (ps === undefined) return false;
          if (this.game.manhattanDist(w.tile(), ps) >= 130) return false; // mid-voyage
          const last = s.cooldown.get(w.id());
          if (last !== undefined && tick - last < cooldownTicks) return false; // just tasked
          return true;
        } catch (_e) {
          return false;
        }
      });
      if (idle.length === 0) return false;
      idle.sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), tile) -
          this.game.manhattanDist(b.tile(), tile),
      );
      const w = idle[0];
      if (this.game.manhattanDist(w.tile(), tile) > maxDist) return false; // too far
      const ctors = discoverCtors(getEventBus());
      if (!ctors.moveWarship) return false;
      emitIntent(ctors.moveWarship, [w.id()], tile);
      s.cooldown.set(w.id(), tick);
      setLastAction(tr("🚢 Patrol → {k}", { k: kind }), "naval");
      ofhDebug(
        "[Warship] patrol →",
        kind,
        "@",
        this.game.x(tile),
        this.game.y(tile),
      );
      return true;
    }

    // ── WARSHIP NUKE AUTO-DODGE (WIN-FIX — NOT in src) ─────────────────────────
    // Detect any in-flight nuke whose blast zone covers one of our warships and
    // move that warship clear of EVERY active blast zone. Owner-agnostic: a nuke
    // kills a warship regardless of who fired it (maybeRetaliateWithWarship even
    // notes "own nuke destroyed own ship"), and the user chose "dodge any nuke that
    // covers the ship" — so we filter by blast coverage, not relation. Pure movement
    // (no gold), runs every tick BEFORE smartWarshipPatrol, gated by winFixes. Locks
    // each dodged ship into the shared smartState.cooldown so patrol skips it.

    // Remaining flight ticks for an atom/hydrogen nuke from its CURRENT tile to its
    // target, via the same parabola the game uses (mirrors nuke-prediction.js).
    // UniversalPathFinding lives in nukeBehavior.js (shared scope) — guarded.
    computeNukeRemainingTicks(fromTile, toTile) {
      try {
        if (
          typeof UniversalPathFinding === "undefined" ||
          !UniversalPathFinding.Parabola ||
          fromTile === undefined ||
          fromTile === null ||
          toTile === undefined ||
          toTile === null
        ) {
          return null;
        }
        const speed = this.game.config?.().defaultNukeSpeed?.() ?? 8;
        const pf = UniversalPathFinding.Parabola(this.game, {
          increment: speed,
          distanceBasedHeight: true,
          directionUp: true,
        });
        const path = pf.findPath(fromTile, toTile);
        if (!Array.isArray(path) || path.length === 0) return null;
        if (path.length === 1) return 1;
        let arc = 0;
        for (let i = 1; i < path.length; i++) {
          const ax = this.game.x(path[i]);
          const ay = this.game.y(path[i]);
          const bx = this.game.x(path[i - 1]);
          const by = this.game.y(path[i - 1]);
          arc += Math.hypot(ax - bx, ay - by);
        }
        return Math.floor(arc / (speed > 0 ? speed : 8)) + 1;
      } catch (_e) {
        return null;
      }
    }

    // ETA (ticks) until this nuke detonates. MIRV → 0 (treated as imminent: its
    // mid-air flat arc isn't this parabola). Atom/hydrogen: anchored once at first
    // sight then counted down (nuke advances one trajectory point per tick).
    // Parabola-unavailable fallback: straight-line distance / speed.
    nukeEtaTicks(nuke, nowTick) {
      const type = nuke.type?.();
      if (type === UNIT.MIRVWarhead) return 0;
      const id = nuke.id?.();
      if (id === undefined) return 0;
      if (!this.nukeEtaById) this.nukeEtaById = new Map();
      let anchor = this.nukeEtaById.get(id);
      if (anchor === undefined) {
        let remainTicks = this.computeNukeRemainingTicks(
          nuke.tile?.(),
          nuke.targetTile?.(),
        );
        if (remainTicks === null) {
          try {
            const speed = this.game.config?.().defaultNukeSpeed?.() ?? 8;
            const d2 = this.game.euclideanDistSquared(
              nuke.tile(),
              nuke.targetTile(),
            );
            remainTicks = Math.floor(Math.sqrt(d2) / (speed > 0 ? speed : 8)) + 1;
          } catch (_e) {
            remainTicks = 1;
          }
        }
        anchor = { firstTick: nowTick, remainTicks };
        this.nukeEtaById.set(id, anchor);
      }
      return Math.max(0, anchor.remainTicks - (nowTick - anchor.firstTick));
    }

    // Outer blast radius (tile units) of a nuke, with the same fallback the overlay
    // (nuke-prediction.js) uses when nukeMagnitudes is unavailable.
    nukeOuterRadius(nuke) {
      try {
        const mag = this.game.config().nukeMagnitudes(nuke.type());
        const outer = Number(mag?.outer ?? mag?.inner);
        if (Number.isFinite(outer) && outer > 0) return outer;
      } catch (_e) {
        /* fall through */
      }
      return nuke.type && nuke.type() === UNIT.HydrogenBomb ? 160 : 70;
    }

    // Find a water tile MAXIMIZING coverEta for a ship at (sx,sy): coverEta = the
    // soonest impact (ticks) among zones covering a tile, +Infinity if clear of all.
    // Radial push away from the nearest center, sampling several angles × rings (to
    // clear wide overlapping coverage). Tie-break: closest to the ship. Returns
    // { tile, eta } (eta may be Infinity = fully safe) or null if no water tile found.
    findNukeEscapeTile(sx, sy, zones, coverEta) {
      let center = null;
      let bestD2 = Infinity;
      for (const z of zones) {
        const dx = sx - z.tx;
        const dy = sy - z.ty;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          center = z;
        }
      }
      if (center === null) return null;

      const buffer = state.settings.warshipNukeDodgeBuffer || 20;
      const samples = Math.max(1, state.settings.warshipNukeDodgeSamples || 8);
      const rings = Math.max(1, state.settings.warshipNukeDodgeRings || 3);

      // Base angle points from the center out toward the ship (away from impact).
      let baseAngle = Math.atan2(sy - center.ty, sx - center.tx);
      if (!Number.isFinite(baseAngle)) baseAngle = 0; // ship exactly on the center

      let bestTile = null;
      let bestEta = -Infinity;
      let bestDist = Infinity;
      for (let ring = 1; ring <= rings; ring++) {
        const pushDist = center.radius + buffer * ring;
        for (let k = 0; k < samples; k++) {
          // 0, -45, +45, -90, +90, … spread symmetrically around the base angle.
          const stepN = Math.ceil(k / 2);
          const sign = k % 2 === 0 ? 1 : -1;
          const angle = baseAngle + sign * stepN * (Math.PI / 4);
          const cx = Math.round(center.tx + Math.cos(angle) * pushDist);
          const cy = Math.round(center.ty + Math.sin(angle) * pushDist);
          if (!this.game.isValidCoord(cx, cy)) continue;
          const tile = this.game.ref(cx, cy);
          if (!this.game.isWater(tile)) continue;
          const eta = coverEta(cx, cy);
          const dist = Math.abs(cx - sx) + Math.abs(cy - sy);
          if (eta > bestEta || (eta === bestEta && dist < bestDist)) {
            bestEta = eta;
            bestDist = dist;
            bestTile = tile;
          }
        }
      }
      if (bestTile === null) return null;
      return { tile: bestTile, eta: bestEta };
    }

    dodgeNukes() {
      if (this.player === null) return;
      if (this.game.config().isUnitDisabled(UNIT.Warship)) return;

      const myWarships = this.player.units(UNIT.Warship);
      if (myWarships.length === 0) return;

      const tick = this.game.ticks();

      // 1) collect active blast zones from ALL in-flight nukes (owner-agnostic),
      //    each carrying its ETA (ticks until detonation; MIRV = 0 = imminent).
      const margin = state.settings.warshipNukeDodgeMargin || 8;
      const zones = [];
      const seen = new Set();
      for (const nuke of this.game.units(
        UNIT.AtomBomb,
        UNIT.HydrogenBomb,
        UNIT.MIRVWarhead,
      )) {
        try {
          if (!nuke.isActive()) continue;
          const target = nuke.targetTile();
          if (target === undefined || target === null) continue;
          const id = nuke.id?.();
          if (id !== undefined) seen.add(id);
          const radius = this.nukeOuterRadius(nuke) + margin;
          zones.push({
            tx: this.game.x(target),
            ty: this.game.y(target),
            radius,
            r2: radius * radius,
            owner: nuke.owner()?.smallID?.(),
            eta: this.nukeEtaTicks(nuke, tick),
          });
        } catch (_e) {
          /* skip */
        }
      }
      // prune ETA anchors for nukes no longer in flight (landed/intercepted).
      if (this.nukeEtaById && this.nukeEtaById.size > 0) {
        for (const id of Array.from(this.nukeEtaById.keys())) {
          if (!seen.has(id)) this.nukeEtaById.delete(id);
        }
      }
      if (zones.length === 0) return; // no-op

      // coverEta(x,y) = soonest impact (ticks) among zones covering (x,y); Infinity
      // if the tile is clear of every zone (fully safe).
      const coverEta = (x, y) => {
        let best = Infinity;
        for (const z of zones) {
          const dx = x - z.tx;
          const dy = y - z.ty;
          if (dx * dx + dy * dy <= z.r2 && z.eta < best) best = z.eta;
        }
        return best;
      };

      // DE-RISK (throttled ~1s): confirm the wrapper sees ENEMY nukes via this
      // GameView (not just our own/allies'). Logs owner + mine flag + eta per zone.
      const nowMs = performance.now();
      if (nowMs - (this._dodgeLogAtMs || 0) > 1000) {
        this._dodgeLogAtMs = nowMs;
        const mySid = this.player.smallID();
        ofhDebug(
          "[Warship] nuke-dodge scan:",
          zones.length,
          "zone(s)",
          zones.map((z) => ({ owner: z.owner, mine: z.owner === mySid, eta: z.eta })),
        );
      }

      // 2) for each covered warship, move toward the highest-coverEta reachable tile.
      //    A fully-clear tile (Infinity) wins; if coverage is too wide to escape,
      //    the ship shelters in the LATEST-detonating zone, then re-evaluates each
      //    tick (the early nuke's zone vanishes on detonation → it runs onward).
      const s = this.ensureSmartState();
      for (const ship of myWarships) {
        try {
          const st = ship.tile();
          const sx = this.game.x(st);
          const sy = this.game.y(st);
          const shipEta = coverEta(sx, sy);
          if (shipEta === Infinity) continue; // safe where it is

          const best = this.findNukeEscapeTile(sx, sy, zones, coverEta);
          if (best === null) continue;
          if (best.eta <= shipEta) continue; // no safer spot reachable → don't jitter

          // Debounce: already heading somewhere at least as safe → leave it. Self-
          // heals — when the early nuke detonates, coverEta(pt) drops below the new
          // best.eta and this re-fires.
          const pt = ship.warshipState().patrolTile;
          if (
            pt !== undefined &&
            coverEta(this.game.x(pt), this.game.y(pt)) >= best.eta
          ) {
            continue;
          }

          const ctors = discoverCtors(getEventBus());
          if (!ctors.moveWarship) continue;
          emitIntent(ctors.moveWarship, [ship.id()], best.tile);
          s.cooldown.set(ship.id(), tick); // lock patrol from re-tasking it this pass
          setLastAction(tr("🚢 Dodge nuke"), "naval");
        } catch (_e) {
          /* skip */
        }
      }
    }

    // ── BATTLE SIMULATION (ported from Blon — winFix DIVERGENCE) ──────────────
    // Monte Carlo: simulates tick-by-tick combat between friendly and enemy warships.
    // Returns { win: boolean, survivalPct: number }.
    simulateBattle(friendlies, enemies, maxHp, focalTile) {
      if (enemies.length === 0) return { win: true, survivalPct: 100 };
      if (friendlies.length === 0) return { win: false, survivalPct: 0 };
      const game = this.game;
      const range = typeof game.config === "function" && typeof game.config().warshipTargettingRange === "function"
        ? game.config().warshipTargettingRange() : 8;
      const shellInfo = typeof game.config === "function" && typeof game.config().unitInfo === "function"
        ? game.config().unitInfo("Shell") : null;
      const shellBaseDmg = shellInfo ? (shellInfo.damage || 250) : 250;
      const attackRate = typeof game.config === "function" && typeof game.config().warshipShellAttackRate === "function"
        ? game.config().warshipShellAttackRate() : 20;
      const avgDmg = shellBaseDmg * 2.625;
      const dmgPerTick = avgDmg / Math.max(1, attackRate);

      const fLen = friendlies.length;
      const F = new Array(fLen);
      for (let i = 0; i < fLen; i++) {
        const u = friendlies[i];
        const dist = focalTile ? game.manhattanDist(focalTile, u.tile()) : range;
        F[i] = { hp: u.health(), engageTick: Math.max(0, dist - range) };
      }
      const eLen = enemies.length;
      const E = new Array(eLen);
      for (let i = 0; i < eLen; i++) {
        const u = enemies[i];
        const dist = focalTile ? game.manhattanDist(focalTile, u.tile()) : range;
        E[i] = { hp: u.health(), engageTick: Math.max(0, dist - range) };
      }

      let ticks = 0;
      while (ticks < 1000) {
        let aliveF = 0, minEngageF = Infinity;
        for (let i = 0; i < fLen; i++) { if (F[i].hp > 0.01) { aliveF++; if (F[i].engageTick < minEngageF) minEngageF = F[i].engageTick; } }
        let aliveE = 0, minEngageE = Infinity;
        for (let i = 0; i < eLen; i++) { if (E[i].hp > 0.01) { aliveE++; if (E[i].engageTick < minEngageE) minEngageE = E[i].engageTick; } }
        if (aliveE === 0 || aliveF === 0) break;

        const activeF = F.filter(f => f.hp > 0.01 && f.engageTick <= ticks);
        const activeE = E.filter(e => e.hp > 0.01 && e.engageTick <= ticks);
        if (activeF.length === 0 && activeE.length === 0) {
          const next = Math.min(minEngageF, minEngageE);
          if (next > ticks && next !== Infinity) { ticks = next; continue; }
        }
        if (activeF.length > 0 && activeE.length > 0) {
          let fDmg = activeF.length * dmgPerTick;
          let eDmg = activeE.length * dmgPerTick;
          activeE.sort((a, b) => a.hp - b.hp);
          activeF.sort((a, b) => a.hp - b.hp);
          for (let i = 0; i < activeE.length && fDmg > 0; i++) { const take = Math.min(activeE[i].hp, fDmg); activeE[i].hp -= take; fDmg -= take; }
          for (let i = 0; i < activeF.length && eDmg > 0; i++) { const take = Math.min(activeF[i].hp, eDmg); activeF[i].hp -= take; eDmg -= take; }
        }
        ticks++;
      }

      let totalAliveF = 0, remainingHp = 0;
      for (let i = 0; i < fLen; i++) { if (F[i].hp > 0.01) { totalAliveF++; remainingHp += Math.max(0, F[i].hp); } }
      let totalAliveE = 0;
      for (let i = 0; i < eLen; i++) { if (E[i].hp > 0.01) totalAliveE++; }

      if (totalAliveF > 0 && totalAliveE === 0) {
        let totalMaxHp = 0;
        for (let i = 0; i < friendlies.length; i++) totalMaxHp += typeof friendlies[i].maxHealth === "function" ? friendlies[i].maxHealth() : maxHp;
        return { win: true, survivalPct: (remainingHp / totalMaxHp) * 100 };
      }
      return { win: false, survivalPct: 0 };
    }

    // ── SAFE WAYPOINT BFS (ported from Blon — winFix DIVERGENCE) ─────────────
    // BFS over water tiles to find the safest retreat point: maximizes distance from
    // enemies while staying as close as possible to the base target. Penalizes corners.
    findSafeWaypoint(start, baseTarget, enemies) {
      const game = this.game;
      const myComponent = game.getWaterComponent(start);
      const MAX_DEPTH = 30;
      const queue = [{ tile: start, depth: 0 }];
      const visited = new Set();
      visited.add(start);
      let bestTile = start;
      let bestScore = -Infinity;

      while (queue.length > 0) {
        const { tile, depth } = queue.shift();
        let dEnemy = Infinity;
        for (const ew of enemies) {
          const d = game.manhattanDist(tile, ew.tile());
          if (d < dEnemy) dEnemy = d;
        }
        const dTarget = baseTarget ? game.manhattanDist(tile, baseTarget) : 0;
        const SAFE_DISTANCE = 15;
        const enemyScore = Math.min(dEnemy, SAFE_DISTANCE) * 50;
        const targetScore = -dTarget;
        let waterNeighbors = 0;
        // gameApi exposes `neighbors` (an array), never `forEachNeighbor` — the api is a
        // plain object literal, so the old call threw TypeError and took the whole BFS
        // with it.
        for (const n of game.neighbors(tile)) {
          if (game.isWater(n)) waterNeighbors++;
        }
        const cornerPenalty = (4 - waterNeighbors) * 15;
        const score = enemyScore + targetScore - cornerPenalty;
        if (score > bestScore) { bestScore = score; bestTile = tile; }

        if (depth >= MAX_DEPTH) continue;
        for (const neighbor of game.neighbors(tile)) {
          if (game.isWater(neighbor) && game.getWaterComponent(neighbor) === myComponent && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ tile: neighbor, depth: depth + 1 });
          }
        }
      }
      return bestTile;
    }

    // ── SMART WARSHIP COMBAT (Blon-inspired — winFix DIVERGENCE) ─────────────
    // Combines retreat-by-HP, battle simulation, safe waypoint, and trade hunting.
    // Runs AFTER smartWarshipPatrol, gated by winFixes + features.warship.
    smartWarshipCombat() {
      if (this.player === null) return;
      if (!state.settings.winFixes) return;
      if (!state.settings.features.warship) return;
      if (this.game.config().isUnitDisabled(UNIT.Warship)) return;

      const game = this.game;
      const me = this.player;
      const mySid = me.smallID();
      const s = this.ensureSmartState();
      const now = performance.now();
      const throttle = state.settings.warshipCombatThrottleMs || 800;
      if (now - (s.lastCombatPassMs || 0) < throttle) return;
      s.lastCombatPassMs = now;

      const myWarships = [];
      for (const u of me.units(UNIT.Warship)) {
        try {
          if (u.isActive() && !u.isUnderConstruction()) myWarships.push(u);
        } catch (_e) {}
      }
      if (myWarships.length === 0) return;

      const unitInfo = typeof game.unitInfo === "function" ? game.unitInfo("Warship") : null;
      const maxHp = unitInfo ? (unitInfo.maxHealth || 1000) : 1000;
      const retreatPct = (state.settings.warshipRetreatHealthPct || 50) / 100;

      // Collect enemy warships
      const allWarships = game.units(UNIT.Warship) || [];
      const enemyWarships = [];
      for (const u of allWarships) {
        try {
          const owner = u.owner();
          if (!owner || owner.smallID() === mySid) continue;
          // isFriendly is a PLAYER method; wrapUnit does not expose it. The old
          // `u.isFriendly(me)` threw into the per-unit catch below, so this list came out
          // empty every pass and no enemy warship was ever seen. Line ~1340 of this same
          // function already had it right on the owner.
          if (u.isActive() && !u.isUnderConstruction() && !owner.isFriendly(me)) {
            enemyWarships.push(u);
          }
        } catch (_e) {}
      }

      // Collect enemy trade ships (hunt mode)
      const huntTrade = state.settings.warshipHuntTrade !== false;
      const enemyTradeShips = [];
      if (huntTrade) {
        const allTrades = game.units(UNIT.TradeShip) || [];
        for (const u of allTrades) {
          try {
            const owner = u.owner();
            if (!owner || owner.smallID() === mySid) continue;
            // Same wrapped-unit mistake as the warship filter above.
            if (u.isActive() && !owner.isFriendly(me)) enemyTradeShips.push(u);
          } catch (_e) {}
        }
      }

      // Base target: nearest friendly port water tile
      let baseTarget = null;
      const friendlyPorts = [];
      const allPorts = game.units(UNIT.Port) || [];
      for (const u of allPorts) {
        try {
          if (u.isActive() && !u.isUnderConstruction() && u.owner() && u.owner().isFriendly(me)) friendlyPorts.push(u);
        } catch (_e) {}
      }
      if (friendlyPorts.length > 0) {
        let nearest = friendlyPorts[0], minD = Infinity;
        for (const p of friendlyPorts) {
          const d = game.manhattanDist(myWarships[0].tile(), p.tile());
          if (d < minD) { minD = d; nearest = p; }
        }
        // UNGUARDED in this method: the old forEachNeighbor TypeError here aborted
        // smartWarshipCombat before its per-warship loop on every pass that found a
        // friendly port, i.e. essentially always in a team game.
        for (const n of game.neighbors(nearest.tile())) {
          if (game.isWater(n)) { baseTarget = n; break; }
        }
        if (baseTarget === null) baseTarget = nearest.tile();
      }

      for (const warship of myWarships) {
        try {
          const wsId = warship.id();
          // Skip if already being handled by smartWarshipPatrol this tick
          const cooldownTick = s.cooldown.get(wsId);
          if (cooldownTick !== undefined && game.ticks() - cooldownTick < 3) continue;

          const hp = warship.health();
          const wsMaxHp = typeof warship.maxHealth === "function" ? warship.maxHealth() : maxHp;
          const wsState = warship.warshipState();
          const isGameRetreating = wsState && (wsState.state === "retreating" || wsState.state === "docked");
          if (isGameRetreating && friendlyPorts.length > 0) continue;

          // Find nearby enemies (within 30 tiles)
          const nearbyEnemies = [];
          for (const ew of enemyWarships) {
            if (game.manhattanDist(warship.tile(), ew.tile()) <= 30) nearbyEnemies.push(ew);
          }

          // Battle simulation: should we fight or evade?
          let wantsToEvade = false;
          if (nearbyEnemies.length > 0 && state.settings.warshipEvade !== false) {
            const activeFriendlies = myWarships.filter(fw => {
              const fState = fw.warshipState();
              if (fState && (fState.state === "retreating" || fState.state === "docked")) return false;
              const fHp = fw.health();
              if (fHp < wsMaxHp * retreatPct) return false;
              return game.manhattanDist(warship.tile(), fw.tile()) <= 15;
            });
            const result = this.simulateBattle(activeFriendlies, nearbyEnemies, wsMaxHp, warship.tile());
            if (!result.win || result.survivalPct < 15) wantsToEvade = true;
          }

          let targetTile = null;

          if (hp < wsMaxHp * retreatPct) {
            // RETREAT: go to base or safe waypoint
            if (wantsToEvade && nearbyEnemies.length > 0) {
              targetTile = this.findSafeWaypoint(warship.tile(), baseTarget, nearbyEnemies);
            } else {
              targetTile = baseTarget;
            }
          } else if (wantsToEvade && nearbyEnemies.length > 0) {
            // EVADE: find safe waypoint
            targetTile = this.findSafeWaypoint(warship.tile(), baseTarget, nearbyEnemies);
          } else if (!wantsToEvade && nearbyEnemies.length > 0) {
            // ATTACK: target weakest enemy
            let bestTarget = null, minHp = Infinity;
            for (const ew of nearbyEnemies) {
              if (ew.health() < minHp) { minHp = ew.health(); bestTarget = ew; }
            }
            if (bestTarget) targetTile = bestTarget.tile();
          } else if (huntTrade && enemyTradeShips.length > 0) {
            // HUNT: nearest enemy trade ship
            let closest = enemyTradeShips[0], minD = Infinity;
            for (const ship of enemyTradeShips) {
              const d = game.manhattanDist(warship.tile(), ship.tile());
              if (d < minD) { minD = d; closest = ship; }
            }
            targetTile = closest.tile();
          }

          if (targetTile !== null) {
            const currentPatrol = wsState ? wsState.patrolTile : undefined;
            if (currentPatrol !== targetTile) {
              this.moveWarship(warship, targetTile);
              s.cooldown.set(wsId, game.ticks());
            }
          }
        } catch (_e) {}
      }
    }

    // moveWarship helper — send move intent via WS
    moveWarship(warship, tile) {
      try {
        const ctors = typeof discoverCtors === "function" ? discoverCtors(getEventBus()) : {};
        if (ctors.moveWarship) {
          emitIntent(ctors.moveWarship, [warship.id()], tile);
        }
      } catch (_e) {}
    }
  }
