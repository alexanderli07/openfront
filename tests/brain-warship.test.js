'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const file = '../src/brain/warship-patrol-planner';
const create = fs.existsSync(require('node:path').join(__dirname, file + '.js')) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function fixture(choose, success = 'loss-zone') {
  const calls = [], records = [];
  const smart = { serviced: new Map() };
  const actor = { game: { x: x => x, y: () => 0 },
    moveBestWarshipTo(tile, kind) { calls.push(kind); return kind === success; } };
  const sites = ['invasion', 'trade-lane', 'loss-zone'].map((kind, i) => ({ kind, tile: i * 40 }));
  const hooks = { allowed: () => true,
    choose: candidates => ({ ...((choose || (c => legacy().decide({ domain: 'warship-patrol' }, c)))(candidates)), decisionId: 1 }),
    execute: (id, fn) => fn(), record: (kind, data) => records.push({ kind, ...data }) };
  return { calls, records, smart, hooks, run: () => create().run(actor, sites, { smart, tick: 100, cellSize: 40, serviceTicks: 90 }, hooks) };
}
test('warship patrol planner exists', () => assert.equal(typeof create, 'function'));
test('patrol preserves fallback order and services only successful zone', () => {
  const f = fixture(); assert.equal(f.run(), undefined);
  assert.deepEqual(f.calls, ['invasion', 'trade-lane', 'loss-zone']);
  assert.deepEqual([...f.smart.serviced], [['2,0', 100]]);
});
test('recently serviced zone skips; exact service boundary is eligible', () => {
  const f = fixture(null, 'trade-lane'); f.smart.serviced.set('0,0', 11); f.smart.serviced.set('1,0', 10);
  f.run(); assert.deepEqual(f.calls, ['trade-lane']);
});
test('policy may choose another zone without attempting earlier zones', () => {
  const f = fixture(c => ({ selectedId: c.find(c => c.purpose === 'loss-zone').id }));
  f.run(); assert.deepEqual(f.calls, ['loss-zone']);
});
test('policy wait logs wait and changes no service state', () => {
  const f = fixture(() => ({ selectedId: '$wait', reason: 'hold' })); f.run();
  assert.deepEqual(f.calls, []); assert.equal(f.smart.serviced.size, 0);
  assert.ok(f.records.some(r => r.status === 'wait'));
});
test('stale controller stops before movement', () => {
  const f = fixture(); f.hooks.allowed = () => false; f.run(); assert.deepEqual(f.calls, []);
});

function integrated(source, success, serviced = []) {
  const vm = require('node:vm');
  const calls = [];
  const player = { units: () => [], id: () => 'self', smallID: () => 1 };
  const game = { units: () => [], myPlayer: () => player, ticks: () => 100,
    config: () => ({ isUnitDisabled: () => false }), x: x => x, y: () => 0,
    isValidCoord: () => true, ref: x => x, isWater: () => true };
  const runtime = require('../src/brain/runtime')({ createEngine: require('../src/brain/engine'),
    createLegacyStrategy: legacy, warshipPatrolPlanner: create(),
    warshipThreatPlanner: require('../src/brain/warship-threat-planner')({settings:()=>({})}), enabled: () => true,
    isCurrent: () => true, isPublic: () => false, settings: () => ({}), emitIntent: (...args) => { calls.push(args); return true; } });
  const start = source.indexOf('class WarshipBehavior{');
  const end = source.indexOf('"use strict";', start);
  const C = vm.runInNewContext(source.slice(start, end) + ';WarshipBehavior', {
    state: { settings: {} }, UNIT: {}, Map, Set, performance: { now: () => 10000 }, ofhBrainRuntime: runtime
  });
  const actor = new C({}, game, player, {});
  actor.findInvasionThreat = () => ({ tile: 0, kind: 'invasion' });
  actor.findLossZone = () => 80;
  const smart = actor.ensureSmartState(); smart.raids.push({ x: 40, y: 0, at: 99 });
  for (const entry of serviced) smart.serviced.set(...entry);
  actor.moveBestWarshipTo = (tile, kind) => {
    calls.push([tile, kind]);
    if (kind !== success) return false;
    runtime.intent(actor, 'WarshipBehavior', 'move', [1], tile); return true;
  };
  const bot = { mg: game, warshipBehavior: actor }; runtime.attach(bot); runtime.attachBehaviors(bot);
  const result = actor.smartWarshipPatrol();
  return { result, calls, serviced: [...smart.serviced], runtime, actor };
}
for (const success of ['invasion', 'trade-lane', 'loss-zone', 'none']) {
  for (const serviced of [[], [['0,0', 99]], [['0,0', 10], ['1,0', 11]]]) {
    test(`original patrol parity: ${success}, ${JSON.stringify(serviced)}`, () => {
      const original = fs.readFileSync(require('node:path').join(__dirname, '../vendor/openfront-helper-1.84.0.user.js'), 'utf8');
      const generated = require('../scripts/build').buildSource().source;
      const a = integrated(original, success, serviced), b = integrated(generated, success, serviced);
      assert.equal(b.result, a.result); assert.deepEqual(b.calls, a.calls); assert.deepEqual(b.serviced, a.serviced);
    });
  }
}
test('patrol command has decision parent, clears synchronously and replays', () => {
  const f = integrated(require('../scripts/build').buildSource().source, 'invasion');
  f.runtime.intent(f.actor, 'WarshipBehavior', 'move', [1], 99);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const plan = ds.find(d => d.snapshot.domain === 'warship-patrol');
  const commands = ds.filter(d => d.candidates[0].kind === 'intent');
  assert.equal(commands[0].candidates[0].parentDecisionId, plan.decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId, undefined);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
