// Fake game objects built to the EXACT surface gameApi really exposes.
//
// This is the most valuable thing in test/. Three of the four crashes found in the last
// two review rounds were the same mistake — bot code calling a method gameApi does not
// expose:
//
//   * game.forEachNeighbor(...)  — the api is a plain object literal with `neighbors`
//                                  (an array). forEachNeighbor never existed, so this
//                                  was a TypeError that aborted the whole warship
//                                  combat pass. It had never run.
//   * unit.isFriendly(me)        — isFriendly is a PLAYER method. wrapUnit does not
//                                  expose it, so both enemy-collection filters threw
//                                  into their per-unit catch and came out EMPTY.
//   * config().defaultNukeSpeed() — absent from Config; the config Proxy forwards
//                                  t[prop] unchanged, so this resolved to undefined()
//                                  and killed the entire nuclear offence.
//
// A stub that merely omits those would let `undefined()` fail with a vague message. These
// stubs THROW BY NAME on any property the real surface does not have, so the failure
// names itself. That turns a whole class of bug into a test failure rather than a silent
// no-op in production — which is worth more than any single assertion in this directory.
//
// The surfaces below are asserted against gameApi.js itself in gameapi-surface.test.mjs,
// so they cannot silently rot as the real api changes.

/** Every key on gameApi's `api` object literal. Anything else is not available to bot
 *  code at runtime, no matter how reasonable it sounds. */
export const API_SURFACE = [
  "ticks",
  "inSpawnPhase",
  "isSpawnImmunityActive",
  "config",
  "myPlayer",
  "players",
  "playerViews",
  "playerBySmallID",
  "nations",
  "terraNullius",
  "owner",
  "ownerID",
  "hasOwner",
  "numLandTiles",
  "numTilesWithFallout",
  "getWinner",
  "units",
  "unitCount",
  "ref",
  "x",
  "y",
  "cell",
  "width",
  "height",
  "isValidCoord",
  "isOnMap",
  "isLand",
  "isWater",
  "isOcean",
  "isShore",
  "isOceanShore",
  "isBorder",
  "magnitude",
  "hasFallout",
  "neighbors",
  "manhattanDist",
  "euclideanDistSquared",
  "terrainType",
  "nearbyUnits",
  "hasUnitNearby",
  "ensureBorderTiles",
  "getWaterComponent",
  "sharedWaterComponents",
  "railroadState",
];

/** Everything wrapUnit returns — 17 accessors plus __src. NOTE: no `troops`, `attacker`,
 *  `target` or `retreating` (those are wrapAttack's), no `maxHealth`, no `veterancy`
 *  (read veterancy off warshipState()), and above all no `isFriendly`. */
export const UNIT_SURFACE = [
  "__src",
  "owner",
  "type",
  "tile",
  "level",
  "id",
  "isActive",
  "isUnderConstruction",
  "isInCombat",
  "hasTrainStation",
  "missileTimerQueue",
  "targetTile",
  "patrolTile",
  "warshipState",
  "transportShipState",
  "health",
  "ticksLeftInCooldown",
  "lastSetSafeFromPirates",
];

/** Everything wrapAttack returns. */
export const ATTACK_SURFACE = [
  "__src",
  "troops",
  "attacker",
  "target",
  "retreating",
  "id",
  "hasSourceTile",
  "sourceTile",
];

// Properties every JS object gets asked for by the runtime, spread operators, console,
// promise resolution and so on. Letting these through keeps the strict proxy usable.
const HOST_PROPS = new Set([
  "then",
  "constructor",
  "toString",
  "valueOf",
  "inspect",
  "hasOwnProperty",
  "nodeType",
  "length",
  "name",
]);

/** Wrap `obj` so reading anything outside `allowed` throws by name.
 *
 *  This is the enforcement mechanism. Do not "helpfully" add a missing method here to
 *  make a test pass — if bot code needs it, either the real gameApi exposes it (in which
 *  case add it to the SURFACE list and to gameApi) or the bot code is wrong. */
