'use strict';

function createWarshipPatrolPlanner() {
  function run(actor, sites, context, hooks) {
    const { smart, tick, cellSize, serviceTicks } = context;
    const remaining = sites.map((site, priority) => ({ ...site, priority, id: `patrol:${priority}` }));
    while (remaining.length) {
      if (!hooks.allowed()) return;
      const candidates = remaining.map(site => {
        const cell = Math.floor(actor.game.x(site.tile) / cellSize) + ',' + Math.floor(actor.game.y(site.tile) / cellSize);
        const lastServiceTick = smart.serviced.get(cell);
        const eligible = lastServiceTick === undefined || tick - lastServiceTick >= serviceTicks;
        return { id: site.id, kind: 'warship-patrol', purpose: site.kind, tile: site.tile, sourceDecisionId:site.sourceDecisionId,
          ...(site.adaptiveOnly ? {adaptiveOnly:true} : {}),
          priority: site.priority, cell, lastServiceTick, eligible,
          reason: eligible ? `Patrol ${site.kind} in original priority order` : 'Zone was recently serviced' };
      });
      const choice = hooks.choose([...candidates, { id: '$wait', kind: 'wait', reason: 'Hold patrol position' }]);
      const selected = candidates.find(c => c.id === choice.selectedId && c.eligible);
      const report = (status, extra = {}) => hooks.record('warship-patrol-result', {
        decisionId: choice.decisionId, purpose: selected?.purpose, tile: selected?.tile, status, ...extra
      });
      if (!selected) { report('wait', { reason: choice.reason }); return; }
      if (!hooks.allowed()) { report('stopped'); return; }
      remaining.splice(remaining.findIndex(s => s.id === selected.id), 1);
      const moved = hooks.execute(choice.decisionId, () => actor.moveBestWarshipTo(selected.tile, selected.purpose, smart, tick));
      report('move-result', { moved: Boolean(moved) });
      if (moved) { smart.serviced.set(selected.cell, tick); return; }
    }
  }
  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createWarshipPatrolPlanner;
