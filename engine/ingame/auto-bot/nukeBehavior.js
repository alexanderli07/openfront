// Auto-Bot — NukeBehavior: a faithful 1:1 port of the in-game Nation nuclear AI
// (src/core/execution/nation/NationNukeBehavior.ts). The most sophisticated
// behavior: target selection (retaliation, FFA crown, high-density, team), per-
// tile nuke scoring (level-weighted structures, SAM penalties, silo-distance
// penalty, recent-nuke memory), parabolic-trajectory SAM-interception checks, and
// the SAM-overwhelm saturation salvo planner. Every branch, constant, probability,
// threshold and call order is preserved exactly. The ONLY changes are the
// mechanical API substitutions mandated by PORT-CONTRACT.md:
//   - difficulty read (this.mg.config().gameConfig().difficulty) → currentDifficulty()
//   - UnitType.X → UNIT.X
//   - player/owner identity `===` → `.smallID()` compares; TerraNullius via !x.isPlayer()
//   - gold is BigInt — costs keep bigint math
//   - addExecution(new NukeExecution(...)) → buildables probe + getBuildMenu()
//     .sendBuildOrUpgrade(bu, targetTile) (see DIVERGENCE G1 for the dropped stagger)
//   - addExecution(new UpgradeStructureExecution(...)) → buildables probe +
//     getBuildMenu().sendBuildOrUpgrade(bu) for the silo upgrade
//   - cost()/getPerceivedNukeCost(): src reads unitInfo(type).cost(game, player),
//     but the nuke cost fn calls game.stats() which the client GameView does NOT
//     expose — we read the live price from a buildables probe (same value, client
//     source — DIVERGENCE C1, mirrors mirvBehavior.cost()).
//   - canUpgradeUnit(silo): not on the gameApi player wrapper — replaced by the
//     buildables probe `bu.canUpgrade !== false` (DIVERGENCE U1).
//
// The parabola path finder (ParabolaUniversalPathFinder) and the Bezier curve
// helpers (CubicBezierCurve / DistanceBasedBezierCurve) are ported VERBATIM as
// module-local helpers so isTrajectoryInterceptableBySam + maybeDestroyEnemySam
// are faithful at Hard/Impossible (the default replicated difficulty). The path
// finder uses the GameMap x/y/ref/height surface — all exposed on `game`.
//
// ASYNC: maybeSendNuke() becomes async (nationExecution awaits it); the only
// worker calls are the buildables probes for the FINAL chosen nuke tile and the
// salvo (candidate tile generation is all sync — random territory tiles + unit
// tiles). Each worker call is wrapped in withTimeout(p, WORKER_TIMEOUT_MS, fallback).
//
// Constructed by nationExecution with (random, game, player, attackBehavior,
// emojiBehavior). The attackBehavior instance exposes shouldAttack(target) and
// findIncomingAttackPlayer() (AttackBehavior port) — called exactly as src.
//
// Loaded with the other behavior modules (after portutil/gameApi and the emoji
// phase which provides EMOJI_NUKE), before nationExecution.
// Classic-script shared-global scope (no IIFE): top-level names (the NUKE_*
// consts, the curve/path-finder helper classes, the NukeBehavior class) are
// visible to the sibling modules and must stay unique across the bundle.