export function strictSurface(obj, allowed, label) {
  const ok = new Set(allowed);
  return new Proxy(obj, {
    get(t, prop) {
      if (typeof prop === "symbol" || HOST_PROPS.has(prop)) return t[prop];
      if (!ok.has(prop)) {
        throw new TypeError(
          `${label} has no "${String(prop)}" — the real gameApi does not expose it. ` +
            `If production code reads this, it throws there too.`,
        );
      }
      return t[prop];
    },
    has(t, prop) {
      return ok.has(prop) || typeof prop === "symbol" || HOST_PROPS.has(prop);
    },
  });
}

// ── a square tile grid, matching the engine's tile-as-integer convention ──────────

/** Grid helpers for a WxH map. Tiles are `y * W + x`, exactly as the engine treats them. */
export function grid(W = 400, H = 400) {
  const T = (x, y) => y * W + x;
  const xOf = (t) => t % W;
  const yOf = (t) => Math.floor(t / W);
  return {
    W,
    H,
    T,
    xOf,
    yOf,
    manhattanDist: (a, b) => Math.abs(xOf(a) - xOf(b)) + Math.abs(yOf(a) - yOf(b)),
    euclideanDistSquared: (a, b) => (xOf(a) - xOf(b)) ** 2 + (yOf(a) - yOf(b)) ** 2,
    neighbors: (t) => {
      const x = xOf(t),
        y = yOf(t),
        out = [];
      if (x > 0) out.push(T(x - 1, y));
      if (x < W - 1) out.push(T(x + 1, y));
      if (y > 0) out.push(T(x, y - 1));
      if (y < H - 1) out.push(T(x, y + 1));
      return out;
    },
  };
}

/** Verified upstream constants (src/core/configuration/Config.ts). Defaults for the
 *  config stub; override per test. Keep these honest — a wrong constant here turns a
 *  passing test into a lie. */
export const UPSTREAM = {
  // Warships
  warshipTargettingRange: 130, // compared as SQUARED EUCLIDEAN by UnitGrid
  warshipShellAttackRate: 20,
  warshipRetreatHealthPercent: 75,
  warshipPatrolRange: 100,
  warshipPassiveHealing: 1,
  warshipPassiveHealingRange: 150, // and only near an OWN port
  warshipPortHealingBonusPerLevel: 5,
  warshipMaxVeterancy: 3,
  warshipVeterancyHealthBonus: 20, // integer percent of base max health per level
  warshipVeterancyShellDamageBonus: 20,
  // Shells. ShellExecution: roll = nextInt(1,6) and nextInt is MAX-EXCLUSIVE, so the
  // roll is 1..5, multiplier is {200,225,250,275,300} (mean 250), and the return is
  // round((baseDamage / 250) * multiplier) — expected damage is exactly baseDamage.
  shellBaseDamage: 250,
  shellExpectedMultiplier: 250,
  // Nukes
  nukeSpeed: { "Atom Bomb": 10, "Hydrogen Bomb": 10, MIRV: 15, "MIRV Warhead": 22 },
  nukeMagnitudes: {
    "Atom Bomb": { inner: 12, outer: 30 },
    "Hydrogen Bomb": { inner: 80, outer: 100 },
    "MIRV Warhead": { inner: 12, outer: 18 },
  },
  // Defense posts
  defensePostRange: 30,
  defensePostDefenseBonus: 5,
  defensePostSpeedBonus: 3,
  // SAMs. samRange(level) = 150 - 480/(level+5); level = concurrent intercept slots.
  maxSamRange: 150,
  SAMCooldown: 90,
  samRange: (level) => 150 - 480 / (level + 5),
};

/** A config stub. Only the methods you pass (plus the UPSTREAM defaults you opt into)
 *  exist; anything else throws, which is what caught defaultNukeSpeed. */
export function makeConfig(overrides = {}) {
  const base = {
    isUnitDisabled: () => false,
    unitInfo: (t) => (t === "Shell" ? { damage: UPSTREAM.shellBaseDamage } : { maxHealth: 1000 }),
    warshipTargettingRange: () => UPSTREAM.warshipTargettingRange,
    warshipShellAttackRate: () => UPSTREAM.warshipShellAttackRate,
    warshipRetreatHealthPercent: () => UPSTREAM.warshipRetreatHealthPercent,
    warshipVeterancyHealthBonus: () => UPSTREAM.warshipVeterancyHealthBonus,
    warshipVeterancyShellDamageBonus: () => UPSTREAM.warshipVeterancyShellDamageBonus,
    nukeSpeed: (t) => UPSTREAM.nukeSpeed[t] ?? 10,
    samRange: UPSTREAM.samRange,
    maxSamRange: () => UPSTREAM.maxSamRange,
    SAMCooldown: () => UPSTREAM.SAMCooldown,
    defensePostRange: () => UPSTREAM.defensePostRange,
  };
  return { ...base, ...overrides };
}

