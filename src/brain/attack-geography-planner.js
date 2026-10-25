'use strict';

function createAttackGeographyPlanner(deps) {
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Stop this geographic target search' };
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

  function result(hooks, mode, status, details = {}) {
    hooks.record('attack-geography-result', { mode, status, ...details });
  }

  function stopped(hooks, mode, decisionId, reason) {
    result(hooks, mode, 'stopped', { decisionId: decisionId ?? null, reason });
    return { target: null, decisionId: decisionId ?? null, stop: true };
  }

  function choose(entries, mode, hooks, facts = {}) {
    if (entries.length === 0) {
      result(hooks, mode, 'empty', { decisionId: null, reason: 'No original search candidate was reachable' });
      return { target: null, decisionId: null, stop: false };
    }
    const visible = entries.slice(0, 79);
    let choice;
    try {
      choice = hooks.choose('attack-geography', [...visible.map(entry => entry.candidate), wait], {
        mode, totalTargets: entries.length, visibleTargets: visible.length,
        hiddenTargets: entries.length - visible.length, ...facts
      });
    } catch (error) {
      return stopped(hooks, mode, null, `Policy selection threw: ${String(error?.message || error)}`);
    }
    const selected = visible.find(entry => entry.candidate.id === choice?.selectedId);
    if (!selected) return stopped(hooks, mode, choice?.decisionId,
      choice?.selectedId === '$wait' ? 'Policy selected wait' : 'Policy selected an invalid geographic target');
    if (!hooks.allowed()) return stopped(hooks, mode, choice?.decisionId,
      'Bot stopped or ownership changed after geographic target selection');
    result(hooks, mode, 'selected', { decisionId: choice.decisionId,
      targetId: selected.candidate.targetId, reason: selected.candidate.reason });
    return { target: selected.target, decisionId: choice.decisionId, stop: false };
  }

  async function pocket(actor, hooks) {
    let tick;
    try { tick = Number(actor.game.ticks()); } catch { return { target: null, decisionId: null, stop: false }; }
    if (actor._pocketTick !== undefined && tick >= actor._pocketTick &&
        tick - actor._pocketTick < (deps.encircleScanTicks ?? 100)) {
      if (actor._pocketSid === null || actor._pocketSid === undefined) return { target: null, decisionId: null, stop: false };
      try {
        const cached = actor.game.playerBySmallID(actor._pocketSid);
        if (cached && cached.isPlayer && cached.isPlayer() && cached.isAlive()) {
          result(hooks, 'pocket', 'cached', { decisionId: null, targetId: safe(() => cached.id()) });
          return { target: cached, decisionId: null, stop: false };
        }
      } catch { /* Original cache lookup falls through to a fresh scan. */ }
    }
    if (!hooks.allowed()) return stopped(hooks, 'pocket', null, 'Bot stopped before pocket scan');
    actor._pocketTick = tick;
    actor._pocketSid = null;
    const landTiles = Number(actor.game.numLandTiles()) || 1;
    const maxLandShare = deps.settings().encircleMaxShare ?? .1;
    const minSealShare = deps.settings().encircleMinSealShare ?? .6;
    const width = actor.game.width(), height = actor.game.height(), ownId = actor.player.smallID();
    const entries = [];
    let inputIndex = 0;
    for (const target of actor.player.nearby()) {
      const index = inputIndex++;
      try {
        if (!target.isPlayer || !target.isPlayer()) continue;
        if (actor.player.isFriendly(target)) continue;
        if (target.isAlive && !target.isAlive()) continue;
        const tilesOwned = Number(target.numTilesOwned()) || 0;
        if (tilesOwned <= 0 || tilesOwned / landTiles > maxLandShare) continue;
        await actor.game.ensureBorderTiles(target);
        if (!hooks.allowed()) return stopped(hooks, 'pocket', null, 'Bot stopped during pocket border preparation');
        const border = target.borderTiles();
        if (!border || border.size === 0) continue;
        const targetId = target.smallID();
        let ownedPerimeter = 0, openPerimeter = 0, sealed = true;
        for (const tile of border) {
          if (actor.game.isShore(tile)) { sealed = false; break; }
          const x = actor.game.x(tile), y = actor.game.y(tile);
          if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) { sealed = false; break; }
          for (const neighbor of actor.game.neighbors(tile)) {
            if (!actor.game.isLand(neighbor)) continue;
            if (!actor.game.hasOwner(neighbor)) { openPerimeter++; continue; }
            const owner = actor.game.ownerID(neighbor);
            if (owner === targetId) continue;
            if (owner === ownId) ownedPerimeter++;
            else { sealed = false; break; }
          }
          if (!sealed) break;
        }
        if (!sealed) continue;
        const perimeter = ownedPerimeter + openPerimeter;
        if (perimeter === 0) continue;
        const sealShare = ownedPerimeter / perimeter;
        if (sealShare <= 0 || sealShare < minSealShare) continue;
        entries.push({ target, candidate: {
          id: `attack-geography:pocket:${targetId}`, kind: 'attack-geography', mode: 'pocket',
          targetId: safe(() => target.id(), String(targetId)), inputIndex: index, priority: index, eligible: true,
          facts: { tilesOwned, landShare: tilesOwned / landTiles, maxLandShare, ownedPerimeter,
            openPerimeter, sealShare, minSealShare },
          reason: 'Sealable pocket meeting original land-share and perimeter thresholds'
        } });
      } catch { /* The original pocket scan ignores one target's failure. */ }
    }
    entries.sort((a, b) => b.candidate.facts.sealShare - a.candidate.facts.sealShare ||
      a.candidate.inputIndex - b.candidate.inputIndex);
    entries.forEach((entry, priority) => { entry.candidate.priority = priority; });
    const selected = choose(entries, 'pocket', hooks, { tick, maxLandShare, minSealShare });
    actor._pocketSid = selected.target ? selected.target.smallID() : null;
    return selected;
  }

  async function island(actor, hooks) {
    if (!hooks.allowed()) return stopped(hooks, 'island', null, 'Bot stopped before island scan');
    if (actor.game.config().isUnitDisabled(deps.transportType)) return choose([], 'island', hooks);
    if (actor.player.unitCount(deps.transportType) >= actor.game.config().boatMaxNumber()) return choose([], 'island', hooks);
    if (!Array.from(actor.player.borderTiles()).some(tile => actor.game.isShore(tile))) return choose([], 'island', hooks);
    const targets = actor.game.players().filter(target => {
      if (target.smallID() === actor.player.smallID()) return false;
      if (actor.player.isFriendly(target)) return false;
      return !actor.isFFA() || target.troops() < actor.player.troops();
    });
    if (targets.length === 0) return choose([], 'island', hooks);
    const ownCenter = actor.getPlayerCenter(actor.player);
    const ranked = targets.map((target, inputIndex) => {
      const center = actor.getPlayerCenter(target);
      let distance = Infinity;
      if (ownCenter && ownCenter.x != null && center && center.x != null) {
        distance = actor.game.manhattanDist(actor.game.ref(ownCenter.x, ownCenter.y), actor.game.ref(center.x, center.y));
      }
      return { target, inputIndex, distance };
    }).sort((a, b) => a.distance - b.distance || a.inputIndex - b.inputIndex);
    const ownShore = Array.from(actor.player.borderTiles()).filter(tile => actor.game.isShore(tile));
    const entries = [];
    for (const entry of ranked) {
      await actor.game.ensureBorderTiles(entry.target);
      if (!hooks.allowed()) return stopped(hooks, 'island', null, 'Bot stopped during island border preparation');
      const pair = deps.closestTwoTiles(actor.game, ownShore,
        Array.from(entry.target.borderTiles()).filter(tile => actor.game.isShore(tile)));
      if (pair === null) continue;
      const reachable = await hooks.probe(pair.y);
      if (!hooks.allowed()) return stopped(hooks, 'island', null, 'Bot stopped during island reachability probe');
      if (reachable === false) continue;
      const smallId = entry.target.smallID();
      entries.push({ target: entry.target, candidate: {
        id: `attack-geography:island:${smallId}`, kind: 'attack-geography', mode: 'island',
        targetId: safe(() => entry.target.id(), String(smallId)), inputIndex: entry.inputIndex,
        priority: entries.length, eligible: true,
        facts: { distance: Number.isFinite(entry.distance) ? entry.distance : null, destinationTile: pair.y },
        reason: 'Reachable island enemy in original center-distance order'
      } });
      if (entries.length >= 2) break;
    }
    return choose(entries, 'island', hooks, { scannedTargets: ranked.length });
  }

  async function select(actor, mode, hooks) {
    if (mode === 'pocket') return pocket(actor, hooks);
    if (mode === 'island') return island(actor, hooks);
    throw new Error('Unknown attack geography mode: ' + mode);
  }

  return { select };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createAttackGeographyPlanner;
