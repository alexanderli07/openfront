'use strict';

// Require exact, nonnegative quoted amounts. Estimates, missing quotes and
// already-rounded large numbers cannot authorize spending.
function defenseEconomyAffordable({ gold, cost, reserve = 0n, pendingCost = 0n } = {}) {
  const exact = value => typeof value === 'bigint' && value >= 0n ? value :
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  const amounts = [gold, cost, reserve, pendingCost].map(exact);
  return amounts.every(value => value !== null) && amounts[0] >= amounts[1] + amounts[2] + amounts[3];
}

// Shared observations only: execution and reactive SAM upgrade decisions remain
// with the runtime. Construction satisfies physical economic goals, while the
// first SAM must finish before additional development begins.
function createDefenseEconomy({ units: U, buildAllowed, portWaterAccess }) {
  const states = new WeakMap();
  function observe(game, player, opening) {
    if (!opening || opening.samEnabled !== true) return null;
    const config = game.config();
    const enabled = type => type !== undefined && !config.isUnitDisabled(type) && (!buildAllowed || buildAllowed(type));
    if (!enabled(U.SAMLauncher)) return null;
    let state = states.get(player);
    if (!state || state.game !== game) {
      state = { game, reserveActivated: false };
      states.set(player, state);
    }
    const safe = opening.borderKnown === true && !opening.frontline;
    // A newly detected frontline keeps the ordinary policy. Once activated,
    // however, the reserve cannot disappear merely because geography changes.
    if (!safe && !state.reserveActivated && !state.recovering) return null;
    const physical=type=>(player.units(type)||[]).filter(unit=>!unit.isActive||unit.isActive());
    const active = type => physical(type).filter(unit=>
      type!==U.Port||!portWaterAccess||portWaterAccess.assess(game,unit.tile()).allowed);
    const samUnits = active(U.SAMLauncher);
    const counts = { ports: active(U.Port).length, cities: active(U.City).length,
      factories: active(U.Factory).length, sams: samUnits.length };
    const samCompleted = samUnits.some(unit => !unit.isUnderConstruction || !unit.isUnderConstruction());
    const coastal = opening.portTarget > 0 && enabled(U.Port);
    const initial = { ports: coastal ? 2 : 0, cities: enabled(U.City) ? (coastal ? 1 : 2) : 0,
      factories: !coastal && enabled(U.Factory) ? 1 : 0, sams: 1 };
    const developed = { ports: coastal ? 4 : 0, cities: enabled(U.City) ? (coastal ? 3 : 4) : 0,
      factories: !coastal && enabled(U.Factory) ? 3 : 0, sams: 1 };
    const meetsEconomy = targets => ['ports', 'cities', 'factories'].every(key => counts[key] >= targets[key]);
    const physicalCounts={ports:physical(U.Port).length,cities:physical(U.City).length,factories:physical(U.Factory).length};
    const lostEconomy=state.lastPhysical&&Object.keys(physicalCounts).some(key=>physicalCounts[key]<state.lastPhysical[key]);
    if(state.reserveActivated&&lostEconomy&&!meetsEconomy(developed)){
      state.reserveActivated=false;state.recovering=true;
    }
    state.lastPhysical=physicalCounts;
    const nextType = targets => {
      const sequence = coastal ? [
        ['ports', U.Port], ['cities', U.City], ['ports', U.Port],
        ['ports', U.Port], ['cities', U.City], ['ports', U.Port], ['cities', U.City]
      ] : [
        ['cities', U.City], ['cities', U.City], ['factories', U.Factory],
        ['cities', U.City], ['factories', U.Factory], ['cities', U.City], ['factories', U.Factory]
      ];
      const seen = { ports: 0, cities: 0, factories: 0 };
      for (const [key, type] of sequence) {
        seen[key]++;
        if (counts[key] < Math.min(seen[key], targets[key])) return type;
      }
      return null;
    };
    let stage, requiredType = null, targetCounts;
    if (state.reserveActivated && samCompleted) {
      stage = 'reserve'; targetCounts = developed;
      requiredType = nextType(developed);
    } else if (!state.reserveActivated && !meetsEconomy(initial)) {
      stage = 'initial-economy'; targetCounts = initial; requiredType = nextType(initial);
    } else if (!samCompleted) {
      stage = 'first-sam'; targetCounts = initial;
      requiredType = counts.sams ? null : U.SAMLauncher;
    } else if (!meetsEconomy(developed)) {
      stage = 'development'; targetCounts = developed; requiredType = nextType(developed);
    } else {
      state.reserveActivated = true;state.recovering=false;
      stage = 'reserve'; targetCounts = developed;
    }
    return { stage,recovering:!!state.recovering, reserve: state.reserveActivated ? 3000000n : 0n,
      requiredType: safe || state.recovering || state.reserveActivated&&stage==='first-sam' ? requiredType : null, targetCounts, counts,
      waitingForSam: stage === 'first-sam' && counts.sams > 0,
      samUpgradeReactiveOnly: true, frontline: !!opening.frontline };
  }
  return { observe, affordable: defenseEconomyAffordable };
}

createDefenseEconomy.affordable = defenseEconomyAffordable;
if (typeof module !== 'undefined' && module.exports) module.exports = createDefenseEconomy;
