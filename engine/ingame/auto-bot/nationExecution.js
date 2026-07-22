// Auto-Bot — nationExecution: a faithful 1:1 port of the in-game Nation AI
// orchestrator (src/core/execution/NationExecution.ts). Owns the tick gating,
// behavior construction + ordering, spawn, embargo relation upkeep.
//
// Two faithful adaptations vs the core class:
//  - DIFFICULTY: the src reads the lobby Nation difficulty; the bot REPLICATES a
//    user-chosen difficulty (currentDifficulty()) for its strategy, while enemy
//    stat reads (config().maxTroops(enemy)) still use the real game difficulty.
//  - TICK GATING: the core tick() is called once per GAME tick; our engine polls
//    less often, so we EDGE-DETECT every attackTick / structure-third crossing in
//    the window since the last poll, so none is skipped or double-fired (§7).
//
// Feature toggles (state.settings.features.*) gate whole behaviors on/off — a UX
// switch, NOT a strategy change (default all-on == fully faithful).
//
// Loaded after the behavior modules, before engine.

"use strict";

  class NationBot {
    constructor(game, opts) {
      this.mg = game;
      this.player = game.myPlayer();
      this.active = true;
      this.behaviorsInitialized = false;
      this.spawnExecAdded = false;
      this.lastSpawnTile = null; // last emitted spawn tile (to re-emit on change)
      this.lastSpawnTopKey = null; // "x,y" of the #1 spot we last committed to
      this.lastSpawnPickTick = null; // throttle re-evaluation during spawn phase
      this.status = "";
      this.lastSeenTick = -1;
      this.embargoMalusApplied = new Set(); // smallIDs we've applied embargo malus to

      // Seed exactly like src (NationExecution.ts:54): simpleHash(playerId)+gameID.
      this.random = new PseudoRandom(
        simpleHash(String(opts && opts.playerId)) +
          simpleHash(String(opts && opts.gameId)),
      );
      // RNG consumed in src constructor order (NationExecution.ts:57-59).
      this.triggerRatio = this.random.nextInt(50, 60) / 100;
      this.reserveRatio = this.random.nextInt(30, 40) / 100;
      this.expandRatio = this.random.nextInt(10, 20) / 100;
      // …then init() order (NationExecution.ts:64-65).
      this.attackRate = this.getAttackRate();
      this.attackTick = this.random.nextInt(0, this.attackRate);
    }

    // getAttackRate — NationExecution.ts:74. Uses the REPLICATED difficulty.
    getAttackRate() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return this.random.nextInt(65, 100);
        case Difficulty.Medium:
          return this.random.nextInt(55, 70);
        case Difficulty.Hard:
          return this.random.nextInt(45, 60);
        case Difficulty.Impossible:
          return this.random.nextInt(30, 50);
        default:
          return this.random.nextInt(30, 50);
      }
    }

    feat(name) {
      return !!(state.settings.features && state.settings.features[name]);
    }

    async tick(ticks) {
      this.player = this.mg.myPlayer();
      const me = this.player;

      // ── ship tracking — NationExecution.ts:90-101 (every tick, non-Easy, Port) ─
      if (
        this.behaviorsInitialized &&
        me !== null &&
        me.isAlive() &&
        this.feat("warship") &&
        currentDifficulty() !== Difficulty.Easy &&
        me.unitsConstructed(UNIT.Port) &&
        !this.mg.config().isUnitDisabled(UNIT.Warship)
      ) {
        try {
          if (state.settings.warshipAutoSpawn !== false) {
            this.warshipBehavior.trackShipsAndRetaliate();
          }
          if (state.settings.winFixes) {
            // WIN-FIX: né nuke trước (ưu tiên sống sót), rồi reposition idle warship
            // tới naval threat. dodgeNukes khoá ship vừa né khỏi patrol pass này.
            if (state.settings.warshipNukeDodge !== false) {
              this.warshipBehavior.dodgeNukes();
            }
            // WIN-FIX: reposition EXISTING idle warships to the top naval threat (invasion
            // > trade-raid lane > open-water loss zone). Throttled/debounced internally.
            this.warshipBehavior.smartWarshipPatrol();
            // WIN-FIX (Blon port): battle sim + retreat HP% + hunt trade + attack weakest.
            // Runs AFTER patrol so it can override patrol targets when combat is needed.
            this.warshipBehavior.smartWarshipCombat();
          }
        } catch (e) {
          console.error("[AutoBot] trackShips error:", e);
        }
      }

      if (me === null) return;

      // ── spawn phase — NationExecution.ts:107-162 ─────────────────────────────
      if (this.mg.inSpawnPhase()) {
        // NOTE: we deliberately do NOT bail on me.hasSpawned() here. During the
        // spawn phase the game's SpawnExecution relinquishes the old spawn and
        // re-conquers when we emit a new spawn intent (non-random-spawn maps),
        // so the bot can keep MOVING its spawn to follow the #1 spot even after
        // it has already spawned once.
        if (this.feat("spawn")) {
          // Re-evaluate at most every ~6 ticks (~600ms). Re-emit only when the
          // ranked #1 GRID point actually moves — comparing the grid key (not
          // the snapped tile, which changes once we own territory) keeps a
          // stable #1 from drifting while still following a moving #1.
          if (
            this.lastSpawnPickTick == null ||
            ticks - this.lastSpawnPickTick >= 6
          ) {
            this.lastSpawnPickTick = ticks;
            const topKey = this.currentSpawnTopKey();
            if (!this.spawnExecAdded || (topKey != null && topKey !== this.lastSpawnTopKey)) {
              this.lastSpawnTopKey = topKey;
              this.doSpawn();
            }
          }
          this.status = tr("Spawn phase…");
        } else {
          this.status = tr("Spawn phase…");
        }
        return;
      }

      if (!me.isAlive()) {
        this.active = false;
        this.status = tr("💀 Eliminated");
        return;
      }

      // ── first live tick — NationExecution.ts:170-174 ─────────────────────────
      if (!this.behaviorsInitialized) {
        this.initializeBehaviors();
        if (this.feat("expand")) {
          await this.attackBehavior.forceSendAttack(this.mg.terraNullius());
        }
        this.lastSeenTick = ticks;
        return;
      }

      // ── tick gating (edge-detected over the elapsed window) — NationExecution.ts:176 ─
      const from = this.lastSeenTick < 0 ? ticks : this.lastSeenTick + 1;
      this.lastSeenTick = ticks;
      // WIN-FIX (combatCadenceScale): <1 shrinks the effective attack interval so
      // the bot makes attack decisions more often (faster mid-game growth). 1 (or
      // winFixes off) = the faithful src cadence (decide once per attackRate).
      let ar = this.attackRate;
      if (state.settings.winFixes) {
        const scale = state.settings.combatCadenceScale ?? 1;
        if (scale > 0 && scale !== 1) {
          ar = Math.max(1, Math.round(this.attackRate * scale));
        }
      }
      const at = this.attackTick % ar; // attackTick may exceed a shrunk ar
      const oneThird = (at + Math.floor(ar / 3)) % ar;
      const twoThirds = (at + Math.floor((ar * 2) / 3)) % ar;
      let attackCrossed = false;
      let thirdCrossed = false;
      for (let t = from; t <= ticks; t++) {
        const offset = ((t % ar) + ar) % ar;
        if (offset === at) attackCrossed = true;
        else if (offset === oneThird || offset === twoThirds) thirdCrossed = true;
      }

      if (!attackCrossed) {
        // Between regular attack ticks: build at 1/3 and 2/3 (NationExecution.ts:180-190).
        if (thirdCrossed && this.feat("build")) {
          await this.structureBehavior.handleStructures();
        }
        return;
      }

      // ── full decision chain, src order (NationExecution.ts:194-204) ───────────
      this.status = tr("Thinking…");
      try {
        this.emojiBehavior.maybeSendCasualEmoji();
        this.updateRelationsFromEmbargos();
        // Always reject alliance requests from regular bots — even when
        // alliance auto-accept is off. Regular bots spam requests defensively
        // which blocks attacks against them.
        this.allianceBehavior.handleAllianceRequestsFromBots();
        if (this.feat("alliance")) {
          this.allianceBehavior.handleAllianceRequests();
          this.allianceBehavior.handleAllianceExtensionRequests();
        }
        if (this.feat("nuke")) {
          await this.mirvBehavior.considerMIRV();
        }
        if (this.feat("build")) {
          await this.structureBehavior.handleStructures();
        }
        if (this.feat("warship") && state.settings.warshipAutoSpawn !== false) {
          await this.warshipBehavior.maybeSpawnWarship();
        }
        // DIVERGENCE: src gates this under alliance; we add a dedicated `embargo`
        // toggle so the user can turn off the bot's auto-stop-trading behavior.
        if (this.feat("embargo")) {
          this.handleEmbargoesToHostileNations();
        }
        if (this.feat("expand") || this.feat("boat")) {
          await this.attackBehavior.maybeAttack();
        }
        if (this.feat("warship") && state.settings.warshipAutoSpawn !== false) {
          await this.warshipBehavior.counterWarshipInfestation();
        }
        if (this.feat("nuke")) {
          await this.nukeBehavior.maybeSendNuke();
        }
      } catch (e) {
        console.error("[AutoBot] decision chain error:", e);
      }
    }

    // initializeBehaviors — NationExecution.ts:207
    initializeBehaviors() {
      const r = this.random;
      const g = this.mg;
      const p = this.player;
      this.emojiBehavior = new EmojiBehavior(r, g, p);
      this.mirvBehavior = new MirvBehavior(r, g, p, this.emojiBehavior);
      this.allianceBehavior = new AllianceBehavior(r, g, p, this.emojiBehavior);
      this.warshipBehavior = new WarshipBehavior(r, g, p, this.emojiBehavior);
      this.attackBehavior = new AttackBehavior(
        r,
        g,
        p,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
        this.allianceBehavior,
        this.emojiBehavior,
      );
      this.nukeBehavior = new NukeBehavior(
        r,
        g,
        p,
        this.attackBehavior,
        this.emojiBehavior,
      );
      this.structureBehavior = new StructureBehavior(r, g, p);
      this.behaviorsInitialized = true;
    }

    // ── spawn pick — port of SpawnExecution.getSpawn (no-spawnCell branch,
    //    SpawnExecution.ts:105-151): a random whole-map (or team-area) land tile,
    //    unowned, not on a border, not within minDistanceBetweenPlayers of another
    //    player's spawn, with a valid spawn cluster. 1000 tries.
    //    Two unavoidable client DIVERGENCES (data not surfaced client-side):
    //    (a) other players' spawnTile() is not exposed → proximity is checked
    //        against their nameLocation (territory centre), spawned players only;
    //    (b) getSpawnTiles' all-valid 4-radius BFS is not reproducible → `!isBorder`
    //        (which excludes coast/edge tiles) is the faithful client stand-in for
    //        "interior tile with a full land neighbourhood".
    //    Emits the UI spawn intent (the worker re-validates the chosen tile).
    // "x,y" grid key of the current #1 spawn spot, or null. Prefers the live
    // heatmap topSpots (what the player sees) and falls back to computing them.
    currentSpawnTopKey() {
      if (!state.settings.smartSpawn) return null;
      let ts = null;
      try {
        if (typeof getSpawnHeatmapTopSpots === "function") ts = getSpawnHeatmapTopSpots();
        if ((!ts || ts.length === 0) && typeof computeSpawnTopSpotsForBot === "function") {
          ts = computeSpawnTopSpotsForBot(this.mg, this.player);
        }
      } catch (_e) {
        ts = null;
      }
      return ts && ts.length > 0 ? `${ts[0].x},${ts[0].y}` : null;
    }

    doSpawn() {
      const center = this.pickSpawnCenter();
      if (center == null) {
        this.status = tr("Spawn phase…");
        return;
      }
      // Nothing to do if the best tile hasn't moved since the last emit.
      if (this.spawnExecAdded && center === this.lastSpawnTile) {
        return;
      }
      const ctors = discoverCtors(getEventBus());
      if (ctors.spawn) {
        emitIntent(ctors.spawn, center);
        const moved = this.spawnExecAdded;
        this.spawnExecAdded = true;
        this.lastSpawnTile = center;
        if (!moved) {
          state.stats.spawns++;
        }
        setLastAction(tr("🏁 Spawned"), "spawn");
      }
    }

    pickSpawnCenter() {
      // DIVERGENCE: Companion mode pins the spawn next to the configured boss.
      // Returns null unless companion is enabled AND in Active mode, so with the
      // feature off this is a single typeof check and the port is unchanged.
      if (typeof companionSpawnCenter === "function") {
        const companionTile = companionSpawnCenter(this.mg, this.player);
        if (companionTile != null) return companionTile;
      }
      const g = this.mg;
      const W = g.width();
      const H = g.height();
      let minDist = 30;
      try {
        const md = g.config().minDistanceBetweenPlayers();
        if (Number.isFinite(md)) minDist = md;
      } catch (_e) {
        /* default */
      }
      // Team spawn area (SpawnExecution.getTeamSpawnArea) — null in FFA.
      let area = null;
      try {
        const team = this.player.team();
        if (team !== null && typeof g.__src?.teamSpawnArea === "function") {
          area = g.__src.teamSpawnArea(team) ?? null;
        }
      } catch (_e) {
        /* none */
      }
      const others = g
        .players()
        .filter((p) => p.smallID() !== this.player.smallID() && p.hasSpawned());
      const tooClose = (tile) => {
        const tx = g.x(tile);
        const ty = g.y(tile);
        for (const o of others) {
          const loc = o.nameLocation();
          if (!loc) continue;
          if (g.manhattanDist(g.ref(loc.x, loc.y), tile) < minDist) return true;
        }
        return false;
      };

      // DIVERGENCE: smart spawn scoring — when enabled, sample candidates and
      // pick the best by land density + distance from enemies + edge avoidance.
      // When disabled, use the faithful first-valid-random-tile (SpawnExecution).
      const useSmart = state.settings.smartSpawn;

      // A tile is a valid spawn if it's unowned interior land, far enough from
      // other players. Reused for the top-spot pick and its snap search.
      const isValidSpawn = (tile) =>
        tile != null &&
        g.isLand(tile) &&
        !g.hasOwner(tile) &&
        !g.isBorder(tile) &&
        !tooClose(tile);

      // Search outward from (sx,sy) for the nearest valid spawn tile (ring scan).
      // Lets the bot commit to the marked #1 area even if the exact grid point is
      // a coast/border/occupied tile the server would reject.
      const snapToValid = (sx, sy) => {
        if (g.isValidCoord(sx, sy)) {
          const c = g.ref(sx, sy);
          if (isValidSpawn(c)) return c;
        }
        for (let radius = 2; radius <= 24; radius += 2) {
          for (let dy = -radius; dy <= radius; dy += 2) {
            for (let dx = -radius; dx <= radius; dx += 2) {
              if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue; // ring only
              const nx = sx + dx;
              const ny = sy + dy;
              if (!g.isValidCoord(nx, ny)) continue;
              const c = g.ref(nx, ny);
              if (isValidSpawn(c)) return c;
            }
          }
        }
        return null;
      };

      // Prefer spawning at the spawn-heatmap's #1 circle so the bot lands exactly
      // where the player sees it. Use the LIVE displayed topSpots if the overlay
      // is on (identical to what's on screen), else compute them.
      if (useSmart) {
        let topSpots = null;
        try {
          if (typeof getSpawnHeatmapTopSpots === "function") {
            topSpots = getSpawnHeatmapTopSpots();
          }
          if (!topSpots && typeof computeSpawnTopSpotsForBot === "function") {
            topSpots = computeSpawnTopSpotsForBot(g, this.player);
          }
        } catch (_e) {
          topSpots = null;
        }
        if (topSpots && topSpots.length > 0) {
          for (let s = 0; s < topSpots.length; s++) {
            const snapped = snapToValid(topSpots[s].x, topSpots[s].y);
            if (snapped != null) return snapped; // spawn at / near the ranked best spot
          }
        }
      }

      let bestTile = null;
      let bestScore = -Infinity;

      for (let tries = 0; tries < 1000; tries++) {
        const x = area
          ? this.random.nextInt(area.x, area.x + area.width)
          : this.random.nextInt(0, W);
        const y = area
          ? this.random.nextInt(area.y, area.y + area.height)
          : this.random.nextInt(0, H);
        if (!g.isValidCoord(x, y)) continue;
        const tile = g.ref(x, y);
        if (!g.isLand(tile) || g.hasOwner(tile) || g.isBorder(tile)) continue;
        if (tooClose(tile)) continue;
        if (!useSmart) return tile; // faithful: first valid wins
        const score = this.scoreSpawnTile(tile, others, W, H);
        if (score > bestScore) {
          bestScore = score;
          bestTile = tile;
        }
      }
      return bestTile;
    }

    // DIVERGENCE: spawn scoring (Tactical spawn-scoring port). Scores a candidate
    // tile by: land density in a 12-radius neighbourhood, distance from the
    // nearest enemy nameLocation (farther = better), and edge avoidance (centre
    // of map preferred). Team mode adds a pull toward the team spawn area centre.
    scoreSpawnTile(tile, others, W, H) {
      const g = this.mg;
      const tx = g.x(tile);
      const ty = g.y(tile);
      let score = 0;

      // Land density: count land neighbours in a 12-radius square.
      const R = 12;
      let land = 0;
      let total = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (!g.isValidCoord(nx, ny)) continue;
          total++;
          if (g.isLand(g.ref(nx, ny))) land++;
        }
      }
      score += (total > 0 ? land / total : 0) * 40;

      // Distance from nearest enemy (farther = safer spawn).
      let minEnemyDist = Infinity;
      for (const o of others) {
        const loc = o.nameLocation();
        if (!loc) continue;
        const d = Math.abs(loc.x - tx) + Math.abs(loc.y - ty);
        if (d < minEnemyDist) minEnemyDist = d;
      }
      // Normalize: cap at 200 tiles, scale to 0..30.
      score += Math.min(1, minEnemyDist / 200) * 30;

      // Edge avoidance: prefer tiles away from map edges.
      const edgeDist = Math.min(tx, ty, W - 1 - tx, H - 1 - ty);
      score += Math.min(1, edgeDist / 30) * 20;

      // Team area pull: bonus for being near the team spawn area centre.
      if (area) {
        const cx = area.x + area.width / 2;
        const cy = area.y + area.height / 2;
        const teamDist = Math.abs(tx - cx) + Math.abs(ty - cy);
        const teamRadius = (area.width + area.height) / 2;
        score += Math.max(0, 1 - teamDist / Math.max(1, teamRadius)) * 10;
      }

      return score;
    }

    // updateRelationsFromEmbargos — NationExecution.ts:285. AI-subjective ±20
    // (overlay write via player.updateRelation).
    updateRelationsFromEmbargos() {
      const player = this.player;
      if (player === null) return;
      const others = this.mg.players().filter((p) => p.id() !== player.id());
      const embargoMalus = -20;
      others.forEach((other) => {
        if (
          other.hasEmbargoAgainst(player) &&
          !this.embargoMalusApplied.has(other.smallID())
        ) {
          player.updateRelation(other, embargoMalus);
          this.embargoMalusApplied.add(other.smallID());
        } else if (
          !other.hasEmbargoAgainst(player) &&
          this.embargoMalusApplied.has(other.smallID())
        ) {
          player.updateRelation(other, -embargoMalus);
          this.embargoMalusApplied.delete(other.smallID());
        }
      });
    }

    // handleEmbargoesToHostileNations — NationExecution.ts:308.
    handleEmbargoesToHostileNations() {
      const player = this.player;
      if (player === null) return;
      const others = this.mg.players().filter((p) => p.id() !== player.id());
      const difficulty = currentDifficulty();
      const isHigherDifficulty =
        difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;
      const teamGame =
        this.mg.config().gameConfig().gameMode === GameMode.Team;

      others.forEach((other) => {
        if (
          teamGame &&
          isHigherDifficulty &&
          other.type() !== PlayerType.Bot &&
          !player.isOnSameTeam(other)
        ) {
          if (!player.hasEmbargoAgainst(other)) this.addEmbargo(other, false);
          return;
        }
        if (
          player.relation(other) <= Relation.Hostile &&
          !player.hasEmbargoAgainst(other) &&
          !player.isOnSameTeam(other)
        ) {
          this.addEmbargo(other, false);
        } else if (
          player.relation(other) >= Relation.Neutral &&
          player.hasEmbargoAgainst(other) &&
          difficulty !== Difficulty.Hard &&
          difficulty !== Difficulty.Impossible
        ) {
          this.stopEmbargo(other);
        } else if (
          player.relation(other) >= Relation.Friendly &&
          player.hasEmbargoAgainst(other) &&
          difficulty !== Difficulty.Impossible
        ) {
          this.stopEmbargo(other);
        }
      });
    }

    addEmbargo(other, _temporary) {
      const ctors = discoverCtors(getEventBus());
      if (ctors.embargo) emitIntent(ctors.embargo, other.__src ?? other, "start");
    }
    stopEmbargo(other) {
      const ctors = discoverCtors(getEventBus());
      if (ctors.embargo) emitIntent(ctors.embargo, other.__src ?? other, "stop");
    }
  }
