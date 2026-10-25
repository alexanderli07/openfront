'use strict';

// Browser-facing adapter. Every action still uses the game's existing build menu.
function createEconomyAdapter(deps) {
  const { core, UNIT } = deps;
  const { money, IncomeTracker, BudgetLedger, rankInvestments } = core;
  const tracker = new IncomeTracker();
  const ledger = new BudgetLedger();
  const structures = [UNIT.City, UNIT.Port, UNIT.Factory, UNIT.SAMLauncher, UNIT.DefensePost, UNIT.MissileSilo];
  const weapons = [UNIT.AtomBomb, UNIT.HydrogenBomb, UNIT.MIRV];
  let bot = null, game = null, player = null, source = null, epoch = 0;
  let decision = null, rates = tracker.rates(), lastPlanTick = -Infinity;
  let history = [], lastMessage = '', active = false, inFlight = false;
  let authorization = null, context = null, pendingOrder = null, planCycle = 0;
  const call = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const levels = type => player.units(type).reduce((sum, unit) => sum + Math.max(1, finite(unit.level(), 1)), 0);
  const signature = () => player.units(...structures, UNIT.Warship, ...weapons)
    .map(u => `${u.id()}:${u.level()}:${u.isUnderConstruction()}`).sort().join('|');
  const enabled = () => {
    const s = deps.settings();
    return Boolean(active && s.enabled && s.economyPlanner !== false && game && player &&
      deps.isCurrent(game) && !deps.isPublic(game) && !game.inSpawnPhase() &&
      game.myPlayer()?.id() === player.id() && player.isAlive());
  };
  const typeEnabled = type => {
    const s = deps.settings();
    if (game.config().isUnitDisabled(type)) return false;
    if (structures.includes(type)) return Boolean(s.features?.build && s.buildStructures?.[type] !== false &&
      (type !== UNIT.DefensePost || s.defensePosts !== false) &&
      (type !== UNIT.SAMLauncher || s.samDefense !== false));
    if (weapons.includes(type)) return Boolean(s.features?.nuke);
    if (type === UNIT.Warship) return Boolean(s.features?.warship && s.warshipAutoSpawn !== false);
    return false;
  };
  function record(entry) {
    const serial = JSON.parse(JSON.stringify({ tick: game?.ticks(), ...entry }, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value));
    history.push(serial);
    if (history.length > 120) history.shift();
    const message = `${entry.kind}: ${entry.action || ''} ${entry.reason}`;
    if (message !== lastMessage) { lastMessage = message; deps.log?.(`[Planner] ${message}`); }
  }
  function begin(nextBot) {
    const nextGame = nextBot.mg;
    const nextPlayer = nextGame.myPlayer();
    const nextSource = nextGame.__src || nextGame;
    if (source !== nextSource || player?.id() !== nextPlayer?.id() || game && nextGame.ticks() < ledger.tick) {
      source = nextSource; epoch++;
      decision = null; lastPlanTick = -Infinity; history = []; lastMessage = ''; authorization = null; pendingOrder = null;
    }
    bot = nextBot; game = nextGame; player = nextPlayer;
    active = Boolean(player);
    if (!enabled()) { decision = null; active = false; return; }
    const srcPlayer = player.__src || player;
    const counters = {};
    for (const field of ['goldEarned', 'tradeGold', 'trainGold']) counters[field] = call(() => srcPlayer[field]());
    tracker.sample(epoch, game.ticks(), counters); rates = tracker.rates();
    observeBudget();
    const incoming = player.incomingAttacks().filter(a => !call(() => a.retreating(), false))
      .reduce((sum, attack) => sum + Math.max(0, finite(attack.troops())), 0);
    const ownTroops = Math.max(1, finite(player.troops()));
    const maxTroops = Math.max(1, finite(call(() => game.config().maxTroops(player)), ownTroops));
    const enemies = game.players().filter(p => p.isPlayer() && p.isAlive() && p.id() !== player.id() && !player.isFriendly(p));
    const hostileSilos = enemies.reduce((sum, p) => sum + p.units(UNIT.MissileSilo).filter(u => !u.isUnderConstruction()).length, 0);
    const totalLand = Math.max(1, finite(game.numLandTiles(), 1));
    const leaderShare = enemies.reduce((max, p) => Math.max(max, p.numTilesOwned() / totalLand), 0);
    context = { incomingRatio: incoming / ownTroops, fill: ownTroops / maxTroops,
      hostileSilos, leaderShare, cityLevels: levels(UNIT.City),
      horizonTicks: incoming >= ownTroops ? 600 : leaderShare >= 0.6 ? 1200 : 2400 };
    // Total receipts include donations and conquest: never use them to promise a saving deadline.
    context.incomePerTick = rates.recurring;
  }
  function fresh(token, tick) {
    return epoch === token && enabled() && game.ticks() >= tick && game.ticks() - tick <= 30;
  }
  function observeBudget() {
    let acknowledged = false;
    if (pendingOrder) {
      const units = player.units(pendingOrder.type);
      acknowledged = pendingOrder.upgradeId !== null ? units.some(u => u.id() === pendingOrder.upgradeId && u.level() > pendingOrder.level) :
        units.some(u => !pendingOrder.ids.has(u.id()) && (!structures.includes(pendingOrder.type) || u.tile() === pendingOrder.tile));
    }
    ledger.observe(epoch, game.ticks(), player.gold(), signature(), acknowledged);
    if (!ledger.pending) pendingOrder = null;
  }
  async function quote(type, tile, deadline = Date.now() + 250) {
    let timer;
    const remaining = Math.min(250, deadline - Date.now());
    if (remaining <= 0) return null;
    try {
      const rows = await Promise.race([
        player.buildables(tile, [type]),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), remaining); })
      ]);
      const row = Array.isArray(rows) ? rows.find(r => r.type === type) : null;
      return row && money(row.cost) !== null ? row : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  function exposure(tile) {
    const border = call(() => bot.structureBehavior.classifyBorder());
    if (!border?.ok) return 0.65;
    let distance = Infinity;
    const front = border.threatFront || [];
    const step = Math.max(1, Math.ceil(front.length / 64));
    for (let i = 0; i < front.length; i += step) distance = Math.min(distance, Math.sqrt(game.euclideanDistSquared(tile, front[i])));
    const landSafety = Number.isFinite(distance) ? Math.max(0.25, Math.min(1, distance / 50)) : 1;
    if (!context.hostileSilos) return landSafety;
    const covered = player.units(UNIT.SAMLauncher).some(sam => !sam.isUnderConstruction() &&
      game.euclideanDistSquared(tile, sam.tile()) <= finite(call(() => game.config().samRange(sam.level()))) ** 2);
    return landSafety * (covered ? 0.95 : 0.65);
  }
  function tradeOpportunity(type, tile) {
    if (type === UNIT.Factory) {
      const min = finite(call(() => game.config().trainStationMinRange()), 15);
      const max = finite(call(() => game.config().trainStationMaxRange()), 110);
      const reachable = call(() => bot.structureBehavior.getOrBuildReachableStations(), []);
      return Math.min(3, reachable.filter(station => {
        const d = game.euclideanDistSquared(tile, station.tile);
        return d >= min * min && d <= max * max;
      }).length);
    }
    if (type !== UNIT.Port) return 0;
    const waterKeys = location => {
      const keys = new Set();
      for (const neighbor of game.neighbors(location)) {
        if (!game.isWater(neighbor)) continue;
        if (game.isOcean(neighbor)) keys.add('ocean');
        else { const component = game.getWaterComponent(neighbor); if (component !== null) keys.add(component); }
      }
      return keys;
    };
    const ownWater = waterKeys(tile);
    let partners = 0;
    for (const other of game.players()) {
      if (!other.isPlayer() || !other.isAlive() || other.id() === player.id() ||
          player.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(player)) continue;
      for (const port of other.units(UNIT.Port)) {
        if (port.isUnderConstruction()) continue;
        if ([...waterKeys(port.tile())].some(key => ownWater.has(key))) partners++;
        if (partners >= 3) return partners;
      }
    }
    return partners;
  }
  function features(type, tile, upgrade) {
    const duration = finite(call(() => game.config().unitInfo(type).constructionDuration), 100);
    const result = { survival: exposure(tile), durationTicks: duration, confidence: 0.65,
      incomePerTick: 0, utility: 0, emergency: false, reason: '' };
    if (type === UNIT.City) {
      result.utility = context.cityLevels === 0 ? 3 : context.fill >= 0.75 ? 2.6 : context.fill >= 0.55 ? 1.6 : 0.3;
      if (context.incomingRatio >= 1) result.utility *= 0.5;
      result.reason = context.cityLevels === 0 ? 'Establish first city; avoid trade-only opening lock' : 'Increase capacity while the army is filling it';
    } else if (type === UNIT.Port || type === UNIT.Factory) {
      const opportunity = tradeOpportunity(type, tile);
      const observed = type === UNIT.Port ? rates.trade : rates.train;
      const activeLevels = player.units(type).filter(u => !u.isUnderConstruction()).reduce((sum, u) => sum + u.level(), 0);
      if (opportunity > 0 && observed !== null && observed > 0 && activeLevels > 0) {
        // Portfolio average is a marginal approximation, not an exact route simulation.
        result.incomePerTick = observed / activeLevels;
        result.confidence = 0.7;
        result.reason = 'Estimated trade payback from recent per-level revenue; delivery risk discounted';
      } else if (opportunity > 0 && levels(type) === 0 && !upgrade) {
        result.utility = 1.8;
        result.confidence = 0.35;
        result.reason = 'Explore first connected trade building; income not yet measured';
      } else {
        result.reason = opportunity ? 'Await evidence of productive trade before expanding it' : 'No usable trade connection found';
      }
    } else if (type === UNIT.SAMLauncher) {
      const target = finite(call(() => bot.structureBehavior.samThreatLevels(context.cityLevels)));
      const deficit = target - levels(UNIT.SAMLauncher);
      if (deficit > 0 && context.hostileSilos > 0) {
        result.utility = 3 + Math.min(2, deficit);
        result.emergency = levels(UNIT.SAMLauncher) === 0;
        result.reason = 'Protect assets from existing hostile missile silos';
      }
    } else if (type === UNIT.DefensePost) {
      result.utility = context.incomingRatio >= 0.35 ? 4 : 0;
      result.emergency = context.incomingRatio >= 0.35;
      result.reason = 'Build behind the active land front before it arrives';
    } else if (type === UNIT.MissileSilo) {
      const hasWeapons = weapons.some(w => typeEnabled(w));
      if (hasWeapons && levels(type) === 0 && context.cityLevels >= 3 && context.incomingRatio < 0.5 &&
          (rates.recurring || 0) > 0) result.utility = context.leaderShare >= 0.5 ? 2.8 : 1.5;
      result.reason = 'Open a missile option once the economy can support it';
    }
    return result;
  }
  function tilesFor(type, behavior) {
    if (type === UNIT.Port) return behavior.randCoastalTileArray(12);
    if (type === UNIT.DefensePost) {
      if (!behavior.defensePostNeeded()) return [];
      const attacks = call(() => behavior.dpLandAttacks(), []);
      const front = call(() => behavior.getAttackFrontTiles(attacks), []);
      const speed = call(() => behavior.measureAttackFrontSpeed(front, attacks));
      if (speed === null || !front.length) return [];
      const duration = finite(call(() => game.config().unitInfo(type).constructionDuration), 100);
      const min = Math.ceil(Math.max(10, speed * (duration * 1.6 + 20)));
      const desired = Math.ceil(context.incomingRatio / 0.4);
      if (min > 150 || behavior.countDefensePostsNearFront(front, desired, min + 30) >= desired) return [];
      return behavior.sampleTilesNearFront(front, 12, type, { min, max: min + 30 }).filter(tile =>
        front.every(f => game.euclideanDistSquared(tile, f) >= min * min));
    }
    return [...call(() => behavior.tilesDeepInTerritory(8), []), ...deps.territoryTiles(behavior, 12)];
  }
  async function candidatesFor(behavior, token, tick) {
    const candidates = [];
    const deadline = Date.now() + 500;
    const rotated = structures.slice(planCycle % structures.length).concat(structures.slice(0, planCycle % structures.length));
    planCycle++;
    behavior.reachableStationsCache = null;
    behavior._sharedWaterComponents = deps.sharedWater(game, player);
    for (const type of rotated) {
      if (Date.now() >= deadline) break;
      if (!typeEnabled(type)) continue;
      if ((type === UNIT.SAMLauncher && !context.hostileSilos) ||
          (type === UNIT.DefensePost && context.incomingRatio < 0.35) ||
          (type === UNIT.MissileSilo && (context.cityLevels < 3 || levels(type) > 0))) continue;
      // Bound worker traffic: four new sites and two upgrades per building type.
      const score = call(() => behavior.structureSpawnTileValue(type), () => 0);
      const newTiles = [...new Set(tilesFor(type, behavior))]
        .filter(tile => Number.isInteger(tile) && tile >= 0)
        .sort((a, b) => finite(call(() => score(b))) - finite(call(() => score(a))) || a - b).slice(0, 4);
      const upgrades = player.units(type).filter(u => !u.isUnderConstruction())
        .sort((a, b) => exposure(b.tile()) - exposure(a.tile()) || a.level() - b.level()).slice(0, 2);
      const sites = [...upgrades.map(unit => ({ tile: unit.tile(), unit })), ...newTiles.map(tile => ({ tile, unit: null }))];
      const seen = new Set();
      for (const site of sites) {
        if (!fresh(token, tick)) return [];
        if (Date.now() >= deadline) return candidates;
        const bu = await quote(type, site.tile, deadline);
        if (!bu || !fresh(token, tick)) continue;
        const upgrading = Number.isInteger(bu.canUpgrade) && bu.canUpgrade >= 0;
        const building = Number.isInteger(bu.canBuild) && bu.canBuild >= 0;
        if (!upgrading && !building) {
          // Core withholds placement flags when unaffordable. Retain a price-only
          // saving option; this never authorizes construction at an unverified site.
          if (money(bu.cost) > money(player.gold()) && game.isLand(site.tile) && game.hasOwner(site.tile) &&
              game.ownerID(site.tile) === player.smallID()) {
            const id = `${type}:save:${site.tile}`;
            if (!seen.has(id)) {
              seen.add(id);
              candidates.push({ id, type, tile: site.tile, upgrade: Boolean(site.unit),
                upgradeId: site.unit?.id() ?? null, cost: money(bu.cost), quoteOnly: true,
                ...features(type, site.tile, Boolean(site.unit)) });
            }
          }
          continue;
        }
        if (site.unit && (!upgrading || bu.canUpgrade !== site.unit.id())) continue;
        const tile = upgrading ? (player.units(type).find(u => u.id() === bu.canUpgrade)?.tile()) : bu.canBuild;
        if (!Number.isInteger(tile)) continue;
        const id = `${type}:${upgrading ? 'upgrade' : 'build'}:${tile}`;
        if (seen.has(id)) continue; seen.add(id);
        candidates.push({ id, type, tile, upgrade: upgrading, upgradeId: upgrading ? bu.canUpgrade : null,
          cost: money(bu.cost), ...features(type, tile, upgrading) });
      }
    }
    return candidates;
  }
  async function run(behavior) {
    if (!enabled() || !deps.settings().features?.build || inFlight || ledger.pending || game.ticks() - lastPlanTick < 10) return false;
    inFlight = true;
    const token = epoch, tick = game.ticks();
    const originalSignature = signature();
    lastPlanTick = tick;
    try {
      const candidates = await candidatesFor(behavior, token, tick);
      if (!fresh(token, tick) || signature() !== originalSignature) return false;
      const emergencies = candidates.filter(c => c.emergency);
      const emergencyReserve = emergencies.length ? emergencies.reduce((a, c) => a < c.cost ? a : c.cost, emergencies[0].cost) : 0n;
      decision = rankInvestments({ gold: player.gold(), incomePerTick: context.incomePerTick,
        horizonTicks: context.horizonTicks, emergencyReserve }, candidates);
      record({ kind: decision.kind, action: decision.action?.id || null, reason: decision.reason,
        reserve: decision.reserve, income: rates, objective: emergencies.length ? 'defend' : context.leaderShare >= 0.6 ? 'contest leader' : 'grow',
        alternatives: decision.alternatives.slice(0, 6).map(c => ({ id: c.id, score: c.score,
          cost: c.cost, paybackTicks: c.paybackTicks, confidence: c.confidence, reason: c.reason })) });
      if (decision.kind !== 'spend' || decision.action.quoteOnly) return false;
      const action = decision.action;
      const latest = await quote(action.type, action.tile);
      if (!fresh(token, tick) || !latest || signature() !== originalSignature || !typeEnabled(action.type)) return false;
      if (money(latest.cost) !== action.cost || (action.upgrade ? latest.canUpgrade !== action.upgradeId : latest.canBuild !== action.tile)) return false;
      authorization = action;
      const sent = await send(deps.getMenu(), latest, action.upgrade ? undefined : action.tile, { game, player });
      authorization = null;
      if (sent) {
        behavior.placementsCount++; behavior.lastStructureTick = game.ticks();
        deps.onBuild?.(action);
      }
      return sent;
    } catch (error) {
      record({ kind: 'error', reason: String(error?.message || error) });
      return false;
    } finally { authorization = null; inFlight = false; }
  }
  async function send(menu, bu, tile, origin) {
    if (!origin || origin.game !== game || origin.player.id() !== player?.id()) return false;
    if (!enabled() || !menu || typeof menu.sendBuildOrUpgrade !== 'function' || !bu || !typeEnabled(bu.type)) return false;
    const cost = money(bu.cost);
    if (cost === null) return false;
    const ownAction = authorization && authorization.type === bu.type;
    if (structures.includes(bu.type) && !ownAction) return false;
    if (!ownAction && !decision && deps.settings().features?.build) return false;
    let reserve = ownAction ? (decision.reserve > cost ? decision.reserve - cost : 0n) : decision?.reserve ?? 0n;
    if (!ownAction && weapons.includes(bu.type)) {
      // Ordinary launches only spend surplus and at most two minutes of measured recurring income.
      // A leader near victory may justify spending the surplus without that income ceiling.
      const allowance = (rates.recurring || 0) * 1200;
      if (context.incomingRatio >= 1 || context.leaderShare < 0.6 && Number(cost) > allowance) return false;
    }
    observeBudget();
    if (!ledger.commit(cost, reserve)) return false;
    const token = epoch;
    pendingOrder = { type: bu.type, tile, ids: new Set(player.units(bu.type).map(u => u.id())),
      upgradeId: Number.isInteger(bu.canUpgrade) ? bu.canUpgrade : null,
      level: player.units(bu.type).find(u => u.id() === bu.canUpgrade)?.level() ?? 0 };
    try {
      // Force one purchase: UI bulk selection must not exceed the authorized quote.
      const result = await menu.sendBuildOrUpgrade(bu, tile, 1);
      if (epoch !== token) return false;
      if (result === false) { ledger.cancel(); pendingOrder = null; return false; }
      record({ kind: 'sent', action: bu.type, reason: ownAction ? decision.reason : 'Spend surplus after the selected investment reserve', cost });
      return true;
    } catch (error) {
      if (epoch !== token) return false;
      ledger.cancel(); pendingOrder = null;
      record({ kind: 'error', action: bu.type, reason: String(error?.message || error) });
      return false;
    }
  }
  function inspect() {
    return JSON.parse(JSON.stringify({ version: 1, active: enabled(), pending: ledger.pending !== null,
      income: rates, history }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  return { begin, run, send, inspect };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createEconomyAdapter;
