'use strict';

function createStrikePlanner(deps) {
  const { state, units } = deps;
  const wait = { id: '$wait', kind: 'wait', reason: 'Hold strike' };
  function choose(hooks, domain, plans, facts = {}) {
    const candidates = plans.map((plan, priority) => ({ kind: domain, priority, eligible: true, ...plan }));
    const decision = hooks.choose(domain, [...candidates, wait], facts);
    const plan = candidates.find(c => c.id === decision.selectedId && c.eligible);
    const report = (status, details = {}) => hooks.record('strike-result', {
      domain, decisionId: decision.decisionId, planId: plan?.id, status, ...details
    });
    if (!plan) report('wait', { reason: decision.reason });
    return { plan, decision, report };
  }
  async function mirv(actor, cost, hooks) {
    if (!hooks.allowed()) return false;
    if (state.settings.winFixes && actor.teamHasWon()) {
      if (state.nukeReserveGold) state.nukeReserveGold = 0n;
      hooks.record('strike-result', { domain: 'mirv-plan', status: 'team-won' }); return false;
    }
    const remaining = state.settings.winFixes ? ['win-fix', 'counter', 'denial', 'steamroll'] : ['counter', 'denial', 'steamroll'];
    let affordabilityChecked = false;
    while (remaining.length) {
      if (!hooks.allowed()) return false;
      if (remaining[0] !== 'win-fix' && !affordabilityChecked) {
        affordabilityChecked = true;
        if (actor.player.gold() < cost) {
          hooks.record('strike-result', { domain: 'mirv-plan', status: 'unaffordable', cost }); return false;
        }
      }
      const { plan, decision, report } = choose(hooks, 'mirv-plan', remaining.map(purpose => ({
        id: purpose, readiness: 'unchecked', reason: `Original MIRV purpose: ${purpose}`
      })), { cost, reserve: state.nukeReserveGold });
      if (!plan) return false;
      if (plan.id !== 'win-fix' && !affordabilityChecked) {
        affordabilityChecked = true;
        if (actor.player.gold() < cost) { report('unaffordable', { cost }); return false; }
      }
      remaining.splice(remaining.indexOf(plan.id), 1);
      const read = () => {
        if (plan.id === 'win-fix') return actor.selectWinFixMirvTarget(cost);
        if (plan.id === 'counter') return actor.selectCounterMirvTarget();
        if (plan.id === 'denial') return actor.selectVictoryDenialTarget();
        return actor.selectSteamrollStopTarget();
      };
      const lookup = hooks.lookup ? hooks.lookup(decision.decisionId,read) : { target: read(), stopped: false };
      if (lookup.stopped) { report('stopped', { reason: 'Target ranking policy stopped purpose pass' }); return false; }
      const target = lookup.target;
      if (!hooks.allowed()) { report('stopped'); return false; }
      if (target && !actor.wasRecentlyMirved(target)) {
        if (plan.id === 'win-fix') {
          if (actor.player.gold() >= cost) state.nukeReserveGold = 0n;
          else {
            if (actor.game.ticks() >= (state.settings.mirvEarlyGameTicks ?? 6000)) state.nukeReserveGold = cost;
            else if (state.nukeReserveGold) state.nukeReserveGold = 0n;
            report('reserve', { reserve: state.nukeReserveGold, cost }); return false;
          }
        }
        await actor.maybeSendMIRV(target, lookup.decisionId ?? decision.decisionId);
        report('attempt-completed'); return true;
      }
      if (plan.id === 'win-fix' && state.nukeReserveGold) state.nukeReserveGold = 0n;
      report('unfulfilled', { reason: target ? 'Target was recently MIRVed' : 'No target' });
    }
    return false;
  }

  async function weapon(actor, context, hooks) {
    const remaining = [units.HydrogenBomb, units.AtomBomb];
    while (remaining.length) {
      if (!hooks.allowed()) return null;
      const { plan, decision, report } = choose(hooks, 'nuke-weapon', remaining.map(type => ({
        id: type, readiness: 'unchecked', reason: `Original weapon preference: ${type}`
      })), context);
      if (!plan) return null;
      remaining.splice(remaining.indexOf(plan.id), 1);
      let eligible = false;
      if (plan.id === units.HydrogenBomb) {
        eligible = !actor.game.config().isUnitDisabled(units.HydrogenBomb) && context.available >= context.hydroCost && actor.nukeSpendAllowed(await actor.cost(units.HydrogenBomb));
      } else {
        eligible = !actor.game.config().isUnitDisabled(units.AtomBomb) && (!actor.isHydroNation || actor.isUnderHeavyAttack()) && context.available >= context.atomCost;
      }
      if (!hooks.allowed()) { report('stopped'); return null; }
      report(eligible ? 'weapon-selected' : 'unfulfilled');
      if (eligible) { hooks.selected?.(decision.decisionId); return plan.id; }
    }
    return null;
  }

  async function nuke(actor, sites, context, hooks) {
    const difficulty = context.difficulty ?? deps.difficulty();
    const remaining = [];
    // Original sorted loop stops at the first score that does not exceed -1.
    for (const site of sites) { if (!(site.value > -1)) break; remaining.push({ ...site, id: `site:${remaining.length}` }); }
    let selected = null, salvo = null, siteDecisionId;
    while (remaining.length) {
      if (!hooks.allowed()) return;
      const { plan, decision, report } = choose(hooks, 'nuke-site', remaining.slice(0, 79).map(site => ({
        ...site, reason: 'Original descending strike score; reachability unchecked'
      })), { parentDecisionId: context.parentDecisionId, weapon: context.weapon });
      if (!plan) return;
      if (plan.arcDecisionId !== undefined) hooks.record('strike-link', {
        decisionId: decision.decisionId, sourceDecisionId: plan.arcDecisionId, relation: 'selected-site-arc' });
      remaining.splice(remaining.findIndex(s => s.id === plan.id), 1);
      const reachable = await actor.probeCanBuildNuke(plan.tile, plan.interceptable ? units.AtomBomb : context.weapon);
      if (!hooks.allowed()) { report('stopped'); return; }
      if (!reachable) { report('unreachable', { tile: plan.tile }); continue; }
      if (plan.interceptable) {
        salvo = await actor.planSaturationSalvoFor(plan.tile, decision.decisionId);
        if (!hooks.allowed()) { report('stopped'); return; }
        if (salvo?.stopped) { report('stopped'); return; }
        if (salvo === null) { report('no-salvo', { tile: plan.tile }); continue; }
      }
      selected = plan; siteDecisionId = decision.decisionId; report('site-selected', { tile: plan.tile }); break;
    }
    if (!hooks.allowed()) return;
    let purpose;
    if (salvo !== null) purpose = 'salvo';
    else {
      const permitted = actor.nukeSpendAllowed(await actor.cost(context.weapon));
      if (!hooks.allowed()) return;
      if (!permitted) { hooks.record('strike-result', { domain: 'nuke-action', status: 'spend-blocked' }); return; }
      const samCrack = Boolean(state.settings.samCrack);
      if (selected !== null && (selected.value > 0 || difficulty !== 'Impossible' && !samCrack)) purpose = 'direct';
      else if (difficulty === 'Impossible' || samCrack) purpose = 'sam-clear';
    }
    const { plan, decision, report } = choose(hooks, 'nuke-action', purpose ? [{
      id: purpose, reason: `Original strike action: ${purpose}`, tile: selected?.tile
    }] : [], { parentDecisionId: hooks.parent?.(salvo) ?? siteDecisionId ?? context.parentDecisionId, weapon: context.weapon });
    if (!plan) return;
    if (!hooks.allowed()) { report('stopped'); return; }
    try {
      if (purpose === 'salvo') {
        for (let i = 0; i < salvo.bombsToFire; i++) {
          if (!hooks.allowed()) { report('stopped', { attempts: i }); return; }
          await actor.sendNuke(selected.tile, units.AtomBomb, context.target, salvo.waitTicksPerBomb[i], true, salvo.arcUpPerBomb ? salvo.arcUpPerBomb[i] !== false : true, decision.decisionId);
          if (!hooks.allowed()) { report('stopped', { attempts: i + 1 }); return; }
          await deps.salvoPace(i, salvo.bombsToFire);
        }
        if (!hooks.allowed()) { report('stopped'); return; }
        deps.salvoMessage(salvo.bombsToFire);
      } else if (purpose === 'direct') await actor.sendNuke(selected.tile, context.weapon, context.target, 0, false, selected.arcUp !== false, decision.decisionId);
      else await actor.maybeDestroyEnemySam(context.target, decision.decisionId);
      report('attempt-completed');
    } catch (error) { report('threw', { error: String(error?.message || error) }); throw error; }
  }
  return { mirv, weapon, nuke };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStrikePlanner;
