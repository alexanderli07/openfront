'use strict';

function createWarshipDetailsPlanner(deps) {
  const wait = { id: '$wait', kind: 'wait', reason: 'Hold warship action' };
  function spawn(actor, center, radius, hooks) {
    if (!hooks.allowed()) return null;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!hooks.allowed()) return null;
      const x = actor.random.nextInt(actor.game.x(center)-radius, actor.game.x(center)+radius);
      const y = actor.random.nextInt(actor.game.y(center)-radius, actor.game.y(center)+radius);
      if (!actor.game.isValidCoord(x,y)) continue;
      const tile = actor.game.ref(x,y);
      if (!actor.game.isWater(tile)) continue;
      const candidates = [{ id: 'site:use', kind: 'warship-placement', priority: 0, eligible: true,
        tile, reason: 'Use first valid water sample' },
      { id: 'site:resample', kind: 'warship-placement', priority: 1, eligible: attempt < 49,
        resample: true, reason: 'Search another coordinate pair within fifty attempts' }, wait];
      const choice = hooks.choose('warship-placement', candidates, { center, radius, attempt });
      const selected = candidates.find(c=>c.id===choice.selectedId && c.eligible);
      const status = !hooks.allowed() ? 'stopped' : selected?.resample ? 'resample' : selected ? 'selected' : 'wait';
      hooks.record('warship-placement-result', { decisionId: choice.decisionId, tile, attempt, status });
      if (status === 'selected') { hooks.remember(choice.decisionId); return tile; }
      if (status !== 'resample') { hooks.hold(); return null; }
    }
    hooks.record('warship-placement-result', { status: 'exhausted', attempts: 50 });
    return null;
  }
  function move(actor, tile, context, hooks) {
    if (!hooks.allowed() || !actor.game.isWater(tile)) return false;
    const { smart, tick, purpose } = context;
    const settings = deps.settings();
    const maxDistance = settings.warshipMoveMaxDist || 160;
    const cooldownTicks = settings.warshipMoveCooldownTicks || 60;
    const component = smart ? actor.game.getWaterComponent(tile) : undefined;
    const ships = actor.player.units(deps.warshipType).filter(ship => {
      if (!smart) {
        const patrol = ship.warshipState().patrolTile;
        return patrol !== undefined && actor.game.manhattanDist(ship.tile(),patrol) < 130;
      }
      try {
        const state = ship.warshipState(), patrol = state ? state.patrolTile : undefined;
        if (patrol === undefined || state.state !== undefined && state.state !== 'patrolling') return false;
        if (actor.game.manhattanDist(ship.tile(),patrol) >= 130) return false;
        if (actor.game.getWaterComponent(ship.tile()) !== component) return false;
        const last = smart.cooldown.get(ship.id());
        return last === undefined || tick-last >= cooldownTicks;
      } catch { return false; }
    }).sort((a,b)=>actor.game.manhattanDist(a.tile(),tile)-actor.game.manhattanDist(b.tile(),tile));
    const entries = ships.slice(0,79);
    const candidates = entries.map((ship,priority)=>({id:`ship:${priority}`,kind:'warship-unit',priority,
      eligible: !smart || actor.game.manhattanDist(ship.tile(),tile) <= maxDistance,
      unitId: ship.id(), tile: ship.tile(), distance: actor.game.manhattanDist(ship.tile(),tile),
      reason:'Closest eligible patrolling ship, preserving first ties'}));
    const choice = hooks.choose('warship-unit',[...candidates,wait],{ tile,purpose,tick,smart:Boolean(smart),maxDistance,cooldownTicks });
    const index = candidates.findIndex(c=>c.id===choice.selectedId && c.eligible);
    if (index < 0 || !hooks.allowed()) {
      if (candidates.some(c=>c.eligible) || choice.selectedId === null) hooks.hold();
      hooks.record('warship-unit-result',{decisionId:choice.decisionId,status:hooks.allowed()?'wait':'stopped'});
      return false;
    }
    const result = hooks.execute(choice.decisionId,()=>actor._moveSelectedWarship(entries[index],tile,purpose,smart,tick));
    hooks.record('warship-unit-result',{decisionId:choice.decisionId,status:'move-result',moved:Boolean(result),unitId:candidates[index].unitId,tile});
    return result;
  }
  return { spawn, move };
}
if (typeof module !== 'undefined' && module.exports) module.exports = createWarshipDetailsPlanner;
