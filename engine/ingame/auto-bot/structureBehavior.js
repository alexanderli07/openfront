// Auto-Bot — StructureBehavior: a faithful 1:1 port of the in-game Nation
// economy/structure AI (src/core/execution/nation/NationStructureBehavior.ts).
// It decides which structure to build each build-tick (Port → Factory →
// SAMLauncher → MissileSilo, City as fallback), with the special first-structure
// cases (high-starting-gold SAM, high-nation-density port/factory), the
// high-gold structure-placement cooldown, the team post-save-up on/off phase,
// defense-post placement under land attack, perceived-cost save-up inflation,
// the upgrade-vs-build density gate, and ALL the per-type placement value
// functions (city/factory/missileSilo/port/samLauncher) including the rail
// connectivity scoring. Every branch, ratio, constant, probability, strategy
// order and call order is preserved exactly. The ONLY changes are the mechanical
// API substitutions mandated by PORT-CONTRACT.md:
//   - DIFFICULTY: src reads the lobby Nation difficulty
//     (`this.game.config().gameConfig().difficulty`); the bot REPLICATES a
//     user-chosen difficulty, so every such read becomes `currentDifficulty()`.
//   - UnitType.X → UNIT.X.
//   - PLAYER/OWNER IDENTITY: src compares players/owners with `===`; the client
//     wraps players fresh each tick, so identity compares become `.smallID()`
//     compares (and TerraNullius/unowned is guarded via `isPlayer()`/null).
//   - ASYNC + ACTUATION: the client has no synchronous canBuild/addExecution /
//     UpgradeStructureExecution. Builds and upgrades go through the build menu
//     (`getBuildMenu().sendBuildOrUpgrade(...)`) and require an `await
//     player.buildables(tile,[type])` worker probe, so the methods that place a
//     structure (handleStructures / doHandleStructures / maybeSpawnStructure /
//     tryBuildDefensePost / maybeUpgradeStructure / structureSpawnTile) BECOME
//     async (nationExecution awaits handleStructures). Worker reads are wrapped
//     in withTimeout(p, WORKER_TIMEOUT_MS, fallback).
//   - RANK-THEN-PROBE (PORT-CONTRACT §Async #1): src `structureSpawnTile`
//     interleaves the value function with a SYNC `player.canBuild` inside a loop
//     over ~25 candidates, short-circuiting on the first valid best-value tile.
//     The client canBuild is async, so we score ALL candidates SYNC by the src
//     value function, sort DESC, then await buildables down the ranked list and
//     take the FIRST whose returned BuildableUnit `.canBuild !== false`. Same
//     candidate set + value fn → same winner (the highest-value buildable tile).
//   - COST: src reads `unitInfo(type).cost(game, player)`. That cost fn is built
//     on `costWrapper`, whose `numUnits = Σ min(unitsOwned(type), unitsConstructed
//     (type))`. The client GameView does NOT expose unitsOwned/unitsConstructed
//     with core semantics (the gameApi wrapper's unitsOwned is a plain built-count
//     and unitsConstructed is a boolean), so calling the passthrough cost fn would
//     compute min(count, 0|1) — wrong, and would also corrupt cityCount/targetCount/
//     owned-multipliers (strategy, not just cost) once anything is upgraded. We
//     therefore reproduce each cost FORMULA from src/core/configuration/Config.ts
//     directly as BigInt, with `numUnits = ownedLevels(type)` (see DIVERGENCE on
//     ownedLevels below). Config scalar reads (samRange/defaultSamRange/
//     trainGold/trainStationMin|MaxRange/nukeMagnitudes/startingGold/isUnitDisabled)
//     go through the `game.config()` passthrough unchanged.
//   - DATA SHIMS (the two genuinely-missing datasets): `game.sharedWaterComponents`
//     and `game.railNetwork()` are not client-available. They are reconstructed as
//     faithfully as the client allows. WATER: gameApi builds a full-resolution
//     water union-find ONCE per game (cached) and applies core's exact
//     SharedWaterCache predicate (ocean always shared, lakes shared iff a tradeable
//     non-bot other player is on the same component); the only divergence is
//     sub-minimap channel granularity (core labels on a downsampled minimap the
//     client does not expose). RAIL: in the EXTENSION the real rail tiles come from
//     frameData().railroadState → EXACT rail-connected clusters; in the headless
//     harness (no frameData) it falls back to a train-station proximity union-find.
//     They affect placement SCORING only — everything else is faithful.
//
// Loaded with the other behavior modules (after portutil/gameApi), before
// nationExecution (which constructs `new StructureBehavior(random, game, player)`).

