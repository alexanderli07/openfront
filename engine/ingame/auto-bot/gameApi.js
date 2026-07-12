// Auto-Bot — gameApi: the data-access shim that lets the faithfully-ported Nation
// behaviors run against the CLIENT view as if they were running in core.
//
// The src behaviors are written against the core Game/Player/Unit (synchronous,
// full data). The client GameView/PlayerView/UnitView mirror most of it but:
//   - some reads are ASYNC worker calls (borderTiles, buildables, profile,
//     bestTransportShipSpawn, actions);
//   - a few core reads are not surfaced at all (relation values, nearby(),
//     sharedWaterComponents, railNetwork).
//
// gameApi presents a CORE-SHAPED, SYNCHRONOUS interface to the behaviors. Async
// data is fetched ONCE per decision tick by beginTick() (me's borderTiles +
// profile) and lazily-cached per target; the behaviors then read it synchronously
// so the ported code stays a 1:1 diff against src. The two genuinely-missing
// datasets (sharedWaterComponents, railNetwork) are reconstructed in §SHIMS and
// are the ONLY approximated data (used for structure-placement scoring only).
//
// `src` is the client-shape game: the real GameView in the extension, or the
// training coreAdapter `game` in the headless harness — both expose the same
// client surface, so the SAME behaviors validate against core for free.
//
// Loaded after portutil, before the behaviors.

