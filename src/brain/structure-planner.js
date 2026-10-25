'use strict';

// Plans choose which existing placement routine to try. They are not build quotes.
function createStructurePlanner(deps) {
  const U = deps.units;
  function candidates(actor, context) {
    const config = actor.game.config();
    const settings = deps.settings();
    const enabled = type => !config.isUnitDisabled(type);
    const siloEnabled = enabled(U.MissileSilo);
    const nuclearEnabled = enabled(U.AtomBomb) || enabled(U.HydrogenBomb) || enabled(U.MIRV);
    const plans = [];
    function add(id, type, priority, stage, reason, exclusion, facts = {}) {
      plans.push({ id, kind: 'structure-plan', source: 'StructurePlanner', unitType: type,
        priority, stage, eligible: !exclusion, reason: exclusion || reason,
        validation: 'Affordability, placement and upgrade checks run only after selection', ...facts });
    }
    const hard = ['Hard', 'Impossible'].includes(deps.difficulty());
    const defense=context.defenseEconomy;
    if(defense?.requiredType){const type=defense.requiredType,cost=actor.cost(type);
      add('structure:defense-economy',type,-10,'defense-economy','Required physical economy before emergency reserve',
        enabled(type)?null:'Unit disabled',{adaptiveOnly:true,forceNew:true,
          perceivedCost:cost,availableGold:defense.availableGold,
          affordable:defense.availableGold>=cost+(defense.stage==='first-sam'?0n:defense.reserve)});}
    const early = actor.placementsCount === 0 && hard && enabled(U.AtomBomb) && siloEnabled &&
      enabled(U.SAMLauncher) && actor.hasHighStartingGold();
    add('structure:initial-sam', U.SAMLauncher, 0, 'initial',
      'Original first-placement protection for high starting gold',
      early ? null : 'First-placement high-gold protection conditions are not met');

    const denseType = context.sharedWater && enabled(U.Port) ? U.Port : U.Factory;
    const dense = !context.cityDisabled && actor.ownedLevels(U.City) === 0 && actor.isHighNationDensity();
    add('structure:dense-economy', denseType, 1, 'dense',
      'Original economic opening with no cities in a high-density game',
      !dense ? 'High-density opening conditions are not met' : !enabled(denseType) ? 'Unit disabled in game configuration' : null);

    const urgentSam = settings.samDefense && enabled(U.SAMLauncher) &&
      actor.ownedLevels(U.SAMLauncher) < actor.samThreatLevels(context.cityLevels);
    const ownedSamLevels = actor.ownedLevels(U.SAMLauncher);
    let samTargetLevels = ownedSamLevels;
    try { samTargetLevels = actor.samTargetLevels(context.cityLevels); } catch {}
    let samPerceivedCost = 0n;
    try { samPerceivedCost = actor.getPerceivedCost(U.SAMLauncher); } catch {}
    let availableGold = actor.player.gold();
    try { if (deps.spendableGold) availableGold = deps.spendableGold(actor); } catch {}
    if (context.teamOpening && !context.teamOpening.frontline && !context.teamOpening.sams) {
      const opening = context.teamOpening;
      for (const [role, type, target] of [['Port', U.Port, opening.portTarget ? 3 : 0],
        ['City', U.City, opening.cityTarget ? 2 : 0], ['Factory', U.Factory, opening.factoryTarget],
        ['SAM', U.SAMLauncher, opening.samEnabled ? 1 : 0]]) {
        const owned = { Port: opening.ports, City: opening.cities, Factory: opening.factories, SAM: opening.sams }[role];
        if (!target || owned >= target) continue;
        const cost = actor.getPerceivedCost(type);
        add('structure:opening:' + role, type, 100, 'team-opening',
          'Physical two-team opening construction', enabled(type) ? null : 'Unit disabled',
          { adaptiveOnly: true, forceNew: true, openingRole: role, perceivedCost: cost,
            availableGold, affordable: availableGold >= cost });
      }
    }
    const order = urgentSam ? [U.SAMLauncher, U.Port, U.Factory, U.MissileSilo] :
      [U.Port, U.Factory, U.SAMLauncher, U.MissileSilo];
    order.forEach((type, index) => {
      let exclusion = !enabled(type) ? 'Unit disabled in game configuration' :
        type === U.Port && !context.sharedWater ? 'No shared water component for port trade' :
        !nuclearEnabled && (type === U.SAMLauncher || type === U.MissileSilo) ? 'All nuclear weapons are disabled' :
        !siloEnabled && type === U.SAMLauncher ? 'Missile silos are disabled' : null;
      if (!exclusion && !actor.shouldBuildStructure(type, context.cityLevels, context.sharedWater)) {
        exclusion = 'Original structure target or ratio is already satisfied';
      }
      const firstSamReserve = type === U.SAMLauncher && ownedSamLevels === 0 && !exclusion;
      if (firstSamReserve && samTargetLevels === 0) samTargetLevels = 1;
      add(`structure:normal:${type}`, type, index + 2, 'normal',
        type === U.SAMLauncher && urgentSam ? 'SAM threat shortfall takes priority under the original defense rule' :
          'Below original structure target; retain original ordering', exclusion,
        type === U.SAMLauncher ? { ownedLevels: ownedSamLevels, targetLevels: samTargetLevels,
          perceivedCost: samPerceivedCost, availableGold, affordable: availableGold >= samPerceivedCost,
          firstSamReserve } : {});
    });
    add('structure:city', U.City, 6, 'fallback', 'Original city fallback after targeted structures',
      context.cityDisabled ? 'Cities disabled in game configuration' : null);
    plans.push({ id: '$wait', kind: 'wait', eligible: true,
      firstSamReserve: plans.some(plan => plan.firstSamReserve && plan.eligible),
      reason: 'Save resources; attempt no structure' });
    if(defense)for(const plan of plans)if(plan.kind==='structure-plan'&&plan.unitType!==U.SAMLauncher){
      const cost=actor.cost(plan.unitType);plan.perceivedCost=cost;plan.availableGold=defense.availableGold;
      plan.affordable=defense.availableGold>=cost+defense.reserve;
    }
    return plans;
  }

  async function run(actor, context, hooks) {
    if (!hooks.allowed()) return false;
    let remaining = candidates(actor, context);
    const exhausted = new Set();
    let normalPriorities = null;
    // Each stage is attempted at most once. A failed special opening may still
    // reach the same unit type in its normal stage, matching the original flow.
    while (true) {
      if (!hooks.allowed()) return false;
      const choice = hooks.choose(remaining);
      const plan = remaining.find(p => p.id === choice.selectedId);
      if (!plan || plan.kind === 'wait') return false;
      if (!plan.eligible) {
        hooks.record('plan-blocked', { decisionId: choice.decisionId, planId: plan.id, reason: plan.reason });
        return false;
      }
      if (!hooks.allowed()) return false;
      // Preserve stages already passed by the original ordered walk. Later
      // ineligible stages can become eligible while a placement query awaits.
      for (const other of remaining) {
        if (other.priority < plan.priority && other.eligible === false) exhausted.add(other.id);
      }
      if (!normalPriorities && (plan.stage === 'normal' || plan.stage === 'fallback')) {
        normalPriorities = new Map(remaining.filter(p => p.stage === 'normal').map(p => [p.id, p.priority]));
      }
      try {
        const result = await hooks.execute(plan, choice.decisionId, () => actor.maybeSpawnStructure(plan.unitType));
        hooks.record('plan-result', { decisionId: choice.decisionId, planId: plan.id,
          status: result ? 'completed' : 'unfulfilled',
          reason: result ? 'Original placement routine returned success; consult linked dispatch record' :
            'Original placement routine did not complete; consult rule results for affordability or placement checks' });
        if (result) return result;
      } catch (error) {
        hooks.record('plan-result', { decisionId: choice.decisionId, planId: plan.id, status: 'threw' });
        throw error;
      }
      exhausted.add(plan.id);
      if (!hooks.allowed()) return false;
      remaining = candidates(actor, context).filter(p => !exhausted.has(p.id));
      if (normalPriorities) {
        for (const other of remaining) {
          if (normalPriorities.has(other.id)) other.priority = normalPriorities.get(other.id);
        }
      }
    }
  }
  return { candidates, run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStructurePlanner;
