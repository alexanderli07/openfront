'use strict';

function createNavalActionPlanner(deps) {
  const state = deps.state;
  const purposes = ['surge', 'disconnected', 'nearby', 'crater', 'random-free', 'random-enemy', 'distant'];
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Stop this opportunistic naval pass' };
  async function run(actor, context, hooks) {
    let inflightReady = false, scanned = 0;
    function prepareInflight() {
      if (inflightReady) return;
      inflightReady = true;
      actor._inflightBoatTargets = [];
      for (const ship of actor.player.units(deps.transportType)) {
        try {
          const tile = ship.targetTile ? ship.targetTile() : null;
          if (tile != null) actor._inflightBoatTargets.push({ x: actor.game.x(tile), y: actor.game.y(tile) });
        } catch { /* Original ship metadata fallback. */ }
      }
    }
    async function findTarget(purpose) {
      switch (purpose) {
        case 'disconnected': {
          const tile = await actor.findDisconnectedBoatTarget();
          if (tile !== null && hooks.allowed() && !actor.boatTargetTaken(tile)) return { tile, owned: true, island: true };
          return null;
        }
        case 'nearby': {
          const sites = actor.scanNearbyTargets(context.shore);
          scanned = sites.length;
          const cap = state.settings.islandProbeMax || 4;
          const tile=await hooks.nearby(sites,cap);
          const site=sites.find(site=>site.tile===tile);
          return tile!==null && site && hooks.allowed()?{tile,owned:site.owned,fallout:site.fallout,island:true}:null;
        }
        case 'crater': {
          const tile = actor.pickMirvCraterTarget();
          if (tile === null || actor.boatTargetTaken(tile)) return null;
          const spawn = await hooks.probe(tile);
          return spawn !== false && hooks.allowed() ? { tile, owned: true, island: false } : null;
        }
        case 'random-free': case 'random-enemy': {
          const shore = hooks.origin(context.shore);
          if(shore===null||!hooks.allowed())return null;
          const tile = await actor.findRandomBoatTarget(shore, [], purpose === 'random-free');
          return tile !== null && hooks.allowed() && !actor.boatTargetTaken(tile) ?
            { tile, owned: actor.game.hasOwner(tile), island: false } : null;
        }
        case 'enemy-probe': case 'distant': {
          const tile = await actor.findDistantBoatTarget(purpose==='enemy-probe');
          return tile !== null && hooks.allowed() ? { tile, owned: true, island: true } : null;
        }
        default: throw new Error('Unknown naval target purpose: ' + purpose);
      }
    }
    let remaining = purposes.map((purpose, priority) => ({ id: `naval:${purpose}`, kind: 'naval-action',
      purpose, priority, eligible: true, readiness: 'unchecked',
      reason: `Original naval order: ${purpose}; run search and launch checks only after selection` }));
    remaining.push({id:'naval:enemy-probe',kind:'naval-action',purpose:'enemy-probe',priority:7,
      eligible:true,adaptiveOnly:true,readiness:'unchecked',
      reason:'After the opening, send a 1% probe to a reachable distant enemy before local grabs'});
    while (remaining.length && hooks.allowed()) {
      // A policy that kept the original order must finish naturally rather
      // than turning the unused adaptive-only alternative into a policy hold.
      if(remaining.every(plan=>plan.adaptiveOnly))break;
      const choice = hooks.choose([...remaining, wait], {
        fill: context.fill, surplusFill: context.surplusFill, shoreTiles: context.shore.length,
        beachhead: state.beachhead ? { tile: state.beachhead.tile, at: state.beachhead.at, surged: state.beachhead.surged } : null
      });
      const plan = remaining.find(p => p.id === choice.selectedId);
      const report = (status, data = {}) => hooks.record('naval-action-result', {
        decisionId: choice.decisionId, purpose: plan?.purpose ?? null, status, ...data
      });
      if (!plan) { report('wait', { reason: choice.reason }); return false; }
      const stopped = () => {
        report('stopped', { reason: 'Bot ownership/enabled state changed or a nested policy stopped this pass' });
        return { done: true, result: false };
      };
      if (!hooks.allowed()) { stopped(); return false; }
      try {
        const outcome = await hooks.execute(choice.decisionId, async () => {
          if (plan.purpose === 'surge') {
            const head = state.beachhead;
            const window = state.settings.mirvBoatWindowTicks || 150;
            if (!(head && head.tile != null && !head.surged && context.fill >= context.surplusFill &&
                actor.game.ticks() - (head.at || 0) < window && actor.landingSucceeded(head.tile))) {
              report('unfulfilled', { reason: 'Original reinforcement preconditions are not met' });
              return { done: false };
            }
            const spawn = await hooks.probe(head.tile);
            if (!hooks.allowed()) return stopped();
            if (spawn === false) { report('unfulfilled', { reason: 'Reinforcement spawn probe failed' }); return { done: false }; }
            const sent = hooks.launch(head.tile, 'surge', '⚓ Surge landing');
            if(!hooks.allowed())return stopped();
            if (sent) { state.lastOppBoatMs = context.now; head.surged = true; }
            report('launch-result', { tile: head.tile, submitted: !!sent });
            // The original surge falls through on failed emit, unlike a found
            // ordinary target whose failed launch ends the entire pass.
            return { done: !!sent, result: !!sent };
          }
          prepareInflight();
          const target = await findTarget(plan.purpose);
          if (!hooks.allowed()) return stopped();
          if (!target) { report('unfulfilled', { reason: 'Selected search found no usable target' }); return { done: false }; }
          const threshold = plan.purpose==='enemy-probe' ? 0 : target.island ? state.settings.boatIslandFill || .35 : context.surplusFill;
          if (context.fill < threshold) {
            report('held', { tile: target.tile, fill: context.fill, requiredFill: threshold });
            return { done: true, result: false };
          }
          const label = plan.purpose==='enemy-probe' ? '🛟 Distant enemy probe (1%)' : target.fallout ? '☢️ Nuked-coast grab' : target.island ?
            target.owned ? '🏝️ Weak-coast grab' : '🏝️ Island grab' : '🛟 Probe landing';
          const sent = hooks.launch(target.tile, plan.purpose==='enemy-probe'?'probe-1pct':'probe', label);
          if(!hooks.allowed())return stopped();
          if (sent) {
            state.lastOppBoatMs = context.now;
            state.beachhead = { tile: target.tile, at: actor.game.ticks(), surged: false };
          }
          report('launch-result', { tile: target.tile, submitted: !!sent, label });
          return { done: true, result: !!sent };
        });
        if (outcome.done) return outcome.result;
      } catch (error) {
        report('threw'); throw error;
      }
      remaining = remaining.filter(p => p !== plan && !(plan.purpose==='enemy-probe'&&p.purpose==='distant'));
    }
    if (hooks.allowed()) deps.debug?.('[Boat] no reachable target', {
      scanCandidates: scanned, shoreSamples: Math.min(state.settings.islandScanSamples || 6, context.shore.length), distant: state._distantDiag || null
    });
    return false;
  }
  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createNavalActionPlanner;