"use strict";

  // Relation enum — src/core/game/Game.ts:464
  const Relation = { Hostile: 0, Distrustful: 1, Neutral: 2, Friendly: 3 };

  // relationFromValue — src/core/game/PlayerImpl.ts:638
  function relationFromValue(v) {
    if (v < -50) return Relation.Hostile;
    if (v < 0) return Relation.Distrustful;
    if (v < 50) return Relation.Neutral;
    return Relation.Friendly;
  }
  // Representative raw midpoint of each bucket (profile() gives the bucket, not
  // the raw int the server keeps; we reconstruct an approximate raw — §8.1).
  function bucketMidpoint(rel) {
    switch (rel) {
      case Relation.Hostile:
        return -75;
      case Relation.Distrustful:
        return -25;
      case Relation.Friendly:
        return 75;
      default:
        return 25; // Neutral
    }
  }

  function createGameApi(src) {
    const playerCache = new Map(); // smallID -> wrapped player
    const borderCache = new Map(); // smallID -> { tick, set:Set<TileRef> }
    // Relation overlay: ONLY the AI-subjective deltas WE issue this game
    // (embargo malus ±20, assist −20, warship −7.5/−15). The engine-applied
    // relation changes for our slot are already in profile(); the overlay is an
    // OFFSET added on top of the profile bucket midpoint (§8.1), decayed 0.05/tick.
    const overlay = new Map(); // smallID -> offset
    let profileRelations = new Map(); // smallID -> Relation bucket (from profile())
    let profileAlliances = []; // smallID[]
    let mePlayer = null; // wrapped me
    let lastSnapshotTick = -1;

    const unwrap = (p) => (p && p.__src ? p.__src : p);

    function isPlayerObj(o) {
      try {
        return !!(o && typeof o.isPlayer === "function" && o.isPlayer());
      } catch (_e) {
        return false;
      }
    }

    // ── unit wrapper: delegate to the src unit, wrap owner() ──────────────────
    function wrapUnit(u) {
      if (u == null) return u;
      const m = (name, dflt) => (...a) =>
        typeof u[name] === "function" ? u[name](...a) : dflt;
      return {
        __src: u,
        owner: () => wrapPlayer(u.owner()),
        type: m("type", null),
        tile: m("tile", null),
        level: m("level", 1),
        id: m("id", null),
        isActive: m("isActive", false),
        isUnderConstruction: m("isUnderConstruction", false),
        isInCombat: m("isInCombat", false),
        hasTrainStation: m("hasTrainStation", false),
        missileTimerQueue: m("missileTimerQueue", []),
        targetTile: m("targetTile", undefined),
        patrolTile: m("patrolTile", undefined),
        warshipState: m("warshipState", undefined),
        transportShipState: m("transportShipState", undefined),
        health: m("health", undefined),
        ticksLeftInCooldown: m("ticksLeftInCooldown", 0),
        lastSetSafeFromPirates: m("lastSetSafeFromPirates", undefined),
      };
    }

    // Client AttackUpdate (PlayerView.incomingAttacks) is a PLAIN object with
    // FIELDS: { troops:number, attackerID:number, targetID:number,
    // retreating:bool, id:string } (NO attacker()/target() methods, sourceTile
    // is absent on the wire). The coreAdapter wraps core attacks into the same
    // field shape. The ported behaviors call core-style METHOD accessors, so we
    // expose methods over the fields. `val` tolerates either a value or a fn.
    function wrapAttack(a) {
      const val = (x) => (typeof x === "function" ? x() : x);
      return {
        __src: a,
        troops: () => Number(val(a.troops) ?? 0),
        attacker: () =>
          wrapPlayer(
            typeof a.attacker === "function"
              ? a.attacker()
              : srcPlayerBySmallID(a.attackerID),
          ),
        target: () =>
          wrapPlayer(
            typeof a.target === "function"
              ? a.target()
              : srcPlayerBySmallID(a.targetID),
          ),
        retreating: () => val(a.retreating) ?? false,
        id: () => val(a.id),
        // client AttackUpdate has no sourceTile on the wire → undefined in the
        // extension; the coreAdapter (harness) DOES set it. `hasSourceTile()`
        // lets consumers use the exact value when present and reconstruct it
        // (land = attacker shares a land border) when absent — see structureBehavior.
        hasSourceTile: () => a.sourceTile !== undefined,
        sourceTile: () => (a.sourceTile !== undefined ? val(a.sourceTile) : null),
      };
    }

    function srcPlayerBySmallID(sid) {
      if (sid == null) return null;
      try {
        return src.playerBySmallID(sid);
      } catch (_e) {
        return null;
      }
    }

    // ── relation overlay helpers ──────────────────────────────────────────────
    function relationRawFor(otherSmallID) {
      const bucket = profileRelations.has(otherSmallID)
        ? profileRelations.get(otherSmallID)
        : Relation.Neutral;
      const off = overlay.get(otherSmallID) ?? 0;
      return bucketMidpoint(bucket) + off;
    }

    // ── player wrapper ────────────────────────────────────────────────────────
    function wrapPlayer(core) {
      if (core == null) return null;
      if (!isPlayerObj(core)) {
        // TerraNullius / non-player passthrough (carry isPlayer()===false).
        return core;
      }
      const sid = core.smallID();
      let w = playerCache.get(sid);
      if (w) {
        w.__src = core; // refresh underlying view (it may be a fresh object)
        return w;
      }
      w = makePlayer(core);
      playerCache.set(sid, w);
      return w;
    }

    function makePlayer(core) {
      const pass = (name, dflt) => (...a) =>
        typeof core[name] === "function"
          ? core[name](...a.map((x) => (x && x.__src ? x.__src : x)))
          : dflt;
      const w = {
        __src: core,
        isPlayer: () => true,
        isAlive: pass("isAlive", false),
        hasSpawned: pass("hasSpawned", false),
        smallID: () => core.smallID(),
        id: () => core.id(),
        clientID: pass("clientID", null),
        type: pass("type", null),
        name: pass("name", "?"),
        displayName: pass("displayName", "?"),
        troops: () => Number(core.troops?.() ?? 0),
        gold: () => core.gold?.() ?? 0n,
        numTilesOwned: () => Number(core.numTilesOwned?.() ?? 0),
        team: pass("team", null),
        maxTroops: () => api.config().maxTroops(w),
        isTraitor: pass("isTraitor", false),
        isDisconnected: pass("isDisconnected", false),
        betrayals: pass("betrayals", 0),
        getTraitorRemainingTicks: pass("getTraitorRemainingTicks", 0),

        units: (...types) => core.units(...types).map(wrapUnit),
        unitCount: (type) => core.units(type).length,
        // unitsOwned/unitsConstructed — core semantics: built (not under
        // construction) units of a type.
        unitsOwned: (type) =>
          core.units(type).filter((u) => !(u.isUnderConstruction?.() ?? false)).length,
        unitsConstructed: (type) =>
          core.units(type).some((u) => !(u.isUnderConstruction?.() ?? false)),
        totalUnitLevels: (type) =>
          core
            .units(type)
            .filter((u) => !(u.isUnderConstruction?.() ?? false))
            .reduce((acc, u) => acc + (u.level?.() ?? 1), 0),

        incomingAttacks: () => core.incomingAttacks().map(wrapAttack),
        outgoingAttacks: () => core.outgoingAttacks().map(wrapAttack),
        targets: () => (core.targets ? core.targets().map(wrapPlayer) : []),
        allies: () => (core.allies ? core.allies().map(wrapPlayer) : []),
        transitiveTargets: () =>
          core.transitiveTargets ? core.transitiveTargets().map(wrapPlayer) : [],
        alliances: () => (core.alliances ? core.alliances() : []),

        isFriendly: (o) => core.isFriendly(unwrap(o)),
        isAlliedWith: (o) => core.isAlliedWith(unwrap(o)),
        isOnSameTeam: (o) => core.isOnSameTeam(unwrap(o)),
        isRequestingAllianceWith: (o) =>
          core.isRequestingAllianceWith
            ? core.isRequestingAllianceWith(unwrap(o))
            : false,
        hasEmbargoAgainst: (o) =>
          core.hasEmbargoAgainst ? core.hasEmbargoAgainst(unwrap(o)) : false,

        nameLocation: () =>
          core.nameLocation ? core.nameLocation() : { x: 0, y: 0 },

        // ── borderTiles: SYNC snapshot Set (core-shape). Populated by beginTick
        //    for me, and by ensureBorderTiles() for targets (lazy, cached/tick).
        borderTiles: () => {
          // Return the latest cached border snapshot (populated by ensureBorderTiles,
          // time-based so it survives MAX-game-speed worker saturation). NOT gated on
          // the exact tick — a ~1.5s-stale border is far better than blinding the bot.
          const c = borderCache.get(core.smallID());
          return c && c.set ? c.set : new Set();
        },

        // ── relation (reconstructed via profile() + overlay) ──────────────────
        relation: (o) => {
          const osid = unwrapSmallID(o);
          return relationFromValue(within(relationRawFor(osid), -100, 100));
        },
        allRelationsSorted: () => {
          // Build {player, raw} for every player we have a relation signal for
          // (profile keys ∪ overlay keys), alive only, sort ASC by raw then
          // smallID (stable tie-break — §8.1), bucket.
          const sids = new Set();
          for (const k of profileRelations.keys()) sids.add(k);
          for (const k of overlay.keys()) sids.add(k);
          const out = [];
          for (const sid of sids) {
            if (sid === core.smallID()) continue;
            const p = api.playerBySmallID(sid);
            if (!p || !p.isPlayer || !p.isPlayer() || !p.isAlive()) continue;
            out.push({ player: p, raw: relationRawFor(sid), sid });
          }
          out.sort((a, b) => a.raw - b.raw || a.sid - b.sid);
          return out.map((r) => ({
            player: r.player,
            relation: relationFromValue(within(r.raw, -100, 100)),
          }));
        },
        // updateRelation: AI-subjective → write the OFFSET (no client intent).
        updateRelation: (o, delta) => {
          const osid = unwrapSmallID(o);
          if (osid == null || osid === core.smallID()) return;
          overlay.set(osid, within((overlay.get(osid) ?? 0) + delta, -100, 100));
        },

        // ── nearby(): EXACT reconstruction — src/core/game/PlayerImpl.ts:359 ───
        nearby: () => nearbyOf(w),
        sharesBorderWith: (o) => sharesBorderWith(w, o),

        // ── async probes (worker calls) — used by the rank-then-probe paths ───
        borderTilesAsync: () => core.borderTiles(),
        buildables: (tile, types) => core.buildables(tile, types),
        bestTransportShipSpawn: (tile) => core.bestTransportShipSpawn(tile),
        profile: () => core.profile(),
        actions: (tile, units) =>
          core.actions ? core.actions(tile, units) : Promise.resolve(null),
      };
      return w;
    }

    function unwrapSmallID(o) {
      if (o == null) return null;
      if (typeof o === "number") return o;
      if (typeof o.smallID === "function") return o.smallID();
      return null;
    }

    // nearby — union of (a) owners of LAND neighbors of our border tiles whose
    // owner != us (incl. TerraNullius), and (b) shore-reachable neighbors across
    // narrow rivers. Fully synchronous over the border snapshot.
    function nearbyOf(me) {
      const ns = new Map(); // key -> player|TN  (key: smallID, or "TN")
      const mySid = me.smallID();
      const addOwner = (ownerSid) => {
        if (ownerSid === mySid) return;
        if (ownerSid == null) {
          const tn = api.terraNullius();
          ns.set("TN", tn);
        } else {
          const p = api.playerBySmallID(ownerSid);
          if (p) ns.set(ownerSid, p);
        }
      };
      const border = me.borderTiles();
      for (const bt of border) {
        for (const n of src.neighbors(bt)) {
          if (!src.isLand(n)) continue;
          const ownerSid = src.hasOwner(n) ? src.ownerID(n) : null;
          if (ownerSid !== mySid) addOwner(ownerSid);
        }
      }
      // shoreReachableNeighbors — every 10th shore border tile, 5 steps each
      // cardinal direction that immediately enters water.
      const shores = [];
      for (const bt of border) if (src.isShore(bt)) shores.push(bt);
      const dirs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      for (let i = 0; i < shores.length; i += 10) {
        const b = shores[i];
        const bx = src.x(b);
        const by = src.y(b);
        for (const [dx, dy] of dirs) {
          const x1 = bx + dx;
          const y1 = by + dy;
          if (!src.isValidCoord(x1, y1) || !src.isWater(src.ref(x1, y1))) continue;
          const nx = bx + dx * 5;
          const ny = by + dy * 5;
          if (!src.isValidCoord(nx, ny)) continue;
          const tile = src.ref(nx, ny);
          if (!src.isLand(tile)) continue;
          if (!src.hasOwner(tile) && src.hasFallout(tile)) continue;
          const ownerSid = src.hasOwner(tile) ? src.ownerID(tile) : null;
          if (ownerSid !== mySid) addOwner(ownerSid);
        }
      }
      return Array.from(ns.values());
    }

    // sharesBorderWith — does any LAND neighbor of our border tiles belong to other?
    function sharesBorderWith(me, other) {
      const osid = unwrapSmallID(other);
      if (osid == null) {
        // TerraNullius: share a border if any unowned land neighbor exists.
        for (const bt of me.borderTiles()) {
          for (const n of src.neighbors(bt)) {
            if (src.isLand(n) && !src.hasOwner(n)) return true;
          }
        }
        return false;
      }
      for (const bt of me.borderTiles()) {
        for (const n of src.neighbors(bt)) {
          if (src.isLand(n) && src.hasOwner(n) && src.ownerID(n) === osid) return true;
        }
      }
      return false;
    }

    // ── config proxy: forward to src.config(), but UNWRAP gameApi players in
    //    maxTroops (both the real Config and the coreAdapter proxy expect the
    //    underlying player, not our wrapper). Memoized — config() is stable.
    let _srcConfig = null;
    let _configProxy = null;
    function configProxy() {
      const sc = src.config();
      if (_configProxy && _srcConfig === sc) return _configProxy;
      _srcConfig = sc;
      _configProxy = new Proxy(sc, {
        get(t, prop) {
          if (prop === "maxTroops") return (p) => sc.maxTroops(unwrap(p));
          const v = t[prop];
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      return _configProxy;
    }

    // ── §SHIM-DATA: water-component labeling + rail state (structure siting) ──
    // These reconstruct the two datasets the client GameView does NOT surface
    // (core's getWaterComponent / sharedWaterComponents / railNetwork). They feed
    // STRUCTURE PLACEMENT scoring only. The water labeling is built ONCE per game
    // (terrain is static) and cached on THIS gameApi closure (per-game, not a
    // module-global — the harness runs many games per process and two maps with
    // identical dimensions must not share a cache).
    //
    // WATER — EXACT-as-client-allows union-find.
    //   Core (WaterManager.getWaterComponent) labels water components on a
    //   DOWNSAMPLED MINIMAP graph (x/y ÷ 2), which the client does not expose.
    //   We instead flood-fill ALL water tiles at FULL resolution using only
    //   isWater/neighbors/ref/width/height — the closest client-side
    //   reconstruction. It differs from core ONLY at sub-minimap granularity:
    //   narrow channels that the minimap merges (or splits) may land in a
    //   different component here. This is strictly better than the old bounded
    //   400-tile BFS, which could not see large lakes or assign stable ids.
    //
    //   _waterLabels[tile] : component id (>= 0) for every water tile, -2 for
    //   land/unlabeled. Component ids are dense (0..N-1). OCEAN_SENTINEL (-1) is
    //   reserved for the "touches ocean" marker in shared sets and NEVER used as
    //   a real component id, so shared.has(comp) is collision-free.
    //   _waterCompIsOcean[id] : true if the component contains any ocean tile.
    //   _waterCompCoast[id]   : array of land TileRefs adjacent to that (non-ocean)
    //                           component (the component's coastline). Ocean
    //                           coasts are not recorded — ocean is always shared,
    //                           so its coast is never scanned for trade partners.
    let _waterLabels = null;
    let _waterCompIsOcean = null;
    let _waterCompCoast = null;

    function buildWaterLabels() {
      const w = src.width();
      const h = src.height();
      const total = w * h;
      const labels = new Int32Array(total).fill(-2);
      const compIsOcean = [];
      const compCoast = [];
      let nextId = 0;
      // Iterative flood fill (queue) over every water tile.
      for (let t = 0; t < total; t++) {
        if (!src.isWater(t) || labels[t] !== -2) continue;
        const id = nextId++;
        let isOcean = false;
        const coastSet = new Set();
        const queue = [t];
        labels[t] = id;
        let head = 0;
        while (head < queue.length) {
          const cur = queue[head++];
          if (src.isOcean(cur)) isOcean = true;
          for (const n of src.neighbors(cur)) {
            if (src.isWater(n)) {
              if (labels[n] === -2) {
                labels[n] = id;
                queue.push(n);
              }
            } else if (src.isLand(n)) {
              // A land neighbor of this water body is part of its coastline.
              coastSet.add(n);
            }
          }
        }
        compIsOcean[id] = isOcean;
        // Only non-ocean components need their coast recorded (ocean is always
        // treated as shared → its coast is never scanned).
        compCoast[id] = isOcean ? null : Array.from(coastSet);
      }
      _waterLabels = labels;
      _waterCompIsOcean = compIsOcean;
      _waterCompCoast = compCoast;
    }

    function ensureWaterLabels() {
      if (_waterLabels === null) buildWaterLabels();
    }

    // getWaterComponent(tile) — mirrors core's signature. Returns the component
    // id of a water tile (>= 0), or null for non-water. (In practice only ever
    // called on NON-ocean water — randCoastalTileArray / SharedWaterCache
    // short-circuit on ocean before the lookup.)
    function getWaterComponent(tile) {
      ensureWaterLabels();
      if (tile < 0 || tile >= _waterLabels.length) return null;
      const id = _waterLabels[tile];
      return id >= 0 ? id : null;
    }

    // OCEAN sentinel — core SharedWaterCache.OCEAN_SENTINEL.
    const SHARED_OCEAN_SENTINEL = -1;

    // sharedWaterComponents(player) — faithful reconstruction of core's
    // SharedWaterCache predicate (SharedWaterCache.ts):
    //   - Skip bots as candidate trade partners (core skips bots in Pass 1).
    //   - For the QUERIED player, scan its OWN shore border tiles (available
    //     synchronously — me's border is pre-fetched each tick): ocean neighbor →
    //     mark hasOcean; non-ocean water neighbor → add its component id to
    //     "mine".
    //   - A lake component is SHARED iff some OTHER non-bot player on that
    //     component's coast can trade with the queried player (no mutual embargo,
    //     different id). We resolve "other player on the component" via the
    //     pre-recorded coast tiles + ownerID (both SYNC) — we do NOT iterate other
    //     players' borderTiles() (those return EMPTY synchronously through the
    //     wrapper; only me's is pre-fetched).
    //   - Ocean is always shared (sentinel -1).
    // Returns Set<number>|null (null = touches no ocean and no shared lake),
    // exactly matching core's `!== null` coastal test.
    function sharedWaterComponents(player) {
      if (player == null) return null;
      // Bots are never the nation AI caller in core, but guard anyway: a bot
      // player has no shared-water relevance.
      try {
        if (player.type && player.type() === PlayerType.Bot) return null;
      } catch (_e) {
        /* fall through */
      }
      ensureWaterLabels();
      const border = player.borderTiles();
      const mySid = player.smallID();

      let hasOcean = false;
      const myLakes = new Set();
      for (const t of border) {
        if (!src.isShore(t)) continue;
        for (const n of src.neighbors(t)) {
          if (!src.isWater(n)) continue;
          if (src.isOcean(n)) {
            hasOcean = true;
            continue;
          }
          const comp = _waterLabels[n];
          if (comp >= 0) myLakes.add(comp);
        }
      }

      const shared = new Set();
      if (hasOcean) shared.add(SHARED_OCEAN_SENTINEL);

      for (const comp of myLakes) {
        const coast = _waterCompCoast[comp];
        if (!coast) continue; // ocean component (shouldn't appear) or none
        // Is there another NON-BOT player on this lake who can trade with us?
        let isShared = false;
        const seen = new Set();
        for (const landTile of coast) {
          if (!src.hasOwner(landTile)) continue;
          const ownerSid = src.ownerID(landTile);
          if (ownerSid == null || ownerSid === mySid) continue;
          if (seen.has(ownerSid)) continue;
          seen.add(ownerSid);
          const other = wrapPlayer(src.playerBySmallID(ownerSid));
          if (!other || !other.isPlayer || !other.isPlayer()) continue;
          if (other.type && other.type() === PlayerType.Bot) continue;
          // canTrade: different id + no mutual embargo (PlayerImpl.canTrade).
          if (
            player.id() !== other.id() &&
            !player.hasEmbargoAgainst(other) &&
            !other.hasEmbargoAgainst(player)
          ) {
            isShared = true;
            break;
          }
        }
        if (isShared) shared.add(comp);
      }

      return shared.size > 0 ? shared : null;
    }

    // RAIL — railroadState buffer (EXTENSION only). Core RailroadCache keeps a
    // Uint8Array(width*height) indexed by TileRef: 0 = no rail, 1..6 = RailType+1
    // (rail present). GameView.frameData().railroadState is that buffer. The
    // harness coreAdapter has no frameData → returns null, and structureBehavior
    // falls back to the station-proximity union-find.
    function railroadState() {
      try {
        if (typeof src.frameData !== "function") return null;
        const fd = src.frameData();
        return fd && fd.railroadState ? fd.railroadState : null;
      } catch (_e) {
        return null;
      }
    }

    // ── the core-shaped game object handed to the behaviors ───────────────────
    const mapM = (name) => (...a) => src[name](...a);
    const api = {
      __src: src,
      ticks: () => src.ticks(),
      inSpawnPhase: () => src.inSpawnPhase(),
      isSpawnImmunityActive: (...a) =>
        typeof src.isSpawnImmunityActive === "function"
          ? src.isSpawnImmunityActive(...a)
          : false,
      config: () => configProxy(),
      myPlayer: () => mePlayer,
      players: () => src.players().map(wrapPlayer),
      playerViews: () => src.players().map(wrapPlayer),
      playerBySmallID: (sid) => wrapPlayer(src.playerBySmallID(sid)),
      nations: () =>
        (src.nations ? src.nations() : src.players().filter((p) => p.type?.() === "Nation")).map(
          wrapPlayer,
        ),
      terraNullius: () => {
        if (typeof src.terraNullius === "function") return src.terraNullius();
        // synthesize a TN sentinel matching the core contract.
        return { isPlayer: () => false, smallID: () => 0, id: () => "TerraNullius" };
      },
      owner: (t) => wrapPlayer(src.owner(t)),
      ownerID: (t) => src.ownerID(t),
      hasOwner: (t) => src.hasOwner(t),
      numLandTiles: () => src.numLandTiles(),
      numTilesWithFallout: () =>
        typeof src.numTilesWithFallout === "function" ? src.numTilesWithFallout() : 0,
      getWinner: () => (typeof src.getWinner === "function" ? src.getWinner() : null),
      units: (...types) => src.units(...types).map(wrapUnit),
      unitCount: (type) => src.units(type).length,
      // GameMap surface (sync passthrough)
      ref: mapM("ref"),
      x: mapM("x"),
      y: mapM("y"),
      cell: mapM("cell"),
      width: mapM("width"),
      height: mapM("height"),
      isValidCoord: mapM("isValidCoord"),
      isOnMap: (cell) =>
        typeof src.isOnMap === "function"
          ? src.isOnMap(cell)
          : src.isValidCoord(cell.x, cell.y),
      isLand: mapM("isLand"),
      isWater: mapM("isWater"),
      isOcean: mapM("isOcean"),
      isShore: mapM("isShore"),
      isOceanShore: mapM("isOceanShore"),
      isBorder: (t) => (typeof src.isBorder === "function" ? src.isBorder(t) : false),
      magnitude: mapM("magnitude"),
      hasFallout: mapM("hasFallout"),
      neighbors: mapM("neighbors"),
      manhattanDist: mapM("manhattanDist"),
      euclideanDistSquared: mapM("euclideanDistSquared"),
      terrainType: (t) =>
        typeof src.terrainType === "function" ? src.terrainType(t) : null,
      nearbyUnits: (...a) =>
        typeof src.nearbyUnits === "function" ? src.nearbyUnits(...a) : [],
      hasUnitNearby: (...a) =>
        typeof src.hasUnitNearby === "function" ? src.hasUnitNearby(...a) : false,

      // Prefetch a target player's border tiles into the per-tick cache, so the
      // SYNC `target.borderTiles()` (and portutil.calculateTerritoryCenter /
      // randTerritoryTileArray) work for that target. `await` before use.
      ensureBorderTiles: (p) => ensureBorderTiles(p),

      // ── §SHIM-DATA accessors (structure placement) ────────────────────────
      // Water-component reconstruction (full-resolution union-find, cached once
      // per game). getWaterComponent mirrors core; sharedWaterComponents mirrors
      // core SharedWaterCache. railroadState exposes the real rail-tile buffer in
      // the extension (null under the harness → proximity fallback).
      getWaterComponent: (tile) => getWaterComponent(tile),
      sharedWaterComponents: (p) => sharedWaterComponents(p),
      railroadState: () => railroadState(),

      // expose internals the behaviors/engine need
      _wrapPlayer: wrapPlayer,
      _wrapUnit: wrapUnit,
    };

    // ── per-tick snapshot ─────────────────────────────────────────────────────
    async function ensureBorderTiles(player) {
      const core = unwrap(player);
      const sid = core.smallID();
      const tick = src.ticks();
      const cached = borderCache.get(sid);
      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      // TIME-BASED reuse (not per-tick): serve a border up to ~1.5s old instead of
      // re-hitting the worker every tick. CRITICAL at MAX game speed, where the
      // worker/client is saturated by GameUpdates and a per-tick borderTiles
      // request times out → empty → BLIND bot. (Mirrors the old 2.2s border cache.)
      const BORDER_REUSE_MS = 1500;
      if (
        cached &&
        cached.set &&
        cached.set.size > 0 &&
        now - (cached.at || 0) < BORDER_REUSE_MS
      ) {
        return cached.set;
      }
      // Don't pile up concurrent requests for the same player (worsens saturation)
      // — if a fetch is already in flight, serve the last-good set immediately.
      if (cached && cached.inFlight) {
        return cached.set || new Set();
      }
      const entry = cached || { at: 0, set: new Set(), inFlight: false };
      entry.inFlight = true;
      borderCache.set(sid, entry);
      let fetched = null;
      try {
        // Longer timeout than the default — at max speed the worker may be slow.
        const res = await withTimeout(core.borderTiles(), 4000, null);
        const s = res && res.borderTiles ? res.borderTiles : res;
        if (s) {
          const ns = new Set(s);
          if (ns.size > 0) fetched = ns;
        }
      } catch (_e) {
        /* keep last good */
      }
      entry.inFlight = false;
      if (fetched !== null) {
        entry.set = fetched;
        entry.at =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
      }
      // else: keep entry.set (last good) — never blank the bot.
      borderCache.set(sid, entry);
      return entry.set || new Set();
    }

    // Called ONCE at the top of each decision tick, before any behavior runs.
    async function beginTick(meCorePlayer) {
      mePlayer = wrapPlayer(meCorePlayer);
      const tick = src.ticks();

      // decay overlay 0.05/tick toward 0 (PlayerImpl.decayRelations) — once per
      // game tick crossed.
      if (lastSnapshotTick >= 0 && tick > lastSnapshotTick) {
        const steps = Math.min(tick - lastSnapshotTick, 50);
        for (const [k, v] of overlay) {
          let r = v;
          for (let i = 0; i < steps; i++) {
            const sign = -1 * Math.sign(r);
            r += sign * 0.05;
            if (Math.abs(r) < 0.1) {
              r = 0;
              break;
            }
          }
          if (r === 0) overlay.delete(k);
          else overlay.set(k, r);
        }
      }
      lastSnapshotTick = tick;

      // snapshot me.borderTiles + profile (relation buckets).
      await ensureBorderTiles(mePlayer);
      try {
        const prof = await withTimeout(unwrap(mePlayer).profile(), WORKER_TIMEOUT_MS, null);
        if (prof && prof.relations) {
          profileRelations = new Map(
            Object.entries(prof.relations).map(([k, v]) => [Number(k), Number(v)]),
          );
          profileAlliances = (prof.alliances || []).map(Number);
        }
      } catch (_e) {
        /* keep previous profile on failure */
      }
      return mePlayer;
    }

    return {
      game: api,
      beginTick,
      ensureBorderTiles,
      wrapPlayer,
      overlay,
      // SHIMS (§5) for sharedWaterComponents / railNetwork are attached in
      // structureBehavior's phase (Phase 2) to keep this file focused; they read
      // only api primitives (isOcean/isShore/neighbors + unit tiles).
    };
  }
