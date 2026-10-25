'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const createEngine = require('../src/brain/engine');
const createLegacyStrategy = require('../src/brain/legacy-strategy');
const createAdaptiveStrategy = require('../src/brain/adaptive-strategy');
const createRuntime = require('../src/brain/runtime');
const file = require('node:path').join(__dirname, '../src/brain/structure-planner.js');
const createPlanner = fs.existsSync(file) ? require(file) : null;
const units = Object.fromEntries(['City', 'Port', 'Factory', 'SAMLauncher', 'MissileSilo', 'AtomBomb', 'HydrogenBomb', 'MIRV'].map(t => [t, t]));

function fixture(options = {}) {
  const attempts = [], disabled = new Set(options.disabled || []);
  let active = true;
  const player = { id: () => 'self', gold: () => options.gold ?? 1000000n, troops: () => 500,
    numTilesOwned: () => 1000, units: () => [], incomingAttacks: () => [], outgoingAttacks: () => [] };
  const config = { isUnitDisabled: t => disabled.has(t), gameConfig: () => ({}) };
  const game = { myPlayer: () => player, ticks: () => 1, inSpawnPhase: () => false, config: () => config };
  const actor = { game, player, placementsCount: options.first ? 0 : 1,
    ownedLevels: type => type === 'City' ? options.cities ?? 3 : type === 'SAMLauncher' ? options.sams ?? 0 : 0,
    hasHighStartingGold: () => !!options.highGold, isHighNationDensity: () => !!options.dense,
    samThreatLevels: () => 1, samTargetLevels: () => options.samTarget ?? 1,
    getPerceivedCost: type => type === 'SAMLauncher' ? options.samCost ?? 1500000n : 100n,
    shouldBuildStructure: () => options.ratios !== false,
    maybeSpawnStructure: async type => { attempts.push(type); return options.succeed === undefined || options.succeed === type; } };
  const settings = { samDefense: !!options.samDefense };
  const planner = createPlanner({ units, settings: () => settings, difficulty: () => 'Impossible',
    spendableGold: () => options.spendableGold ?? options.gold ?? 1000000n });
  const strategies = [...(options.strategies || [])];
  if (options.adaptive) strategies.push(createAdaptiveStrategy(createLegacyStrategy()));
  const runtime = createRuntime({ createEngine, createLegacyStrategy, structurePlanner: planner,
    settings: () => settings, enabled: () => active, isCurrent: () => active, isPublic: () => false,
    emitIntent: () => true, strategies, defaultStrategy: options.adaptive ? 'adaptive-v1' : 'legacy-v1' });
  const bot = { mg: game, player, structureBehavior: actor };
  runtime.attach(bot); runtime.begin(bot); runtime.attachBehaviors(bot);
  const context = { cityLevels: options.cities ?? 3, cityDisabled: disabled.has('City'), sharedWater: options.coastal !== false };
  return { actor, runtime, attempts, run: () => runtime.planStructures(actor, context), stop: () => { active = false; } };
}

