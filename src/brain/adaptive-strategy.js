'use strict';

function createAdaptiveStrategy(legacyStrategy) {
  if (!legacyStrategy || typeof legacyStrategy.decide !== 'function') {
    throw new TypeError('Adaptive strategy requires a legacy strategy fallback.');
  }
  function select(candidate, candidates, reason) {
    return { selectedId: candidate?.id ?? null, reason,
      evaluations: candidates.map(item => ({ id: item.id,
        verdict: item === candidate ? 'select' : item.eligible === false ? 'ineligible' : 'not-selected',
        reason: item === candidate ? reason : item.reason })) };
  }
  function placementChoice(candidates) {
    const eligible = candidates.filter(candidate => candidate.kind === 'structure-placement' && candidate.eligible);
    if (!eligible.length) return select(candidates.find(candidate => candidate.id === '$wait'), candidates,
      'No eligible structure tile remains');
    const samSearch = eligible.find(c=>c.samSearchPlan);
    if (samSearch) return select(samSearch,candidates,'Compare a bounded set of actual SAM construction quotes near priority anchors');
    if (eligible.some(c=>c.samAnchorKind)) {
      const ranked = [...eligible].sort((a,b) => (a.samAnchorProtection ?? Infinity) - (b.samAnchorProtection ?? Infinity) ||
        (a.samAnchorDistance ?? Infinity) - (b.samAnchorDistance ?? Infinity) ||
        (b.originalScore || 0) - (a.originalScore || 0) || (a.priority || 0) - (b.priority || 0));
      const chosen = ranked[0];
      const result = select(chosen,candidates,`Place SAM close to least-protected owned ${chosen.samAnchorKind === 'Port' ? 'ports' : 'cities'}; distance=${chosen.samAnchorDistance}`);
      result.evaluations = candidates.map(c=>({id:c.id,verdict:c===chosen?'select':'not-selected',
        reason:c.samAnchorKind ? `anchor=${c.samAnchorKind}:${c.samAnchorTile}; protection=${c.samAnchorProtection}; distance=${c.samAnchorDistance}; original=${c.originalScore}` : c.reason}));
      return result;
    }
    const economy = ['City', 'Port', 'Factory'].includes(eligible[0].unitType);
    if (!economy) return null;
    const afterSam = eligible.some(candidate => candidate.hasOwnSam);
    const factoryLines = eligible.some(candidate => candidate.factoryLinePriority);
    const routeCount = candidate => (candidate.ownedFactoryRoutes || 0) + (candidate.alliedFactoryRoutes || 0);
    const compare = (left, right) => {
      if (left.frontline || right.frontline) {
        const safety = (right.rearBand || 0) - (left.rearBand || 0);
        if (safety) return safety;
        const route = Number(routeCount(right) > 0) - Number(routeCount(left) > 0) ||
          (right.ownSamCoverage || 0) - (left.ownSamCoverage || 0) || (right.alliedSamCoverage || 0) - (left.alliedSamCoverage || 0);
        if (route) return route;
      }
      if (!afterSam && !factoryLines) {
        return (right.originalScore || 0) - (left.originalScore || 0) ||
          routeCount(right) - routeCount(left) || (left.priority || 0) - (right.priority || 0);
      }
      const leftRoute = routeCount(left) > 0 ? 1 : 0;
      const rightRoute = routeCount(right) > 0 ? 1 : 0;
      let result = rightRoute - leftRoute || (right.ownSamCoverage || 0) - (left.ownSamCoverage || 0) ||
        (right.alliedSamCoverage || 0) - (left.alliedSamCoverage || 0);
      if (!result && left.unitType === 'Factory') {
        result = (right.routeClusters || 0) - (left.routeClusters || 0) ||
          (right.futureRouteCapacity || 0) - (left.futureRouteCapacity || 0);
      }
      return result || (right.originalScore || 0) - (left.originalScore || 0) ||
        (left.priority || 0) - (right.priority || 0);
    };
    const chosen = [...eligible].sort(compare)[0];
    const phase = factoryLines ? 'factory economy: existing factory-line grouping' : afterSam ? 'post-SAM factory-line grouping' : 'pre-SAM spread and safety';
    return { selectedId: chosen.id,
      reason: `${chosen.frontline ? 'Rear safety before route bonuses; ' : ''}${phase}: selected tile ${chosen.tile}`,
      evaluations: candidates.map(candidate => candidate.kind !== 'structure-placement' ?
        { id: candidate.id, verdict: 'not-selected', reason: candidate.reason } :
        { id: candidate.id, verdict: candidate === chosen ? 'select' : 'not-selected',
          reason: `${phase}; rear=${candidate.rearDistance || 0}, band=${candidate.rearBand || 0}, routes=${routeCount(candidate)}, ownSAM=${candidate.ownSamCoverage || 0}, alliedSAM=${candidate.alliedSamCoverage || 0}, clusters=${candidate.routeClusters || 0}, future=${candidate.futureRouteCapacity || 0}, original=${candidate.originalScore || 0}` }) };
  }
  return {
    id: 'adaptive-v1',
    name: 'Adaptive algorithm',
    version: '1.14.0-local-team-piracy',
    decide(snapshot, candidates) {
      if (snapshot.domain === 'spawn-source' && snapshot.spawn?.teamSpawn) {
        const chosen = candidates.find(c => c.source === 'companion' && c.eligible) ||
          candidates.find(c => c.source === 'team-geography' && c.eligible) || candidates.find(c => c.id === '$wait');
        return select(chosen, candidates, 'Use companion override or measured two-team group/coastal spawning');
      }
      if (snapshot.domain === 'team-spawn-site') {
        const score = c => (c.openSpace || 0) * 100 + Number(c.waterAccess) * 25 +
          (c.allyDistance <= 160 ? 20 * Math.max(0, 1 - Math.abs(c.allyDistance - 80) / 100) : 0) +
          Math.min(1, (c.enemyDistance || 0) / 200) * 30 + Math.min(1, (c.edgeDistance || 0) / 30) * 10 -
          (c.enemyDistance < 80 ? 100 : 0);
        const ranked = candidates.filter(c => c.kind === 'team-spawn-site' && c.eligible).sort((a, b) => score(b) - score(a) || a.priority - b.priority);
        const choice = select(ranked[0] || candidates.find(c => c.id === '$wait'), candidates,
          'Prefer open safe expansion, useful water and nearby teammates without crowding');
        choice.evaluations = candidates.map(c => ({ id: c.id, verdict: c === ranked[0] ? 'select' : 'not-selected',
          reason: c.kind === 'team-spawn-site' ? `score=${score(c).toFixed(2)}; open=${c.openSpace}, coast=${c.waterAccess}, ally=${c.allyDistance}, enemy=${c.enemyDistance}` : c.reason }));
        return choice;
      }
      if (snapshot.domain === 'turn-plan' && snapshot.teamNaval?.island && snapshot.teamNaval.fleetNeeded) {
        const deploy = candidates.find(c => c.kind === 'turn-plan' && c.phase === 'warship-deployment' && c.eligible);
        if (deploy) return select(deploy, candidates, 'Island defense fleet before routine spending; deployment preserves economy reserve');
      }
      if (snapshot.domain === 'warship-deployment' && snapshot.teamNaval?.island) {
        const deploy = candidates.find(c=>c.id==='deploy:replacement'&&c.eligible)||candidates.find(c => c.id === 'deploy:island' && c.eligible);
        return select(deploy || candidates.find(c => c.id === '$wait'), candidates,
          deploy ? 'Build a bounded island defense fleet while preserving the economy reserve' : 'Island fleet covered or economy reserve would be spent');
      }
      if (snapshot.domain === 'warship-combat') {
        const chosen = ['retreat', 'evade', 'engage', 'intercept', 'return-to-team', 'trade-hunt'].map(p =>
          candidates.find(c => c.purpose === p && c.eligible)).find(Boolean);
        return select(chosen || candidates.find(c => c.id === '$wait'), candidates,
          'Survival and enemy warships first; intercept invading transports before trade hunting');
      }
      if (snapshot.domain === 'warship-patrol' && snapshot.teamNaval?.island) {
        const rank = purpose => ({ invasion: 0, 'coast-guard': 1, 'loss-zone': 2, 'trade-lane': 3 }[purpose] ?? 4);
        const chosen = candidates.filter(c => c.kind === 'warship-patrol' && c.eligible).sort((a, b) =>
          rank(a.purpose) - rank(b.purpose) || a.priority - b.priority)[0];
        return select(chosen || candidates.find(c => c.id === '$wait'), candidates, 'Intercept invasions and cover island approaches before loss/trade patrols');
      }
      const opening = snapshot.teamOpening;
      const safeOpening = opening && !opening.frontline;
      const wait = () => candidates.find(c => c.id === '$wait');
      const eligible = id => candidates.find(c => c.id === id && c.eligible !== false);
      const defense=snapshot.defenseEconomy;
      if(snapshot.domain==='structure-plan'&&defense){
        if(defense.stage!=='reserve'){
          const plan=eligible('structure:defense-economy');
          return select(plan?.affordable?plan:wait(),candidates,defense.waitingForSam?
            'First SAM is under construction; do not order another':plan?.affordable?
            'Complete the physical economy stage before saving the emergency reserve':'Save for the required economy or first SAM');
        }
        const chosen=candidates.filter(c=>c.kind==='structure-plan'&&c.eligible&&c.affordable!==false&&
          c.unitType!=='SAM Launcher'&&c.stage!=='team-opening').sort((a,b)=>a.priority-b.priority)[0];
        return select(chosen||wait(),candidates,chosen?'Spend only the surplus above the SAM defense reserve':
          'Preserve the emergency SAM upgrade reserve');
      }
      if(snapshot.domain==='structure-phase'&&defense&&(!defense.frontline||defense.stage==='first-sam')&&defense.stage!=='reserve')
        return select(eligible('building:normal')||wait(),candidates,'Prioritize the staged economy and first SAM');
      if(snapshot.domain==='reactive-sam-upgrade'){
        const chosen=candidates.filter(c=>c.kind==='reactive-sam-upgrade'&&c.eligible&&(c.canDefend||c.mode==='planned'))
          .sort((a,b)=>(a.priority??0)-(b.priority??0)||Number(BigInt(a.cost)-BigInt(b.cost)))[0];
        return select(chosen||wait(),candidates,chosen?(chosen.mode==='planned'?
          `Prepare existing SAM to level ${chosen.targetLevel}: ${chosen.reason}; preserve emergency reserve`:
          'Incoming strike becomes defendable with this timely SAM upgrade'):
          'Save for SAM preparation or hold without a proven useful emergency upgrade');
      }
      if(snapshot.domain==='opening-expansion'&&snapshot.openingExpansion?.applies){
        return select(snapshot.openingExpansion.ready?eligible('opening-expansion:wave'):wait(),candidates,
          snapshot.openingExpansion.ready?`Opening wave: send 20% at ${snapshot.openingExpansion.troops} troops`:
            `Opening expansion: rebuild to ${Math.ceil(snapshot.openingExpansion.threshold)} troops; ten-tick dispatch spacing`);
      }
      if (snapshot.domain==='naval-action' && (snapshot.supportPosture?.ready&&!snapshot.supportPosture.conserve||!opening ||
          !opening.frontline && opening.borderKnown && !opening.wilderness)) {
        const order=snapshot.supportPosture?.ready&&!snapshot.supportPosture.conserve?
          ['enemy-probe','surge','disconnected','nearby','crater','random-free','random-enemy','distant']:
          ['surge','enemy-probe','disconnected','nearby','crater','random-free','random-enemy','distant'];
        const chosen=order
          .map(purpose=>eligible('naval:'+purpose)).find(Boolean);
        return select(chosen||wait(),candidates,'After the opening, reinforce a landing or try a distant 1% enemy probe before local grabs');
      }
      if (snapshot.domain === 'team-opening-attack') {
        const mode = !safeOpening ? 'legacy' : !opening.borderKnown || opening.wilderness ? 'defer' : 'allow';
        return select(eligible('team-attack:' + mode) || wait(), candidates,
          mode === 'defer' ? 'Finish reachable wilderness before attacking countries' :
            mode === 'allow' ? 'Reachable wilderness exhausted; country expansion may proceed' : 'Retain the existing front-line opening rules');
      }
      if (snapshot.domain === 'attack-sequence' && safeOpening && (!opening.borderKnown || opening.wilderness)) {
        return select(opening.borderKnown ? eligible('sequence:river-crossing')||eligible('sequence:wilderness-only') || wait() : wait(), candidates,
          'Safe two-team opening: this pass may only expand reachable wilderness');
      }
      if(snapshot.domain==='attack-sequence'&&snapshot.supportPosture?.ready&&!snapshot.supportPosture.conserve){
        const chosen=['takeover','opening-bots','river-crossing','open-land','main','donation','opportunistic-boat','far-alliance','random-boat','enemy-alliance']
          .map(phase=>eligible('sequence:'+phase)).find(Boolean);
        return select(chosen||wait(),candidates,'Expand local territory and save for conquests before donating; support precedes distant naval searches');
      }
      const incomeOpening = safeOpening && !opening.sams && (opening.samEnabled ||
        opening.ports < opening.portTarget || opening.cities < opening.cityTarget || opening.factories < opening.factoryTarget);
      if (!defense && snapshot.domain === 'structure-plan' && snapshot.teamNaval?.island && snapshot.teamNaval.fleetNeeded &&
        opening?.economyReady && (!opening.samEnabled || opening.sams > 0)) {
        return select(wait(), candidates, 'Opening economy protected; save for the bounded island defense fleet');
      }
      if (snapshot.domain === 'structure-phase' && incomeOpening) {
        return select(eligible('building:normal') || wait(), candidates,
          'Save optional defense spending for the opening economy and first SAM');
      }
      if (snapshot.domain === 'structure-plan' && incomeOpening) {
        const plans = candidates.filter(c => c.stage === 'team-opening' && c.eligible);
        const byRole = role => plans.find(c => c.openingRole === role);
        const deficits = [];
        if (opening.ports < Math.min(1, opening.portTarget)) deficits.push('Port');
        if (opening.cities < opening.cityTarget) deficits.push('City');
        if (opening.ports < opening.portTarget) deficits.push('Port');
        if (opening.factories < opening.factoryTarget) deficits.push('Factory');
        if (deficits.length) {
          const plan = deficits.map(byRole).find(Boolean);
          return select(plan?.affordable ? plan : wait(), candidates,
            plan?.affordable ? 'Build the required physical opening economy' : 'Save for the required opening economy; retry unavailable placements next pass');
        }
        const sam = byRole('SAM');
        const optional = [opening.portTarget && opening.ports < 3 ? byRole('Port') : null,
          opening.cityTarget && opening.cities < 2 ? byRole('City') : null].find(p => p && sam &&
            BigInt(p.availableGold) >= BigInt(p.perceivedCost) + BigInt(sam.perceivedCost));
        return select(optional || (sam?.affordable ? sam : wait()), candidates,
          optional ? 'Add opening income while preserving the full first-SAM budget' :
            sam?.affordable ? 'Opening economy ready; construct the first owned SAM' : 'Opening economy ready; save for the first owned SAM');
      }
      if (snapshot.domain === 'donation-target') {
        const configured = snapshot.diplomacy?.threshold;
        const threshold = Number.isFinite(configured) ? Math.max(0, Math.min(.65, configured)) : .65;
        const targets = candidates.filter(candidate => candidate.kind === 'donation-target' &&
          candidate.eligible !== false && Number.isFinite(candidate.fill) && candidate.fill < threshold &&
          (candidate.frontline === true || candidate.bordersEnemy === true));
        targets.sort((a,b) => Number(b.frontline === true) - Number(a.frontline === true) || a.fill - b.fill);
        const chosen = targets[0];
        return select(chosen || candidates.find(candidate => candidate.skipDonation && candidate.eligible !== false) ||
          candidates.find(candidate => candidate.id === '$wait'), candidates,
          chosen ? `Donate to a front-line teammate below ${Math.round(threshold * 100)}% capacity` :
            `No front-line teammate below ${Math.round(threshold * 100)}% capacity; keep troops`);
      }
      if (snapshot.domain === 'structure-plan' && (!safeOpening || opening.samEnabled)) {
        const reserve = candidates.find(candidate => candidate.kind === 'structure-plan' &&
          candidate.firstSamReserve && candidate.eligible);
        if (reserve) {
          if (reserve.affordable) return select(reserve, candidates,
            'Build the first owned SAM before spending on other structures');
          const wait = candidates.find(candidate => candidate.id === '$wait');
          return select(wait, candidates, 'Save spendable gold for the first owned SAM');
        }
        const wait = candidates.find(candidate => candidate.id === '$wait');
        if (wait?.firstSamReserve) return select(wait, candidates,
          'Keep the first owned SAM budget after an unsuccessful placement; retry next pass');
      }
      if (snapshot.domain === 'structure-placement') {
        const choice = placementChoice(candidates);
        if (choice) return choice;
      }
      return legacyStrategy.decide(snapshot, candidates);
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createAdaptiveStrategy;
