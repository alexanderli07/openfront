'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/naval-landing-planner.js');
const createPlanner = fs.existsSync(file) ? require(file) : null;
const createRuntime = require('../src/brain/runtime');
const createEngine = require('../src/brain/engine');
const legacy = require('../src/brain/legacy-strategy');
function fixture(options = {}) {
  let active = true; const probes = [], diagnostics = [];
  const player = { id: () => 'self', gold: () => 100, troops: () => 100,
    units: () => [], incomingAttacks: () => [], outgoingAttacks: () => [], numTilesOwned: () => 20 };
  const game = { myPlayer: () => player, ticks: () => 1, inSpawnPhase: () => false, config: () => ({ gameConfig: () => ({}) }) };
  const actor = { game, player, boatTargetTaken: tile => (options.taken || []).includes(tile) };
  const runtime = createRuntime({ createEngine, createLegacyStrategy: legacy,
    navalLandingPlanner: createPlanner(), enabled: () => active, isCurrent: () => active, isPublic: () => false,
    settings: () => ({}), strategies: options.strategies || [],
    probeLanding: async (actor, tile, fallback) => {
      probes.push({ tile, fallback });
      if (options.stopOnProbe) active = false;
      if (options.error) throw options.error;
      return options.results?.[tile] ?? false;
    }, landingDiagnostics: data => diagnostics.push(data) });
  const bot = { mg: game, player, attackBehavior: actor };
  runtime.attach(bot); runtime.begin(bot); runtime.attachBehaviors(bot);
  return { runtime, actor, probes, diagnostics, stop: () => { active = false; },
    run: (sites, context = {}) => runtime.planNavalLanding(actor, sites, { mode: 'distant', probeCap: 12, ...context }),
    decisions: () => runtime.inspect().records.filter(r => r.kind === 'decision') };
}
test('naval landing planner exists', () => assert.equal(typeof createPlanner, 'function'));
test('nearest-first failures preserve probe order and tile zero success', async () => {
  const f = fixture({ results: { 0: 42 } });
  assert.equal(await f.run([{ tile: 8, dist: 1 }, { tile: 0, dist: 2 }]), 0);
  assert.deepEqual(f.probes.map(p => p.tile), [8, 0]);
  assert.deepEqual(f.diagnostics[0], { enemies: 2, probed: 2, probeCap: 12, timedOut: 0, found: true });
});
test('taken sites consume rank slots without probing beyond original cap', async () => {
  const f = fixture({ taken: [1], results: { 3: 10 } });
  assert.equal(await f.run([{ tile: 1 }, { tile: 2 }, { tile: 3 }], { probeCap: 2 }), null);
  assert.deepEqual(f.probes.map(p => p.tile), [2]);
});
test('timeout and unreachable outcomes are distinct in distant diagnostics', async () => {
  const f = fixture({ results: { 1: '__probe_timeout__', 3: 7 } });
  assert.equal(await f.run([{ tile: 1 }, { tile: 2 }, { tile: 3 }]), 3);
  assert.equal(f.diagnostics[0].timedOut, 1);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'landing-probe' && r.status === 'timeout'));
  const outcome = f.runtime.inspect().records.filter(r => r.kind === 'landing-probe').at(-1);
  assert.equal(outcome.probed, 3); assert.equal(outcome.timedOut, 1);
});
test('disconnected mode uses false timeout fallback and leaves distant diagnostics alone', async () => {
  const f = fixture(); await f.run([{ tile: 1 }], { mode: 'disconnected' });
  assert.equal(f.probes[0].fallback, false); assert.deepEqual(f.diagnostics, []);
});
test('alternate policy chooses a later landing and wait makes no probes', async () => {
  for (const hold of [false, true]) {
    const f = fixture({ results: { 2: 20 }, strategies: [{ id: 'custom', version: '1', decide: (s, cs) => ({
      selectedId: hold ? '$wait' : cs.find(c => c.tile === 2).id, reason: 'Test choice' }) }] });
    f.runtime.select('custom'); assert.equal(await f.run([{ tile: 1 }, { tile: 2 }]), hold ? null : 2);
    assert.equal(f.probes.length, hold ? 0 : 1);
  }
});
test('stale results cannot return a landing after an async probe', async () => {
  const f = fixture({ stopOnProbe: true, results: { 1: 10 } });
  assert.equal(await f.run([{ tile: 1 }, { tile: 2 }]), null);
  assert.equal(f.probes.length, 1);
});
test('large cap refills windows and retains legacy success beyond entry79', async () => {
  const f = fixture({ results: { 89: 10 } });
  assert.equal(await f.run(Array.from({ length: 100 }, (_, i) => ({ tile: i, dist: i })), { probeCap: 100 }), 89);
  assert.equal(f.probes.length, 90);
  assert.ok(f.decisions().every(d => d.candidates.length <= 80));
  assert.equal(f.decisions()[0].snapshot.navalLanding.windowHidden, 21);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
test('fractional cap preserves original index comparison and empty pool records wait', async () => {
  const f = fixture(); await f.run([{ tile: 1 }, { tile: 2 }, { tile: 3 }], { probeCap: 1.5 });
  assert.equal(f.probes.length, 2);
  const g = fixture(); assert.equal(await g.run([]), null);
  assert.equal(g.decisions()[0].selectedId, '$wait');
});
test('probe exceptions retain identity and are traced', async () => {
  const error = new Error('probe failed'); const f = fixture({ error });
  await assert.rejects(f.run([{ tile: 1 }]), e => e === error);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'landing-probe' && r.status === 'threw'));
});
