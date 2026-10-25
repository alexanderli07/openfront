'use strict';

function createNavalLandingPlanner() {
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Stop this landing-site lookup' };
  async function run(actor, sites, context, hooks) {
    const distant = context.mode === 'distant';
    const timeout = distant ? '__probe_timeout__' : false;
    // The caller supplies the original distance-sorted pool. Compare indices
    // with the cap rather than slice(cap), preserving fractional cap semantics.
    let remaining = sites.map((site, priority) => ({ id: `landing:${context.mode}:${priority}`,
      kind: 'naval-landing', source: 'NavalLandingPlanner', mode: context.mode, tile: site.tile,
      distanceSquared: site.dist, priority, eligible: true, readiness: 'unchecked',
      reason: 'Original nearest-first order; check boat assignment and reachability after selection'
    })).filter(candidate => candidate.priority < context.probeCap);
    const poolSize = remaining.length;
    let probed = 0, timedOut = 0;
    const finish = tile => {
      if (distant && hooks.allowed()) hooks.diagnostics({ enemies: sites.length, probed,
        probeCap: context.probeCap, timedOut, found: tile !== null });
      return tile;
    };
    while (hooks.allowed()) {
      const visible = remaining.slice(0, 79);
      const choice = hooks.choose([...visible, wait], {
        mode: context.mode, totalTargets: sites.length, searchPool: poolSize,
        outsideCap: sites.length - poolSize, remainingTargets: remaining.length,
        windowHidden: remaining.length - visible.length, probeCap: context.probeCap, probed, timedOut
      });
      const selected = visible.find(c => c.id === choice.selectedId);
      if (!selected) {
        if (visible.length > 0 || choice.selectedId === null) hooks.stop?.(choice);
        return finish(null);
      }
      if (!hooks.allowed()) return finish(null);
      remaining = remaining.filter(c => c !== selected);
      const details = { decisionId: choice.decisionId, candidateId: selected.id,
        mode: context.mode, tile: selected.tile };
      const report = (status, extra = {}) => hooks.record('landing-probe', {
        ...details, status, probed, timedOut, ...extra
      });
      try {
        if (actor.boatTargetTaken(selected.tile)) {
          report('already-targeted', { reason: 'Original boat target spacing check rejected this destination' });
          continue;
        }
        probed++;
        const result = await hooks.probe(choice.decisionId, selected.tile, timeout);
        if (!hooks.allowed()) {
          report('stale', { reason: 'Bot disabled or game ownership changed while probing' });
          return null;
        }
        if (distant && result === timeout) {
          timedOut++;
          report('timeout');
          continue;
        }
        if (result === false) {
          report('unreachable', {
            reason: distant ? 'Reachability probe returned false' : 'Reachability failed or timed out (original false fallback)' });
          continue;
        }
        report('reachable', {
          reason: 'Transport spawn probe succeeded; no boat has been dispatched by this lookup' });
        return finish(selected.tile);
      } catch (error) {
        report('threw');
        throw error;
      }
    }
    return null;
  }
  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createNavalLandingPlanner;
