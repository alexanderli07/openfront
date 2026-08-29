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

  /** samDefense: SAM levels wanted per level of hostile Missile Silo. Silo level ==
   *  missiles it can hold, and SAM level == interceptions it can make, so ~parity is
   *  the goal; slightly under parity to stop a silo race from consuming the economy. */
  const SAM_PER_HOSTILE_SILO_LEVEL = 0.75;
  /** samDefense: absolute ceiling so a nuke-heavy lobby can't spiral. */
  const SAM_MAX_LEVELS = 24;

  /** defensePosts: rolling window for the income estimate. 600 ticks = 60s. */
  const INCOME_WINDOW_TICKS = 600;
  /** Minimum span before the income estimate is trusted at all. Without this, two
   *  samples 10 ticks apart around a single trade payout extrapolate 60x — one 50k
   *  lump reads as 3M/min and instantly asks for the maximum number of defence
   *  posts. Below this span the estimate is 0, i.e. "no data", not "no income". */
  const INCOME_MIN_SPAN_TICKS = 300;

  // ── DIVERGENCE: income sampling. Free functions in the shared scope rather than
  // StructureBehavior methods, because the nuke throttle needs the NET rate and has no
  // reference to that instance. Driven once per tick from nationExecution.tick() so it
  // keeps running regardless of the build/defensePosts feature toggles — a throttle
  // that fails closed must never be starved of data by an unrelated switch.
  function sampleBotIncome(game, player) {
    let tick;
    let gold;
    try {
      tick = Number(game.ticks());
      gold = Number(player.gold());
    } catch (_e) {
      return;
    }
    if (!Number.isFinite(tick) || !Number.isFinite(gold)) return;
    const inc = state.income;
    // Same tick twice (two callers in one pass) would push a zero-span sample.
    const tail = inc.samples[inc.samples.length - 1];
    if (tail && tail.tick === tick) return;
    // (A new game restarting game.ticks() near 0 would leave a negative-span window here;
    // that is handled once for ALL tick-stamped state by maybeResetForNewGame in core.js,
    // called from nationExecution.tick() just before this sampler.)
    if (inc.lastGold !== null && gold > inc.lastGold) inc.earned += gold - inc.lastGold;
    inc.lastGold = gold;
    inc.samples.push({ tick: tick, earned: inc.earned, gold: gold });
    const cutoff = tick - INCOME_WINDOW_TICKS;
    while (inc.samples.length > 1 && inc.samples[0].tick < cutoff) inc.samples.shift();
  }

  function incomeWindow() {
    const inc = state.income;
    if (!inc || inc.samples.length < 2) return null;
    const first = inc.samples[0];
    const last = inc.samples[inc.samples.length - 1];
    const dt = last.tick - first.tick;
    if (dt < INCOME_MIN_SPAN_TICKS) return null;
    return { first: first, last: last, dt: dt };
  }

  /** Positive-delta income: the sum of gold INCREASES between consecutive samples.
   *  NOT true gross income — the game exposes no income accessor, and each sample is taken
   *  once per tick before the build pass spends, so a tick whose earnings were outspent
   *  contributes 0 rather than its earnings. That biases the estimate DOWNWARD under heavy
   *  building, which makes every consumer conservative (it under-spends rather than
   *  over-spends). Still far better than the raw balance slope, which the build pass drives
   *  to ~0 every tick and which therefore reported "flat economy" during a boom. */
  function estimatedGoldPerMinute() {
    const w = incomeWindow();
    if (w === null) return 0;
    return ((w.last.earned - w.first.earned) / w.dt) * 600;
  }

  // REMOVED: estimatedNetGoldPerMinute(). Its only consumer was the nuke income throttle,
  // which now reads GROSS — the balance slope it returned was driven to ~0 every tick by
  // handleStructures() spending the treasury, so it reported "flat economy" while the
  // economy boomed and blocked every warhead. samples[].gold is kept: it is one number and
  // it records the raw balance the slope was derived from.

  /** Gold the MIRV war chest holds back. THE single definition of this hold: both the
   *  build gate (handleStructures) and the warhead gate (maybeSendNuke) call it, so the two
   *  can no longer disagree — them disagreeing is what deadlocked the entire nuclear
   *  offence (the nuke pass held fire completely while the build pass, exempt, spent the
   *  chest away, so the 25M target was never reached and nothing ever cleared it).
   *
   *  Returns 0n when no chest is set, which is the common case.
   *
   *  Under economyFirst it always returns 0n, and that is deliberate. Withholding gold
   *  CANNOT fund a 25M MIRV here, in either available shape:
   *    - all-or-nothing (availableGold = gold - 25M) is ZERO for any gold under 25M, which
   *      freezes the build pass outright from ~10 min onward;
   *    - proportional (hold f of the treasury) leaves (1-f)*gold spendable, so any spender
   *      with a price floor C keeps buying whenever gold >= C/(1-f). The treasury then has a
   *      fixed point at C/(1-f) — with the 750k atom bomb and f=0.5 that is ~1.5M — and it
   *      never approaches 25M. Raising f only moves the attractor: it would take f≈97% to
   *      reach 25M, a value that silently breaks the moment the cheapest marginal purchase
   *      changes (a 250k defence post would need 99%).
   *  The real cause is that economyFirst gives the builder an effectively unbounded appetite
   *  (prices capped at 1M, no ratio ceiling, save-up throttle disabled), so holding gold
   *  back only strands it for a MIRV that never arrives. The MIRV stays OPPORTUNISTIC under
   *  economyFirst: considerMIRV still launches one the moment gold reaches its price. With
   *  economyFirst OFF, the faithful win-fix hold applies in full to BOTH gates. */
  function mirvReserveHold(goldBigInt) {
    if (!state.settings.winFixes) return 0n;
    if (state.settings.economyFirst) return 0n;
    let chest = 0n;
    let gold = 0n;
    try {
      chest = BigInt(state.nukeReserveGold || 0);
      gold = BigInt(goldBigInt || 0);
    } catch (_e) {
      return 0n;
    }
    if (chest <= 0n || gold <= 0n) return 0n;
    return chest;
  }

  /** safePlacement: distance at which the "away from a threat border" term saturates,
   *  as a multiple of the atom blast radius. Past this, extra depth buys nothing real and
   *  would just out-shout the elevation and spacing terms. */
  const SAFE_PLACEMENT_RANGE_MULT = 3;
  /** safePlacement: weight of the "far from any border we do not trust" term. Sized to
   *  compete with src's own terms rather than dominate them: elevation contributes ~0-10
   *  and the two src distance terms saturate at the blast radius (~31) and twice it (~62). */
  const SAFE_WEIGHT_THREAT = 40;
  /** safePlacement: weight of the "near a TEAMMATE border" term. Deliberately smaller than
   *  the threat term — hugging a teammate is a bonus, but not at the price of sitting next
   *  to an enemy. */
  const SAFE_WEIGHT_TEAM = 25;
  /** safePlacement: weight of the atom-separation term. This is the user's hard
   *  requirement, so it outweighs both strategic terms.
   *
   *  It is a GRADIENT on distance-to-nearest-structure, NOT a flat penalty for "is
   *  blast-paired". A flat penalty is worthless here and it is worth spelling out why: the
   *  exclusion disc around each structure has radius 2R (~60 tiles), which on a normal
   *  territory covers the whole map, so EVERY candidate is paired with something and every
   *  candidate takes the SAME penalty. Subtracting a constant from every candidate leaves
   *  every `b.value - a.value` comparison unchanged, so the ranking — and therefore the
   *  chosen tile — is bit-identical to having no penalty at all. A gradient always
   *  discriminates: when nothing can fully escape, it still picks the least-paired tile. */
  const SAFE_WEIGHT_SEPARATION = 60;
  /** safePlacement: penalty for sitting in a low-level SAM's "outranged" ring.
   *
   *  The nuke target scorer has exactly ONE owner-blind term, and it is huge: on
   *  Impossible with a Hydrogen Bomb, every SAM launcher of level 1-4 within the hydrogen
   *  blast radius of the aim tile adds 100_000 * level to that tile's value, no matter
   *  WHOSE launcher it is (nukeBehavior.js, the "SAMs that can be outranged" block).
   *  A city is 25_000 * level by comparison — one level-4 launcher is worth sixteen cities
   *  as a target. So a building sited in that ring is standing in a bullseye.
   *
   *  It is a RING, not a disc: the bonus requires distToSam > samRange(level), because a
   *  closer tile would simply be intercepted. Sitting INSIDE a launcher's range is safe
   *  from this term (and defended). Only the annulus
   *  ( samRange(level), hydrogenOuter ] is dangerous.
   *
   *  Saturating rather than per-level so a single level-4 launcher cannot dominate the
   *  whole score, and graded by exposure so it still discriminates when every candidate
   *  sits in some ring — a flat penalty applied to every candidate changes no ranking. */
  const SAFE_WEIGHT_SAM_MAGNET = 50;
  /** Level at and above which a launcher stops being a magnet: the targeting term skips
   *  level >= 5 ("can't outrange level 5+ SAMs"). Upgrading a level-4 launcher to 5 removes
   *  the bullseye outright — cheaper than relocating everything around it. */
  const SAM_MAGNET_MAX_LEVEL = 5;
  /** Exposure (summed magnet levels) at which the penalty saturates. */
  const SAM_MAGNET_FULL_LEVELS = 4;

  /** samUmbrella: weight of the "sited under a friendly SAM umbrella" term.
   *
   *  USER: "if a team SAM covers our land, prioritize that covered area over spreading it
   *  around our land."
   *
   *  Sized to OUTRANK the separation term (60) deliberately - that inversion IS the
   *  request: a covered-but-clustered site should beat an uncovered-but-perfectly-spread
   *  one.
   *
   *  Which means it also outranks the threat term (40), and that needed handling: taken
   *  alone it would site cities on the enemy border whenever a SAM happened to reach there,
   *  and a SAM stops warheads, not infantry - the commonest way to lose a city is still
   *  ground capture. Hence UMBRELLA_FRONT_FLOOR: the bonus is attenuated toward the
   *  untrusted front, so cover we may not be holding for long counts for less. At the floor
   *  it drops below the separation term, which is the one case where spreading out should
   *  still win.
   *
   *  Why a TEAMMATE's launcher counts as fully ours (SAMLauncherExecution.ts, verified):
   *  isValidNukeTarget() rejects only nukes owned by the launcher itself or by one of the
   *  launcher's own friendlies - it never asks whose territory the nuke is aimed at. And
   *  checkDetonationInterception() gates on the nuke's FINAL tile being inside
   *  dynamicSamRange, i.e. "aimed inside the umbrella" is itself the interception
   *  condition. A teammate's SAM genuinely shoots down the bomb flying at our city. */
  const SAFE_WEIGHT_SAM_UMBRELLA = 90;
  /** samUmbrella: trust in an ALLY's launcher, relative to our own or a teammate's. It
   *  really does protect us right now, but an alliance can be broken and the launcher
   *  deleted, and the standing rule here is that allies are untrusted for strategy - so it
   *  attracts buildings at half weight and never releases the pairing rule (below). */
  const UMBRELLA_TRUST_ALLY = 0.5;
  /** samUmbrella: share of the umbrella bonus that survives right on the untrusted front,
   *  rising to the full bonus once we are `range` tiles clear of it.
   *
   *  The invariant that picks the number: SAFE_WEIGHT_SAM_UMBRELLA * this floor must come
   *  out BELOW the threat swing (40) AND below the separation swing (60). 90 * 0.35 = 31.5
   *  clears both. That is what guarantees our own terms never favour a front-line site on
   *  their own - the first draft used 0.5, where the attenuated bonus (45) still beat the
   *  threat swing, and only src's border-distance term (+30) was quietly saving us.
   *  Away from the front the attenuation fades out and the umbrella takes priority over
   *  spreading, which is the whole point.
   *
   *  Note the pairing RELEASE is deliberately NOT attenuated: the interception is just as
   *  real on the front line, it is the ground underneath we might not keep. */
  const UMBRELLA_FRONT_FLOOR = 0.35;
  /** samUmbrella: trusted intercept slots at which we stop caring about atom-pairing.
   *
   *  A launcher's LEVEL is its number of simultaneous intercept slots, not a range stat:
   *  UnitImpl.isInCooldown() is `missileTimerQueue.length === level`, and SAMLauncherExecution
   *  fires at target after target in ONE tick until that is true, each slot then taking
   *  SAMCooldown() = 90 ticks to reload. So an umbrella of N slots eats N warheads before
   *  the (N+1)th lands, and to exploit a cluster underneath it the enemy has to buy AND
   *  deliver N+1 atoms (750k gold each) inside a 9-second window - with silos on the same
   *  90-tick reload clock, that also means N+1 silo levels. Three slots (one level-3
   *  launcher, or a pair of overlapping level-1/2s) is where that stops being cheap. */
  const UMBRELLA_RELEASE_SLOTS = 3;

  /** safePlacement: weight of the "as deep behind the lines as we can get" term (USER: "if
   *  im near the frontlines... place the buildings as far back and as deep into our teams
   *  territory as possible").
   *
   *  This exists because SAFE_WEIGHT_THREAT SATURATES: it divides by `range` and clamps, so
   *  once a tile is 3 blast radii (~90 tiles) clear of the front it stops earning anything
   *  and a site 100 tiles back ranks identically to one 400 tiles back. Depth past that
   *  point was invisible to the scorer, which is why buildings kept landing mid-territory.
   *
   *  The shape is d/(d+range), which never saturates - deeper ALWAYS scores higher, so the
   *  deepest candidate on the list wins - while the marginal gain shrinks with depth (90 ->
   *  0.5, 180 -> 0.67, 360 -> 0.8). That shrinking matters as much as the growth: between
   *  two nearby back-country tiles the depth difference is worth a point or two, so the
   *  LOCAL arrangement is still decided by separation, elevation and connectivity instead of
   *  everything piling onto the single deepest tile.
   *
   *  Sized above the umbrella (90) and the separation swing (60) on purpose - the user put
   *  depth first - but the umbrella still wins where it overlaps, since a covered deep tile
   *  collects both. */
  const SAFE_WEIGHT_DEPTH = 120;
  /** deepPlacement: how many random territory tiles to probe for the back country, and how
   *  many front tiles to measure them against. 200 x 32 is ~6.4k distance checks per
   *  placement - bounded, and it runs at most once per build. */
  const DEEP_PROBE_TILES = 200;
  const DEEP_FRONT_SAMPLE = 32;
  /** structureSpawnTile: how many ranked candidates we are willing to PROBE.
   *
   *  Scoring is sync and cheap, so every candidate is still scored; this only bounds the
   *  async tail. Each probe is a buildables() worker round-trip wrapped in withTimeout, and
   *  the two injections (deep + umbrella) can hand the loop 75 candidates where src handed
   *  it 25 - so without a cap a single city placement could sit through 75 sequential worker
   *  calls. The cap is generous rather than tight because dropping a candidate can only cost
   *  us a placement this tick, and it logs when it truncates. */
  const MAX_SPAWN_PROBES = 40;

  /** samDefense: what each asset class is worth PROTECTING, independent of its level.
   *  Ports and Factories are the economy — they mint the gold that pays for the troops,
   *  the warheads and the SAMs themselves — so a launcher covering them is worth more than
   *  one covering the same number of city levels. A City is troop capacity and rebuilds; a
   *  Missile Silo is offence, and is already deliberately sited inside SAM cover. */
  const SAM_PROTECT_WEIGHT = {};
  SAM_PROTECT_WEIGHT[UNIT.Port] = 2.5;
  SAM_PROTECT_WEIGHT[UNIT.Factory] = 2.5;
  SAM_PROTECT_WEIGHT[UNIT.City] = 1;
  SAM_PROTECT_WEIGHT[UNIT.MissileSilo] = 1;

  function samProtectWeight(type) {
    const w = SAM_PROTECT_WEIGHT[type];
    return typeof w === "number" && w > 0 ? w : 1;
  }

  /** Every level-1..4 SAM launcher on the map, ANY owner, with the ring that makes tiles
   *  around it attractive to a hydrogen strike. Owner-blind on purpose: the targeting term
   *  it mirrors does not care whose launcher it is, and OUR OWN low-level launchers are
   *  exactly as much of a magnet as an enemy's. */
  function collectSamMagnets(game) {
    const out = [];
    let hydroOuter = 0;
    try {
      hydroOuter = Number(game.config().nukeMagnitudes(UNIT.HydrogenBomb).outer) || 0;
    } catch (_e) {
      return out;
    }
    if (hydroOuter <= 0) return out;
    let all = [];
    try {
      all = game.units(UNIT.SAMLauncher) || [];
    } catch (_e) {
      return out;
    }
    for (const u of all) {
      try {
        const level = Number(u.level && u.level()) || 1;
        if (level >= SAM_MAGNET_MAX_LEVEL) continue;
        const inner = Number(game.config().samRange(level)) || 0;
        if (inner <= 0 || inner >= hydroOuter) continue; // no ring exists
        out.push({
          tile: u.tile(),
          level: level,
          innerSq: inner * inner,
          outerSq: hydroOuter * hydroOuter,
        });
      } catch (_e) {
        /* skip this launcher */
      }
    }
    return out;
  }

  /** Summed magnet level of every ring `tile` sits inside. 0 = not in any bullseye. */
  function samMagnetExposure(game, magnets, tile) {
    let levels = 0;
    for (const m of magnets) {
      let dsq;
      try {
        dsq = game.euclideanDistSquared(tile, m.tile);
      } catch (_e) {
        continue;
      }
      if (!Number.isFinite(dsq)) continue;
      if (dsq > m.innerSq && dsq <= m.outerSq) levels += m.level;
    }
    return levels;
  }

  /** samUmbrella: every friendly SAM launcher that can actually shoot for us, with the
   *  range it covers, its slot count and how much we trust it to still be there.
   *
   *  Under-construction launchers are skipped because they shoot nothing - SAMLauncherExecution
   *  returns early on isUnderConstruction() - so building under one that is still going up
   *  buys no protection today. `teammateSids` is passed in rather than recomputed: the caller
   *  has already classified every player, and "teammate" must stay keyed on team() rather
   *  than isFriendly(), which is also true for revocable alliances. */
  function collectFriendlyUmbrellas(game, player, teammateSids) {
    const out = [];
    let all = [];
    let cfg;
    try {
      all = game.units(UNIT.SAMLauncher) || [];
      cfg = game.config();
    } catch (_e) {
      return out;
    }
    if (!cfg || typeof cfg.samRange !== "function") return out;
    const mySid = player.smallID();
    for (const u of all) {
      try {
        if (u.isUnderConstruction && u.isUnderConstruction()) continue;
        const owner = u.owner && u.owner();
        if (!owner) continue;
        const sid = owner.smallID ? owner.smallID() : null;
        let trust = 0;
        if (sid !== null && sid === mySid) trust = 1;
        else if (sid !== null && teammateSids.has(sid)) trust = 1;
        else if (player.isFriendly(owner) === true) trust = UMBRELLA_TRUST_ALLY;
        if (trust <= 0) continue;
        const level = Number(u.level && u.level()) || 1;
        const range = Number(cfg.samRange(level)) || 0;
        if (range <= 0) continue;
        out.push({ tile: u.tile(), level: level, range: range, trust: trust });
      } catch (_e) {
        /* one unreadable launcher must not lose the rest */
      }
    }
    return out;
  }

  /** safePlacement: types worth protecting from a shared blast.
   *
   *  DefensePost used to be excluded here, on the grounds that posts are cheap and belong ON
   *  the border so a pairing rule would fight their whole point. That reasoning only holds
   *  for placing a POST, and posts never come through this scorer - tryBuildDefensePost
   *  ranks them with sampleTilesNearFront and its own front-distance ordering. The list is
   *  read only when siting something else, so including posts pushes cities and factories
   *  off them without moving a single post off the border.
   *
   *  USER asked for exactly that. Worth recording what it costs, because it is not free:
   *  every tile within defensePostRange() = 30 of one of OUR posts multiplies an attacker's
   *  per-tile troop loss by defensePostDefenseBonus() = 5 and their per-tile budget by
   *  defensePostSpeedBonus() = 3 (attackLogic), so a building inside that aura is far harder
   *  to GROUND-capture. But the aura radius and the atom blast radius are both 30, so the
   *  bonus is unobtainable without sharing a blast with the post - and the user's call is to
   *  take the nuke safety and get the buildings out of reach of the front entirely, which
   *  the depth term below now actually delivers. */
  const BLAST_PAIR_TYPES = [
    UNIT.City,
    UNIT.Factory,
    UNIT.Port,
    UNIT.MissileSilo,
    UNIT.SAMLauncher,
    UNIT.DefensePost,
  ];

  /** dpTangentSpacing: how far the post-spacing requirement may relax when a front is too
   *  crowded or a territory too narrow to honour tangency. Strictest first; the last tier is
   *  src's unconstrained sampler, because a shield that exists beats perfect geometry. */
  const DP_SPACING_TIERS = [1, 0.8, 0.6, 0];

  /** defensePosts: minutes of income we are willing to have tied up in posts. */
  const DEFENSE_POST_INCOME_MINUTES = 1;
  /** defensePosts: absolute ceiling regardless of income. */
  const DEFENSE_POST_MAX = 12;

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

  /** defensePostTiming: don't compute an advance rate from front snapshots closer
   *  together than this many ticks (sub-window deltas are all noise). */
  const DP_SPEED_MIN_WINDOW_TICKS = 20;
  /** defensePostTiming: EMA weight of the newest front-speed measurement. */
  const DP_SPEED_EMA = 0.5;
  /** defensePostTiming: max tiles kept per front snapshot — comparisons stay
   *  O(64 x 64) no matter how wide the war gets. */
  const DP_FRONT_SAMPLE_CAP = 64;
  /** defensePostTiming: the front must need DP_ETA_SAFETY x constructionDuration
   *  (+ the tick margin) to reach a candidate before we'll buy a post there.
   *  v1.64: raised 1.25->1.6 and 10->20 after shields kept dying mid-build. */
  const DP_ETA_SAFETY = 1.6;
  const DP_ETA_MARGIN_TICKS = 20;
  /** v1.64: plan against the SPEARHEAD, not the line — the game conquers the
   *  cheapest tiles first, so one prong runs far ahead of the median front and
   *  that prong is what reaches the shield. A real punch-through is a NARROW
   *  corridor (a few tiles on a wide front), so a percentile dilutes it away —
   *  use the mean of the top-K displacement samples instead: robust to a single
   *  aliasing outlier, still catches a thin prong. */
  const DP_SPEAR_TOPK = 3;
  /** v1.64: a front whose latest reading is still climbing gets extrapolated by
   *  this much — acceleration is the norm as the defence thins, and a trailing
   *  average systematically loses the race. */
  const DP_ACCEL_MULT = 1.5;
  /** v1.64: incoming/our troop ratio at which the attack will cascade once the
   *  border thins even if it measures slow RIGHT NOW — depth-floor it. */
  const DP_BIG_ATTACK_RATIO = 1.0;
  /** defensePostTiming: give up (buy nothing) once the required depth exceeds this
   *  many border-spacings — a blitz that fast outruns any post anywhere. */
  const DP_MAX_DEPTH_SPACINGS = 4;

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
    /** DIVERGENCE (defensePosts): src gives the bot no income signal at all. Accumulate
     *  POSITIVE gold deltas over a rolling window to estimate gold/min. Positive-only
     *  means spending is ignored (good) but received donations inflate it slightly
     *  (acceptable — this only sizes a build target, it is not an accounting figure). */

    /** DIVERGENCE (defensePosts): own border tiles adjacent to land owned by a hostile
     *  player. Unlike getAttackFrontTiles this does NOT require an active attack — a
     *  shared border is enough. Regular bots count as hostile; they do attack. */
    getEnemyFrontTiles() {
      const game = this.game;
      const player = this.player;
      // Resolve hostiles up front from players() — playerBySmallID is not guaranteed
      // to exist on every build (see resolveEventPlayer in allianceBehavior.js), and a
      // prebuilt set avoids a per-tile lookup on a border that can be thousands long.
      const hostileSids = new Set();
      try {
        for (const other of game.players()) {
          if (!other.isPlayer() || !other.isAlive()) continue;
          if (other.smallID() === player.smallID()) continue;
          if (player.isFriendly(other)) continue;
          // DIVERGENCE (defensePostPlayersOnly, USER): tribes are no longer a
          // "hostile front" for proactive posts — shields are for real players.
          // (They previously counted on purpose: "regular bots do attack".)
          if (
            state.settings.defensePostPlayersOnly &&
            other.type() === PlayerType.Bot
          ) {
            continue;
          }
          hostileSids.add(other.smallID());
        }
      } catch (_e) {
        return [];
      }
      if (hostileSids.size === 0) return [];

      const front = [];
      outer: for (const borderTile of player.borderTiles()) {
        for (const neighbor of game.neighbors(borderTile)) {
          if (!game.hasOwner(neighbor) || !game.isLand(neighbor)) continue;
          if (hostileSids.has(game.ownerID(neighbor))) {
            front.push(borderTile);
            continue outer;
          }
        }
      }
      return front;
    }

    /** DIVERGENCE (defensePosts): how many posts one minute of income can fund, using
     *  the real escalating cost curve min(250k, n * 50k). Self-scaling: a richer nation
     *  fortifies more heavily. */
    affordableDefensePosts() {
      const perMinute = estimatedGoldPerMinute();
      if (!(perMinute > 0)) return 0;
      const budget = perMinute * DEFENSE_POST_INCOME_MINUTES;
      let count = 0;
      let spend = 0;
      while (count < DEFENSE_POST_MAX) {
        const next = Math.min(250_000, (count + 1) * 50_000);
        if (spend + next > budget) break;
        spend += next;
        count += 1;
      }
      return count;
    }

    async handleStructures() {
      // Defense posts are handled outside the normal pacing/counter system:
      // they don't increment placementsCount or lastStructureTick, and they are
      // never built as the very first structure.
      // DIVERGENCE (defensePosts): src only ever reached tryBuildDefensePost while
      // ACTUALLY under attack, so giving it first refusal was a rare interrupt. Making
      // it proactive turned that into a permanent one: while we border anyone and can
      // afford a post, this branch built one and returned, so no city/port/factory was
      // ever considered on that pass. Reactive keeps first refusal (an attack is
      // landing now); proactive is moved BELOW the economy and spends surplus only.
      const postsAllowed =
        this.placementsCount > 0 &&
        !this.game.config().isUnitDisabled(UNIT.DefensePost);
      if (postsAllowed && this.defensePostNeeded()) {
        if (await this.tryBuildDefensePost()) {
          return true;
        }
        // Threshold met but placement failed (no tile / can't afford) — still block
        // other structures, exactly as src does.
        return false;
      }

      if (this.isOnStructureCooldown()) {
        return false;
      }
      if (this.isInPostSaveUpBlockedPhase()) {
        return false;
      }
      const built = await this.doHandleStructures();
      // Proactive defence posts run only when the economy pass declined to build —
      // i.e. out of surplus, never instead of a city.
      if (!built && postsAllowed && state.settings.defensePosts) {
        if (await this.tryBuildDefensePost()) {
          return true;
        }
      }
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
      // land border when the extension omits it. Tribe attacks are filtered under
      // defensePostPlayersOnly (see dpLandAttacks).
      const landAttacks = this.dpLandAttacks();
      const proactive = Boolean(state.settings.defensePosts);
      if (landAttacks.length === 0 && !proactive) return false;

      const ourTroops = player.troops();
      if (ourTroops <= 0 && !proactive) return false;

      const incomingTroops = landAttacks.reduce((sum, a) => sum + a.troops(), 0);
      const ratio = ourTroops > 0 ? incomingTroops / ourTroops : 0;

      // src's reactive target — 0 unless the incoming attack is big enough.
      let reactiveAllowed = 0;
      if (landAttacks.length > 0 && ratio >= UNDER_ATTACK_THREAT_RATIO) {
        reactiveAllowed =
          difficulty === Difficulty.Medium
            ? 1
            : Math.ceil(ratio / DEFENSE_POST_RATIO_PER_POST);
      }

      // DIVERGENCE (defensePosts): income-sized target, live whenever we share a land
      // border with a hostile player — no attack required.
      let enemyFront = [];
      let incomeAllowed = 0;
      if (proactive) {
        enemyFront = this.getEnemyFrontTiles();
        if (enemyFront.length > 0) incomeAllowed = this.affordableDefensePosts();
      }

      const allowed = Math.max(reactiveAllowed, incomeAllowed);
      if (allowed <= 0) return false;

      // Fortify the attacked front first when under attack; otherwise the whole
      // hostile border. Spacing in countDefensePostsNearFront / sampleTilesNearFront
      // self-limits how many actually fit, so no extra cap is needed here.
      const attackFront =
        landAttacks.length > 0 ? this.getAttackFrontTiles(landAttacks) : [];
      const frontTiles = attackFront.length > 0 ? attackFront : enemyFront;
      if (frontTiles.length === 0) return false;

      // DIVERGENCE (defensePostTiming, USER): a post takes constructionDuration
      // ticks to finish and defends NOTHING until then. Against a fast attack the
      // front used to overrun the site mid-build — pure wasted gold. Measure the
      // front's real advance rate and require every candidate's ETA (distance from
      // the front over that speed) to beat the build time plus margin: fast attack
      // → the whole sampling band shifts DEEPER so the post finishes just before
      // the front arrives; blitz nothing can beat → buy nothing, keep the gold.
      // Peacetime / stalled-front placement is unchanged.
      let depthPlan = null;
      let etaNeed = 0; // min tiles a candidate must sit from the front (0 = off)
      let frontProbe = null; // subsampled attack front for candidate distances
      if (attackFront.length > 0 && state.settings.defensePostTiming) {
        const speed = this.measureAttackFrontSpeed(attackFront, landAttacks);
        // First sight of this attack: snapshot taken, no rate yet. Hold this pass
        // (~1s) rather than guess — the build takes ~10x longer than the wait.
        if (speed === null) return false;
        // v1.64: an attack that OUTNUMBERS the standing defence will cascade once
        // the border thins, even while it measures slow — depth-floor it instead
        // of trusting the current reading.
        const bigAttack = ratio >= DP_BIG_ATTACK_RATIO;
        if (speed > 0 || bigAttack) {
          const buildTicks =
            typeof getConstructionDuration === "function"
              ? getConstructionDuration(this.game, UNIT.DefensePost)
              : 100;
          const needTicks = buildTicks * DP_ETA_SAFETY + DP_ETA_MARGIN_TICKS;
          const { borderSpacing } = this.spacingConstants();
          let requiredDepth = speed * needTicks;
          if (bigAttack) {
            requiredDepth = Math.max(requiredDepth, borderSpacing);
          }
          if (requiredDepth > borderSpacing * DP_MAX_DEPTH_SPACINGS) {
            ofhDebug(
              "[DPost] front advancing " +
                speed.toFixed(2) +
                " tiles/tick — no site can finish a post in time, keeping the gold",
            );
            return false;
          }
          etaNeed = requiredDepth;
          frontProbe = this.dpSubsample(attackFront);
          const defMin = Math.ceil(borderSpacing * 0.75);
          if (requiredDepth > defMin) {
            const min = Math.ceil(requiredDepth);
            depthPlan = { min, max: min + defMin };
            ofhDebug(
              "[DPost] front " +
                speed.toFixed(2) +
                " tiles/tick, build " +
                buildTicks +
                "t → placing ≥" +
                min +
                " tiles back",
            );
          }
        }
      }

      if (
        this.countDefensePostsNearFront(
          frontTiles,
          allowed,
          depthPlan ? depthPlan.max : undefined,
        ) >= allowed
      ) {
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
      const tiles = this.sampleTilesNearFront(
        frontTiles,
        25,
        UNIT.DefensePost,
        depthPlan,
      );
      // With the timing gate live, keep only candidates the front cannot reach
      // before the post finishes — DEEPEST first (v1.64: the closest-safe pick was
      // a knife-edge; any speed underestimate killed the shield mid-build, which
      // is exactly what the user kept seeing). Coverage costs a little; a shield
      // that survives to finish beats one that doesn't exist. Without the gate
      // (peacetime / stalled front) the sampler's original order is preserved.
      let ordered = tiles;
      if (etaNeed > 0 && frontProbe && frontProbe.length > 0) {
        const g = this.game;
        const withDist = [];
        for (const t of tiles) {
          let best = Infinity;
          for (const f of frontProbe) {
            const d = g.euclideanDistSquared(t, f);
            if (d < best) best = d;
          }
          const dist = Math.sqrt(best);
          if (dist >= etaNeed) withDist.push([dist, t]);
        }
        withDist.sort((a, b) => b[0] - a[0]);
        ordered = withDist.map((e) => e[1]);
        if (ordered.length === 0) {
          ofhDebug(
            "[DPost] no candidate deep enough to finish in time — keeping the gold",
          );
          return false;
        }
      }
      for (const tile of ordered) {
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

    /** DIVERGENCE (defensePostPlayersOnly, USER): the land attacks that count for
     *  defense posts. Tribes (PlayerType.Bot) are filtered out under the setting —
     *  their constant trickle was buying shields; posts are for real players. */
    dpLandAttacks() {
      let landAttacks = this.player
        .incomingAttacks()
        .filter((a) => this.isLandAttack(a));
      if (state.settings.defensePostPlayersOnly) {
        landAttacks = landAttacks.filter((a) => {
          try {
            const at = a.attacker();
            if (!at || !at.isPlayer || !at.isPlayer()) return true;
            return at.type() !== PlayerType.Bot;
          } catch (_e) {
            return true;
          }
        });
      }
      return landAttacks;
    }

    // defensePostNeeded — NationStructureBehavior.ts:229.
    defensePostNeeded() {
      const difficulty = currentDifficulty();
      if (difficulty === Difficulty.Easy) return false;
      const landAttacks = this.dpLandAttacks();
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

    /** DIVERGENCE (defensePostTiming, USER): every build pass while under attack,
     *  snapshot the attack front and compare with the previous snapshot at least
     *  DP_SPEED_MIN_WINDOW_TICKS older: the median, over current front tiles, of
     *  the distance to the nearest previous-front tile = how far the line moved.
     *  Direction comes from the attackers' total tile count — if the SAME attackers
     *  aren't gaining ground, the front is stalled (or WE are pushing) and the speed
     *  is 0. EMA-smoothed. Everything is in ticks and tiles, so the game-speed
     *  factor cancels (the tick-rate lesson: never convert through wall time).
     *  Returns null while unmeasured (first snapshot just taken), else tiles/tick.
     *  A tick regression (new game) resets the state.
     */
    measureAttackFrontSpeed(attackFront, landAttacks) {
      const game = this.game;
      let tick;
      try {
        tick = Number(game.ticks());
      } catch (_e) {
        return 0;
      }
      if (!Number.isFinite(tick)) return 0;
      if (this._dpSpeed && tick < this._dpSpeed.tick) this._dpSpeed = undefined;

      let attTiles = 0;
      const sidList = [];
      for (const a of landAttacks) {
        try {
          const at = a.attacker();
          if (at && at.isPlayer && at.isPlayer()) {
            attTiles += at.numTilesOwned();
            sidList.push(at.smallID());
          }
        } catch (_e) {
          /* skip this attack */
        }
      }
      const sids = sidList.sort().join(",");

      const prev = this._dpSpeed;
      if (!prev) {
        this._dpSpeed = {
          tick,
          sample: this.dpSubsample(attackFront),
          attTiles,
          sids,
          ema: null,
          inst: null,
          pess: null,
        };
        return null;
      }
      const elapsed = tick - prev.tick;
      if (elapsed < DP_SPEED_MIN_WINDOW_TICKS) {
        return prev.pess !== undefined ? prev.pess : prev.ema;
      }

      const sample = this.dpSubsample(attackFront);
      const dists = [];
      for (const t of sample) {
        let best = Infinity;
        for (const o of prev.sample) {
          const d = game.euclideanDistSquared(t, o);
          if (d < best) best = d;
        }
        if (Number.isFinite(best)) dists.push(Math.sqrt(best));
      }
      dists.sort((a, b) => a - b);
      // v1.64 (USER: "it punches through before the shield finishes"): a punch-
      // through is a SPEARHEAD. The median line understates the prong that
      // actually reaches the shield — track the mean of the top-K displacements.
      let disp = 0;
      if (dists.length > 0) {
        const k = Math.min(DP_SPEAR_TOPK, dists.length);
        let sum = 0;
        for (let i = dists.length - k; i < dists.length; i++) sum += dists[i];
        disp = sum / k;
      }
      // Same attackers whose tile count did not grow → stalled front, or our own
      // counter-push moving the line the OTHER way — either way nothing is racing
      // our construction. A changed attacker set can't be compared by count, so
      // trust the displacement (placing deeper is the cheap error).
      const gaining = prev.sids !== sids || attTiles > prev.attTiles;
      const inst = gaining ? disp / elapsed : 0;
      const ema =
        prev.ema === null
          ? inst
          : prev.ema * (1 - DP_SPEED_EMA) + inst * DP_SPEED_EMA;
      // v1.64: plan against the WORSE of (smoothed, latest) — and when the latest
      // reading is still climbing, extrapolate: the cascade is just starting.
      let pess = Math.max(inst, ema);
      if (prev.inst !== null && prev.inst !== undefined && inst > prev.inst) {
        pess *= DP_ACCEL_MULT;
      }
      this._dpSpeed = { tick, sample, attTiles, sids, ema, inst, pess };
      return pess;
    }

    /** Bounded every-k-th subsample of a front so snapshot comparisons stay cheap. */
    dpSubsample(tiles) {
      const step = Math.max(1, Math.floor(tiles.length / DP_FRONT_SAMPLE_CAP));
      const out = [];
      for (let i = 0; i < tiles.length; i += step) out.push(tiles[i]);
      return out;
    }

    /** DIVERGENCE (dpTangentSpacing, USER): centre-to-centre distance at which two of our
     *  defense posts sit exactly TANGENT - their auras meeting at a single tile - which is
     *  also precisely the distance at which one atom stops being able to take both.
     *
     *  Tangency is the EXACT threshold here, not a near-enough approximation, and it is worth
     *  writing down why. A post's aura is defensePostRange() = 30, an atom's outer radius is
     *  30, and NukeExecution destroys a unit only when
     *      euclideanDistSquared(dst, unit.tile()) < outer * outer
     *  - STRICTLY less than. With the centres 2r apart, the only tile in reach of both is the
     *  midpoint, at exactly r from each, where that strict compare fails and BOTH posts
     *  survive. One tile closer and a single warhead takes the pair. The same 2r is the most
     *  border two posts can cover with zero wasted overlap, so the nuke-safety optimum and
     *  the coverage optimum are the same number.
     *
     *  Read from the config, as the max of the two radii, so the rule stays correct if the
     *  game rebalances either one. Note this is centre-to-centre in the plane: a post sited
     *  DEEPER than r has an aura that no longer reaches the border at all (see the depth plan
     *  in tryBuildDefensePost), so along-border coverage is a separate question from this. */
    dpTangentSeparation() {
      const { borderSpacing } = this.spacingConstants();
      let r = borderSpacing; // borderSpacing IS the atom outer radius
      try {
        const cfg = this.game.config();
        const aura = Number(cfg.defensePostRange ? cfg.defensePostRange() : 0);
        if (Number.isFinite(aura) && aura > r) r = aura;
      } catch (_e) {
        /* keep the atom radius */
      }
      return 2 * Math.max(1, r);
    }

    // countDefensePostsNearFront — NationStructureBehavior.ts:269.
    // DIVERGENCE (defensePostTiming): optional maxDepth widens "near the front" to
    // at least the depth the timing plan actually places posts at — a deep-sited
    // post must still count here or the bot keeps buying more of them.
    countDefensePostsNearFront(frontTiles, cap, maxDepth) {
      if (frontTiles.length === 0) return 0;

      const game = this.game;
      const { borderSpacing } = this.spacingConstants();
      const range = Math.max(borderSpacing * 1.5, (maxDepth || 0) + 2);
      const rangeSquared = range ** 2;

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
    sampleTilesNearFront(frontTiles, count, _unitType, depthPlan) {
      const game = this.game;
      const player = this.player;

      if (frontTiles.length === 0) {
        return [];
      }

      const { borderSpacing } = this.spacingConstants();
      // DIVERGENCE (defensePostTiming): the caller may push the whole band deeper
      // than src's [0.75, 1.5] x spacing so a post can finish building before a
      // fast front reaches it. searchRadius must reach the band's far edge.
      const minBorderDist = depthPlan
        ? depthPlan.min
        : Math.ceil(borderSpacing * 0.75);
      const maxBorderDist = depthPlan
        ? depthPlan.max
        : Math.ceil(borderSpacing * 1.5);
      const searchRadius = maxBorderDist;
      const borderTiles = player.borderTiles();
      const mySid = player.smallID();

      // DIVERGENCE (dpTangentSpacing, USER: "spread our shield placements as well so that
      // atom bombs dont hit multiple shields, just make the shields circle exactly tangent
      // touching at one area"). Two things were wrong with the old spread rule:
      //
      //   * the distance was borderSpacing * 1.5 = 45 tiles. Two posts share an atom blast
      //     whenever they are under 2 x 30 = 60 apart, so 45 permitted exactly the pairing
      //     the user is objecting to. It is now the tangent separation - see
      //     dpTangentSeparation() for why tangency is the exact threshold; and
      //   * it was enforced on the front ANCHOR, never on the chosen tile. That was the real
      //     hole: the anchor filter only kept the sampling ORIGIN clear of existing posts,
      //     and the site is then offset from that origin by up to searchRadius, so the post
      //     itself could still land right on top of a neighbour.
      //
      // Tiered rather than absolute, so a crowded front or a narrow strip of land still gets
      // a shield: strictest first, last tier is src's unconstrained sampler.
      const tangentSep = this.dpTangentSeparation();
      const existingDPTiles = player
        .units(UNIT.DefensePost)
        .map((u) => u.tile());

      const farEnough = (t, sepSq) => {
        if (sepSq <= 0) return true;
        for (const dp of existingDPTiles) {
          if (game.euclideanDistSquared(t, dp) < sepSq) return false;
        }
        return true;
      };

      for (let tier = 0; tier < DP_SPACING_TIERS.length; tier++) {
        const frac = DP_SPACING_TIERS[tier];
        const sep = tangentSep * frac;
        const sepSq = sep * sep;

        let anchors = frontTiles;
        if (existingDPTiles.length > 0 && sepSq > 0) {
          anchors = frontTiles.filter((ft) => farEnough(ft, sepSq));
          // No part of this front is even that clear — no point sampling it, relax instead.
          if (anchors.length === 0) continue;
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
          // THE FIX: the SITE has to clear the neighbours, not just the anchor.
          if (!farEnough(t, sepSq)) continue;
          // src: if (!player.canBuild(unitType, t)) continue; → moved to probe phase.
          result.push(t);
        }

        if (result.length > 0) {
          if (frac < 1) {
            ofhDebug(
              "[DPost] tangent spacing " +
                Math.round(tangentSep) +
                " unsatisfiable here — relaxed to " +
                Math.round(sep) +
                "; a shield inside a neighbour's blast beats no shield",
            );
          }
          return result;
        }
      }

      // Fallback: relax the border-DEPTH constraint too (territory too small for the depth
      // ring). Spacing is already fully relaxed by the last tier above, and the anchor set
      // goes back to the whole front — this is the last resort before building nothing.
      const fallback = [];
      for (
        let attempt = 0;
        attempt < count * 4 && fallback.length < count;
        attempt++
      ) {
        const anchor = this.random.randElement(frontTiles);
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
            ofhDebug("[Build] dominance gate", {
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
      // DIVERGENCE (samDefense): while our air defence is below the threat-scaled
      // target, build SAMs BEFORE economy. src always puts ports/factories first, so a
      // nation under nuclear threat keeps expanding while its cities stay uncovered.
      // Only a REAL threat justifies jumping the economy queue. Comparing against the
      // full target used to hoist SAMs whenever the flat cities x 0.30 baseline was
      // unmet — which is true on turn one of a lobby where nobody owns a silo.
      if (
        state.settings.samDefense &&
        !config.isUnitDisabled(UNIT.SAMLauncher) &&
        this.ownedLevels(UNIT.SAMLauncher) < this.samThreatLevels(cityCount)
      ) {
        buildOrder.splice(buildOrder.indexOf(UNIT.SAMLauncher), 1);
        buildOrder.unshift(UNIT.SAMLauncher);
      }

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
    /** DIVERGENCE (samDefense): how many SAM levels we actually want, from real threat
     *  rather than a fixed per-city ratio. Two signals, both bounded by the amount of
     *  stuff we own that is worth protecting:
     *    - hostile Missile Silo levels  (who can nuke us, and how hard)
     *    - map-wide average SAM levels per player  (are we behind the field?)
     *  Never returns less than src's ratio target, so this only ever adds defence. */
    /** DIVERGENCE (samDefense): the parts behind the SAM target, memoised per game
     *  tick because both samTargetLevels() and the build-order hoist read them and the
     *  loop walks every player's units.
     *
     *  Split deliberately: `stock` is src's flat cities x ratio baseline, which is
     *  NON-ZERO even when nobody on the map owns a silo. Prioritising air defence
     *  ahead of the economy to satisfy a baseline — with no nuclear threat in
     *  existence — is exactly the "building shields for no reason" behaviour. Only
     *  `threat` and `peerAvg` justify jumping the queue. */
    samTargetParts(cityCount) {
      let tick = -1;
      try {
        tick = Number(this.game.ticks());
      } catch (_e) {
        tick = -1;
      }
      if (this._samPartsTick === tick && this._samParts) return this._samParts;
      const parts = this.computeSamTargetParts(cityCount);
      this._samPartsTick = tick;
      this._samParts = parts;
      return parts;
    }

    /** Largest silo capacity any single hostile coalition can field. Union-find over the
     *  "same coalition" relation, so a chain A-B, B-C groups all three. */
    peakHostileCoalitionCapacity(hostiles) {
      if (!hostiles || hostiles.length === 0) return 0;
      const parent = hostiles.map((_unused, i) => i);
      const find = (i) => {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };
      for (let i = 0; i < hostiles.length; i += 1) {
        for (let j = i + 1; j < hostiles.length; j += 1) {
          // Pass the WRAPPED PLAYERS, never the {player, capacity} records — team() and
          // isFriendly() exist on the player, and handing them a record would make every
          // comparison throw, silently leaving every coalition a singleton.
          if (this.sameCoalition(hostiles[i].player, hostiles[j].player)) {
            const a = find(i);
            const b = find(j);
            if (a !== b) parent[b] = a;
          }
        }
      }
      const byRoot = new Map();
      for (let i = 0; i < hostiles.length; i += 1) {
        const root = find(i);
        byRoot.set(root, (byRoot.get(root) || 0) + hostiles[i].capacity);
      }
      let peak = 0;
      for (const capacity of byRoot.values()) {
        if (capacity > peak) peak = capacity;
      }
      return peak;
    }

    /** Two hostiles count as one attacker if they share a team or are allied. */
    sameCoalition(a, b) {
      try {
        const ta = a.team ? a.team() : null;
        const tb = b.team ? b.team() : null;
        if (ta != null && tb != null && ta === tb) return true;
      } catch (_e) {
        /* fall through to the alliance test */
      }
      try {
        return a.isFriendly(b) === true;
      } catch (_e) {
        // Fail CLOSED: if we cannot establish that they are UNRELATED, assume they
        // coordinate. That merges them, sums their capacity, and over-protects — the
        // safe direction. Failing open would silently split a real team into singletons.
        return true;
      }
    }

    /** Threat-driven SAM levels only — ignores the flat baseline. */
    samThreatLevels(cityCount) {
      const p = this.samTargetParts(cityCount);
      return Math.max(0, Math.min(p.threat, p.protectables, SAM_MAX_LEVELS));
    }

    samTargetLevels(cityCount) {
      const p = this.samTargetParts(cityCount);
      if (!state.settings.samDefense) return p.stock;
      const wanted = Math.max(p.stock, p.threat, p.peerAvg);
      return Math.max(p.stock, Math.min(wanted, p.protectables, SAM_MAX_LEVELS));
    }

    computeSamTargetParts(cityCount) {
      const stockRatio = getStructureRatios(currentDifficulty())[UNIT.SAMLauncher];
      const stock = Math.floor(cityCount * stockRatio.ratioPerCity);
      const bail = { stock: stock, threat: 0, peerAvg: 0, protectables: stock };
      if (!state.settings.samDefense) return bail;

      const game = this.game;
      const me = this.player;
      const hostiles = [];
      let allSamLevels = 0;
      let peers = 0;
      try {
        for (const p of game.players()) {
          if (!p.isPlayer() || !p.isAlive()) continue;
          if (p.type() === PlayerType.Bot) continue; // regular bots never nuke
          peers += 1;
          for (const u of p.units(UNIT.SAMLauncher)) allSamLevels += u.level();
          if (p.smallID() === me.smallID() || me.isFriendly(p)) continue;
          let capacity = 0;
          for (const u of p.units(UNIT.MissileSilo)) capacity += u.level();
          if (capacity > 0) hostiles.push({ player: p, capacity: capacity });
        }
      } catch (_e) { return bail; }

      // DIVERGENCE (samDefense): threat is the largest capacity any ONE hostile coalition
      // can deliver, not the global sum across every hostile player.
      //
      // Why: a SAM's interception capacity REGENERATES each SAMCooldown(), and the
      // attacker's own planner requires a whole breakthrough salvo to arrive inside
      // floor(SAMCooldown()/2) (see planSaturationSalvo in nukeBehavior.js). Two unallied
      // players firing one warhead each, at times they have no way to coordinate, are
      // therefore BOTH stopped by a single level-1 launcher. Summing them modelled a
      // simultaneity the game's timing cannot produce, and bought a SAM per attacker.
      // Teammates DO coordinate — that is exactly why isTeammateAlreadyNukingThisSpot
      // exists to de-duplicate their strikes — so a coalition is summed, not discounted.
      //
      // The 0.75 factor is unchanged, so protection against any single coordinated
      // arsenal is exactly what it was; only the double-counting of uncoordinated
      // attackers is removed. In a 5-player FFA holding 2,2,1,1,1 silo levels this is
      // 2 SAM levels instead of 6 — about 12M gold.
      const peakCoalition = this.peakHostileCoalitionCapacity(hostiles);
      const threat = Math.ceil(peakCoalition * SAM_PER_HOSTILE_SILO_LEVEL);
      const peerAvg = peers > 0 ? Math.ceil(allSamLevels / peers) : 0;

      let protectables = 0;
      try {
        for (const u of me.units(UNIT.City, UNIT.Port, UNIT.Factory, UNIT.MissileSilo)) {
          protectables += Math.max(1, u.level());
        }
      } catch (_e) { protectables = stock; }

      return { stock: stock, threat: threat, peerAvg: peerAvg, protectables: protectables };
    }

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

      // DIVERGENCE (samDefense): SAMs use the threat-scaled target instead of the ratio.
      const targetCount =
        type === UNIT.SAMLauncher
          ? this.samTargetLevels(cityCount)
          : Math.floor(cityCount * ratio);

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
      // WIN-FIX (NOT in src): yield part of the treasury to the MIRV war chest so the
      // leader/pre-empt MIRV that closes out a winning game can actually be funded. The
      // hold is BOUNDED (see mirvReserveHold) rather than all-or-nothing, and it is applied
      // identically on the warhead side in nukeBehavior.maybeSendNuke — the two gates
      // disagreeing is what deadlocked the offence: the nuke pass held fire completely
      // while this pass spent the chest away, so 25M was never reached and no MIRV, atom or
      // hydrogen bomb ever launched again.
      const mirvHold = mirvReserveHold(availableGold);
      availableGold = availableGold > mirvHold ? availableGold - mirvHold : 0n;
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

      // DIVERGENCE (samDefense): for SAMs, upgrade the launcher guarding the most asset
      // value, skipping src's RNG draw and its "already best-protected SAM" heuristic.
      // Asset value is weighted by CLASS as well as level — ports and factories are the
      // economy, so the launcher over the money outranks one over the same number of city
      // levels (samProtectWeight).
      //
      // An upgrade definitely raises samRange(level) — that is the one level-parameterised
      // SAM accessor the config exposes. Whether it also raises interception CAPACITY is
      // asserted by a src-marked comment in nukeBehavior (a level-N SAM intercepts N nukes
      // per cooldown) but is not verifiable from this repo, so nothing here depends on it.
      // Upgrading past level 4 has a separate, provable benefit: it removes the launcher
      // from the owner-blind "outranged SAM" targeting bonus entirely.
      if (
        state.settings.samDefense &&
        upgradable.length > 0 &&
        upgradable[0].type() === UNIT.SAMLauncher
      ) {
        const assets = [];
        for (const u of this.player.units(
          UNIT.City, UNIT.Port, UNIT.Factory, UNIT.MissileSilo,
        )) {
          assets.push({
            tile: u.tile(),
            weight: Math.max(1, u.level()) * samProtectWeight(u.type()),
          });
        }
        let best = null;
        let bestScore = -1;
        for (const sam of upgradable) {
          const r = game.config().samRange(sam.level());
          const r2 = r * r;
          let score = 0;
          for (const a of assets) {
            if (game.euclideanDistSquared(sam.tile(), a.tile) <= r2) score += a.weight;
          }
          if (score > bestScore) { bestScore = score; best = sam; }
        }
        if (best !== null) return mkResult(best);
      }

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
        // DIVERGENCE (bestAI): src rolls a 10% chance to upgrade a RANDOM structure
        // even on Impossible. Never do that - always take the best-scoring one.
        case Difficulty.Impossible:
          randomChance = 0;
          break;
        default:
          randomChance = 0;
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

        // DIVERGENCE (bestAI): src adds nextInt(0,5) of noise here, which is enough
        // to outrank a real +7.5 SAM-level advantage. Ties now resolve by order.

        scored.push({ structure, score });
      }

      if (scored.length === 0) {
        return null;
      }

      // Sort descending by score.
      scored.sort((a, b) => b.score - a.score);

      // DIVERGENCE (bestAI): src throws away its own ranking half the time "for
      // variety" and upgrades the 2nd/3rd best instead. Always take the best.
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
      // Both injections below exist for the SAME reason: a siting score can only rank the
      // candidates it is handed, and the base set is 25 tiles drawn at random from the whole
      // territory. On a large map that sample can miss the SAM umbrella, or the back country,
      // entirely — and no weighting can rescue a tile that was never offered.

      // DIVERGENCE (deepPlacement, USER: "place the buildings as far back and as deep into
      // our teams territory as possible"). Cities and factories only: silos are pinned into
      // SAM cover by samCoverageBonus, and ports have to sit on the coast.
      if (
        state.settings.safePlacement &&
        (type === UNIT.City || type === UNIT.Factory)
      ) {
        try {
          const deep = this.tilesDeepInTerritory(25);
          if (deep.length > 0) tiles = deep.concat(tiles);
        } catch (_e) {
          /* fall back to the random sample */
        }
      }

      // WIN-FIX for silos (own SAMs first, ally SAMs as fallback) so the ranked probe can
      // pick a defended spot; DIVERGENCE (samUmbrella, USER) extends the same injection to
      // cities and factories. Ports are left out on purpose: their candidates already come
      // from the much smaller set of valid shore sites, usually below the 25-tile sample
      // size, so every coastal tile inside the umbrella gets scored anyway.
      const injectUmbrella =
        state.settings.samUmbrella &&
        (type === UNIT.City || type === UNIT.Factory);
      if (
        (type === UNIT.MissileSilo && state.settings.winFixes) ||
        injectUmbrella
      ) {
        try {
          const samTiles = this.tilesNearFriendlySams(25);
          if (samTiles.length > 0) tiles = samTiles.concat(tiles);
        } catch (_e) {
          /* fall back to the random sample */
        }
      }
      // DEDUPE. The three sources overlap by construction — a deep tile can also sit under
      // the umbrella, and the random sample draws from the same territory as both — and every
      // duplicate would cost its own async buildables() round-trip in the probe loop below.
      if (tiles.length > 1) tiles = Array.from(new Set(tiles));
      if (tiles.length === 0) return null;
      const valueFunction = this.structureSpawnTileValue(type);
      if (valueFunction === null) return null;

      // Score ALL candidates synchronously (cheap), then sort DESC by value.
      const scored = tiles.map((t) => ({ t, v: valueFunction(t) }));
      scored.sort((a, b) => b.v - a.v);

      // Probe down the ranked list; first canBuild !== false wins. Only the async tail is
      // capped — the ranking above still saw every candidate, so the cap can only ever drop
      // the WORST-scoring ones.
      const probes = scored.length > MAX_SPAWN_PROBES ? scored.slice(0, MAX_SPAWN_PROBES) : scored;
      if (probes.length < scored.length) {
        ofhDebug(
          "[Build] " +
            type +
            ": probing the top " +
            probes.length +
            " of " +
            scored.length +
            " candidates",
        );
      }
      for (const { t } of probes) {
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

    /** DIVERGENCE (safePlacement): a weighting system for WHERE to build, layered on top
     *  of src's elevation / away-from-border / away-from-same-type terms. Three components:
     *
     *    + far from any border we do NOT trust. "Untrusted" means everyone who is not an
     *      actual TEAMMATE — enemies obviously, but ALLIES too, because an alliance can be
     *      broken at will, so an ally border is a potential front rather than a safe one.
     *    + near a TEAMMATE border, for mutual defence. Keyed on team() only, NEVER on
     *      isFriendly(), which is true for alliances as well.
     *    + distance from our OWN existing structures, so a single atom bomb cannot take out
     *      two of them. Full credit at 2x the blast radius, scaled down closer in.
     *
     *  Why src's existing spacing term does not already do that last part: it compares
     *  MANHATTAN distance against 2x the blast radius, and manhattan is far too lenient on
     *  the diagonal — dx = dy = R sums to 2R and passes, while the true separation is only
     *  R*sqrt(2) ≈ 1.41R, so both structures sit comfortably inside one blast. This term
     *  uses euclideanDistSquared, which is the distance a bomb actually cares about. It also
     *  spans ALL our structure types, not just the type being placed: an atom landing
     *  between a new city and an existing factory costs us both.
     *
     *  Degrades cleanly: in FFA team() is null, so there are no teammates and the team term
     *  contributes nothing while the threat term still works.
     *
     *  `placingType` matters for one case: when siting a MISSILE SILO we do NOT count our
     *  own SAM launchers as blast partners. Silos are deliberately placed inside a friendly
     *  SAM's cover, and a SAM's range is typically within 2x the blast radius, so counting it
     *  would penalise every covered tile equally — which is both useless (a constant cannot
     *  change a ranking) and backwards, since the SAM's entire job is to shoot that bomb down
     *  before it lands.
     *
     *  Returns a (tile) => number closure. Every expensive step — classifying players,
     *  walking the border, listing our structures — happens ONCE here, not per candidate. */
    safePlacementScorer(placingType) {
      const ZERO = function () {
        return 0;
      };
      if (!state.settings.safePlacement) return ZERO;
      const game = this.game;
      const player = this.player;

      // Who is who, and which of our border tiles face them. Extracted + memoised per tick
      // because the deep-candidate injector needs the same answer during the same build.
      const border = this.classifyBorder();
      if (!border.ok) return ZERO;
      const { teammateSids, threatFront, teamFront } = border;

      const ourStructures = [];
      for (const type of BLAST_PAIR_TYPES) {
        // See the note on placingType: the SAM protecting a silo is not a liability to it.
        if (placingType === UNIT.MissileSilo && type === UNIT.SAMLauncher) continue;
        try {
          for (const u of player.units(type)) ourStructures.push(u.tile());
        } catch (_e) {
          /* a missing type is not fatal; a partial list still helps */
        }
      }

      // Owner-blind: our own level-1..4 launchers are as much of a bullseye as an enemy's.
      const samMagnets = collectSamMagnets(game);

      // DIVERGENCE (samUmbrella, USER): friendly SAM cover to build UNDER. Owner-aware,
      // unlike the magnet list above - this one is about who shoots for us.
      const umbrellas = state.settings.samUmbrella
        ? collectFriendlyUmbrellas(game, player, teammateSids)
        : [];

      const { borderSpacing } = this.spacingConstants();
      const range = Math.max(1, borderSpacing * SAFE_PLACEMENT_RANGE_MULT);
      // One bomb catches both when their separation is within 2x the outer radius, so that
      // distance is where the separation term stops earning credit.
      const blastPair = Math.max(1, borderSpacing * 2);
      // borderSpacing IS the atom outer radius (spacingConstants), and the umbrella term
      // measures depth in exactly those units - see the frac note below.
      const atomOuter = Math.max(1, borderSpacing);
      const haveThreat = threatFront.length > 0;
      const haveTeam = teamFront.length > 0;
      // Nothing to say about this tile if there is no threat border, no teammate border,
      // no friendly umbrella, no bullseye ring to avoid and nothing of ours to stay clear
      // of. (The magnet check is a FIX, not part of the samUmbrella work: it was missing,
      // so a player with no structures and no untrusted border yet - i.e. one who has just
      // spawned - got a ZERO scorer and placed its first buildings straight into a
      // neighbour's hydrogen bullseye. It is the one term that needs nothing of ours.)
      if (
        !haveThreat &&
        !haveTeam &&
        umbrellas.length === 0 &&
        samMagnets.length === 0 &&
        ourStructures.length === 0
      ) {
        return ZERO;
      }

      return (tile) => {
        let w = 0;

        // Normalised clearance from the nearest border we do not trust: 0 on the front,
        // 1 once we are `range` tiles clear of it. Computed once and used three times - the
        // threat term, the umbrella attenuation below, and the depth term.
        let frontSafety = 1;
        if (haveThreat) {
          const d = closestTile(game, threatFront, tile)[1];
          if (Number.isFinite(d)) {
            frontSafety = Math.min(d, range) / range;
            w += SAFE_WEIGHT_THREAT * frontSafety;
            // DIVERGENCE (deepPlacement, USER): keep paying for depth after the threat term
            // has saturated, so "as far back as possible" is a thing the scorer can express
            // at all. Never saturates, so the deepest candidate always wins on this term.
            w += SAFE_WEIGHT_DEPTH * (d / (d + range));
          }
        }

        if (haveTeam) {
          const d = closestTile(game, teamFront, tile)[1];
          if (Number.isFinite(d)) {
            w += SAFE_WEIGHT_TEAM * (1 - Math.min(d, range) / range);
          }
        }

        if (samMagnets.length > 0) {
          const lv = samMagnetExposure(game, samMagnets, tile);
          if (lv > 0) {
            w -=
              SAFE_WEIGHT_SAM_MAGNET *
              (Math.min(lv, SAM_MAGNET_FULL_LEVELS) / SAM_MAGNET_FULL_LEVELS);
          }
        }

        // DIVERGENCE (samUmbrella, USER): reward sites a friendly SAM already covers, and
        // work out how much of the pairing rule to switch off there.
        //
        // Graded by DEPTH, not by mere containment, and the unit of depth is the atom blast
        // radius for a concrete reason: an enemy who cannot fly a warhead INTO the umbrella
        // can still aim at a tile just OUTSIDE it and splash `atomOuter` tiles past the
        // boundary. Only tiles that deep inside are actually out of reach. (Note this is
        // the same geometry as the SAM-magnet ring above, seen from the other side.)
        // The gradient also does useful work against src's own spacing term: ours pushes
        // inward, src's pushes outward, and the pair settles in the atom-proof interior
        // instead of hugging the rim.
        let release = 0;
        if (umbrellas.length > 0) {
          let bestCover = 0;
          let slots = 0;
          for (const um of umbrellas) {
            let dsq;
            try {
              dsq = game.euclideanDistSquared(um.tile, tile);
            } catch (_e) {
              continue;
            }
            if (!Number.isFinite(dsq) || dsq > um.range * um.range) continue;
            const frac = Math.min((um.range - Math.sqrt(dsq)) / atomOuter, 1);
            if (frac <= 0) continue;
            const cover = frac * um.trust;
            if (cover > bestCover) bestCover = cover;
            // Slots add up across overlapping umbrellas, but only launchers we cannot lose
            // to a broken alliance are allowed to release the pairing rule.
            if (um.trust >= 1) slots += um.level * frac;
          }
          if (bestCover > 0) {
            const attenuation =
              UMBRELLA_FRONT_FLOOR + (1 - UMBRELLA_FRONT_FLOOR) * frontSafety;
            w += SAFE_WEIGHT_SAM_UMBRELLA * bestCover * attenuation;
          }
          release = Math.min(slots / UMBRELLA_RELEASE_SLOTS, 1);
        }

        // EUCLIDEAN, unlike src's manhattan spacing term: manhattan lets dx = dy = R pass
        // (it sums to 2R) while the true separation is only R*sqrt(2), i.e. both structures
        // sit comfortably inside one blast. No early exit — we need the true nearest, since
        // the term is a gradient rather than a yes/no test.
        //
        // `release` (samUmbrella) is how the user's second ask is implemented: at release = 1
        // the term pays the SAME full credit at every distance, and per the note on
        // SAFE_WEIGHT_SEPARATION a constant cannot change a ranking - so the spread rule
        // genuinely stops choosing the tile inside the umbrella. Paying full credit rather
        // than zero matters: dropping the term instead would quietly hand every uncovered
        // tile a 60-point head start and steer us back out of the cover we just bought.
        if (ourStructures.length > 0) {
          let nearestSq = Infinity;
          for (const other of ourStructures) {
            if (other === tile) continue;
            let dsq;
            try {
              dsq = game.euclideanDistSquared(other, tile);
            } catch (_e) {
              continue;
            }
            if (Number.isFinite(dsq) && dsq < nearestSq) nearestSq = dsq;
          }
          if (Number.isFinite(nearestSq)) {
            const d = Math.sqrt(nearestSq);
            const spread = Math.min(d, blastPair) / blastPair;
            w += SAFE_WEIGHT_SEPARATION * (release + (1 - release) * spread);
          }
        }

        return w;
      };
    }

    /** One border walk, classifying every one of our border tiles by who it faces, plus the
     *  teammate/untrusted split behind it. A tile can face both (a pinch between a teammate
     *  and an enemy) and counts for both. "Teammate" is keyed on team() and NEVER on
     *  isFriendly(), which is also true for revocable alliances.
     *
     *  Memoised per game tick: safePlacementScorer and tilesDeepInTerritory both want it
     *  within the same build, and borders only change on a tick. `ok: false` reproduces the
     *  old behaviour of the callers bailing to a zero scorer when the views cannot be read. */
    classifyBorder() {
      const game = this.game;
      const player = this.player;
      let tick = -1;
      try {
        tick = Number(game.ticks());
      } catch (_e) {
        tick = -1;
      }
      const cached = this._borderClass;
      if (cached && tick >= 0 && cached.tick === tick) return cached;

      let myTeam = null;
      try {
        myTeam = player.team ? player.team() : null;
      } catch (_e) {
        myTeam = null;
      }

      const teammateSids = new Set();
      const untrustedSids = new Set();
      try {
        for (const other of game.players()) {
          if (!other.isPlayer() || !other.isAlive()) continue;
          if (other.smallID() === player.smallID()) continue;
          let theirTeam = null;
          try {
            theirTeam = other.team ? other.team() : null;
          } catch (_e) {
            theirTeam = null;
          }
          if (myTeam !== null && theirTeam !== null && theirTeam === myTeam) {
            teammateSids.add(other.smallID());
          } else {
            untrustedSids.add(other.smallID());
          }
        }
      } catch (_e) {
        return { ok: false, tick: -1, teammateSids, threatFront: [], teamFront: [] };
      }

      const threatFront = [];
      const teamFront = [];
      try {
        for (const borderTile of player.borderTiles()) {
          let facesThreat = false;
          let facesTeam = false;
          for (const neighbor of game.neighbors(borderTile)) {
            if (!game.hasOwner(neighbor) || !game.isLand(neighbor)) continue;
            const sid = game.ownerID(neighbor);
            if (untrustedSids.has(sid)) facesThreat = true;
            else if (teammateSids.has(sid)) facesTeam = true;
          }
          if (facesThreat) threatFront.push(borderTile);
          if (facesTeam) teamFront.push(borderTile);
        }
      } catch (_e) {
        return { ok: false, tick: -1, teammateSids, threatFront: [], teamFront: [] };
      }

      const out = { ok: true, tick, teammateSids, threatFront, teamFront };
      this._borderClass = out;
      return out;
    }

    /** DIVERGENCE (deepPlacement, USER): the deepest land we own, measured from the
     *  UNTRUSTED front only - so a teammate at our back reads as safe hinterland rather
     *  than as exposure, which is what "deep into our team's territory" means when we can
     *  only build on our own tiles.
     *
     *  Needed because a siting score can only rank the candidates it is handed, and the
     *  default set is 25 tiles drawn at random from the whole territory: on a large map the
     *  actual back country may not appear in it at all, and then the depth term has nothing
     *  deep to pick. Draws a WIDER sample and keeps the deepest few, with both the sample
     *  and the front subsample bounded so the cost stays flat as the territory grows. */
    tilesDeepInTerritory(maxTiles) {
      const game = this.game;
      const border = this.classifyBorder();
      if (!border.ok || border.threatFront.length === 0) return [];

      // Bounded front subsample: the nearest of 32 spread-out front tiles is a good enough
      // proxy for depth when we are only ranking candidates against each other.
      const front = border.threatFront;
      const step = Math.max(1, Math.floor(front.length / DEEP_FRONT_SAMPLE));
      const probeFront = [];
      for (let i = 0; i < front.length; i += step) probeFront.push(front[i]);
      if (probeFront.length === 0) return [];

      let probe;
      try {
        probe = randTerritoryTileArray(this.random, game, this.player, DEEP_PROBE_TILES);
      } catch (_e) {
        return [];
      }
      const scored = [];
      for (const t of probe) {
        let best = Infinity;
        for (const f of probeFront) {
          let d;
          try {
            d = game.euclideanDistSquared(t, f);
          } catch (_e) {
            continue;
          }
          if (Number.isFinite(d) && d < best) best = d;
        }
        if (Number.isFinite(best)) scored.push([best, t]);
      }
      scored.sort((a, b) => b[0] - a[0]); // deepest first
      const out = [];
      for (let i = 0; i < scored.length && out.length < maxTiles; i++) {
        out.push(scored[i][1]);
      }
      return out;
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

      // DIVERGENCE (safePlacement): strategic siting weights - away from untrusted
      // borders, toward teammates, and away from our own structures so one atom cannot
      // take out two. See safePlacementScorer().
      const safePlace = this.safePlacementScorer(UNIT.MissileSilo);

      return (tile) => {
        let w = 0;
        w += safePlace(tile);

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
    // Prefers OUR + TEAMMATE SAMs; only if we have neither does it fall back to ALLY SAMs
    // (user rule: an alliance can be broken, a team cannot). Returns up to maxTiles
    // candidate TileRefs to feed silo / city / factory placement.
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
      let myTeam = null;
      try {
        myTeam = this.player.team ? this.player.team() : null;
      } catch (_e) {
        myTeam = null;
      }
      const own = [];
      const ally = [];
      for (const u of allSams) {
        try {
          if (u.isUnderConstruction && u.isUnderConstruction()) continue;
          const owner = u.owner && u.owner();
          if (!owner) continue;
          // Keyed on team(), never isFriendly() - the latter is true for alliances too.
          let theirTeam = null;
          try {
            theirTeam = owner.team ? owner.team() : null;
          } catch (_e) {
            theirTeam = null;
          }
          const teammate =
            myTeam !== null && theirTeam !== null && theirTeam === myTeam;
          if ((owner.smallID && owner.smallID() === mySid) || teammate) own.push(u);
          else if (this.player.isFriendly(owner) === true) ally.push(u);
        } catch (_e) {
          /* skip */
        }
      }
      const useSams = own.length > 0 ? own : ally; // ours + teammates first, else allies
      if (useSams.length === 0) return [];
      let cfg;
      try {
        cfg = game.config();
      } catch (_e) {
        return [];
      }
      // DIVERGENCE FIX: sample every SAM's ring in FULL, shuffle each one, then interleave
      // the rings round-robin. The old loop walked dx from -r upward and returned the
      // instant it hit maxTiles, so all 25 candidates came from the FIRST SAM's two or
      // three westernmost columns. Every silo then landed in that one wedge, well inside a
      // single warhead's blast — precisely what the structureSpacing term in the silo value
      // function exists to prevent, and it could not help because it only ever saw tiles
      // from that wedge. Interleaving spreads the candidate set across all our SAMs.
      const rings = [];
      for (const unit of useSams) {
        const samTile = unit.tile();
        const cx = game.x(samTile);
        const cy = game.y(samTile);
        const level = (unit.level && Number(unit.level())) || 1;
        const range = cfg && cfg.samRange ? Number(cfg.samRange(level)) : 0;
        if (range <= 0) continue;
        const r = Math.floor(range);
        const step = Math.max(2, Math.floor(r / 6));
        const ring = [];
        for (let dx = -r; dx <= r; dx += step) {
          for (let dy = -r; dy <= r; dy += step) {
            if (dx * dx + dy * dy > range * range) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (!game.isValidCoord(nx, ny)) continue;
            const t = game.ref(nx, ny);
            if (!game.isLand(t)) continue;
            if (game.ownerID(t) !== mySid) continue; // can only build on OUR land
            ring.push(t);
          }
        }
        if (ring.length > 0) rings.push(this.random.shuffleArray(ring));
      }
      if (rings.length === 0) return [];
      const out = [];
      const seen = new Set();
      for (let i = 0; out.length < maxTiles; i++) {
        let advanced = false;
        for (const ring of rings) {
          if (i >= ring.length) continue;
          advanced = true;
          const t = ring[i];
          if (seen.has(t)) continue; // overlapping SAM coverage
          seen.add(t);
          out.push(t);
          if (out.length >= maxTiles) break;
        }
        if (!advanced) break; // every ring exhausted
      }
      return out;
    }

    // portValue — NationStructureBehavior.ts:925.
    // NOTE: pure port-spacing; does NOT consume the water shim.
    portValue() {
      const game = this.game;
      const otherUnits = this.player.units(UNIT.Port);
      const { structureSpacing } = this.spacingConstants();

      // DIVERGENCE (safePlacement): strategic siting weights - away from untrusted
      // borders, toward teammates, and away from our own structures so one atom cannot
      // take out two. See safePlacementScorer().
      const safePlace = this.safePlacementScorer(UNIT.Port);

      return (tile) => {
        let w = 0;
        w += safePlace(tile);

        // Prefer to be as far as possible from other ports
        const otherTiles = new Set(otherUnits.map((u) => u.tile()));
        otherTiles.delete(tile);
        const closest = closestTile(game, otherTiles, tile);
        const closestOtherDist = closest[1];
        // closestTile returns Infinity for an EMPTY set, so with no ports yet every
        // candidate scored Infinity and tied — which silently discarded every other term
        // for the very first port. Only add a real distance.
        if (Number.isFinite(closestOtherDist)) {
          // DIVERGENCE (safePlacement): CAP it. src leaves this term uncapped, and portValue
          // has no elevation or border term, so it is the ENTIRE function — a spread of
          // 100-280 points across the candidate set, which buries every strategic weight.
          // It also points the wrong way: maximising distance from our existing ports drives
          // each new port to the far end of the territory, which on a contested map is the
          // enemy front. Past two blast radii, extra port separation buys nothing anyway.
          w += state.settings.safePlacement
            ? Math.min(closestOtherDist, structureSpacing)
            : closestOtherDist;
        }

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

      // DIVERGENCE (safePlacement): strategic siting weights - away from untrusted
      // borders, toward teammates, and away from our own structures so one atom cannot
      // take out two. See safePlacementScorer().
      const safePlace = this.safePlacementScorer(UNIT.Factory);

      return (tile) => {
        let w = 0;
        w += safePlace(tile);

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

      // DIVERGENCE (safePlacement): strategic siting weights - away from untrusted
      // borders, toward teammates, and away from our own structures so one atom cannot
      // take out two. See safePlacementScorer().
      const safePlace = this.safePlacementScorer(UNIT.City);

      return (tile) => {
        let w = 0;
        w += safePlace(tile);

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
              // DIVERGENCE (samDefense): scale by asset CLASS as well as level. Ports and
              // factories are the economy, so covering them outranks covering the same
              // number of city levels.
              weight:
                (weightByLevel ? unit.level() : 1) * samProtectWeight(unit.type()),
            });
        }
      }

      // DIVERGENCE (safePlacement): a NEW launcher is level 1, and a level-1..4 launcher
      // makes the ring around itself — outside its own range, inside a hydrogen blast — a
      // bullseye worth 100_000 * level to an Impossible AI holding a Hydrogen Bomb. Placing
      // one on top of our cluster therefore hands the enemy a high-value aim point right
      // next to the very assets it was meant to defend. Penalise sites whose ring would
      // contain our own structures. (Note the assets INSIDE the new launcher's range are
      // not affected — that region is exactly what it protects.)
      let magnetInnerSq = 0;
      let magnetOuterSq = 0;
      try {
        const r1 = Number(game.config().samRange(1)) || 0;
        const ho = Number(game.config().nukeMagnitudes(UNIT.HydrogenBomb).outer) || 0;
        if (r1 > 0 && ho > r1) {
          magnetInnerSq = r1 * r1;
          magnetOuterSq = ho * ho;
        }
      } catch (_e) {
        magnetInnerSq = 0;
      }
      const range = game.config().defaultSamRange();
      const rangeSquared = range * range;

      // DIVERGENCE (samDefense): src only weighs existing coverage 25% of the time, so
      // 3 in 4 placements ignore overlap and stack SAMs over already-defended assets.
      // Always weigh it — that is what makes placement actually tactical.
      const useCoverageWeighting = state.settings.samDefense
        ? difficulty !== Difficulty.Easy
        : difficulty !== Difficulty.Easy && this.random.nextInt(0, 100) < 25;

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

        // How much of OUR OWN asset value would land in this launcher's magnet ring.
        if (magnetOuterSq > 0) {
          let exposed = 0;
          for (const entry of protectEntries) {
            const dsq = game.euclideanDistSquared(tile, entry.tile);
            if (dsq > magnetInnerSq && dsq <= magnetOuterSq) exposed += entry.weight;
          }
          if (exposed > 0) {
            w -=
              structureSpacing *
              Math.min(exposed, SAM_MAGNET_FULL_LEVELS) /
              SAM_MAGNET_FULL_LEVELS;
          }
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