"use strict";

  // ===========================================================================
  // Module-level constants — verbatim from NationStructureBehavior.ts.
  // ===========================================================================

  /** SAM launcher ratio per city, keyed by difficulty */
  const SAM_RATIO_BY_DIFFICULTY = {
    [Difficulty.Easy]: 0.15,
    [Difficulty.Medium]: 0.2,
    [Difficulty.Hard]: 0.25,
    [Difficulty.Impossible]: 0.3,
  };

  /**
   * Returns structure ratios relative to city count, adjusted by difficulty.
   * Cities are always prioritized and built first.
   */
  function getStructureRatios(difficulty) {
    // DIVERGENCE (economyFirst): src caps income structures at 0.75/city and taxes each
    // additional one by +100% perceived cost, which throttles compounding hard. Raise the
    // target and nearly remove the tax so ports/factories snowball. Defensive SAM and
    // silo ratios are left at src values — we still need air defence and a silo battery.
    const eco = Boolean(state.settings.economyFirst);
    const incomeRatio = eco ? 2.0 : 0.75;
    const incomeTax = eco ? 0.05 : 1;
    return {
      [UNIT.Port]: {
        ratioPerCity: incomeRatio,
        perceivedCostIncreasePerOwned: incomeTax,
      },
      [UNIT.Factory]: {
        ratioPerCity: incomeRatio,
        perceivedCostIncreasePerOwned: incomeTax,
      },
      [UNIT.SAMLauncher]: {
        ratioPerCity: SAM_RATIO_BY_DIFFICULTY[difficulty],
        perceivedCostIncreasePerOwned: 0.3,
      },
      [UNIT.MissileSilo]: {
        ratioPerCity: 0.2,
        perceivedCostIncreasePerOwned: 1,
      },
    };
  }

  /** Perceived cost increase percentage per city owned */
  const CITY_PERCEIVED_COST_INCREASE_PER_OWNED = 1;

  /** Factory ratio multiplier when the nation has coastal tiles */
  const FACTORY_COASTAL_RATIO_MULTIPLIER = 0.33;

  /** Maximum number of missile silos a nation will build */
  const MAX_MISSILE_SILOS = 3;

  /** Ratio per city used for the first missile silo so nations start nuking earlier */
  const FIRST_MISSILE_SILO_RATIO = 0.4;

  /** If we have more than this many structures per tiles, prefer upgrading over building */
  const UPGRADE_DENSITY_THRESHOLD = 1 / 1500;

  /** Estimated number of tiles per city equivalent, used when cities are disabled */
  const TILES_PER_CITY_EQUIVALENT = 2000;

  /**
   * When map-wide nation density (nations per land tile) is above this threshold,
   * a nation's very first structure is a port (or factory if no water access)
   */
  const HIGH_NATION_DENSITY_THRESHOLD = 1 / 7500;

  /**
   * Starting-gold threshold above which nations enter the "high-gold" early game:
   * they build a SAM first and wait between structure placements.
   */
  const HIGH_STARTING_GOLD_THRESHOLD = 3_000_000n;

  /** Tick gap a high-starting-gold nation must wait before placing its Nth structure */
  const HIGH_GOLD_STRUCTURE_COOLDOWN_TICKS = [
    0, // before #1 (SAM) — no pause
    0, // before #2 — no pause
    250, // before #3 — 25s
    150, // before #4 — 15s
    100, // before #5 — 10s
  ];

  /** Length in ticks of each on/off phase after the team-mode save-up target is first reached */
  const TEAM_POST_SAVE_UP_PHASE_TICKS = 150; // 15s

  /**
   * Incoming land-attack troop count as a fraction of own troops below which the
   * nation does not build defensive structures.
   */
  const UNDER_ATTACK_THREAT_RATIO = 0.35;

  /**
   * Hard / Impossible: one additional defense post is allowed per this fraction
   * of the incoming-to-own-troop ratio.
   */
  const DEFENSE_POST_RATIO_PER_POST = 0.4;

  // NOTE: the OCEAN sentinel (-1) used by sharedWaterComponents now lives in
  // gameApi's water reconstruction (SHARED_OCEAN_SENTINEL); structureBehavior only
  // consumes the resulting Set<number>|null via shimSharedWaterComponents.

  // The set of unit types treated as "structures" — src Structures.types
  // (Game.ts:374): City, DefensePost, SAMLauncher, MissileSilo, Port, Factory.
  const STRUCTURES_TYPES = [
    UNIT.City,
    UNIT.DefensePost,
    UNIT.SAMLauncher,
    UNIT.MissileSilo,
    UNIT.Port,
    UNIT.Factory,
  ];

  // USER GATE (not in src): the popup lets the user disallow auto-building
  // specific structure types. A type is allowed unless explicitly set false.
  function autoBotBuildAllowed(type) {
    const allow = state.settings && state.settings.buildStructures;
    return !allow || allow[type] !== false;
  }

  // ===========================================================================
  // §SHIMS — the two genuinely-missing datasets, reconstructed client-side.
  // These are the ONLY approximations; they affect placement SCORING only.
  // ===========================================================================

  // canTrade(a, b) — src PlayerImpl.ts:887. No mutual embargo and different id.
  // (gameApi player exposes hasEmbargoAgainst + id(), so this is exact.)
  function shimCanTrade(a, b) {
    if (a == null || b == null) return false;
    if (a.id() === b.id()) return false;
    return !a.hasEmbargoAgainst(b) && !b.hasEmbargoAgainst(a);
  }

  // sharedWaterComponents(game, player) — src SharedWaterCache + GameImpl.
  // SHAPE returned by src: `Set<number> | null` where null = no coastal/shared
  // water; a present set contains OCEAN_SENTINEL(-1) when touching ocean and lake
  // component-ids that are shared with a tradeable other player.
  //
  // RECONSTRUCTION (gameApi §SHIM-DATA): this now returns a REAL `Set<number>|null`
  // backed by a full-resolution water union-find that gameApi builds ONCE per game
  // (cached — terrain is static). gameApi.sharedWaterComponents reproduces core's
  // SharedWaterCache predicate exactly: ocean is always shared (sentinel -1); a
  // lake component is shared iff another non-bot player on that component's coast
  // can trade with us (no mutual embargo). The component ids are usable with
  // gameApi.getWaterComponent so randCoastalTileArray can run the SAME ocean-
  // short-circuit + component-membership test core does.
  //
  // EXACT vs APPROXIMATE: the "shared" PREDICATE is exact (same ocean handling,
  // same bot-skip, same canTrade). The only divergence is GRANULARITY: core labels
  // components on a DOWNSAMPLED MINIMAP graph (x/y÷2) that the client does not
  // expose; we union-find at FULL resolution, so a narrow channel the minimap
  // merges (or a strait it splits) can land in a different component. This is
  // strictly better than the old bounded 400-tile BFS.
  function shimSharedWaterComponents(game, player) {
    try {
      if (typeof game.sharedWaterComponents === "function") {
        return game.sharedWaterComponents(player);
      }
    } catch (_e) {
      /* fall through to null — treat as no coastal access */
    }
    return null;
  }

  // railNetwork connectivity — src builds a global station→cluster graph
  // (TrainStation/Railroad), then factory/cityValue score a candidate by the
  // distinct rail clusters reachable within [trainStationMinRange,
  // trainStationMaxRange], weighted by trade gold.
  //
  // TWO PATHS (see buildReachableStations):
  //   - EXTENSION (EXACT clusters): the real rail tiles come from
  //     game.railroadState() (GameView.frameData().railroadState — a per-tile
  //     Uint8Array: 0=no rail, nonzero=rail). We flood-fill the actual rail tiles
  //     into connected components, then map each train-station-bearing unit
  //     (hasTrainStation()===true) to the rail component touching its tile. The
  //     rail-component id IS the cluster key → clusters reflect the ACTUAL laid
  //     track, exactly like core (a station with no adjacent rail is isolated /
  //     null-cluster, matching core's singleton-for-scoring).
  //   - HARNESS (proximity APPROXIMATION): when railroadState() is null (the
  //     coreAdapter has no frameData), we fall back to the StationUnionFind below:
  //     union stationed City/Port/Factory units within trainStationMaxRange
  //     euclidean PROXIMITY. This approximates rail connectivity by geometric
  //     reachability; it is outcome-neutral (placement scoring only) and only
  //     runs in the headless harness.
  //
  // The trade-gold WEIGHTS, the [min,max] range gating, and computeConnectivityScore
  // are reproduced VERBATIM in both paths — only HOW clusters are determined changes.
  class StationUnionFind {
    constructor() {
      this.parent = new Map(); // key -> key
    }
    add(key) {
      if (!this.parent.has(key)) this.parent.set(key, key);
    }
    find(key) {
      let root = key;
      while (this.parent.get(root) !== root) root = this.parent.get(root);
      // path-compress
      let cur = key;
      while (this.parent.get(cur) !== root) {
        const next = this.parent.get(cur);
        this.parent.set(cur, root);
        cur = next;
      }
      return root;
    }
    union(a, b) {
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) this.parent.set(ra, rb);
    }
  }

  class StructureBehavior {
    constructor(random, game, player) {
      this.random = random;
      this.game = game;
      this.player = player;

      // src private fields (NationStructureBehavior.ts:126-135).
      this.reachableStationsCache = null;
      this._sharedWaterComponents = null;
      this.lastStructureTick = null;
      this.placementsCount = 0;
      this._hasHighStartingGold = null;
      this._postSaveUpStartTick = null;
    }

    // ── core-semantics owned count (used wherever src uses unitsOwned) ──────────
    // DIVERGENCE: src core `unitsOwned(type)` (PlayerImpl.ts:322) sums LEVELS —
    // each built unit contributes its level, each under-construction unit +1. The
    // gameApi wrapper's unitsOwned is a plain built-count (no level sum) and
    // unitsConstructed is a boolean, so neither reproduces core semantics. We
    // reproduce the core level-sum here and use it for cityCount, the first-
    // structure `=== 0` checks, shouldBuildStructure's owned, getPerceivedCost's
    // owned, and the cost-formula numUnits. (The exact core
    // min(unitsOwned, unitsConstructed) with its cumulative numUnitsConstructed
    // counter is not client-reproducible — that counter persists across deletions;
    // the level-sum is the faithful client approximation, and for a single un-
    // upgraded unit both give the same number.)
    ownedLevels(type) {
      let total = 0;
      for (const u of this.player.units(type)) {
        if (u.isUnderConstruction()) {
          total += 1;
        } else {
          total += u.level();
        }
      }
      return total;
    }

    // handleStructures — NationStructureBehavior.ts:143 (now async).
    async handleStructures() {
      // Defense posts are handled outside the normal pacing/counter system:
      // they don't increment placementsCount or lastStructureTick, and they are
      // never built as the very first structure.
      if (
        this.placementsCount > 0 &&
        !this.game.config().isUnitDisabled(UNIT.DefensePost)
      ) {
        if (await this.tryBuildDefensePost()) {
          return true;
        }
        // If the attack threshold is met, block other structures even when
        // placement failed (no tile found / can't afford).
        if (this.defensePostNeeded()) {
          return false;
        }
      }

      if (this.isOnStructureCooldown()) {
        return false;
      }
      if (this.isInPostSaveUpBlockedPhase()) {
        return false;
      }
      const built = await this.doHandleStructures();
      if (built) {
        this.lastStructureTick = this.game.ticks();
        this.placementsCount++;
      }
      return built;
    }

    // tryBuildDefensePost — NationStructureBehavior.ts:181 (now async).
    async tryBuildDefensePost() {
      if (!autoBotBuildAllowed(UNIT.DefensePost)) return false; // user disallowed
      // src reads gameConfig().difficulty → REPLICATED difficulty.
      const difficulty = currentDifficulty();
      if (difficulty === Difficulty.Easy) return false;
      if (difficulty === Difficulty.Medium && !this.random.chance(2)) {
        return false;
      }

      const player = this.player;
      // Land attacks only (src: sourceTile() === null). isLandAttack() uses the
      // exact sourceTile when present (harness) and reconstructs it via shared
      // land border when the extension omits it.
      const landAttacks = player
        .incomingAttacks()
        .filter((a) => this.isLandAttack(a));
      if (landAttacks.length === 0) return false;

      const ourTroops = player.troops();
      if (ourTroops <= 0) return false;

      const incomingTroops = landAttacks.reduce((sum, a) => sum + a.troops(), 0);
      const ratio = incomingTroops / ourTroops;
      if (ratio < UNDER_ATTACK_THREAT_RATIO) return false;

      let allowed;
      if (difficulty === Difficulty.Medium) {
        allowed = 1;
      } else {
        allowed = Math.ceil(ratio / DEFENSE_POST_RATIO_PER_POST);
      }

      const frontTiles = this.getAttackFrontTiles(landAttacks);
      if (this.countDefensePostsNearFront(frontTiles, allowed) >= allowed) {
        return false;
      }

      const cost = this.cost(UNIT.DefensePost);
      if (player.gold() < cost) return false;

      // src samples tiles (canBuild checked inside the sampler) and builds the
      // first valid one. Client: sample WITHOUT canBuild (it's async), then probe
      // buildables down the sampled list and build the first canBuild !== false.
      // DIVERGENCE: src filters by sync canBuild during sampling, so it may sample
      // more raw candidates to reach `count` valid ones; we sample `count` raw
      // candidates and probe them, which can yield slightly fewer probes. Same
      // candidate-generation distribution; only the in-sampler canBuild filter
      // moves to the probe phase (rank-then-probe).
      const tiles = this.sampleTilesNearFront(frontTiles, 25, UNIT.DefensePost);
      for (const tile of tiles) {
        const bu = await this.buildableFor(UNIT.DefensePost, tile);
        if (bu === null || bu.canBuild === false) continue;
        const buildMenu = getBuildMenu();
        if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
          return false;
        }
        // src: addExecution(new ConstructionExecution(player, DefensePost, tile)).
        buildMenu.sendBuildOrUpgrade(bu, bu.canBuild);
        state.stats.builds++;
        setLastAction(tr("🛡️ Defense post"), "build");
        return true;
      }
      return false;
    }

    // defensePostNeeded — NationStructureBehavior.ts:229.
    defensePostNeeded() {
      const difficulty = currentDifficulty();
      if (difficulty === Difficulty.Easy) return false;
      const landAttacks = this.player
        .incomingAttacks()
        .filter((a) => this.isLandAttack(a));
      if (landAttacks.length === 0) return false;
      const ourTroops = this.player.troops();
      if (ourTroops <= 0) return false;
      const incomingTroops = landAttacks.reduce((sum, a) => sum + a.troops(), 0);
      return incomingTroops / ourTroops >= UNDER_ATTACK_THREAT_RATIO;
    }

    // isLandAttack — src filters land attacks by `attack.sourceTile() === null`
    // (boat attacks carry the landing tile). The extension wire AttackUpdate has
    // NO sourceTile, so when it's absent we RECONSTRUCT it: a land attack comes
    // from an enemy we share a LAND border with; a boat attack lands from across
    // water (the attacker need not be a land neighbour). When sourceTile IS
    // present (harness / a future client build) we use the exact value.
    // RESIDUAL: a land-bordering neighbour who ALSO boats has that boat attack
    // counted as land (rare); still far better than counting every attack as land.
    isLandAttack(a) {
      if (a.hasSourceTile && a.hasSourceTile()) {
        return a.sourceTile() === null;
      }
      const attacker = a.attacker();
      if (!attacker || !(attacker.isPlayer && attacker.isPlayer())) return true;
      return this.player.sharesBorderWith(attacker);
    }

    // getAttackFrontTiles — NationStructureBehavior.ts:246.
    // src builds a Set of attacker Player objects and tests owner-identity; we
    // build a Set of attacker smallIDs and test the neighbor owner's smallID
    // (guarding null / TerraNullius), per the contract identity rule.
    getAttackFrontTiles(landAttacks) {
      const game = this.game;
      const player = this.player;
      const attackerSet = new Set(
        landAttacks
          .map((a) => {
            const at = a.attacker();
            return at && at.isPlayer && at.isPlayer() ? at.smallID() : null;
          })
          .filter((sid) => sid !== null),
      );
      if (attackerSet.size === 0) return [];

      const frontTiles = [];
      outer: for (const borderTile of player.borderTiles()) {
        for (const neighbor of game.neighbors(borderTile)) {
          const ownerSid = game.hasOwner(neighbor) ? game.ownerID(neighbor) : null;
          if (ownerSid !== null && attackerSet.has(ownerSid)) {
            frontTiles.push(borderTile);
            continue outer;
          }
        }
      }
      return frontTiles;
    }

    // countDefensePostsNearFront — NationStructureBehavior.ts:269.
    countDefensePostsNearFront(frontTiles, cap) {
      if (frontTiles.length === 0) return 0;

      const game = this.game;
      const { borderSpacing } = this.spacingConstants();
      const rangeSquared = (borderSpacing * 1.5) ** 2;

      let count = 0;
      for (const dp of this.player.units(UNIT.DefensePost)) {
        for (const frontTile of frontTiles) {
          if (game.euclideanDistSquared(dp.tile(), frontTile) <= rangeSquared) {
            count++;
            if (cap !== undefined && count >= cap) return count;
            break;
          }
        }
      }
      return count;
    }

    // sampleTilesNearFront — NationStructureBehavior.ts:302.
    // DIVERGENCE: src checks `player.canBuild(unitType, t)` inside the sampler
    // (so a tile only counts toward `count` if buildable). The client canBuild is
    // async, so we drop the in-sampler canBuild check and emit the raw sampled
    // tiles; tryBuildDefensePost probes buildability down the returned list
    // (rank-then-probe). Sampling geometry/RNG and the spread-anchor filtering are
    // otherwise identical. `unitType` is retained in the signature for parity.
    sampleTilesNearFront(frontTiles, count, _unitType) {
      const game = this.game;
      const player = this.player;

      if (frontTiles.length === 0) {
        return [];
      }

      const { borderSpacing } = this.spacingConstants();
      const searchRadius = Math.ceil(borderSpacing * 1.5);
      const minBorderDist = Math.ceil(borderSpacing * 0.75);
      const maxBorderDist = Math.ceil(borderSpacing * 1.5);
      const borderTiles = player.borderTiles();
      const mySid = player.smallID();

      // Spread: prefer front tiles far from existing defense posts so successive
      // posts don't cluster at the same spot along the attack line.
      const spreadRangeSquared = (borderSpacing * 1.5) ** 2;
      const existingDPTiles = player
        .units(UNIT.DefensePost)
        .map((u) => u.tile());

      let anchors;
      if (existingDPTiles.length > 0) {
        anchors = frontTiles.filter(
          (ft) =>
            !existingDPTiles.some(
              (dp) => game.euclideanDistSquared(ft, dp) < spreadRangeSquared,
            ),
        );
        if (anchors.length === 0) anchors = frontTiles;
      } else {
        anchors = frontTiles;
      }

      const result = [];
      for (
        let attempt = 0;
        attempt < count * 6 && result.length < count;
        attempt++
      ) {
        const anchor = this.random.randElement(anchors);
        const ax = game.x(anchor);
        const ay = game.y(anchor);
        const x = this.random.nextInt(ax - searchRadius, ax + searchRadius + 1);
        const y = this.random.nextInt(ay - searchRadius, ay + searchRadius + 1);
        if (!game.isValidCoord(x, y)) continue;
        const t = game.ref(x, y);
        // src: if (game.owner(t) !== player) continue; → smallID compare.
        if (game.ownerID(t) !== mySid) continue;
        const closest = closestTile(game, borderTiles, t);
        const borderDist = closest[1];
        if (borderDist < minBorderDist || borderDist > maxBorderDist) continue;
        // src: if (!player.canBuild(unitType, t)) continue; → moved to probe phase.
        result.push(t);
      }

      if (result.length > 0) return result;

      // Fallback: relax border-depth constraint (territory too small for depth ring)
      const fallback = [];
      for (
        let attempt = 0;
        attempt < count * 4 && fallback.length < count;
        attempt++
      ) {
        const anchor = this.random.randElement(anchors);
        const ax = game.x(anchor);
        const ay = game.y(anchor);
        const x = this.random.nextInt(ax - searchRadius, ax + searchRadius + 1);
        const y = this.random.nextInt(ay - searchRadius, ay + searchRadius + 1);
        if (!game.isValidCoord(x, y)) continue;
        const t = game.ref(x, y);
        if (game.ownerID(t) !== mySid) continue;
        fallback.push(t);
      }

      return fallback;
    }

    // isOnStructureCooldown — NationStructureBehavior.ts:383.
    isOnStructureCooldown() {
      // Only high-starting-gold nations pause
      if (this.lastStructureTick === null || !this.hasHighStartingGold()) {
        return false;
      }
      const requiredGap =
        HIGH_GOLD_STRUCTURE_COOLDOWN_TICKS[this.placementsCount] ?? 0;
      if (requiredGap === 0) {
        return false;
      }
      return this.game.ticks() - this.lastStructureTick < requiredGap;
    }

    // isInPostSaveUpBlockedPhase — NationStructureBehavior.ts:398.
    isInPostSaveUpBlockedPhase() {
      // DIVERGENCE (economyFirst): this throttle pauses ALL structure building for 150 of
      // every 300 ticks once gold >= getSaveUpTarget(). src's target is ~30M so it rarely
      // trips; economyFirst's target is ~4.5M, so the bot would sit in a permanent 50%
      // duty cycle and halve its own build rate — exactly backwards. Never block.
      if (state.settings.economyFirst) {
        return false;
      }
      if (this.game.config().isUnitDisabled(UNIT.MissileSilo)) {
        return false;
      }
      const saveUpTarget = this.getSaveUpTarget();
      if (this._postSaveUpStartTick === null) {
        if (this.player.gold() < saveUpTarget) {
          return false;
        }
        this._postSaveUpStartTick = this.game.ticks();
      }
      const elapsed = this.game.ticks() - this._postSaveUpStartTick;
      return (
        elapsed % (TEAM_POST_SAVE_UP_PHASE_TICKS * 2) >=
        TEAM_POST_SAVE_UP_PHASE_TICKS
      );
    }

    // doHandleStructures — NationStructureBehavior.ts:416 (now async).
    async doHandleStructures() {
      this.reachableStationsCache = null;
      const config = this.game.config();
      const citiesDisabled = config.isUnitDisabled(UNIT.City);
      const cityCount = citiesDisabled
        ? Math.max(
            1,
            Math.floor(this.player.numTilesOwned() / TILES_PER_CITY_EQUIVALENT),
          )
        : this.ownedLevels(UNIT.City);
      // sharedWaterComponents → real Set<number>|null from gameApi's cached
      // full-resolution water union-find (core SharedWaterCache predicate).
      this._sharedWaterComponents = shimSharedWaterComponents(
        this.game,
        this.player,
      );
      const hasCoastalTiles = this._sharedWaterComponents !== null;

      // Once OUR side is DOMINANT (default >75% of the live map — well BELOW the 95%
      // win line at which the game would END), stop suppressing coastal factories (see
      // shouldBuildStructure) so the bot fills in factories → train stations → rail
      // linking our ports and cities. Computed ONCE per build-tick (it scans all
      // players) and read by shouldBuildStructure. Gated by winFixes.
      this._dominant = false;
      if (state.settings.winFixes) {
        const share = this.dominanceShare();
        const trigger = Number.isFinite(state.settings.factoryRailShare)
          ? state.settings.factoryRailShare
          : 0.75;
        this._dominant = share !== null && share > trigger;
        // DIAG (throttled ~8s by game-tick): is the dominance gate WHY factories do /
        // don't build? share=our map fraction, trigger=factoryRailShare, dominant=gate.
        // If dominant=false at end-game, lower factoryRailShare in core.js DEFAULTS.
        try {
          const t = this.game.ticks();
          if (t - (state._buildDomDiagTick || -999) >= 80) {
            state._buildDomDiagTick = t;
            console.log("[Build] dominance gate", {
              share: share === null ? null : Number(share.toFixed(3)),
              trigger,
              dominant: this._dominant,
            });
          }
        } catch (_e) {
          /* ignore */
        }
      }
      // Publish the dominance flag so OTHER behaviors share one source of truth (e.g.
      // allianceBehavior stops reaching out for far trade-allies once we're dominant,
      // letting betray/conquer close the game). Updated every build-tick.
      state.dominant = this._dominant;

      const missileSilosEnabled = !config.isUnitDisabled(UNIT.MissileSilo);

      // High-starting-gold Hard/Impossible nations build a SAM first.
      const difficulty = currentDifficulty();
      if (
        this.placementsCount === 0 &&
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        !config.isUnitDisabled(UNIT.AtomBomb) &&
        missileSilosEnabled &&
        !config.isUnitDisabled(UNIT.SAMLauncher) &&
        this.hasHighStartingGold() &&
        (await this.maybeSpawnStructure(UNIT.SAMLauncher))
      ) {
        return true;
      }

      // On crowded maps the first structure is a port (or factory if landlocked).
      if (
        !citiesDisabled &&
        this.ownedLevels(UNIT.City) === 0 &&
        this.isHighNationDensity()
      ) {
        const preferredFirst =
          hasCoastalTiles && !config.isUnitDisabled(UNIT.Port)
            ? UNIT.Port
            : UNIT.Factory;
        if (
          !config.isUnitDisabled(preferredFirst) &&
          (await this.maybeSpawnStructure(preferredFirst))
        ) {
          return true;
        }
      }

      // Build order for non-city structures (priority order)
      const buildOrder = [
        UNIT.Port,
        UNIT.Factory,
        UNIT.SAMLauncher,
        UNIT.MissileSilo,
      ];

      const nukesEnabled =
        !config.isUnitDisabled(UNIT.AtomBomb) ||
        !config.isUnitDisabled(UNIT.HydrogenBomb) ||
        !config.isUnitDisabled(UNIT.MIRV);

      for (const structureType of buildOrder) {
        // Skip disabled structure types
        if (config.isUnitDisabled(structureType)) {
          continue;
        }

        // Skip ports if no coastal tiles
        if (structureType === UNIT.Port && !hasCoastalTiles) {
          continue;
        }

        // Skip missile silos and SAM launchers if all nukes are disabled
        if (
          !nukesEnabled &&
          (structureType === UNIT.MissileSilo ||
            structureType === UNIT.SAMLauncher)
        ) {
          continue;
        }

        // Skip SAM launchers if missile silos are disabled
        if (!missileSilosEnabled && structureType === UNIT.SAMLauncher) {
          continue;
        }

        if (
          this.shouldBuildStructure(structureType, cityCount, hasCoastalTiles)
        ) {
          if (await this.maybeSpawnStructure(structureType)) {
            return true;
          }
        }
      }

      if (!citiesDisabled && (await this.maybeSpawnStructure(UNIT.City))) {
        return true;
      }

      return false;
    }

    // hasHighStartingGold — NationStructureBehavior.ts:521.
    // src: config().startingGold(this.player.info()) >= threshold.
    // DIVERGENCE: the client PlayerView has no info() method (it carries only a
    // `static` with playerType/isLobbyCreator). config().startingGold only reads
    // `playerInfo.playerType` (Bot → 0n) and `playerInfo.isLobbyCreator`, so we
    // synthesize a minimal PlayerInfo-shaped object from the client player's
    // type() + isLobbyCreator() (read off __src, which exposes isLobbyCreator()).
    hasHighStartingGold() {
      if (this._hasHighStartingGold === null) {
        const src = this.player.__src ?? this.player;
        const playerInfo = {
          playerType: this.player.type(),
          isLobbyCreator:
            typeof src.isLobbyCreator === "function"
              ? src.isLobbyCreator()
              : false,
        };
        this._hasHighStartingGold =
          this.game.config().startingGold(playerInfo) >=
          HIGH_STARTING_GOLD_THRESHOLD;
      }
      return this._hasHighStartingGold;
    }

    // isHighNationDensity — NationStructureBehavior.ts:528.
    isHighNationDensity() {
      const landTiles = this.game.numLandTiles();
      if (landTiles <= 0) return false;
      return (
        this.game.nations().length / landTiles > HIGH_NATION_DENSITY_THRESHOLD
      );
    }

    // dominanceShare — fraction of the LIVE map (numLandTiles − fallout) held by OUR
    // side: the whole team in Team mode, just us in FFA. Returns a number in [0,1], or
    // null when unknowable (no player, denom ≤ 0, mode read failed). Drives the
    // post-dominance economy switch (build factories→rail instead of suppressing them).
    // NOTE we compare this against factoryRailShare (default 0.75), NOT the 0.95 win
    // line: the game ENDS at 95% team share, so factories built then never run trains.
    dominanceShare() {
      if (this.player === null) return null;
      let isTeam = false;
      try {
        isTeam = String(this.game.config().gameConfig().gameMode) === "Team";
      } catch (_e) {
        return null;
      }
      const fallout =
        typeof this.game.numTilesWithFallout === "function"
          ? this.game.numTilesWithFallout()
          : 0;
      const denom = (this.game.numLandTiles() || 0) - fallout;
      if (denom <= 0) return null;

      let ownedTiles = 0;
      if (isTeam) {
        for (const p of this.game.players()) {
          try {
            if (p.isPlayer() && this.player.isOnSameTeam(p)) {
              ownedTiles += p.numTilesOwned();
            }
          } catch (_e) {
            /* skip */
          }
        }
      } else {
        ownedTiles = this.player.numTilesOwned();
      }
      return ownedTiles / denom;
    }

    // shouldBuildStructure — NationStructureBehavior.ts:540.
    shouldBuildStructure(type, cityCount, hasCoastalTiles) {
      const gameConfig = this.game.config();
      const difficulty = currentDifficulty();
      const ratios = getStructureRatios(difficulty);
      const config = ratios[type];
      if (config === undefined) {
        return false;
      }

      let ratio = config.ratioPerCity;

      // Heavily reduce factory spawning if we have coastal tiles — EXCEPT once we're
      // DOMINANT: then we WANT factories (for rail linking ports↔cities), so the
      // coastal suppression (which keeps a coastal nation at ~0-2 factories) is lifted
      // and the factory target rises to its full ratioPerCity. (winFixes-gated via
      // this._dominant, set in doHandleStructures.)
      if (
        type === UNIT.Factory &&
        hasCoastalTiles &&
        !gameConfig.isUnitDisabled(UNIT.Port) &&
        !this._dominant
      ) {
        ratio *= FACTORY_COASTAL_RATIO_MULTIPLIER;
      }

      const owned = this.ownedLevels(type);

      // Hard cap on missile silos
      if (type === UNIT.MissileSilo && owned >= MAX_MISSILE_SILOS) {
        return false;
      }

      // First missile silo uses a higher ratio so nations can start nuking earlier
      if (type === UNIT.MissileSilo && owned === 0) {
        ratio = FIRST_MISSILE_SILO_RATIO;
      }

      const targetCount = Math.floor(cityCount * ratio);

      return owned < targetCount;
    }

    // cost — NationStructureBehavior.ts:581.
    // src: this.game.unitInfo(type).cost(this.game, this.player).
    // DIVERGENCE: reproduced from the Config.ts cost formulas as BigInt (the
    // passthrough cost fn would mis-compute numUnits from the client's
    // count/boolean unitsOwned/unitsConstructed — see ownedLevels). numUnits is
    // the core-faithful level-sum; Port/Factory combine BOTH types per the
    // costWrapper arglist (Config.ts:309-401). MIRV uses the base price only
    // (numMirvsLaunched is core-only) — see getSaveUpTarget DIVERGENCE.
    cost(type) {
      switch (type) {
        case UNIT.Port: {
          const n = this.ownedLevels(UNIT.Port) + this.ownedLevels(UNIT.Factory);
          return BigInt(Math.min(1_000_000, Math.pow(2, n) * 125_000));
        }
        case UNIT.Factory: {
          const n = this.ownedLevels(UNIT.Factory) + this.ownedLevels(UNIT.Port);
          return BigInt(Math.min(1_000_000, Math.pow(2, n) * 125_000));
        }
        case UNIT.City: {
          const n = this.ownedLevels(UNIT.City);
          return BigInt(Math.min(1_000_000, Math.pow(2, n) * 125_000));
        }
        case UNIT.SAMLauncher: {
          const n = this.ownedLevels(UNIT.SAMLauncher);
          return BigInt(Math.min(3_000_000, (n + 1) * 1_500_000));
        }
        case UNIT.MissileSilo:
          return 1_000_000n;
        case UNIT.DefensePost: {
          const n = this.ownedLevels(UNIT.DefensePost);
          return BigInt(Math.min(250_000, (n + 1) * 50_000));
        }
        case UNIT.AtomBomb:
          return 750_000n;
        case UNIT.HydrogenBomb:
          return 5_000_000n;
        case UNIT.MIRV:
          // DIVERGENCE: src = 25M + numMirvsLaunched()*15M; numMirvsLaunched is
          // core-only (game.stats() is not on the client GameView). We use the
          // base 25M (no MIRVs launched assumed) — same approach as
          // mirvBehavior.js, but synchronous here (getSaveUpTarget is sync), so
          // we can't probe buildables for the live value.
          return 25_000_000n;
        case UNIT.Warship: {
          const n = this.ownedLevels(UNIT.Warship);
          return BigInt(Math.min(1_000_000, (n + 1) * 250_000));
        }
        default:
          return 0n;
      }
    }

    // maybeSpawnStructure — NationStructureBehavior.ts:585 (now async).
    async maybeSpawnStructure(type) {
      if (!autoBotBuildAllowed(type)) return false; // user disallowed this type
      const perceivedCost = this.getPerceivedCost(type);
      let availableGold = this.player.gold();
      // WIN-FIX (NOT in src): when mirvBehavior has set a real MIRV war-chest
      // reserve (state.nukeReserveGold ≥ 15M), the economy yields so the bot
      // accumulates the war chest instead of over-building — this is what funds
      // the leader/pre-empt MIRV that closes out a winning game.
      if (
        state.settings.winFixes &&
        state.nukeReserveGold &&
        // DIVERGENCE (economyFirst): don't let the MIRV war chest freeze the economy.
        !state.settings.economyFirst
      ) {
        let reserve = 0n;
        try {
          reserve = BigInt(state.nukeReserveGold || 0);
        } catch (_e) {
          reserve = 0n;
        }
        if (reserve >= 15000000n) {
          availableGold = availableGold > reserve ? availableGold - reserve : 0n;
        }
      }
      if (availableGold < perceivedCost) {
        return false;
      }

      // Check if we should upgrade instead of building new
      const structures = this.player.units(type);
      if (
        this.getTotalStructureDensity() > UPGRADE_DENSITY_THRESHOLD &&
        this.game.config().unitInfo(type).upgradable
      ) {
        if (await this.maybeUpgradeStructure(structures)) {
          return true;
        }
        // Density too high but couldn't upgrade (e.g. all under construction) —
        // don't build new, wait for construction (most relevant for SAMs).
        if (structures.length > 0) {
          return false;
        }
        // No structures of this type exist yet — fall through to build the first.
      }

      // RANK-THEN-PROBE: structureSpawnTile now returns the snapped BuildableUnit
      // (the first canBuild !== false tile down the value-ranked list) instead of
      // a bare TileRef, folding the src `player.canBuild(type, tile)` check into
      // the probe. src: tile = structureSpawnTile(type); if null → return;
      // canBuild = player.canBuild(type, tile); if false → return;
      // addExecution(ConstructionExecution).
      const bu = await this.structureSpawnTile(type);
      if (bu === null) {
        return false;
      }
      const buildMenu = getBuildMenu();
      if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
        return false;
      }
      buildMenu.sendBuildOrUpgrade(bu, bu.canBuild);
      state.stats.builds++;
      setLastAction(tr("🏗️ Build {type}", { type }), "build");
      return true;
    }

    // getPerceivedCost — NationStructureBehavior.ts:627.
    getPerceivedCost(type) {
      const realCost = this.cost(type);

      const saveUpTarget = this.getSaveUpTarget();
      if (saveUpTarget === 0n || this.player.gold() >= saveUpTarget) {
        return realCost;
      }

      const owned = this.ownedLevels(type);

      let increasePerOwned;
      if (type === UNIT.City) {
        // DIVERGENCE (economyFirst): cities are the income base; don't tax them.
        increasePerOwned = state.settings.economyFirst
          ? 0.05
          : CITY_PERCEIVED_COST_INCREASE_PER_OWNED;
      } else {
        const difficulty = currentDifficulty();
        const ratios = getStructureRatios(difficulty);
        const config = ratios[type];
        increasePerOwned =
          config && config.perceivedCostIncreasePerOwned !== undefined
            ? config.perceivedCostIncreasePerOwned
            : 0.1;
      }

      // realCost * (1 + increasePerOwned * owned)
      const multiplier = 1 + increasePerOwned * owned;
      return BigInt(Math.ceil(Number(realCost) * multiplier));
    }

    // getSaveUpTarget — NationStructureBehavior.ts:657.
    getSaveUpTarget() {
      const config = this.game.config();

      // DIVERGENCE (economyFirst): src hoards MIRV+Hydrogen (~30M) and starves the
      // economy to do it. Reserve only enough for one SAM-cracking salvo instead, so
      // surplus gold keeps compounding. NOTE the checks below read the LOBBY's
      // disabled-unit list, not the bot's own feature flags — so with features.nuke
      // OFF stock src still hoards for a MIRV it will never build. Fixed here too.
      if (state.settings.economyFirst) {
        if (!state.settings.features.nuke) return 0n;
        return this.cost(UNIT.AtomBomb) * 6n;
      }

      // Just save up for SAMs if missile silos are disabled
      if (config.isUnitDisabled(UNIT.MissileSilo)) {
        return this.cost(UNIT.SAMLauncher);
      }

      // Save up a limited amount in team games (src reads gameConfig().gameMode).
      if (this.game.config().gameConfig().gameMode === GameMode.Team) {
        return this.cost(UNIT.HydrogenBomb);
      }

      const mirvEnabled = !config.isUnitDisabled(UNIT.MIRV);
      const hydroEnabled = !config.isUnitDisabled(UNIT.HydrogenBomb);
      const atomEnabled = !config.isUnitDisabled(UNIT.AtomBomb);

      if (mirvEnabled) {
        // Save up for MIRV + Hydrogen Bomb
        return this.cost(UNIT.MIRV) + this.cost(UNIT.HydrogenBomb);
      }
      if (hydroEnabled) {
        // Save up for 5 hydrogen bombs
        return this.cost(UNIT.HydrogenBomb) * 5n;
      }
      if (atomEnabled) {
        // Save up for 20 atom bombs
        return this.cost(UNIT.AtomBomb) * 20n;
      }
      // No nukes enabled, just save up for SAMs
      return this.cost(UNIT.SAMLauncher);
    }

    // maybeUpgradeStructure — NationStructureBehavior.ts:696 (now async).
    async maybeUpgradeStructure(structures) {
      if (this.getTotalStructureDensity() <= UPGRADE_DENSITY_THRESHOLD) {
        return false;
      }
      if (structures.length === 0) {
        return false;
      }
      const result = await this.findBestStructureToUpgrade(structures);
      if (result !== null) {
        // src: addExecution(new UpgradeStructureExecution(player, unit.id())).
        // Client: sendBuildOrUpgrade(bu) where bu.canUpgrade !== false. We already
        // probed the BuildableUnit in findBestStructureToUpgrade, so reuse it.
        const buildMenu = getBuildMenu();
        if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
          return false;
        }
        buildMenu.sendBuildOrUpgrade(result.bu);
        state.stats.builds++;
        setLastAction(
          tr("⬆️ Upgrade {type}", { type: result.structure.type() }),
          "build",
        );
        return true;
      }
      return false;
    }

    // getTotalStructureDensity — NationStructureBehavior.ts:717.
    // src uses unit COUNT (not levels) here — kept on .length.
    getTotalStructureDensity() {
      const tilesOwned = this.player.numTilesOwned();
      return tilesOwned > 0
        ? this.player.units(...STRUCTURES_TYPES).length / tilesOwned
        : 0; // ignoring levels for structures
    }

    // findBestStructureToUpgrade — NationStructureBehavior.ts:728 (now async).
    // src filters `upgradable = structures.filter(s => player.canUpgradeUnit(s))`
    // synchronously (pre-RNG). The client has no sync canUpgradeUnit, so we PROBE
    // buildables(unit.tile(),[type]) for each candidate FIRST (keeping the
    // BuildableUnit when canUpgrade !== false) BEFORE any RNG draw, preserving the
    // exact src RNG sequence and scoring. Returns {structure, bu} | null.
    async findBestStructureToUpgrade(structures) {
      const game = this.game;
      if (structures.length === 0) {
        return null;
      }

      // Filter to only upgradable structures (probe before any RNG draw).
      const upgradable = [];
      const buByUnitId = new Map();
      for (const s of structures) {
        const bu = await this.buildableFor(s.type(), s.tile());
        if (bu !== null && bu.canUpgrade !== false) {
          upgradable.push(s);
          buByUnitId.set(s.id(), bu);
        }
      }
      if (upgradable.length === 0) {
        return null;
      }

      const mkResult = (structure) => ({
        structure,
        bu: buByUnitId.get(structure.id()),
      });

      // Based on difficulty, chance to just pick a random structure.
      const difficulty = currentDifficulty();
      let randomChance;
      switch (difficulty) {
        case Difficulty.Easy:
          randomChance = 70;
          break;
        case Difficulty.Medium:
          randomChance = 40;
          break;
        case Difficulty.Hard:
          randomChance = 25;
          break;
        case Difficulty.Impossible:
          randomChance = 10;
          break;
        default:
          randomChance = 10;
      }

      if (this.random.nextInt(0, 100) < randomChance) {
        return mkResult(this.random.randElement(upgradable));
      }

      const samLaunchers = this.player.units(UNIT.SAMLauncher);

      // Score each structure based on SAM protection.
      const scored = [];

      for (const structure of upgradable) {
        let score = 0;

        // Check if protected by any SAM, using per-SAM level-based range.
        for (const sam of samLaunchers) {
          const samRange = game.config().samRange(sam.level());
          const samRangeSquared = samRange * samRange;
          const distSquared = game.euclideanDistSquared(
            structure.tile(),
            sam.tile(),
          );
          if (distSquared <= samRangeSquared) {
            // Protected by this SAM, add score based on SAM level.
            score += 10;
            if (sam.level() > 1) {
              score += (sam.level() - 1) * 7.5;
            }
          }
        }

        // Add small random factor to break ties.
        score += this.random.nextInt(0, 5);

        scored.push({ structure, score });
      }

      if (scored.length === 0) {
        return null;
      }

      // Sort descending by score.
      scored.sort((a, b) => b.score - a.score);

      // 50% of the time, pick the second or third best for variety.
      if (scored.length >= 2 && this.random.chance(2)) {
        const pickIndex =
          scored.length >= 3
            ? this.random.nextInt(1, 3) // pick index 1 or 2
            : 1; // only index 1 available
        return mkResult(scored[pickIndex].structure);
      }

      return mkResult(scored[0].structure);
    }

    // structureSpawnTile — NationStructureBehavior.ts:814 (now async).
    // RANK-THEN-PROBE: score ALL candidate tiles SYNC by the src value function,
    // sort DESC, then await buildables down the ranked list and take the FIRST
    // whose BuildableUnit.canBuild !== false. Returns that BuildableUnit | null.
    // (src interleaves the value fn with a SYNC canBuild and short-circuits on the
    // first valid best-value tile; probing in descending value order and taking
    // the first buildable yields the SAME tile src's loop picks — the highest-
    // value buildable in the candidate set.)
    async structureSpawnTile(type) {
      let tiles =
        type === UNIT.Port
          ? this.randCoastalTileArray(25)
          : randTerritoryTileArray(this.random, this.game, this.player, 25);
      // WIN-FIX: for silos, PREPEND tiles that sit inside friendly SAM coverage (own SAMs
      // first, ally SAMs as fallback) so the ranked probe can actually pick a defended
      // spot — a plain 25-tile random sample often misses the SAM area entirely.
      if (type === UNIT.MissileSilo && state.settings.winFixes) {
        try {
          const samTiles = this.tilesNearFriendlySams(25);
          if (samTiles.length > 0) tiles = samTiles.concat(tiles);
        } catch (_e) {
          /* fall back to the random sample */
        }
      }
      if (tiles.length === 0) return null;
      const valueFunction = this.structureSpawnTileValue(type);
      if (valueFunction === null) return null;

      // Score all candidates synchronously, then sort DESC by value.
      const scored = tiles.map((t) => ({ t, v: valueFunction(t) }));
      scored.sort((a, b) => b.v - a.v);

      // Probe down the ranked list; first canBuild !== false wins.
      for (const { t } of scored) {
        const bu = await this.buildableFor(type, t);
        if (bu !== null && bu.canBuild !== false) {
          return bu;
        }
      }
      return null;
    }

    // buildableFor — probe a single tile for one unit type. Returns the matching
    // BuildableUnit ({type, canBuild, canUpgrade, cost}) or null. Worker call is
    // wrapped in withTimeout. (Shared by build + upgrade + defense-post probes.)
    async buildableFor(type, tile) {
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(tile, [type]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return null;
      }
      return Array.isArray(buildables)
        ? buildables.find((b) => b.type === type) ?? null
        : null;
    }

    // randCoastalTileArray — NationStructureBehavior.ts:836. Reproduced VERBATIM
    // against the reconstructed water data: a shore border tile is a valid port
    // site if it has an OCEAN neighbor (always shared — short-circuit) OR a
    // non-ocean water neighbor whose component id is in the shared set. The shared
    // set + getWaterComponent come from gameApi's full-resolution union-find
    // (cached once per game). EXACT predicate; differs from core only at
    // sub-minimap channel granularity (see shimSharedWaterComponents).
    randCoastalTileArray(numTiles) {
      const game = this.game;
      const shared = this._sharedWaterComponents;
      const tiles = Array.from(this.player.borderTiles()).filter((t) => {
        if (!game.isShore(t)) return false;
        if (shared === null) return false;
        for (const neighbor of game.neighbors(t)) {
          if (!game.isWater(neighbor)) continue;
          // Ocean is always considered shared, so any ocean neighbor makes the
          // tile a valid port site — skip the component lookup.
          if (game.isOcean(neighbor)) return true;
          const comp =
            typeof game.getWaterComponent === "function"
              ? game.getWaterComponent(neighbor)
              : null;
          if (comp !== null && shared.has(comp)) return true;
        }
        return false;
      });
      return Array.from(this.arraySampler(tiles, numTiles));
    }

    // arraySampler — NationStructureBehavior.ts:854 (generator).
    *arraySampler(a, sampleSize) {
      if (a.length <= sampleSize) {
        // Return all elements
        yield* a;
      } else {
        // Sample `sampleSize` elements
        const remaining = new Set(a);
        while (sampleSize--) {
          const t = this.random.randFromSet(remaining);
          remaining.delete(t);
          yield t;
        }
      }
    }

    // structureSpawnTileValue — NationStructureBehavior.ts:869.
    structureSpawnTileValue(type) {
      switch (type) {
        case UNIT.City:
          return this.cityValue();
        case UNIT.MissileSilo:
          return this.missileSiloValue();
        case UNIT.Factory:
          return this.factoryValue();
        case UNIT.Port:
          return this.portValue();
        case UNIT.SAMLauncher:
          return this.samLauncherValue();
        default:
          throw new Error(`Value function not implemented for ${type}`);
      }
    }

    // missileSiloValue — NationStructureBehavior.ts:892.
    missileSiloValue() {
      const game = this.game;
      const borderTiles = this.player.borderTiles();
      const otherUnits = this.player.units(UNIT.MissileSilo);
      const { borderSpacing, structureSpacing } = this.spacingConstants();

      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += game.magnitude(tile);

        // Prefer to be away from the border
        const closest = closestTile(game, borderTiles, tile);
        const closestBorderDist = closest[1];
        w += Math.min(closestBorderDist, borderSpacing);

        // Prefer to be away from other structures of the same type
        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(game, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = game.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        // WIN-FIX (NOT in src): build the silo INSIDE a SAM's protection so it's defended
        // against enemy nukes — our OWN SAM first, an ALLY's SAM as a fallback if we have
        // none, closest-to-SAM best. The huge base makes coverage dominate the elevation/
        // spacing terms while those still break ties WITHIN the covered tiles.
        if (state.settings.winFixes) {
          w += this.samCoverageBonus(tile);
        }

        return w;
      };
    }

    // samCoverageBonus — large score if `tile` sits inside a SAM's range. OWN SAMs win
    // (≥100000) over ALLY SAMs (≥50000), and being CLOSER to the covering SAM scores a
    // little higher; 0 when no friendly SAM covers it. Used to steer silo placement.
    samCoverageBonus(tile) {
      const game = this.game;
      if (typeof game.nearbyUnits !== "function") return 0;
      let cfg;
      try {
        cfg = game.config();
      } catch (_e) {
        return 0;
      }
      const maxRange = cfg && cfg.maxSamRange ? Number(cfg.maxSamRange()) : 200;
      let nearby;
      try {
        nearby = game.nearbyUnits(tile, maxRange, UNIT.SAMLauncher);
      } catch (_e) {
        return 0;
      }
      const mySid = this.player.smallID();
      let bestOwn = -1;
      let bestAlly = -1;
      for (const s of nearby || []) {
        const unit = s.unit || s;
        const owner = unit.owner && unit.owner();
        if (!owner) continue;
        if (unit.isUnderConstruction && unit.isUnderConstruction()) continue;
        const isOwn = owner.smallID && owner.smallID() === mySid;
        const isAlly = !isOwn && this.player.isFriendly(owner) === true;
        if (!isOwn && !isAlly) continue; // only OUR + ALLY SAMs protect us
        const level = (unit.level && Number(unit.level())) || 1;
        const range = cfg && cfg.samRange ? Number(cfg.samRange(level)) : 0;
        if (range <= 0) continue;
        let distSq = s.distSquared;
        if (distSq == null && game.euclideanDistSquared && unit.tile) {
          distSq = game.euclideanDistSquared(tile, unit.tile());
        }
        if (distSq == null || distSq > range * range) continue; // outside this SAM
        const closeness = range - Math.sqrt(distSq); // bigger = closer to the SAM
        if (isOwn) {
          if (closeness > bestOwn) bestOwn = closeness;
        } else if (closeness > bestAlly) {
          bestAlly = closeness;
        }
      }
      if (bestOwn >= 0) return 100000 + bestOwn;
      if (bestAlly >= 0) return 50000 + bestAlly;
      return 0;
    }

    // tilesNearFriendlySams — OUR-territory tiles that lie inside a friendly SAM's range.
    // Prefers OUR SAMs; only if we have none does it fall back to ALLY SAMs (user rule).
    // Returns up to maxTiles candidate TileRefs to feed silo placement.
    tilesNearFriendlySams(maxTiles) {
      const game = this.game;
      if (typeof game.nearbyUnits !== "function" && typeof game.units !== "function") {
        return [];
      }
      const mySid = this.player.smallID();
      let allSams = [];
      try {
        allSams = game.units(UNIT.SAMLauncher) || [];
      } catch (_e) {
        return [];
      }
      const own = [];
      const ally = [];
      for (const u of allSams) {
        try {
          if (u.isUnderConstruction && u.isUnderConstruction()) continue;
          const owner = u.owner && u.owner();
          if (!owner) continue;
          if (owner.smallID && owner.smallID() === mySid) own.push(u);
          else if (this.player.isFriendly(owner) === true) ally.push(u);
        } catch (_e) {
          /* skip */
        }
      }
      const useSams = own.length > 0 ? own : ally; // OUR SAMs first, else allies
      if (useSams.length === 0) return [];
      let cfg;
      try {
        cfg = game.config();
      } catch (_e) {
        return [];
      }
      const out = [];
      const seen = new Set();
      for (const unit of useSams) {
        const samTile = unit.tile();
        const cx = game.x(samTile);
        const cy = game.y(samTile);
        const level = (unit.level && Number(unit.level())) || 1;
        const range = cfg && cfg.samRange ? Number(cfg.samRange(level)) : 0;
        if (range <= 0) continue;
        const r = Math.floor(range);
        const step = Math.max(2, Math.floor(r / 6));
        for (let dx = -r; dx <= r; dx += step) {
          for (let dy = -r; dy <= r; dy += step) {
            if (dx * dx + dy * dy > range * range) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (!game.isValidCoord(nx, ny)) continue;
            const t = game.ref(nx, ny);
            if (seen.has(t)) continue;
            if (!game.isLand(t)) continue;
            if (game.ownerID(t) !== mySid) continue; // can only build on OUR land
            seen.add(t);
            out.push(t);
            if (out.length >= maxTiles) return out;
          }
        }
      }
      return out;
    }

    // portValue — NationStructureBehavior.ts:925.
    // NOTE: pure port-spacing; does NOT consume the water shim.
    portValue() {
      const game = this.game;
      const otherUnits = this.player.units(UNIT.Port);

      return (tile) => {
        let w = 0;

        // Prefer to be as far as possible from other ports
        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closest = closestTile(game, otherTiles, tile);
        const closestOtherDist = closest[1];
        w += closestOtherDist;

        return w;
      };
    }

    // factoryValue — NationStructureBehavior.ts:951.
    factoryValue() {
      const game = this.game;
      const player = this.player;
      const borderTiles = this.player.borderTiles();
      const otherUnits = player.units(UNIT.Factory);
      const { borderSpacing, structureSpacing } = this.spacingConstants();
      const stationRange = game.config().trainStationMaxRange();
      const stationRangeSquared = stationRange * stationRange;
      const difficulty = currentDifficulty();
      const useConnectionScore = this.shouldUseConnectivityScore(difficulty);

      const reachableStations = useConnectionScore
        ? this.getOrBuildReachableStations()
        : [];
      const minRangeSquared = game.config().trainStationMinRange() ** 2;

      // Cross-type spacing: prefer to be away from cities.
      const cityTiles = new Set(player.units(UNIT.City).map((u) => u.tile()));

      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += game.magnitude(tile);

        // Prefer to be away from the border
        const closest = closestTile(game, borderTiles, tile);
        const closestBorderDist = closest[1];
        w += Math.min(closestBorderDist, borderSpacing);

        // Prefer to be away from other factories
        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(game, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = game.manhattanDist(closestOther.x, tile);
          w += Math.min(d, stationRange);
        }

        // Prefer to be away from cities (cross-type spacing)
        const closestCity = closestTwoTiles(game, cityTiles, [tile]);
        if (closestCity !== null) {
          const d = game.manhattanDist(closestCity.x, tile);
          w += Math.min(d, structureSpacing);
        }

        if (!useConnectionScore) {
          return w;
        }

        w +=
          this.computeConnectivityScore(
            tile,
            reachableStations,
            minRangeSquared,
            stationRangeSquared,
          ) * structureSpacing;

        return w;
      };
    }

    // shouldUseConnectivityScore — NationStructureBehavior.ts:1018.
    shouldUseConnectivityScore(difficulty) {
      let randomChance;
      switch (difficulty) {
        case Difficulty.Easy:
          randomChance = 0;
          break;
        case Difficulty.Medium:
          randomChance = 60;
          break;
        case Difficulty.Hard:
          randomChance = 75;
          break;
        case Difficulty.Impossible:
          randomChance = 100;
          break;
        default:
          randomChance = 100;
      }

      return this.random.nextInt(0, 100) < randomChance;
    }

    // getOrBuildReachableStations — NationStructureBehavior.ts:1040.
    getOrBuildReachableStations() {
      if (this.reachableStationsCache === null) {
        this.reachableStationsCache = this.buildReachableStations();
      }
      return this.reachableStationsCache;
    }

    // trainGoldBase — the game's Config.trainGold value WITHOUT its final
    // goldMultiplierFor(player) factor. We deliberately drop that factor:
    //   1) it is IDENTICAL for every relation, so it CANCELS OUT in the normalized
    //      station weights below (everything is divided by the "ally" gold), and
    //   2) on hosts that enable the `goldMultiplier` host-cheat (common on private /
    //      self-hosted servers), the game's goldMultiplierFor() calls
    //      player.isLobbyCreator() — which our wrapped player object does NOT expose →
    //      a TypeError that was crashing the ENTIRE bot tick. Replicating the base here
    //      avoids passing our player into the game's gold path at all.
    //   Mirrors Config.ts:trainGold exactly: baseGold by relation, −5k per city past
    //   the first 10, floored at 5k.
    trainGoldBase(rel, citiesVisited) {
      const visited = Math.max(0, (citiesVisited || 0) - 9);
      let baseGold;
      switch (rel) {
        case "ally":
          baseGold = 35000;
          break;
        case "self":
          baseGold = 10000;
          break;
        case "team":
        case "other":
        default:
          baseGold = 25000;
      }
      return Math.max(5000, baseGold - visited * 5000);
    }

    // buildReachableStations — NationStructureBehavior.ts:1055.
    // src reads railNetwork().stationManager().getAll() to map each stationed unit
    // to its rail Cluster. We reproduce the SAME entry shape src does
    // ({ tile, cluster (stable cluster-key | null), weight }) and the SAME trade-gold
    // WEIGHTS — via trainGoldBase (the trainGold base SANS the host-cheat multiplier,
    // which cancels in normalization, so the weights are still exact); only HOW clusters
    // are determined differs by environment (see the StationUnionFind header):
    //   - EXTENSION: real rail tiles from game.railroadState() → flood-filled rail
    //     components; each station's cluster is the rail component at/adjacent to
    //     its tile (null when no rail touches it → isolated). EXACT.
    //   - HARNESS: railroadState() null → proximity union-find. APPROXIMATE.
    buildReachableStations() {
      const game = this.game;
      const player = this.player;

      const maxTradeGold = Math.max(
        Number(this.trainGoldBase("ally", 0)),
        1,
      );

      // 1) Collect all stationed structures (own + non-bot tradeable neighbors)
      //    with their normalized trade weights. This logic is IDENTICAL to src
      //    and shared by both cluster-assignment paths.
      const stationed = []; // { tile, weight, key (unit id) }

      const selfWeight =
        Number(this.trainGoldBase("self", 0)) / maxTradeGold;
      for (const unit of player.units(UNIT.City, UNIT.Port, UNIT.Factory)) {
        if (!unit.hasTrainStation()) continue;
        stationed.push({ tile: unit.tile(), weight: selfWeight, key: unit.id() });
      }

      for (const neighbor of player.nearby()) {
        if (!neighbor.isPlayer || !neighbor.isPlayer()) continue;
        if (neighbor.type() === PlayerType.Bot) continue;
        if (!shimCanTrade(player, neighbor)) continue;
        const relType = player.isOnSameTeam(neighbor)
          ? "team"
          : player.isAlliedWith(neighbor)
            ? "ally"
            : "other";
        const weight =
          Number(this.trainGoldBase(relType, 0)) / maxTradeGold;
        for (const unit of neighbor.units(UNIT.City, UNIT.Port, UNIT.Factory)) {
          if (!unit.hasTrainStation()) continue;
          stationed.push({ tile: unit.tile(), weight, key: unit.id() });
        }
      }

      if (stationed.length === 0) return [];

      // 2a) EXTENSION path — real rail clusters from the actual rail tiles.
      let railState = null;
      try {
        railState =
          typeof game.railroadState === "function" ? game.railroadState() : null;
      } catch (_e) {
        railState = null;
      }
      if (railState) {
        const railComp = this.assignRailClusters(stationed, railState);
        if (railComp !== null) {
          const result = [];
          for (let i = 0; i < stationed.length; i++) {
            result.push({
              tile: stationed[i].tile,
              cluster: railComp[i], // rail-component id, or null if isolated
              weight: stationed[i].weight,
            });
          }
          return result;
        }
        // assignRailClusters returned null (unexpected) → fall through to proximity.
      }

      // 2b) HARNESS / fallback path — proximity union-find (APPROXIMATION).
      const stationRange = game.config().trainStationMaxRange();
      const stationRangeSquared = stationRange * stationRange;
      const uf = new StationUnionFind();
      for (const s of stationed) uf.add(s.key);
      for (let i = 0; i < stationed.length; i++) {
        for (let j = i + 1; j < stationed.length; j++) {
          const d = game.euclideanDistSquared(stationed[i].tile, stationed[j].tile);
          if (d <= stationRangeSquared) {
            uf.union(stationed[i].key, stationed[j].key);
          }
        }
      }
      const result = [];
      for (const s of stationed) {
        result.push({
          tile: s.tile,
          cluster: uf.find(s.key),
          weight: s.weight,
        });
      }
      return result;
    }

    // assignRailClusters — EXTENSION-only. Flood-fill the REAL rail tiles
    // (railState[tile] !== 0) into connected components, then map each stationed
    // unit to the rail component that touches its tile (the station tile itself or
    // any cardinal/diagonal neighbor — a station's rail may begin one tile away).
    // Returns a parallel array of cluster keys (a "rail#<id>" string per station,
    // or null if no rail touches the station → isolated, matching core's singleton
    // for scoring). Returns null only on an unexpected failure so the caller can
    // fall back to proximity. Bounded: flood-fill visits each rail tile once.
    assignRailClusters(stationed, railState) {
      try {
        const game = this.game;
        const width = game.width();
        const height = game.height();
        const total = width * height;
        // Lazily flood-fill rail tiles into components, on demand from each
        // station seed, memoizing labels so the total work is O(rail tiles).
        const railLabel = new Int32Array(total).fill(-1); // -1 = unlabeled rail/none
        let nextRailId = 0;

        const labelFrom = (seed) => {
          // seed is a rail tile with no label yet; BFS its component.
          const id = nextRailId++;
          const queue = [seed];
          railLabel[seed] = id;
          let head = 0;
          while (head < queue.length) {
            const cur = queue[head++];
            for (const n of game.neighbors(cur)) {
              if (
                n >= 0 &&
                n < total &&
                railState[n] !== 0 &&
                railLabel[n] === -1
              ) {
                railLabel[n] = id;
                queue.push(n);
              }
            }
          }
          return id;
        };

        // Resolve the rail component id touching a station tile: the tile itself
        // if it is a rail tile, else any neighbor that is a rail tile.
        const railIdAt = (tile) => {
          if (tile < 0 || tile >= total) return null;
          if (railState[tile] !== 0) {
            if (railLabel[tile] === -1) labelFrom(tile);
            return railLabel[tile];
          }
          for (const n of game.neighbors(tile)) {
            if (n >= 0 && n < total && railState[n] !== 0) {
              if (railLabel[n] === -1) labelFrom(n);
              return railLabel[n];
            }
          }
          return null;
        };

        const out = new Array(stationed.length);
        for (let i = 0; i < stationed.length; i++) {
          const id = railIdAt(stationed[i].tile);
          // null cluster = isolated station (no rail) — core treats a singleton
          // station's cluster as effectively its own; using null routes it through
          // computeConnectivityScore's isolatedWeight path (individual weight).
          out[i] = id === null ? null : "rail#" + id;
        }
        return out;
      } catch (_e) {
        return null;
      }
    }

    // computeConnectivityScore — NationStructureBehavior.ts:1133. Reproduced
    // verbatim: per cluster the MAX weight of any in-range station is taken;
    // isolated (null-cluster) stations contribute their individual weights.
    computeConnectivityScore(
      tile,
      reachableStations,
      minRangeSquared,
      stationRangeSquared,
    ) {
      const clustersInRange = new Map();
      let isolatedWeight = 0;
      for (const { tile: stationTile, cluster, weight } of reachableStations) {
        const dist = this.game.euclideanDistSquared(tile, stationTile);
        if (dist < minRangeSquared || dist > stationRangeSquared) continue;
        if (cluster !== null) {
          clustersInRange.set(
            cluster,
            Math.max(clustersInRange.get(cluster) ?? 0, weight),
          );
        } else {
          isolatedWeight += weight;
        }
      }
      let score = isolatedWeight;
      for (const cw of clustersInRange.values()) score += cw;
      return score;
    }

    // cityValue — NationStructureBehavior.ts:1168.
    cityValue() {
      const game = this.game;
      const player = this.player;
      const borderTiles = player.borderTiles();
      const otherUnits = player.units(UNIT.City);
      const { borderSpacing, structureSpacing } = this.spacingConstants();
      const stationRange = game.config().trainStationMaxRange();
      const stationRangeSquared = stationRange * stationRange;
      const difficulty = currentDifficulty();
      const useConnectionScore = this.shouldUseConnectivityScore(difficulty);

      const reachableStations = useConnectionScore
        ? this.getOrBuildReachableStations()
        : [];
      const minRangeSquared = game.config().trainStationMinRange() ** 2;

      // Cross-type spacing: prefer to be away from factories.
      const factoryTiles = new Set(
        player.units(UNIT.Factory).map((u) => u.tile()),
      );

      return (tile) => {
        let w = 0;

        w += game.magnitude(tile);

        const closest = closestTile(game, borderTiles, tile);
        const closestBorderDist = closest[1];
        w += Math.min(closestBorderDist, borderSpacing);

        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(game, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = game.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        // Prefer to be away from factories (cross-type spacing)
        const closestFactory = closestTwoTiles(game, factoryTiles, [tile]);
        if (closestFactory !== null) {
          const d = game.manhattanDist(closestFactory.x, tile);
          w += Math.min(d, structureSpacing);
        }

        if (!useConnectionScore) {
          return w;
        }

        w +=
          this.computeConnectivityScore(
            tile,
            reachableStations,
            minRangeSquared,
            stationRangeSquared,
          ) * structureSpacing;

        return w;
      };
    }

    // samLauncherValue — NationStructureBehavior.ts:1233.
    samLauncherValue() {
      const game = this.game;
      const player = this.player;
      const borderTiles = player.borderTiles();
      const otherUnits = player.units(UNIT.SAMLauncher);
      const { borderSpacing, structureSpacing } = this.spacingConstants();

      const difficulty = currentDifficulty();
      const weightByLevel =
        difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;

      const protectEntries = [];
      for (const unit of player.units()) {
        switch (unit.type()) {
          case UNIT.City:
          case UNIT.Factory:
          case UNIT.MissileSilo:
          case UNIT.Port:
            protectEntries.push({
              tile: unit.tile(),
              weight: weightByLevel ? unit.level() : 1,
            });
        }
      }
      const range = game.config().defaultSamRange();
      const rangeSquared = range * range;

      const useCoverageWeighting =
        difficulty !== Difficulty.Easy && this.random.nextInt(0, 100) < 25;

      // Pre-compute existing SAM coverage for each protectable structure.
      let structureCoverage = null;
      if (useCoverageWeighting) {
        structureCoverage = new Map();
        const existingSams = player.units(UNIT.SAMLauncher);
        for (const entry of protectEntries) {
          let coverageScore = 0;
          for (const sam of existingSams) {
            const samRange = game.config().samRange(sam.level());
            const dist = game.euclideanDistSquared(entry.tile, sam.tile());
            if (dist <= samRange * samRange) {
              coverageScore += sam.level();
            }
          }
          structureCoverage.set(entry.tile, coverageScore);
        }
      }

      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += game.magnitude(tile);

        // Prefer to be away from the border
        const closestBorder = closestTwoTiles(game, borderTiles, [tile]);
        if (closestBorder !== null) {
          const d = game.manhattanDist(closestBorder.x, tile);
          w += Math.min(d, borderSpacing);
        }

        // Prefer to be away from other structures of the same type
        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closestOther = closestTwoTiles(game, otherTiles, [tile]);
        if (closestOther !== null) {
          const d = game.manhattanDist(closestOther.x, tile);
          w += Math.min(d, structureSpacing);
        }

        // Prefer to be in range of other structures (skip on easy difficulty)
        if (difficulty !== Difficulty.Easy) {
          for (const entry of protectEntries) {
            const distanceSquared = game.euclideanDistSquared(tile, entry.tile);
            if (distanceSquared > rangeSquared) continue;
            if (useCoverageWeighting && structureCoverage !== null) {
              const coverage = structureCoverage.get(entry.tile) ?? 0;
              const coverageWeight = 1 / (1 + coverage);
              w += structureSpacing * entry.weight * coverageWeight;
            } else {
              w += structureSpacing * entry.weight;
            }
          }
        }

        return w;
      };
    }

    // spacingConstants — NationStructureBehavior.ts:1323.
    spacingConstants() {
      const borderSpacing = this.game
        .config()
        .nukeMagnitudes(UNIT.AtomBomb).outer;
      return { borderSpacing, structureSpacing: borderSpacing * 2 };
    }
  }
