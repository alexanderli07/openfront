'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scenarios = require('./fixtures/strategy-scenarios.json');
const createLegacyStrategy = require('../src/brain/legacy-strategy.js');
const createAdaptiveStrategy = require('../src/brain/adaptive-strategy.js');
const { compareScenarios } = require('../scripts/compare-strategies.js');

test('adaptive strategy delegates unchanged scenarios and makes only expected gameplay differences', () => {
  const legacy = createLegacyStrategy();
  const adaptive = createAdaptiveStrategy(legacy);
  assert.deepEqual({ id: adaptive.id, name: adaptive.name, version: adaptive.version }, {
    id: 'adaptive-v1', name: 'Adaptive algorithm', version: '1.14.1-team-support-range'
  });
  for (const scenario of scenarios) {
    const original = legacy.decide(scenario.snapshot, scenario.candidates);
    const changed = adaptive.decide(scenario.snapshot, scenario.candidates);
    if (scenario.expectedAdaptiveChoice) assert.equal(changed.selectedId, scenario.expectedAdaptiveChoice, scenario.name);
    else assert.deepEqual(changed, original, scenario.name);
  }
});

test('scenario comparison reports phase and choice differences without mutating fixtures', () => {
  const before = JSON.stringify(scenarios);
  const legacy = createLegacyStrategy();
  const adaptive = createAdaptiveStrategy(legacy);
  const baseline = compareScenarios(legacy, adaptive, scenarios);
  assert.equal(baseline.unexpected, 0);
  assert.equal(baseline.rows.length, scenarios.length);
  assert.ok(baseline.rows.every(row => row.expectedMatch));
  const changed = compareScenarios(legacy, {
    id: 'changed', version: '1', decide(_snapshot, candidates) {
      return { selectedId: candidates.at(-1).id, reason: 'test change' };
    }
  }, scenarios);
  assert.ok(changed.unexpected > 0);
  assert.ok(changed.rows.some(row => !row.expectedMatch && ['early', 'mid', 'late'].includes(row.phase)));
  assert.equal(JSON.stringify(scenarios), before);
});

test('adaptive strategy rejects a missing fallback policy', () => {
  assert.throws(() => createAdaptiveStrategy(), /legacy strategy/i);
});

test('adaptive strategy reserves for the first SAM and delegates after it exists', () => {
  const legacy = createLegacyStrategy();
  const adaptive = createAdaptiveStrategy(legacy);
  const wait = { id: '$wait', kind: 'wait', eligible: true, priority: 999, reason: 'Wait' };
  const port = { id: 'structure:normal:Port', kind: 'structure-plan', unitType: 'Port',
    eligible: true, priority: 0, reason: 'Port due' };
  const sam = { id: 'structure:normal:SAMLauncher', kind: 'structure-plan', unitType: 'SAMLauncher',
    eligible: true, priority: 2, reason: 'SAM due', firstSamReserve: true, affordable: false };
  assert.equal(adaptive.decide({ domain: 'structure-plan' }, [port, sam, wait]).selectedId, '$wait');
  assert.equal(adaptive.decide({ domain: 'structure-plan' }, [port, { ...sam, affordable: true }, wait]).selectedId, sam.id);
  assert.equal(adaptive.decide({ domain: 'structure-plan' }, [port, { ...sam, firstSamReserve: false }, wait]).selectedId, port.id);
});

function placement(overrides) {
  return { id: `placement:${overrides.tile}`, kind: 'structure-placement', unitType: 'City',
    tile: overrides.tile, eligible: true, priority: overrides.tile, originalScore: 0, safeScore: 0,
    ownedFactoryRoutes: 0, alliedFactoryRoutes: 0, routeClusters: 0, futureRouteCapacity: 0,
    ownSamCoverage: 0, alliedSamCoverage: 0, hasOwnSam: false, reason: 'candidate', ...overrides };
}

