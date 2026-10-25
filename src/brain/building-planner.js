'use strict';

function createBuildingPlanner(deps) {
  const U = deps.units;
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Hold this building pass' };
  const candidate = (domain, id, priority, eligible, facts, reason) => ({
    id, kind: domain, source: 'BuildingPlanner', priority, eligible, ...facts, reason
  });
  async function attempt(domain, actor, options, hooks, execute, facts = {}) {
    if (!hooks.allowed()) return { stopped: true, result: false };
    const choice = hooks.choose(domain, [...options, wait], facts);
    const selected = options.find(item => item.id === choice.selectedId && item.eligible);
    if (!selected || !hooks.allowed()) {
      hooks.record('building-result', { domain, decisionId: choice.decisionId, status: 'stopped' });
      return { stopped: true, result: false };
    }
    try {
      const result = await hooks.execute(choice.decisionId, () => execute(selected));
      if (!hooks.allowed()) {
        hooks.record('building-result', { domain, decisionId: choice.decisionId, status: 'stopped' });
        return { stopped: true, result: false };
      }
      hooks.record('building-result', { domain, decisionId: choice.decisionId,
        selectedId: selected.id, status: result ? 'completed' : 'unfulfilled' });
      return { stopped: false, result, selected };
    } catch (error) {
      hooks.record('building-result', { domain, decisionId: choice.decisionId, status: 'threw',
        error: String(error?.message || error) });
      throw error;
    }
  }
  async function handle(actor, hooks) {
    if (!hooks.allowed()) return false;
    const domain = 'structure-phase';
    const defenseEnabled = actor.placementsCount > 0 && !actor.game.config().isUnitDisabled(U.DefensePost);
    const urgent = defenseEnabled && actor.defensePostNeeded();
    let normalResult = false;
    let normalGated = false;
    let options = [
      candidate(domain, 'building:emergency', 0, !!urgent, { phase: 'emergency', defenseEnabled, urgent: !!urgent }, 'Emergency defense before ordinary structures'),
      candidate(domain, 'building:normal', 1, true, { phase: 'normal' }, 'Ordinary structures after original cooldown and saving gates')
    ];
    while (options.some(item => item.eligible)) {
      const outcome = await attempt(domain, actor, options, hooks, async selected => {
        if (selected.phase === 'emergency') {
          actor.dpDeclinedOnTiming = false;
          return actor.tryBuildDefensePost();
        }
        if (selected.phase === 'normal') {
          normalGated = actor.isOnStructureCooldown() || actor.isInPostSaveUpBlockedPhase();
          if (normalGated) return false;
          normalResult = await actor.doHandleStructures();
          if (!hooks.allowed()) return false;
          if (normalResult) {
            actor.lastStructureTick = actor.game.ticks();
            actor.placementsCount++;
          }
          return normalResult;
        }
        return actor.tryBuildDefensePost();
      });
      if (outcome.stopped) return false;
      if (outcome.result) return outcome.result;
      if (outcome.selected.phase === 'emergency' && !actor.dpDeclinedOnTiming) return false;
      if (outcome.selected.phase === 'normal') {
        // Original cooldown/save-up returns skip even optional defense.
        // Capture the gates during execution, without evaluating them twice.
        if (normalGated) return false;
        options = defenseEnabled && deps.settings().defensePosts ?
          [candidate(domain, 'building:optional-defense', 2, true, { phase: 'optional-defense' }, 'Optional frontier defense after ordinary structures failed')] : [];
      } else options = options.filter(item => item !== outcome.selected);
    }
    return false;
  }
  async function action(actor, unitType, units, hooks) {
    if (!hooks.allowed()) return false;
    const domain = 'structure-action';
    const density = actor.getTotalStructureDensity();
    const forceNew = hooks.forceNew === true;
    const preferUpgrade = !forceNew && density > deps.densityThreshold && actor.game.config().unitInfo(unitType).upgradable;
    let options = [
      candidate(domain, 'building:upgrade', 0, !!preferUpgrade, { action: 'upgrade', unitType, density, ownedCount: units.length }, 'Original dense-territory upgrade preference'),
      candidate(domain, 'building:new', 1, !preferUpgrade || units.length === 0, { action: 'new', unitType, density, ownedCount: units.length }, 'New construction allowed by original density rule')
    ];
    while (options.some(item => item.eligible)) {
      const outcome = await attempt(domain, actor, options, hooks, selected => selected.action === 'upgrade' ?
        actor.maybeUpgradeStructure(units) : actor._placeNewStructure(unitType), { unitType, forceNew });
      if (outcome.stopped) return false;
      if (outcome.result) return outcome.result;
      options = options.filter(item => item !== outcome.selected);
    }
    return false;
  }
  async function upgrade(actor, units, hooks) {
    const eligible = [];
    for (const structure of units) {
      if (!hooks.allowed()) return null;
      const bu = await actor.buildableFor(structure.type(), structure.tile());
      if (!hooks.allowed()) return null;
      if (bu !== null && bu.canUpgrade !== false) eligible.push({ structure, bu });
    }
    if (!eligible.length) return null;
    let mode = 'sam-coverage';
    const scores = new Map();
    let winner;
    if (deps.settings().samDefense && eligible[0].structure.type() === U.SAMLauncher) {
      mode = 'protected-value';
      const protectedUnits = actor.player.units(U.City, U.Port, U.Factory, U.MissileSilo);
      for (const entry of eligible) {
        const range = actor.game.config().samRange(entry.structure.level());
        scores.set(entry, protectedUnits.reduce((sum, unit) => sum +
          (actor.game.euclideanDistSquared(entry.structure.tile(), unit.tile()) <= range * range ?
            Math.max(1, unit.level()) * deps.samProtectWeight(unit.type()) : 0), 0));
      }
    } else {
      const chance = { Easy: 70, Medium: 40, Hard: 25, Impossible: 0 }[deps.difficulty()] || 0;
      if (actor.random.nextInt(0, 100) < chance) {
        mode = 'random';
        // Pass units to the original RNG, preserving its input shape and cadence.
        const chosen = actor.random.randElement(eligible.map(entry => entry.structure));
        winner = eligible.find(entry => entry.structure === chosen);
      }
      if (mode !== 'random') {
        const sams = actor.player.units(U.SAMLauncher);
        for (const entry of eligible) scores.set(entry, sams.reduce((score, sam) => {
          const range = actor.game.config().samRange(sam.level());
          return score + (actor.game.euclideanDistSquared(entry.structure.tile(), sam.tile()) <= range * range ?
            10 + Math.max(0, sam.level() - 1) * 7.5 : 0);
        }, 0));
      }
    }
    const ranked = [...eligible].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
    if (winner) {
      ranked.splice(ranked.indexOf(winner), 1);
      ranked.unshift(winner);
    }
    const options = ranked.map((entry, priority) => candidate('structure-upgrade', `upgrade:${priority}`, priority, true,
      { unitId: entry.structure.id(), tile: entry.structure.tile(), unitType: entry.structure.type(),
        level: entry.structure.level(), score: scores.get(entry) || 0 }, `Original ${mode} upgrade ranking`));
    if (!hooks.allowed()) return null;
    const choice = hooks.choose('structure-upgrade', [...options.slice(0, 79), wait], { mode, totalCandidates: options.length });
    const index = options.slice(0, 79).findIndex(item => item.id === choice.selectedId);
    if (index < 0 || !hooks.allowed()) return null;
    const selected = ranked[index];
    hooks.remember(selected.bu, choice.decisionId);
    hooks.record('building-result', { domain: 'structure-upgrade', decisionId: choice.decisionId,
      status: 'selected', unitId: options[index].unitId });
    return selected;
  }
  async function defense(actor, tiles, hooks, facts = {}) {
    let remaining = tiles.map((tile, priority) => candidate('defense-placement', `defense:${priority}`, priority, true,
      { tile, unitType: U.DefensePost }, 'Original prepared frontier placement order'));
    while (remaining.length) {
      if (!hooks.allowed()) return null;
      const options = remaining.slice(0, 79);
      const choice = hooks.choose('defense-placement', [...options, wait], { ...facts, remainingCandidates: remaining.length });
      const selected = options.find(item => item.id === choice.selectedId);
      if (!selected || !hooks.allowed()) return null;
      remaining = remaining.filter(item => item !== selected);
      try {
        const quote = await actor.buildableFor(U.DefensePost, selected.tile);
        if (!hooks.allowed()) {
          hooks.record('building-result', { domain: 'defense-placement', decisionId: choice.decisionId,
            status: 'stopped', tile: selected.tile });
          return null;
        }
        if (quote === null || quote.canBuild === false) {
          hooks.record('building-result', { domain: 'defense-placement', decisionId: choice.decisionId,
            status: 'unbuildable', tile: selected.tile });
          continue;
        }
        hooks.remember(quote, choice.decisionId);
        hooks.record('building-result', { domain: 'defense-placement', decisionId: choice.decisionId,
          status: 'selected', tile: selected.tile });
        return quote;
      } catch (error) {
        hooks.record('building-result', { domain: 'defense-placement', decisionId: choice.decisionId, status: 'threw' });
        throw error;
      }
    }
    return null;
  }
  return { handle, action, upgrade, defense };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createBuildingPlanner;