/** A config whose surface is exactly what you give it — used to reproduce the
 *  pass-through Proxy in gameApi (`get` returns `t[prop]`), where a missing method
 *  resolves to undefined and calling it is a TypeError. */
export function makeBareConfig(methods = {}) {
  return new Proxy(methods, {
    get: (t, p) => {
      const v = t[p];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** A game stub restricted to the real api surface.
 *  Pass `{ strict: false }` only when a test genuinely needs an off-surface helper. */
export function makeGame(opts = {}) {
  const g = opts.grid || grid();
  const cfg = opts.config || makeConfig();
  const base = {
    ticks: () => opts.ticks ?? 100,
    config: () => cfg,
    width: () => g.W,
    height: () => g.H,
    ref: g.T,
    x: g.xOf,
    y: g.yOf,
    manhattanDist: g.manhattanDist,
    euclideanDistSquared: g.euclideanDistSquared,
    neighbors: g.neighbors,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H,
    isOnMap: () => true,
    isLand: () => true,
    isWater: () => true,
    isShore: () => false,
    isBorder: () => false,
    hasOwner: () => false,
    ownerID: () => 0,
    hasFallout: () => false,
    units: (type) => (opts.units && opts.units[type]) || [],
    unitCount: () => 0,
    getWaterComponent: () => 1,
    nearbyUnits: () => [],
    hasUnitNearby: () => false,
  };
  const merged = { ...base, ...(opts.overrides || {}) };
  if (opts.strict === false) return merged;
  return strictSurface(merged, API_SURFACE, "game");
}

/** A unit restricted to wrapUnit's real surface. `warshipState` carries veterancy —
 *  that is the ONLY route to it, since wrapUnit exposes no veterancy() of its own. */
export function makeUnit(fields = {}) {
  const u = {
    __src: null,
    owner: () => fields.owner ?? null,
    type: () => fields.type ?? null,
    tile: () => fields.tile ?? 0,
    level: () => fields.level ?? 1,
    id: () => fields.id ?? "u0",
    isActive: () => fields.isActive ?? true,
    isUnderConstruction: () => fields.isUnderConstruction ?? false,
    isInCombat: () => fields.isInCombat ?? false,
    hasTrainStation: () => fields.hasTrainStation ?? false,
    missileTimerQueue: () => fields.missileTimerQueue ?? [],
    targetTile: () => fields.targetTile,
    patrolTile: () => fields.patrolTile,
    warshipState: () => fields.warshipState,
    transportShipState: () => fields.transportShipState,
    health: () => fields.health,
    ticksLeftInCooldown: () => fields.ticksLeftInCooldown ?? 0,
    lastSetSafeFromPirates: () => fields.lastSetSafeFromPirates,
  };
  return strictSurface(u, UNIT_SURFACE, "unit");
}

/** A warship, since that is the unit these tests build most. `state` is the engine's
 *  own vocabulary: "patrolling" | "retreating" | "docked". */
export function makeWarship({
  id,
  tile,
  state = "patrolling",
  hp = 1000,
  vet = 0,
  ownerSid = 1,
  friendly = false,
  patrolTile,
}) {
  return makeUnit({
    id,
    tile,
    type: "Warship",
    health: hp,
    warshipState: { state, patrolTile: patrolTile ?? tile, veterancy: vet },
    owner: makePlayer({ smallID: ownerSid, friendly }),
  });
}

/** A player. isFriendly lives HERE, not on units — that distinction is the whole point
 *  of two of the crashes above. */
export function makePlayer({ smallID = 1, friendly = false, sameTeam = false, units = {} } = {}) {
  return {
    smallID: () => smallID,
    id: () => `p${smallID}`,
    isFriendly: () => friendly,
    isOnSameTeam: () => sameTeam,
    units: (t) => units[t] || [],
  };
}