test('adaptive placement keeps spread score primary before the first SAM', () => {
  const adaptive = createAdaptiveStrategy(createLegacyStrategy());
  const spread = placement({ tile: 1, originalScore: 100 });
  const line = placement({ tile: 2, originalScore: 20, alliedFactoryRoutes: 1 });
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'wait' };
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [line, spread, wait]).selectedId, spread.id);
});

test('adaptive placement groups on owned or allied factory lines after the first SAM', () => {
  const adaptive = createAdaptiveStrategy(createLegacyStrategy());
  const spread = placement({ tile: 1, hasOwnSam: true, originalScore: 1000 });
  const owned = placement({ tile: 2, hasOwnSam: true, originalScore: 5, ownedFactoryRoutes: 1 });
  const allied = placement({ tile: 3, hasOwnSam: true, originalScore: 6, alliedFactoryRoutes: 1 });
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'wait' };
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [spread, owned, wait]).selectedId, owned.id);
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [spread, allied, wait]).selectedId, allied.id);
});

test('post-SAM route ties prefer own protection, then factory network extension', () => {
  const adaptive = createAdaptiveStrategy(createLegacyStrategy());
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'wait' };
  const alliedCover = placement({ tile: 1, hasOwnSam: true, ownedFactoryRoutes: 1, alliedSamCoverage: 2 });
  const ownCover = placement({ tile: 2, hasOwnSam: true, alliedFactoryRoutes: 1, ownSamCoverage: 1 });
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [alliedCover, ownCover, wait]).selectedId, ownCover.id);
  const cluster = placement({ tile: 3, unitType: 'Factory', hasOwnSam: true, ownedFactoryRoutes: 1,
    routeClusters: 2, futureRouteCapacity: 3 });
  const capacity = placement({ tile: 4, unitType: 'Factory', hasOwnSam: true, ownedFactoryRoutes: 1,
    routeClusters: 1, futureRouteCapacity: 50, originalScore: 999 });
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [capacity, cluster, wait]).selectedId, cluster.id);
  const moreCapacity = placement({ tile: 5, unitType: 'Factory', hasOwnSam: true, ownedFactoryRoutes: 1,
    routeClusters: 2, futureRouteCapacity: 9 });
  assert.equal(adaptive.decide({ domain: 'structure-placement' }, [cluster, moreCapacity, wait]).selectedId, moreCapacity.id);
});

test('established factory economy uses factory routes before its first SAM, with rear safety first',()=>{
 const policy=createAdaptiveStrategy(createLegacyStrategy());
 const candidates=[{id:'spread',kind:'structure-placement',unitType:'City',eligible:true,originalScore:999,hasOwnSam:false,factoryLinePriority:true},
 {id:'line',kind:'structure-placement',unitType:'City',eligible:true,originalScore:1,hasOwnSam:false,factoryLinePriority:true,alliedFactoryRoutes:1}];
 assert.equal(policy.decide({domain:'structure-placement'},candidates).selectedId,'line');
 candidates[0].frontline=true;candidates[0].rearBand=3;candidates[1].frontline=true;candidates[1].rearBand=0;
 assert.equal(policy.decide({domain:'structure-placement'},candidates).selectedId,'spread');
});
test('SAMs prefer proximity to their primary economy anchors over total structure coverage',()=>{
 const policy=createAdaptiveStrategy(createLegacyStrategy());
 for(const kind of ['Port','City']){
 const cs=[{id:'center',kind:'structure-placement',unitType:'SAM Launcher',eligible:true,originalScore:999,
 samAnchorKind:kind,samAnchorDistance:40,samAnchorProtection:0},
 {id:'near',kind:'structure-placement',unitType:'SAM Launcher',eligible:true,originalScore:1,
 samAnchorKind:kind,samAnchorDistance:5,samAnchorProtection:0}];
 assert.equal(policy.decide({domain:'structure-placement'},cs).selectedId,'near');
 }
});