"use strict";

  // ===========================================================================
  // Constants — NationNukeBehavior.ts:25-35
  // ===========================================================================

  /** Cap on silo levels reachable via maybeDestroyEnemySam's upgrade fallback. */
  const MAX_NATION_SILO_UPGRADE_LEVEL = 5;

  /**
   * Level-weighted structure density (sum of structure levels per tile owned)
   * above which the richest impossible nation will pre-emptively nuke a player.
   */
  const HIGH_DENSITY_NUKE_THRESHOLD = 1 / 75;

  /** Minimum sum of structure levels a player needs to qualify as a high-density nuke target. */
  const MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE = 5;

  // Structures group — src/core/game/Game.ts:374 (Structures.types). Defined
  // module-local under a unique name (no `Structures` global exists in the bundle)
  // so `nukeTarget.units(...NUKE_STRUCTURES_TYPES)` mirrors `units(...Structures.types)`.
  const NUKE_STRUCTURES_TYPES = [
    UNIT.City,
    UNIT.DefensePost,
    UNIT.SAMLauncher,
    UNIT.MissileSilo,
    UNIT.Port,
    UNIT.Factory,
  ];

  // ===========================================================================
  // euclDistFN — src/core/game/GameMap.ts:454. Returns a predicate (gm, tile) =>
  // distance(root, tile) within `dist`. Only the `center=false` branch is used by
  // nukeTileScore; the center branch is ported for completeness.
  // ===========================================================================
  function euclDistFN(root, dist, center) {
    const dist2 = dist * dist;
    if (!center) {
      return (gm, n) => gm.euclideanDistSquared(root, n) <= dist2;
    } else {
      return (gm, n) => {
        // shifts the root tile's coordinates by -0.5 so that its "center"
        // becomes the corner of four pixels rather than the middle of one pixel.
        const dx = gm.x(root) - 0.5 - gm.x(n);
        const dy = gm.y(root) - 0.5 - gm.y(n);
        return dx * dx + dy * dy <= dist2;
      };
    }
  }

  // ===========================================================================
  // Bezier curve helpers — src/core/utilities/Line.ts (ported VERBATIM, only TS
  // types dropped). CubicBezierCurve + DistanceBasedBezierCurve back the parabola
  // path finder. (BezenhamLine is not needed by the nuke behavior and is omitted.)
  // ===========================================================================
  class NukeCubicBezierCurve {
    constructor(p0, p1, p2, p3) {
      this.p0 = p0;
      this.p1 = p1;
      this.p2 = p2;
      this.p3 = p3;
    }
    getPointAt(t) {
      const T = 1 - t;
      const TT = T * T;
      const TTT = TT * T;
      const tt = t * t;
      const ttt = tt * t;

      const x =
        TTT * this.p0.x +
        3 * TT * t * this.p1.x +
        3 * T * tt * this.p2.x +
        ttt * this.p3.x;

      const y =
        TTT * this.p0.y +
        3 * TT * t * this.p1.y +
        3 * T * tt * this.p2.y +
        ttt * this.p3.y;
      return { x, y };
    }
  }

  /**
   *  Use a cumulative distance LUT to approximate the traveled distance
   *  Useful to compute regular steps based on the curve rather than a t
   */
  class NukeDistanceBasedBezierCurve extends NukeCubicBezierCurve {
    constructor(p0, p1, p2, p3, distanceIncrement) {
      super(p0, p1, p2, p3);
      this.totalDistance = 0;
      this.cachedPoints = [];
      this.currentIndex = 0;
      this.computeAllPoints(distanceIncrement, 0.002);
    }

    getAllPoints() {
      return this.cachedPoints;
    }
    /**
     * Move forward along the curve by the given distance.
     * Returns the next cached point, or null if at the end.
     */
    increment(distance) {
      this.totalDistance += distance;

      // Step forward through cached points until we're at the correct distance
      while (
        this.currentIndex < this.cachedPoints.length - 1 &&
        this.getDistanceUpToIndex(this.currentIndex + 1) < this.totalDistance
      ) {
        this.currentIndex++;
      }

      if (this.currentIndex >= this.cachedPoints.length - 1) {
        return null; // End of curve
      }

      return this.cachedPoints[this.currentIndex];
    }

    getCurrentIndex() {
      return this.currentIndex;
    }

    /**
     * Precompute all points spaced @p pixelSpacing apart
     */
    computeAllPoints(pixelSpacing, precision) {
      this.cachedPoints = [];
      this.totalDistance = 0;
      this.currentIndex = 0;

      let t = 0;
      let prevPoint = this.getPointAt(t);
      this.cachedPoints.push(prevPoint);

      let cumulativeDistance = 0;

      while (t < 1) {
        t = Math.min(t + precision, 1);
        const currentPoint = this.getPointAt(t);

        const dx = currentPoint.x - prevPoint.x;
        const dy = currentPoint.y - prevPoint.y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);
        cumulativeDistance += segmentLength;

        if (cumulativeDistance >= pixelSpacing) {
          this.cachedPoints.push(currentPoint);
          cumulativeDistance = 0;
        }

        prevPoint = currentPoint;
      }

      // Make sure the last point is exactly at t=1
      const finalPoint = this.getPointAt(1);
      if (
        this.cachedPoints.length === 0 ||
        finalPoint.x !== this.cachedPoints[this.cachedPoints.length - 1].x ||
        finalPoint.y !== this.cachedPoints[this.cachedPoints.length - 1].y
      ) {
        this.cachedPoints.push(finalPoint);
      }
    }

    /**
     * Optional helper: get distance along the cached points up to a given index
     */
    getDistanceUpToIndex(index) {
      let dist = 0;
      for (let i = 1; i <= index; i++) {
        const p1 = this.cachedPoints[i - 1];
        const p2 = this.cachedPoints[i];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        dist += Math.sqrt(dx * dx + dy * dy);
      }
      return dist;
    }
  }

  // ===========================================================================
  // ParabolaUniversalPathFinder — src/core/pathfinding/PathFinder.Parabola.ts
  // (ported VERBATIM, only TS types + SteppingPathFinder interface dropped). Only
  // findPath() is used by the nuke behavior, but next()/invalidate()/currentIndex()
  // are ported too for faithfulness. Constructed via the UniversalPathFinding
  // .Parabola(game, opts) factory below (mirroring src's UniversalPathFinding).
  // ===========================================================================
  const PARABOLA_MIN_HEIGHT = 50;

  class NukeParabolaUniversalPathFinder {
    constructor(gameMap, options) {
      this.gameMap = gameMap;
      this.options = options;
      this.curve = null;
      this.lastTo = null;
    }

    createCurve(from, to) {
      const increment = this.options?.increment ?? 3;
      const distanceBasedHeight = this.options?.distanceBasedHeight ?? true;
      const directionUp = this.options?.directionUp ?? true;

      const p0 = { x: this.gameMap.x(from), y: this.gameMap.y(from) };
      const p3 = { x: this.gameMap.x(to), y: this.gameMap.y(to) };
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxHeight = distanceBasedHeight
        ? Math.max(distance / 3, PARABOLA_MIN_HEIGHT)
        : 0;
      const heightMult = directionUp ? -1 : 1;
      const mapHeight = this.gameMap.height();

      const p1 = {
        x: p0.x + dx / 4,
        y: within(p0.y + dy / 4 + heightMult * maxHeight, 0, mapHeight - 1),
      };
      const p2 = {
        x: p0.x + (dx * 3) / 4,
        y: within(p0.y + (dy * 3) / 4 + heightMult * maxHeight, 0, mapHeight - 1),
      };

      return new NukeDistanceBasedBezierCurve(p0, p1, p2, p3, increment);
    }

    findPath(from, to) {
      if (Array.isArray(from)) {
        throw new Error(
          "ParabolaUniversalPathFinder does not support multiple start points",
        );
      }
      const curve = this.createCurve(from, to);
      return curve
        .getAllPoints()
        .map((p) => this.gameMap.ref(Math.floor(p.x), Math.floor(p.y)));
    }

    next(from, to, speed) {
      if (this.lastTo !== to) {
        this.curve = this.createCurve(from, to);
        this.lastTo = to;
      }

      const nextPoint = this.curve.increment(speed ?? 1);
      if (!nextPoint) {
        // src returns { status: PathStatus.COMPLETE, node: to }
        return { status: "Complete", node: to };
      }
      const tile = this.gameMap.ref(
        Math.floor(nextPoint.x),
        Math.floor(nextPoint.y),
      );
      // src returns { status: PathStatus.NEXT, node: tile }
      return { status: "Next", node: tile };
    }

    invalidate() {
      this.curve = null;
      this.lastTo = null;
    }

    currentIndex() {
      return this.curve?.getCurrentIndex() ?? 0;
    }
  }

  // UniversalPathFinding.Parabola factory — src/core/pathfinding/PathFinder.ts.
  // src calls `UniversalPathFinding.Parabola(this.game, opts)`; mirror it.
  const UniversalPathFinding = {
    Parabola(gameMap, options) {
      return new NukeParabolaUniversalPathFinder(gameMap, options);
    },
  };

  // ===========================================================================
  // NukeBehavior — 1:1 port of NationNukeBehavior
  // ===========================================================================
  class NukeBehavior {
    constructor(random, game, player, attackBehavior, emojiBehavior) {
      this.random = random;
      this.game = game;
      this.player = player;
      this.attackBehavior = attackBehavior;
      this.emojiBehavior = emojiBehavior;

      // recentlySentNukes: [Tick, TileRef, nukeType][] — NationNukeBehavior.ts:38
      this.recentlySentNukes = [];
      this.atomBombsLaunched = 0;
      // DIVERGENCE C1: src seeds the perceived cost from cost(type) synchronously
      // in field initializers. The client cost is async (buildables probe), so we
      // CANNOT seed these from a live price at construction time. We lazily seed
      // them on first use (see getPerceivedNukeCost) from the live atom/hydro cost,
      // then escalate them by 50%/25% per launch exactly as src does. Until seeded
      // they are null (sentinel "not yet observed").
      this.atomBombPerceivedCost = null;
      this.hydrogenBombPerceivedCost = null;
      this.hydrogenBombsLaunched = 0;
      // Make 1/3 of nations "hydro-nations" that only throw hydrogen bombs (to
      // reduce atom bomb spam) — NationNukeBehavior.ts:48. For our single bot we
      // keep the per-instance random designation faithfully.
      // DIVERGENCE (bestAI): src makes 1 nation in 3 a "hydrogen-only" nation that
      // refuses to fire atom bombs unless it is already being overrun. Pure
      // self-handicap - always keep both warheads available.
      this.isHydroNation = false;

      // Per-tick cost memo (see cost()): keyed by unit type, invalidated per tick.
      this._costCacheTick = -1;
      this._costCache = new Map();
    }

    // ── maybeSendNuke — NationNukeBehavior.ts:58 (now async) ──────────────────
    async maybeSendNuke() {
      // WIN-FIX (NOT in src): when mirvBehavior has set the MIRV war-chest
      // (state.nukeReserveGold ≥ 15M, saving for a leader/pre-empt MIRV), DON'T
      // spend the gold on smaller atom/hydrogen nukes. That drain is exactly what
      // was starving the MIRV (gold oscillated 10–18M, never reached its 25M
      // price) and blocking the close-out from ~65% to victory. Hold fire until
      // the MIRV launches (mirvBehavior clears the chest on fire).
      if (state.settings.winFixes && state.nukeReserveGold) {
        let reserve = 0n;
        try {
          reserve = BigInt(state.nukeReserveGold || 0);
        } catch (_e) {
          reserve = 0n;
        }
        if (reserve >= 15000000n) return;
      }
      const silos = this.player.units(UNIT.MissileSilo);
      const config = this.game.config();
      if (
        silos.length === 0 ||
        config.isUnitDisabled(UNIT.MissileSilo) ||
        (config.isUnitDisabled(UNIT.AtomBomb) &&
          config.isUnitDisabled(UNIT.HydrogenBomb))
      ) {
        return;
      }

      const nukeTarget = this.findBestNukeTarget();
      if (nukeTarget === null) {
        return;
      }

      if (
        nukeTarget.type() === PlayerType.Bot || // Don't nuke tribes (as opposed to nations and humans)
        this.player.isOnSameTeam(nukeTarget) ||
        this.attackBehavior.shouldAttack(nukeTarget) === false
      ) {
        return;
      }

      const hydroCost = await this.getPerceivedNukeCost(UNIT.HydrogenBomb);
      const atomCost = await this.getPerceivedNukeCost(UNIT.AtomBomb);
      let nukeType;
      if (
        !this.game.config().isUnitDisabled(UNIT.HydrogenBomb) &&
        this.player.gold() >= hydroCost
      ) {
        nukeType = UNIT.HydrogenBomb;
      } else if (
        !this.game.config().isUnitDisabled(UNIT.AtomBomb) &&
        (!this.isHydroNation || this.isUnderHeavyAttack()) &&
        this.player.gold() >= atomCost
      ) {
        nukeType = UNIT.AtomBomb;
      } else {
        return;
      }
      const range = this.game.config().nukeMagnitudes(nukeType).outer;

      const structures = nukeTarget.units(...NUKE_STRUCTURES_TYPES);
      const structureTiles = structures.map((u) => u.tile());
      const difficulty = currentDifficulty();
      // Use more random tiles on Impossible difficulty to improve chances of
      // finding a perfect SAM outranging spot
      const numRandomTiles = difficulty === Difficulty.Impossible ? 30 : 10;
      // randTerritoryTileArray reads nukeTarget.borderTiles() SYNCHRONOUSLY; on
      // the client that snapshot is empty for a non-"me" player unless we first
      // prefetch it. (ASYNC boundary — contract §3.) Wrap in withTimeout.
      await withTimeout(
        this.game.ensureBorderTiles(nukeTarget),
        WORKER_TIMEOUT_MS,
        null,
      );
      const randomTiles = randTerritoryTileArray(
        this.random,
        this.game,
        nukeTarget,
        numRandomTiles,
      );
      const allTiles = randomTiles.concat(structureTiles);

      let bestTile = null;
      let bestValue = -1; // -1 is important, so that we can also nuke land without structures
      this.removeOldNukeEvents();

      // src probes player.canBuild(nukeType, tile) SYNCHRONOUSLY inside the loop.
      // On the client canBuild is an async buildables probe, so we use the
      // rank-then-probe pattern: do ALL synchronous validation + scoring first,
      // collect surviving candidates with their scores, then probe buildables down
      // the ranked list and take the best whose canBuild !== false. This preserves
      // the exact src ordering of which tile wins (the buildables probe is the SAME
      // gate src applies, just deferred to after sync scoring).
      const candidates = [];
      outer: for (const tile of new Set(allTiles)) {
        if (tile === null) continue;
        const boundingBox = boundingBoxTiles(this.game, tile, range)
          // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
          .concat(boundingBoxTiles(this.game, tile, Math.floor(range / 2)));
        for (const t of boundingBox) {
          if (!this.isValidNukeTile(t, nukeTarget)) {
            continue outer;
          }
        }
        // DIVERGENCE B1: src checks `const spawnTile = this.player.canBuild(
        // nukeType, tile); if (spawnTile === false) continue;` synchronously, then
        // uses spawnTile (the silo tile the nuke would launch from) as the trajectory
        // start. The client canBuild is async, so we DEFER the canBuild gate to the
        // rank-then-probe pass below. For the trajectory check (which needs the
        // spawn/silo tile NOW), we mirror NukeExecution's nukeSpawn: the closest
        // non-cooldown silo by Manhattan distance to the target — the same silo
        // canBuild would have snapped to. (When the deferred buildables probe later
        // returns a canBuild TileRef it is this same launch silo.)
        const spawnTile = this.nukeSpawn(nukeType, tile);
        if (spawnTile === false) continue;

        // In team games, avoid nuking the same position as a teammate
        if (
          this.game.config().gameConfig().gameMode === GameMode.Team &&
          difficulty !== Difficulty.Easy &&
          this.isTeammateAlreadyNukingThisSpot(tile, nukeType)
        ) {
          continue;
        }

        // On Hard & Impossible, avoid trajectories that can be intercepted by enemy SAMs
        if (
          (difficulty === Difficulty.Hard ||
            difficulty === Difficulty.Impossible) &&
          this.isTrajectoryInterceptableBySam(spawnTile, tile)
        ) {
          continue;
        }

        const value = this.nukeTileScore(tile, silos, structures, nukeType);
        candidates.push({ tile, value });
      }

      // Pick the best-scoring candidate exactly as src: src adopts a tile only when
      // `value > bestValue` (bestValue starts at -1), keeping the FIRST tile at a
      // given max (Set insertion order). We replicate that by a STABLE sort desc
      // (V8 Array.sort is stable, so equal-score tiles keep Set order), then probe
      // buildables down the list and take the FIRST canBuild-passing tile whose
      // score still beats the initial bestValue (-1). Outcome is identical to src's
      // inline scan: the highest-scoring canBuild-passing tile with value > -1 wins.
      candidates.sort((a, b) => b.value - a.value);
      for (const cand of candidates) {
        // strict `>` semantics vs the initial bestValue (-1): a tile scoring exactly
        // -1 (or lower) never becomes bestTile in src, so skip it here too. Since the
        // list is sorted desc, once we hit a candidate that isn't > -1 the rest can't
        // be either — but we still confirm canBuild on each higher candidate.
        if (!(cand.value > bestValue)) break;
        const canBuild = await this.probeCanBuildNuke(cand.tile, nukeType);
        if (!canBuild) continue;
        bestTile = cand.tile;
        bestValue = cand.value;
        break;
      }

      // DIVERGENCE (samCrack): src only cracks SAM batteries on Impossible, and only as
      // a last resort. With samCrack on, prefer breaking the SAM wall over spending a
      // warhead on a zero-value target, at any difficulty. Salvo sizing/pacing is
      // untouched — maybeDestroyEnemySam already fires totalInterceptions + 1 (+ margin)
      // inside SAMCooldown()/2 and bails on insufficient gold or silo slots, so this
      // stays gradual: it simply does nothing until the economy can fund a full salvo.
      const samCrack = Boolean(state.settings.samCrack);
      if (
        bestTile !== null &&
        (bestValue > 0 || (difficulty !== Difficulty.Impossible && !samCrack))
      ) {
        await this.sendNuke(bestTile, nukeType, nukeTarget);
      } else if (difficulty === Difficulty.Impossible || samCrack) {
        await this.maybeDestroyEnemySam(nukeTarget);
      }
    }

    // ── findBestNukeTarget — NationNukeBehavior.ts:166 ────────────────────────
    findBestNukeTarget() {
      // On Hard & Impossible with only 2 players left, target the only other one
      const diff = currentDifficulty();
      if (
        (diff === Difficulty.Hard || diff === Difficulty.Impossible) &&
        this.game.players().length === 2
      ) {
        const other = this.game
          .players()
          .find((p) => p.smallID() !== this.player.smallID());
        if (other) {
          return other;
        }
      }

      // Retaliate against incoming attacks (Most important!)
      const incomingAttackPlayer = this.attackBehavior.findIncomingAttackPlayer();
      if (incomingAttackPlayer) {
        return incomingAttackPlayer;
      }

      // On Impossible, the richest nation hunts very high structure density targets
      // Restricting to the richest nation prevents every impossible nation
      // from piling onto the same compact player.
      // DIVERGENCE (bestAI): src gates this behind Impossible + being the richest
      // nation + a 50% roll, so a whole lobby of nations does not pile onto one
      // compact player. We are a single bot - that anti-pile-on rule only costs us
      // targets. Note this sits BELOW retaliation in the cascade, so always-on here
      // cannot pre-empt answering an actual attack.
      {
        const denseTarget = this.findHighDensityTarget();
        if (denseTarget !== null) {
          return denseTarget;
        }
      }

      // On impossible difficulty, prioritize nuking the crown if they have more than 50% of the map
      const difficulty = currentDifficulty();
      const gameMode = this.game.config().gameConfig().gameMode;
      if (difficulty === Difficulty.Impossible && gameMode === GameMode.FFA) {
        const numTilesWithoutFallout =
          this.game.numLandTiles() - this.game.numTilesWithFallout();
        if (numTilesWithoutFallout > 0) {
          const sortedByTiles = this.game
            .players()
            .slice()
            .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
          const crown = sortedByTiles[0];

          if (
            crown &&
            crown.smallID() !== this.player.smallID() &&
            !this.player.isFriendly(crown)
          ) {
            const crownShare = crown.numTilesOwned() / numTilesWithoutFallout;
            if (crownShare > 0.5) {
              return crown;
            }
          }
        }
      }

      // Assist allies, check their targets (this is basically the same as in assistAllies, but without sending emojis)
      for (const ally of this.player.allies()) {
        if (ally.targets().length === 0) continue;
        if (this.player.relation(ally) < Relation.Friendly) continue;

        for (const target of ally.targets()) {
          if (target.smallID() === this.player.smallID()) continue;
          if (this.player.isFriendly(target)) continue;
          // Found a valid ally target to nuke
          return target;
        }
      }

      // Find the most hated player
      // Ignore much weaker players (we don't need nukes to deal with them)
      const myMaxTroops = this.game.config().maxTroops(this.player);
      for (const relation of this.player.allRelationsSorted()) {
        if (relation.relation !== Relation.Hostile) continue;
        const other = relation.player;
        if (this.player.isFriendly(other)) continue;

        const otherMaxTroops = this.game.config().maxTroops(other);
        if (myMaxTroops >= otherMaxTroops * 2) continue;

        return other;
      }

      // In FFAs, nuke the crown if they're far enough ahead
      const crownTarget = this.findFFACrownTarget();
      if (crownTarget) {
        return crownTarget;
      }

      // In Teams, nuke the strongest team
      const teamTarget = this.findStrongestTeamTarget();
      if (teamTarget) {
        return teamTarget;
      }

      return null;
    }

    // ── isRichestNation — NationNukeBehavior.ts:262 ───────────────────────────
    isRichestNation() {
      const myGold = this.player.gold();
      for (const other of this.game.players()) {
        if (other.smallID() === this.player.smallID()) continue;
        if (other.type() !== PlayerType.Nation) continue;
        if (other.gold() > myGold) return false;
      }
      return true;
    }

    // ── findHighDensityTarget — NationNukeBehavior.ts:272 ─────────────────────
    findHighDensityTarget() {
      let bestTarget = null;
      let bestDensity = HIGH_DENSITY_NUKE_THRESHOLD;
      for (const other of this.game.players()) {
        if (other.smallID() === this.player.smallID()) continue;
        if (other.type() === PlayerType.Bot) continue;
        if (this.player.isFriendly(other)) continue;
        const tilesOwned = other.numTilesOwned();
        if (tilesOwned === 0) continue;
        const structures = other.units(...NUKE_STRUCTURES_TYPES);
        let levelSum = 0;
        for (const s of structures) levelSum += s.level();
        // Skip players with too few structures regardless of density
        if (levelSum < MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE) continue;
        const density = levelSum / tilesOwned;
        if (density > bestDensity) {
          bestDensity = density;
          bestTarget = other;
        }
      }
      return bestTarget;
    }

    // ── findFFACrownTarget — NationNukeBehavior.ts:295 ────────────────────────
    findFFACrownTarget() {
      const difficulty = currentDifficulty();
      const gameMode = this.game.config().gameConfig().gameMode;
      if (gameMode !== GameMode.FFA) {
        return null;
      }

      if (this.game.players().length <= 1) {
        return null;
      }

      const sortedByTiles = this.game
        .players()
        .slice()
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
      const firstPlace = sortedByTiles[0];

      // If we're the crown on Impossible difficulty, target 2nd place
      if (
        difficulty === Difficulty.Impossible &&
        firstPlace.smallID() === this.player.smallID() &&
        sortedByTiles.length >= 2
      ) {
        const secondPlace = sortedByTiles[1];
        if (!this.player.isFriendly(secondPlace)) {
          return secondPlace;
        }
      }

      // Don't target ourselves or allies
      if (
        firstPlace.smallID() === this.player.smallID() ||
        this.player.isFriendly(firstPlace)
      ) {
        return null;
      }

      const numTilesWithoutFallout =
        this.game.numLandTiles() - this.game.numTilesWithFallout();
      if (numTilesWithoutFallout <= 0) {
        return null;
      }

      const firstPlaceShare =
        firstPlace.numTilesOwned() / numTilesWithoutFallout;
      const myShare = this.player.numTilesOwned() / numTilesWithoutFallout;

      let threshold;
      switch (difficulty) {
        case Difficulty.Easy:
          threshold = 0.4; // 40%
          break;
        case Difficulty.Medium:
          threshold = 0.3; // 30%
          break;
        case Difficulty.Hard:
          threshold = 0.2; // 20%
          break;
        case Difficulty.Impossible:
          threshold = 0.1; // 10%
          break;
        default:
          // assertNever(difficulty) — unreachable; keep faithful fall-through.
          threshold = 0.1;
      }

      // Check if first place has threshold% more tile-percentage of the map than us
      if (firstPlaceShare - myShare > threshold) {
        return firstPlace;
      }

      return null;
    }

    // ── findStrongestTeamTarget — NationNukeBehavior.ts:363 ───────────────────
    findStrongestTeamTarget() {
      if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
        return null;
      }

      if (this.game.players().length <= 1) {
        return null;
      }

      const teamTiles = new Map();
      const teamPlayers = new Map();

      for (const p of this.game.players()) {
        const team = p.team();
        if (team === null) continue;

        teamTiles.set(team, (teamTiles.get(team) ?? 0) + p.numTilesOwned());
        let players = teamPlayers.get(team);
        if (!players) {
          players = [];
          teamPlayers.set(team, players);
        }
        players.push(p);
      }

      const sortedTeams = Array.from(teamTiles.entries()).sort(
        (a, b) => b[1] - a[1],
      );

      if (sortedTeams.length === 0) {
        return null;
      }

      let strongestTeam = sortedTeams[0][0];
      // team is a team id (string), not a player — keep the `===` compare.
      if (strongestTeam === this.player.team()) {
        if (sortedTeams.length > 1) {
          strongestTeam = sortedTeams[1][0];
        } else {
          return null;
        }
      }

      const targetTeamPlayers = teamPlayers.get(strongestTeam);

      // Filter out friendly players
      const validTargets = targetTeamPlayers.filter(
        (p) => !this.player.isFriendly(p),
      );

      if (validTargets.length === 0) {
        return null;
      }

      // DIVERGENCE (bestAI): src picks a RANDOM member of the strongest team half
      // the time. Always take the strongest member.
      return validTargets.reduce((prev, current) =>
        this.game.config().maxTroops(prev) > this.game.config().maxTroops(current)
          ? prev
          : current,
      );
    }

    // ── getPerceivedNukeCost — NationNukeBehavior.ts:431 (now async; cost() is a
    //    buildables probe). Simulate saving up for a MIRV. ─────────────────────
    async getPerceivedNukeCost(type) {
      // If only 2 players left, use actual cost (no point saving for MIRV)
      if (this.game.players().length === 2) {
        return await this.cost(type);
      }

      // If MIRVs are disabled, return the actual cost
      if (this.game.config().isUnitDisabled(UNIT.MIRV)) {
        return await this.cost(type);
      }

      // Save up a limited amount in team games, synced with NationStructureBehavior
      // Saving up for a MIRV is not relevant
      if (
        this.game.config().gameConfig().gameMode === GameMode.Team &&
        this.player.gold() > (await this.cost(UNIT.HydrogenBomb))
      ) {
        return await this.cost(type);
      }

      // Return the actual cost if we already have enough gold to buy both a MIRV and a hydro
      if (
        this.player.gold() >
        (await this.cost(UNIT.MIRV)) + (await this.cost(UNIT.HydrogenBomb))
      ) {
        return await this.cost(type);
      }

      // On Hard & Impossible, ignore perceived cost when under heavy attack
      // The nation is probably going to get destroyed soon, so go all-in on nukes
      const difficulty = currentDifficulty();
      if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        this.isUnderHeavyAttack()
      ) {
        return await this.cost(type);
      }

      // DIVERGENCE C1: src seeds atom/hydrogenBombPerceivedCost from cost(type) in
      // field initializers. We seed lazily here on first use (from the live cost),
      // then escalate per launch (in sendNuke). Until seeded, fall back to the live
      // cost — identical to src's initial value (cost(type) before any launch).
      if (type === UNIT.AtomBomb) {
        if (this.atomBombPerceivedCost === null) {
          this.atomBombPerceivedCost = await this.cost(UNIT.AtomBomb);
        }
        return this.atomBombPerceivedCost;
      } else {
        if (this.hydrogenBombPerceivedCost === null) {
          this.hydrogenBombPerceivedCost = await this.cost(UNIT.HydrogenBomb);
        }
        return this.hydrogenBombPerceivedCost;
      }
    }

    // ── isUnderHeavyAttack — NationNukeBehavior.ts:477 ────────────────────────
    isUnderHeavyAttack() {
      // Get the total incoming attack troops
      const incomingAttacks = this.player.incomingAttacks();
      let totalIncomingTroops = 0;
      for (const attack of incomingAttacks) {
        totalIncomingTroops += attack.troops();
      }

      const myTroops = this.player.troops();

      return totalIncomingTroops >= myTroops;
    }

    // ── removeOldNukeEvents — NationNukeBehavior.ts:490 ───────────────────────
    removeOldNukeEvents() {
      const maxAge = 600; // 600 ticks = 1 minute
      const tick = this.game.ticks();
      while (
        this.recentlySentNukes.length > 0 &&
        this.recentlySentNukes[0][0] + maxAge < tick
      ) {
        this.recentlySentNukes.shift();
      }
    }

    // ── isTeammateAlreadyNukingThisSpot — NationNukeBehavior.ts:501 ───────────
    isTeammateAlreadyNukingThisSpot(tile, nukeType) {
      // Get the inner radius for our nuke type
      const ourInnerRadius = this.game.config().nukeMagnitudes(nukeType).inner;

      // Get all active nukes in the game
      const activeNukes = this.game.units(UNIT.AtomBomb, UNIT.HydrogenBomb);

      // Check if any teammate's nuke blast radius overlaps with ours
      for (const nuke of activeNukes) {
        const nukeOwner = nuke.owner();

        // Skip our own nukes and non-teammate nukes
        if (
          (nukeOwner &&
            nukeOwner.smallID &&
            nukeOwner.smallID() === this.player.smallID()) ||
          !this.player.isFriendly(nukeOwner)
        ) {
          continue;
        }

        // Get the target tile of the teammate's nuke
        const targetTile = nuke.targetTile();
        if (!targetTile) continue;

        // Get the blast radius of the teammate's nuke
        const teammateInnerRadius = this.game
          .config()
          .nukeMagnitudes(nuke.type()).inner;

        // Check if the blast zones overlap
        // They overlap if distance between targets < sum of the two radii
        const distSquared = this.game.euclideanDistSquared(tile, targetTile);
        const sumRadius = ourInnerRadius + teammateInnerRadius;
        const sumRadiusSquared = sumRadius * sumRadius;

        if (distSquared <= sumRadiusSquared) {
          return true;
        }
      }

      return false;
    }

    // ── isTrajectoryInterceptableBySam — NationNukeBehavior.ts:547 ────────────
    // mirroring NukeTrajectoryPreviewLayer.ts logic a bit
    isTrajectoryInterceptableBySam(spawnTile, targetTile, excludedSamIds) {
      const speed = this.game.config().defaultNukeSpeed();
      const pathFinder = UniversalPathFinding.Parabola(this.game, {
        increment: speed,
        distanceBasedHeight: true, // Atom/Hydrogen bombs use distance-based height
        directionUp: true, // AI nukes always go "up" for now
      });

      const trajectory = pathFinder.findPath(spawnTile, targetTile) ?? [];
      if (trajectory.length === 0) {
        return false;
      }

      const targetRangeSquared =
        this.game.config().defaultNukeTargetableRange() ** 2;

      let untargetableStart = -1;
      let untargetableEnd = -1;
      for (let i = 0; i < trajectory.length; i++) {
        const tile = trajectory[i];
        if (untargetableStart === -1) {
          if (
            this.game.euclideanDistSquared(tile, spawnTile) > targetRangeSquared
          ) {
            if (
              this.game.euclideanDistSquared(tile, targetTile) <
              targetRangeSquared
            ) {
              // Overlapping spawn & target range – no untargetable segment.
              break;
            } else {
              untargetableStart = i;
            }
          }
        } else if (
          this.game.euclideanDistSquared(tile, targetTile) < targetRangeSquared
        ) {
          untargetableEnd = i;
          break;
        }
      }

      for (let i = 0; i < trajectory.length; i++) {
        // Skip the mid-air untargetable portion
        if (
          untargetableStart !== -1 &&
          untargetableEnd !== -1 &&
          i === untargetableStart
        ) {
          i = untargetableEnd - 1;
          continue;
        }

        const tile = trajectory[i];
        const nearbySams = this.game.nearbyUnits(
          tile,
          this.game.config().maxSamRange(),
          UNIT.SAMLauncher,
        );

        for (const sam of nearbySams) {
          // sam.unit is a RAW core/view unit (nearbyUnits is a passthrough — not
          // wrapped). owner() returns a RAW player; compare identity by smallID and
          // pass the raw owner to isFriendly (gameApi.isFriendly unwraps it anyway).
          const owner = sam.unit.owner();
          if (
            (owner && owner.smallID && owner.smallID() === this.player.smallID()) ||
            this.player.isFriendly(owner)
          ) {
            continue;
          }
          // Skip SAMs we're intentionally overwhelming
          if (excludedSamIds?.has(sam.unit.id())) {
            continue;
          }
          const rangeSquared =
            this.game.config().samRange(sam.unit.level()) ** 2;
          if (sam.distSquared <= rangeSquared) {
            return true;
          }
        }
      }

      return false;
    }

    // ── isValidNukeTile — NationNukeBehavior.ts:630 ───────────────────────────
    isValidNukeTile(t, nukeTarget) {
      const difficulty = currentDifficulty();

      const owner = this.game.owner(t);
      // src: `if (owner === nukeTarget) return true;` — identity compare. owner is
      // a wrapped player (or TN passthrough). Compare via smallID when both are
      // players; nukeTarget is always a player here.
      if (
        owner &&
        owner.isPlayer &&
        owner.isPlayer() &&
        owner.smallID() === nukeTarget.smallID()
      ) {
        return true;
      }
      // On Hard & Impossible, allow TerraNullius (hit small islands) and in team games other non-friendly players
      if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        (!(owner && owner.isPlayer && owner.isPlayer()) ||
          (this.game.config().gameConfig().gameMode === GameMode.Team &&
            owner.isPlayer() &&
            !this.player.isFriendly(owner)))
      ) {
        return true;
      }
      // On Easy & Medium, only allow tiles owned by the target player (=> nuke away from the border) to reduce nuke usage
      return false;
    }

    // ── nukeTileScore — NationNukeBehavior.ts:650 ─────────────────────────────
    nukeTileScore(tile, silos, targets, nukeType) {
      const magnitude = this.game.config().nukeMagnitudes(nukeType);
      const dist = euclDistFN(tile, magnitude.outer, false);
      let tileValue = targets
        .filter((unit) => dist(this.game, unit.tile()))
        .map((unit) => {
          const level = unit.level();
          switch (unit.type()) {
            case UNIT.City:
              return 25_000 * level;
            case UNIT.DefensePost:
              return 5_000 * level;
            case UNIT.MissileSilo:
              return 50_000 * level;
            case UNIT.Port:
              return 15_000 * level;
            case UNIT.Factory:
              return 15_000 * level;
            default:
              return 0;
          }
        })
        .reduce((prev, cur) => prev + cur, 0);

      const difficulty = currentDifficulty();
      // On Easy, ignore SAMs entirely.
      // On Medium, apply a simple local SAM penalty.
      // On Hard & Impossible we rely on trajectory-based interception checks instead. See maybeSendNuke().
      if (difficulty === Difficulty.Medium) {
        const dist50 = euclDistFN(tile, 50, false);
        const hasSam = targets.some(
          (unit) =>
            unit.type() === UNIT.SAMLauncher && dist50(this.game, unit.tile()),
        );
        if (hasSam) return -1;
      }

      // On Impossible difficulty and a hydrogen bomb, add value for SAMs that can be outranged
      if (
        difficulty === Difficulty.Impossible &&
        nukeType === UNIT.HydrogenBomb
      ) {
        const hydroMagnitude = this.game
          .config()
          .nukeMagnitudes(UNIT.HydrogenBomb);
        const nearbySams = this.game.nearbyUnits(
          tile,
          hydroMagnitude.outer,
          UNIT.SAMLauncher,
        );

        for (const sam of nearbySams) {
          const samLevel = sam.unit.level();
          if (samLevel >= 5) continue; // Can't outrange level 5+ SAMs

          const samRange = this.game.config().samRange(samLevel);
          const distToSam = Math.sqrt(
            this.game.euclideanDistSquared(tile, sam.unit.tile()),
          );

          // Check if we can outrange this SAM
          if (distToSam > samRange) {
            // Add significant value for destroying a SAM that we can outrange
            tileValue += 100_000 * samLevel;
          }
        }
      }

      // Prefer tiles that are closer to a silo (but preserve structure value)
      const siloTiles = silos.map((u) => u.tile());
      const result = closestTwoTiles(this.game, siloTiles, [tile]);
      if (result === null) throw new Error("Missing result");
      const closestSilo = result.x;
      const distanceSquared = this.game.euclideanDistSquared(tile, closestSilo);
      const distanceToClosestSilo = Math.sqrt(distanceSquared);
      const distancePenalty = distanceToClosestSilo * 30;
      const baseTileValue = tileValue;
      tileValue = Math.max(baseTileValue * 0.2, tileValue - distancePenalty); // Keep at least 20% of structure value

      // Don't target near recent targets
      tileValue -= this.recentlySentNukes
        .filter(([_tick, recentTile, recentNukeType]) => {
          const recentInnerRadius = this.game
            .config()
            .nukeMagnitudes(recentNukeType).inner;
          const distSquared = this.game.euclideanDistSquared(tile, recentTile);
          return distSquared <= recentInnerRadius * recentInnerRadius;
        })
        .map((_) => 1_000_000)
        .reduce((prev, cur) => prev + cur, 0);

      return tileValue;
    }

    // ── sendNuke — NationNukeBehavior.ts:750 (now async; addExecution → build menu)
    // DIVERGENCE G1: the src NukeExecution accepts a `waitTicks` stagger so the
    // saturation salvo's bombs arrive spread across the SAM cooldown window. That
    // stagger is NOT expressible through the client build-menu intent (it fires the
    // nuke immediately, no per-bomb delay), so we DROP waitTicks — all salvo bombs
    // are fired with no stagger. The salvo SIZE / target / silo-pick order is still
    // faithful; only the arrival spread is lost. We keep the `waitTicks` parameter
    // for signature parity but never act on it.
    async sendNuke(tile, nukeType, targetPlayer, waitTicks = 0) {
      const tick = this.game.ticks();

      // Affordability + actuation via the buildables probe + build menu. Probe the
      // nuke BuildableUnit at the target tile, confirm canBuild and gold (BigInt),
      // then fire through the build menu aimed at the target tile.
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(tile, [nukeType]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return;
      }
      const bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === nukeType)
        : null;
      if (bu === null || bu === undefined) return;
      if (!(bu.canBuild !== false && this.player.gold() >= bu.cost)) return;

      const buildMenu = getBuildMenu();
      if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") return;
      buildMenu.sendBuildOrUpgrade(bu, tile);

      // Mirror src state updates only AFTER a successful fire (src does these
      // unconditionally because addExecution can't "fail"; on the client the build
      // can be rejected, so we gate them on the successful probe+emit above).
      this.recentlySentNukes.push([tick, tile, nukeType]);
      if (nukeType === UNIT.AtomBomb) {
        this.atomBombsLaunched++;
        // Increase perceived cost by 50% each time to simulate saving up for a MIRV
        // (higher than hydro to make atom bombs less attractive for the lategame)
        if (this.atomBombPerceivedCost === null) {
          this.atomBombPerceivedCost = await this.cost(UNIT.AtomBomb);
        }
        this.atomBombPerceivedCost =
          (this.atomBombPerceivedCost * 150n) / 100n;
      } else if (nukeType === UNIT.HydrogenBomb) {
        this.hydrogenBombsLaunched++;
        // Increase perceived cost by 25% each time to simulate saving up for a MIRV
        if (this.hydrogenBombPerceivedCost === null) {
          this.hydrogenBombPerceivedCost = await this.cost(UNIT.HydrogenBomb);
        }
        this.hydrogenBombPerceivedCost =
          (this.hydrogenBombPerceivedCost * 125n) / 100n;
      }

      // LOGGING (light) — on a nuke fire.
      state.stats.nukes++;
      setLastAction(tr("☢️ Launch") + " " + nukeType, "nuke");

      this.emojiBehavior.maybeSendEmoji(targetPlayer, EMOJI_NUKE);
    }

    /**
     * On Impossible difficulty, when no good nuke target is available (score <= 0),
     * attempt to destroy enemy SAMs by overwhelming them with atom bombs.
     * A SAM of level N can intercept N nukes before going on cooldown,
     * so we need N+1 bombs to destroy it (accounting for all covering SAMs).
     */
    // ── maybeDestroyEnemySam — NationNukeBehavior.ts:780 (now async) ──────────
    async maybeDestroyEnemySam(nukeTarget) {
      if (this.game.config().isUnitDisabled(UNIT.AtomBomb)) {
        return;
      }

      // Don't launch another salvo if we already have atom bombs in flight
      const ourAtomBombs = this.player.units(UNIT.AtomBomb);
      if (ourAtomBombs.length > 0) {
        return;
      }

      const atomCost = await this.cost(UNIT.AtomBomb);
      const enemySams = nukeTarget.units(UNIT.SAMLauncher);
      if (enemySams.length === 0) {
        return;
      }

      const ourSilos = this.player
        .units(UNIT.MissileSilo)
        .filter((silo) => !silo.isUnderConstruction());
      if (ourSilos.length === 0) {
        return;
      }

      // Try each enemy SAM as a target, easiest (lowest level) first
      const sortedSams = enemySams.slice().sort((a, b) => a.level() - b.level());
      let needsMoreSilos = false;
      // Track the first failed attempt so we can upgrade a silo that would
      // actually have helped that plan (rather than an unrelated silo).
      let failedTarget = null;

      for (const targetSam of sortedSams) {
        const targetTile = targetSam.tile();

        // Find all enemy SAMs whose range covers the target tile (they will all try to intercept)
        const coveringSams = this.findEnemySamsCoveringTile(targetTile);
        const coveringSamIds = new Set(coveringSams.map((s) => s.id()));

        // Total interception capacity = sum of covering SAM levels
        const totalInterceptions = coveringSams.reduce(
          (sum, sam) => sum + sam.level(),
          0,
        );
        const bombsNeeded = totalInterceptions + 1;

        // NukeExecution always picks the closest non-cooldown silo by Manhattan
        // distance to target (via nukeSpawn). Our planning must mirror that order.
        // Silos with interceptable trajectories will still be picked first by
        // NukeExecution — their bombs launch but get intercepted, "wasting" slots.
        const nukeSpeed = this.game.config().defaultNukeSpeed();
        const allAvailableSilos = [];
        for (const silo of ourSilos) {
          const availableSlots = silo.level() - silo.missileTimerQueue().length;
          if (availableSlots <= 0) {
            continue;
          }
          const interceptable = this.isTrajectoryInterceptableBySam(
            silo.tile(),
            targetTile,
            coveringSamIds,
          );
          // Compute actual parabolic flight time in ticks
          const pathFinder = UniversalPathFinding.Parabola(this.game, {
            increment: nukeSpeed,
            distanceBasedHeight: true,
            directionUp: true,
          });
          const trajectory = pathFinder.findPath(silo.tile(), targetTile) ?? [];
          if (trajectory.length === 0) continue;
          allAvailableSilos.push({
            silo,
            slots: availableSlots,
            flightTicks: trajectory.length,
            interceptable,
          });
        }

        // Sort by Manhattan distance to target (matching nukeSpawn's pick order)
        allAvailableSilos.sort(
          (a, b) =>
            this.game.manhattanDist(a.silo.tile(), targetTile) -
            this.game.manhattanDist(b.silo.tile(), targetTile),
        );

        // Flatten into a per-bomb launch sequence matching NukeExecution's order.
        // Each silo contributes `slots` consecutive bombs before NukeExecution
        // moves to the next silo.
        const launchSequence = [];
        for (const entry of allAvailableSilos) {
          for (let s = 0; s < entry.slots; s++) {
            launchSequence.push({
              flightTicks: entry.flightTicks,
              interceptable: entry.interceptable,
            });
          }
        }

        // Use half the SAM cooldown as the max total arrival spread to be safe.
        const samCooldown = this.game.config().SAMCooldown();
        const maxTotalArrivalSpread = Math.floor(samCooldown / 2);

        // Add extra bombs: 1 for every 5 to account for enemy building more SAMs
        // while our bombs are in flight
        const extraBombs = Math.floor(bombsNeeded / 5);
        const totalBombs = bombsNeeded + extraBombs;

        // Collect bombs from silos whose trajectory to the target is NOT blocked
        // by enemy SAMs other than the covering SAMs we're trying to overwhelm.
        const unblockedBombs = [];
        for (let i = 0; i < launchSequence.length; i++) {
          if (!launchSequence[i].interceptable) {
            unblockedBombs.push({
              index: i,
              flightTicks: launchSequence[i].flightTicks,
            });
          }
        }

        if (unblockedBombs.length < totalBombs) {
          failedTarget ??= { targetTile, coveringSamIds, totalBombs };
          needsMoreSilos = true;
          continue;
        }

        // Sort unblocked bombs by flight time to find a sliding window
        // of maxTotalArrivalSpread that captures the most bombs.
        const sortedByFlight = [...unblockedBombs].sort(
          (a, b) => a.flightTicks - b.flightTicks,
        );

        let bestWindowStart = 0;
        let bestWindowCount = 0;
        for (let start = 0; start < sortedByFlight.length; start++) {
          let end = start;
          while (
            end < sortedByFlight.length &&
            sortedByFlight[end].flightTicks -
              sortedByFlight[start].flightTicks <=
              maxTotalArrivalSpread
          ) {
            end++;
          }
          if (end - start > bestWindowCount) {
            bestWindowCount = end - start;
            bestWindowStart = start;
          }
        }

        if (bestWindowCount < totalBombs) {
          failedTarget ??= { targetTile, coveringSamIds, totalBombs };
          needsMoreSilos = true;
          continue;
        }

        // From the window, pick totalBombs with the lowest launch-sequence
        // indices to minimise how many bombs we need to fire (minimise gold cost).
        const windowBombs = sortedByFlight.slice(
          bestWindowStart,
          bestWindowStart + bestWindowCount,
        );
        const windowByIndex = [...windowBombs].sort((a, b) => a.index - b.index);
        const selected = windowByIndex.slice(0, totalBombs);
        const selectedSet = new Set(selected.map((b) => b.index));
        const lastSelectedIndex = selected[selected.length - 1].index;
        const bombsToFire = lastSelectedIndex + 1;

        // Compute per-bomb waitTicks so all selected bombs arrive in the window.
        // Target: spread arrivals evenly, anchored at the earliest flight time
        // in the selected set.
        // DIVERGENCE G1: waitTicks is computed faithfully here for parity, but the
        // client build menu cannot stagger launches — sendNuke ignores it.
        const selectedFlightMin = Math.min(
          ...selected.map((b) => b.flightTicks),
        );
        const staggerInterval = Math.max(
          1,
          Math.floor(maxTotalArrivalSpread / totalBombs),
        );
        let selectedIdx = 0;
        const waitTicksPerBomb = [];
        for (let i = 0; i < bombsToFire; i++) {
          if (selectedSet.has(i)) {
            const targetArrival =
              selectedFlightMin + selectedIdx * staggerInterval;
            waitTicksPerBomb.push(
              Math.max(0, targetArrival - launchSequence[i].flightTicks),
            );
            selectedIdx++;
          } else {
            // Wasted bomb (interceptable or out-of-window) — launch immediately
            waitTicksPerBomb.push(0);
          }
        }

        // Check gold for all fired bombs (including wasted ones)
        const totalCost = atomCost * BigInt(bombsToFire);
        if (this.player.gold() < totalCost) {
          continue;
        }

        // Fire the salvo — NukeExecution will pick silos in the same
        // Manhattan distance order we planned.
        // DIVERGENCE G1: per-bomb waitTicksPerBomb[i] is dropped — each bomb is
        // fired with no stagger (sendNuke ignores waitTicks). For a multi-bomb
        // salvo we call sendNuke once per bomb (each consumes a silo slot; the
        // engine validates).
        for (let i = 0; i < bombsToFire; i++) {
          await this.sendNuke(
            targetTile,
            UNIT.AtomBomb,
            nukeTarget,
            waitTicksPerBomb[i],
          );
        }
        return;
      }

      // Couldn't destroy any SAM — upgrade silos only if capacity was the bottleneck.
      // If we only lack gold, don't waste it upgrading silos — just wait and save.
      if (needsMoreSilos && failedTarget !== null) {
        await this.maybeUpgradeHelpfulSilo(failedTarget);
      }
    }

    /**
     * Find all enemy SAMs whose range covers a given tile.
     */
    // ── findEnemySamsCoveringTile — NationNukeBehavior.ts:1010 ────────────────
    findEnemySamsCoveringTile(tile) {
      const nearbySams = this.game.nearbyUnits(
        tile,
        this.game.config().maxSamRange(),
        UNIT.SAMLauncher,
      );

      const result = [];
      for (const sam of nearbySams) {
        const owner = sam.unit.owner();
        if (
          (owner && owner.smallID && owner.smallID() === this.player.smallID()) ||
          this.player.isFriendly(owner)
        ) {
          continue;
        }
        const range = this.game.config().samRange(sam.unit.level());
        if (sam.distSquared <= range * range) {
          result.push(sam.unit);
        }
      }
      return result;
    }

    /**
     * Upgrade a missile silo that would actually have helped the failed
     * overwhelm attempt: trajectory to the failed target is not blocked by
     * non-covering enemy SAMs, and the silo is below the upgrade cap. Among
     * those, picks the one best protected by our own SAMs.
     */
    // ── maybeUpgradeHelpfulSilo — NationNukeBehavior.ts:1037 (now async) ──────
    async maybeUpgradeHelpfulSilo(failedTarget) {
      const silos = this.player.units(UNIT.MissileSilo);
      if (silos.length === 0) return;

      // First pass: find silos with an unblocked trajectory to the failed
      // target. Only these contribute slots to the overwhelm plan.
      const unblockedSilos = [];
      for (const silo of silos) {
        if (
          !this.isTrajectoryInterceptableBySam(
            silo.tile(),
            failedTarget.targetTile,
            failedTarget.coveringSamIds,
          )
        ) {
          unblockedSilos.push(silo);
        }
      }
      if (unblockedSilos.length === 0) return;

      // Bail out if the target is unreachable even at max silo level —
      // crazy amounts of covering SAMs, upgrading is wasted gold.
      const maxAchievableSlots =
        unblockedSilos.length * MAX_NATION_SILO_UPGRADE_LEVEL;
      if (maxAchievableSlots < failedTarget.totalBombs) return;

      const ourSams = this.player.units(UNIT.SAMLauncher);
      let bestSilo = null;
      let bestProtection = -1;
      // DIVERGENCE U1: src gates each candidate on `this.player.canUpgradeUnit(silo)`
      // — a synchronous core call NOT exposed on the gameApi player wrapper. We
      // defer that gate: rank the unblocked silos by our-SAM protection here (sync,
      // exactly as src), then probe buildables(siloTile, [MissileSilo]).canUpgrade
      // on the chosen silo before emitting the upgrade (see below).

      for (const silo of unblockedSilos) {
        if (silo.level() >= MAX_NATION_SILO_UPGRADE_LEVEL) continue;
        // canUpgradeUnit deferred to the async probe on bestSilo below.

        let protection = 0;
        for (const sam of ourSams) {
          const range = this.game.config().samRange(sam.level());
          const distSquared = this.game.euclideanDistSquared(
            silo.tile(),
            sam.tile(),
          );
          if (distSquared <= range * range) {
            protection += sam.level();
          }
        }

        if (protection > bestProtection) {
          bestProtection = protection;
          bestSilo = silo;
        }
      }

      if (bestSilo !== null) {
        // Silo UPGRADE actuation: probe buildables for an upgradable MissileSilo at
        // the silo tile, then sendBuildOrUpgrade(bu) if canUpgrade !== false
        // (DIVERGENCE U1 — replaces addExecution(new UpgradeStructureExecution)).
        let buildables;
        try {
          buildables = await withTimeout(
            this.player.buildables(bestSilo.tile(), [UNIT.MissileSilo]),
            WORKER_TIMEOUT_MS,
            null,
          );
        } catch (_e) {
          return;
        }
        const bu = Array.isArray(buildables)
          ? buildables.find((b) => b.type === UNIT.MissileSilo)
          : null;
        if (bu === null || bu === undefined) return;
        if (bu.canUpgrade !== false) {
          const buildMenu = getBuildMenu();
          if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
            return;
          }
          buildMenu.sendBuildOrUpgrade(bu);
          // A silo upgrade is a BUILD action, not a nuke fire — log accordingly.
          state.stats.builds++;
          setLastAction(tr("☢️ Upgrade silo"), "build");
        }
      }
    }

    // ── cost — NationNukeBehavior.ts:1100 ─────────────────────────────────────
    // DIVERGENCE C1: src reads `this.game.unitInfo(type).cost(this.game, this.player)`.
    // The gameApi `game` does NOT expose unitInfo, and the nuke cost fn calls
    // game.stats() (numNukesLaunched etc.) which the client GameView does NOT
    // expose. We read the live price from a buildables probe on an owned tile (the
    // nuke price is global, so any owned tile returns it). Mirrors mirvBehavior.cost.
    // Returns a BigInt (gold). Cached per-tick-ish to avoid re-probing repeatedly.
    async cost(type) {
      // Per-tick memo: src cost() is a pure deterministic calc returning the same
      // value within a tick; here it's an async probe, so cache by type+tick to
      // avoid redundant worker round-trips (getPerceivedNukeCost calls cost() up to
      // ~4× per nuke type). The cached VALUE is identical to a fresh probe — this is
      // a behavior-neutral optimization, not a strategy change.
      const tick = this.game.ticks();
      if (this._costCacheTick !== tick) {
        this._costCacheTick = tick;
        this._costCache = new Map();
      }
      if (this._costCache.has(type)) return this._costCache.get(type);

      const border = this.player.borderTiles();
      const tile =
        border && border.size > 0 ? border.values().next().value : null;
      if (tile === null || tile === undefined) return 0n;
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(tile, [type]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return 0n;
      }
      const bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === type)
        : null;
      const c = bu && bu.cost !== undefined && bu.cost !== null ? bu.cost : 0n;
      this._costCache.set(type, c);
      return c;
    }

    // ── nukeSpawn — mirrors PlayerImpl.nukeSpawn (PlayerImpl.ts:1233), the silo
    //    snap that player.canBuild(nukeType, tile) returns for AtomBomb/HydrogenBomb.
    // DIVERGENCE B1: src calls `this.player.canBuild(nukeType, tile)` to (a) gate
    // buildability and (b) get the launch silo tile for the trajectory check. The
    // client canBuild is async (buildables probe), so we split it: this SYNC helper
    // returns the silo the nuke would fly from — the closest by Manhattan distance
    // among silos that are active, not in cooldown, and not under construction
    // (exactly src nukeSpawn's findClosestBy criteria) — or `false` if none. The
    // async canBuild gate (incl. spawn-immunity / team teammate-structure guards
    // src's nukeSpawn also applies) is enforced separately in probeCanBuildNuke for
    // the FINAL chosen tile. This keeps the trajectory check faithful (same launch
    // silo canBuild would have snapped to) without an await in the inner scoring loop.
    // The unit wrapper exposes `ticksLeftInCooldown()` (proxy for `!isInCooldown()`:
    // not in cooldown ⇔ ticksLeftInCooldown() === 0) but not `isInCooldown()` itself.
    nukeSpawn(nukeType, targetTile) {
      const silos = this.player.units(UNIT.MissileSilo);
      let best = false;
      let bestDist = Infinity;
      for (const silo of silos) {
        if (silo.isActive && silo.isActive() === false) continue;
        if (silo.isUnderConstruction()) continue;
        // !isInCooldown() — proxy via ticksLeftInCooldown() === 0 when available.
        if (
          typeof silo.ticksLeftInCooldown === "function" &&
          silo.ticksLeftInCooldown() > 0
        ) {
          continue;
        }
        const d = this.game.manhattanDist(silo.tile(), targetTile);
        if (d < bestDist) {
          bestDist = d;
          best = silo.tile();
        }
      }
      return best;
    }

    // probeCanBuildNuke — the deferred async canBuild gate (DIVERGENCE B1). Probes
    // buildables(tile, [nukeType]) and returns whether the nuke can be built there
    // (canBuild !== false). This is the SAME gate src's player.canBuild applies,
    // just async. (Affordability is checked separately in sendNuke.)
    async probeCanBuildNuke(tile, nukeType) {
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(tile, [nukeType]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return false;
      }
      const bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === nukeType)
        : null;
      return bu !== null && bu !== undefined && bu.canBuild !== false;
    }
  }
