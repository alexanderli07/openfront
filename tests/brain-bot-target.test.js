'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/bot-target-planner.js');
const createPlanner = fs.existsSync(file) ? require(file) : null;
const createRuntime = require('../src/brain/runtime');
const createEngine = require('../src/brain/engine');
const createLegacyStrategy = require('../src/brain/legacy-strategy');
function target(id, troops = 100, tiles = 100, structured = false) {
  return { id: () => id, isPlayer: () => true, type: () => 'Bot', troops: () => troops,
    numTilesOwned: () => tiles, units: () => structured ? [{ type: () => 'City' }] : [],
    isAlive: () => true, friendly: false };
}
function fixture(targets, options = {}) {
  let active = true; const sent = []; let limitCalls = 0;
  const player = { nearby: () => targets, isFriendly: t => t.friendly, id: () => 'self',
    units: () => [], troops: () => 1000, gold: () => 100n, numTilesOwned: () => 1000,
    incomingAttacks: () => [], outgoingAttacks: () => [] };
  const game = { myPlayer: () => player, ticks: () => 1, inSpawnPhase: () => false,
    config: () => ({ gameConfig: () => ({}) }) };
  const actor = { player, game, botAttackTroopsSent: 999,
    getBotAttackMaxParallelism: () => { limitCalls++; return options.limit ?? 3; },
    async sendAttack(t) { sent.push(t); this.botAttackTroopsSent += options.troopsSent ?? 10; return options.result ?? true; } };
  const runtime = createRuntime({ createEngine, createLegacyStrategy,
    botTargetPlanner: createPlanner({ botType: 'Bot', attackStructures: new Set(['City']) }),
    settings: () => ({}), enabled: () => active, isCurrent: () => active, isPublic: () => false,
    strategies: options.strategies || [], emitIntent: () => true });
  const bot = { mg: game, player, attackBehavior: actor };
  runtime.attach(bot); runtime.begin(bot); runtime.attachBehaviors(bot);
  return { actor, runtime, sent, run: () => runtime.planBotTargets(actor), stop: () => { active = false; },
    limitCalls: () => limitCalls, ids: () => sent.map(t => t.id()) };
}
test('bot-target planner is available', () => assert.equal(typeof createPlanner, 'function'));
test('structure priority precedes troop density with stable ties and exact target identity', async () => {
  const a = target('plain', 1), b = target('city-dense', 200, 100, true),
    c = target('city-weak', 50, 100, true), d = target('tie', 50, 100, true);
  const f = fixture([a, b, c, d]); assert.equal(await f.run(), true);
  assert.deepEqual(f.sent, [c, d, b]); assert.equal(f.limitCalls(), 1);
  const trace = f.runtime.inspect(); const first = trace.records.find(r => r.kind === 'decision');
  assert.equal(first.snapshot.domain, 'bot-target');
  assert.equal(first.candidates[0].targetId, 'city-weak');
  assert.equal(first.candidates[0].troopDensity, 0.5);
  assert.ok(f.runtime.replay('legacy-v1', trace).every(r => r.sameChoice));
});
test('friendly, nonplayer and non-Bot targets are excluded', async () => {
  const friendly = target('friend'); friendly.friendly = true;
  const human = target('human'); human.type = () => 'Human';
  const land = { isPlayer: () => false };
  const f = fixture([friendly, human, land, target('bot')]); await f.run(); assert.deepEqual(f.ids(), ['bot']);
});
test('empty pool records wait without resetting old sent counter or sampling difficulty', async () => {
  const f = fixture([]); assert.equal(await f.run(), false);
  assert.equal(f.actor.botAttackTroopsSent, 999); assert.equal(f.limitCalls(), 0);
  assert.equal(f.runtime.inspect().records.find(r => r.kind === 'decision').selectedId, '$wait');
});
test('failed attempts consume slots; return follows sent-troop counter, not executor result', async () => {
  const f = fixture([target('a'), target('b'), target('c')], { limit: 2, troopsSent: 0, result: true });
  assert.equal(await f.run(), false); assert.deepEqual(f.ids(), ['a', 'b']);
});
test('replacement policy can choose a different target then wait', async () => {
  const f = fixture([target('a'), target('b')], { strategies: [{ id: 'choose-b', version: '1',
    decide: (s, cs) => ({ selectedId: cs.find(c => c.targetId === 'b')?.id ?? '$wait', reason: 'Prefer b, then hold' }) }] });
  f.runtime.select('choose-b'); await f.run(); assert.deepEqual(f.ids(), ['b']);
});
test('waiting never attacks and resets a nonempty wave counter', async () => {
  const f = fixture([target('a')], { strategies: [{ id: 'hold', version: '1', decide: () => ({ selectedId: '$wait', reason: 'Hold' }) }] });
  f.runtime.select('hold'); assert.equal(await f.run(), false); assert.equal(f.actor.botAttackTroopsSent, 0);
  assert.deepEqual(f.sent, []);
});
test('100-target wave refills bounded windows without loss or duplication', async () => {
  const f = fixture(Array.from({ length: 105 }, (_, i) => target(String(i))), { limit: 100 });
  await f.run(); assert.deepEqual(f.ids(), Array.from({ length: 100 }, (_, i) => String(i)));
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  assert.ok(ds.every(d => d.candidates.length <= 80));
  assert.equal(ds[0].snapshot.botTargets.hiddenTargets, 26);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
test('stopping mid-wave prevents further attempts', async () => {
  const f = fixture([target('a'), target('b')]);
  f.actor.sendAttack = async t => { f.sent.push(t); f.stop(); return false; };
  await f.run(); assert.deepEqual(f.ids(), ['a']);
});
test('target becoming friendly is skipped and consumes its original slot', async () => {
  const a = target('a'), b = target('b'); const f = fixture([a, b, target('c')], { limit: 2 });
  f.actor.sendAttack = async t => { f.sent.push(t); b.friendly = true; return false; };
  await f.run(); assert.deepEqual(f.ids(), ['a']);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'plan-result' && r.status === 'skipped'));
});
test('exceptions retain identity and terminate the wave', async () => {
  const f = fixture([target('a'), target('b')]); const error = new Error('dispatch failed');
  f.actor.sendAttack = async () => { throw error; };
  await assert.rejects(f.run(), e => e === error);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'plan-result' && r.status === 'threw'));
});
test('command submission links to target decision and clears link afterward', async () => {
  const f = fixture([target('a')]);
  f.actor.sendAttack = async t => f.runtime.intent(f.actor, 'AttackBehavior', function attack() {}, t.id(), 10);
  await f.run(); f.runtime.intent(f.actor, 'AttackBehavior', function attack() {}, 'later', 1);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  assert.equal(ds[1].candidates[0].parentDecisionId, ds[0].decisionId);
  assert.equal(ds.at(-1).candidates[0].parentDecisionId, undefined);
});