test('structure planner exists', () => assert.equal(typeof createPlanner, 'function'));
test('adaptive policy saves for the first due SAM instead of spending on other structures', async () => {
  const f = fixture({ adaptive: true, gold: 1000000n, samCost: 1500000n });
  assert.equal(await f.run(), false);
  assert.deepEqual(f.attempts, []);
  const decision = f.runtime.inspect().records.find(r => r.kind === 'decision' && r.snapshot.domain === 'structure-plan');
  assert.equal(decision.selectedId, '$wait');
  assert.match(decision.reason, /first owned SAM/i);
});
test('adaptive policy builds an affordable first SAM before ports and factories', async () => {
  const f = fixture({ adaptive: true, gold: 2000000n, samCost: 1500000n });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.attempts, ['SAMLauncher']);
});
test('first-SAM reserve releases after one owned SAM', async () => {
  const f = fixture({ adaptive: true, sams: 1, succeed: 'Port' });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.attempts, ['Port']);
});
test('failed first-SAM placement retains its budget and retries on the next pass', async () => {
  const f = fixture({ adaptive: true, gold: 2000000n, succeed: 'Port' });
  assert.equal(await f.run(), false);
  assert.deepEqual(f.attempts, ['SAMLauncher']);
  assert.equal(await f.run(), false);
  assert.deepEqual(f.attempts, ['SAMLauncher', 'SAMLauncher']);
  const decisions = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  assert.equal(decisions.at(-1).selectedId, '$wait');
});
test('batch includes competing plans and explains excluded landlocked port', async () => {
  const f = fixture({ coastal: false }); await f.run();
  assert.deepEqual(f.attempts, ['Factory']);
  const d = f.runtime.inspect().records.find(r => r.kind === 'decision');
  assert.equal(d.snapshot.domain, 'structure-plan');
  assert.ok(d.candidates.some(c => c.unitType === 'City'));
  const port = d.candidates.find(c => c.unitType === 'Port' && c.stage === 'normal');
  assert.equal(port.eligible, false); assert.match(port.reason, /water/i);
});
test('failed placement selects the next plan and stops after success', async () => {
  const f = fixture({ succeed: 'SAMLauncher' }); assert.equal(await f.run(), true);
  assert.deepEqual(f.attempts, ['Port', 'Factory', 'SAMLauncher']);
  assert.equal(f.runtime.inspect().records.filter(r => r.kind === 'plan-result').length, 3);
});
test('original first-placement SAM and defense priority are preserved', async () => {
  for (const options of [{ first: true, highGold: true }, { samDefense: true }]) {
    const f = fixture(options); await f.run(); assert.deepEqual(f.attempts, ['SAMLauncher']);
  }
});
test('original high-density special attempt can retry same type in normal stage', async () => {
  const f = fixture({ dense: true, cities: 0, succeed: 'City' }); await f.run();
  assert.deepEqual(f.attempts, ['Port', 'Port', 'Factory', 'SAMLauncher', 'MissileSilo', 'City']);
});
test('disabled weapons exclude SAM/silo, unmet ratios leave city fallback', async () => {
  const f = fixture({ disabled: ['AtomBomb', 'HydrogenBomb', 'MIRV'], succeed: 'City' }); await f.run();
  assert.deepEqual(f.attempts, ['Port', 'Factory', 'City']);
  const g = fixture({ ratios: false }); await g.run(); assert.deepEqual(g.attempts, ['City']);
});
test('replacement policy can choose city ahead of original port', async () => {
  const f = fixture({ strategies: [{ id: 'city-first', version: '1', decide: (s, candidates) => ({
    selectedId: candidates.find(c => c.unitType === 'City' && c.eligible)?.id ?? null, reason: 'Test city preference' }) }] });
  f.runtime.select('city-first'); await f.run(); assert.deepEqual(f.attempts, ['City']);
});
test('deliberate wait does not attempt a building', async () => {
  const f = fixture({ strategies: [{ id: 'wait', version: '1', decide: () => ({ selectedId: '$wait', reason: 'Save' }) }] });
  f.runtime.select('wait'); assert.equal(await f.run(), false); assert.deepEqual(f.attempts, []);
});
test('policy cannot execute an ineligible plan', async () => {
  const f = fixture({ coastal: false, strategies: [{ id: 'bad-port', version: '1', decide: (s, cs) => ({
    selectedId: cs.find(c => c.unitType === 'Port' && c.stage === 'normal').id, reason: 'Invalid port' }) }] });
  f.runtime.select('bad-port'); assert.equal(await f.run(), false); assert.deepEqual(f.attempts, []);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'plan-blocked'));
});
test('stop during an asynchronous attempt prevents retries', async () => {
  const f = fixture(); f.actor.maybeSpawnStructure = async type => { f.attempts.push(type); f.stop(); return false; };
  assert.equal(await f.run(), false); assert.deepEqual(f.attempts, ['Port']);
});
test('plan execution exceptions propagate once and are recorded', async () => {
  const f = fixture(); const error = new Error('placement failed');
  f.actor.maybeSpawnStructure = async () => { throw error; };
  await assert.rejects(f.run(), e => e === error);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'plan-result' && r.status === 'threw'));
});
test('actual command decision links back to the selected building plan', async () => {
  const f = fixture();
  f.actor.maybeSpawnStructure = async type => f.runtime.build(f.actor, 'StructureBehavior', { sendBuildOrUpgrade: () => true }, { type });
  await f.run();
  const decisions = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  assert.equal(decisions[1].candidates[0].parentDecisionId, decisions[0].decisionId);
});

test('remaining eligibility is refreshed after an asynchronous placement failure', async () => {
  for (const initiallyNeeded of [true, false]) {
    const f = fixture(); let factoryNeeded = initiallyNeeded;
    f.actor.shouldBuildStructure = type => type !== 'Factory' || factoryNeeded;
    f.actor.maybeSpawnStructure = async type => {
      f.attempts.push(type);
      if (type === 'Port') { await Promise.resolve(); factoryNeeded = !initiallyNeeded; return false; }
      return true;
    };
    await f.run();
    assert.deepEqual(f.attempts, ['Port', initiallyNeeded ? 'SAMLauncher' : 'Factory']);
  }
});

test('exhausted plans record a consistent explicit wait decision', async () => {
  const f = fixture({ succeed: 'never' }); await f.run();
  const last = f.runtime.inspect().records.filter(r => r.kind === 'decision').at(-1);
  assert.equal(last.selectedId, '$wait');
  assert.equal(last.evaluations.find(e => e.id === '$wait').verdict, 'select');
});
