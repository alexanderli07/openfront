'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/attack-planner.js');
const createPlanner = fs.existsSync(file) ? require(file) : null;
const createEngine = require('../src/brain/engine');
const legacy = require('../src/brain/legacy-strategy');
const createRuntime = require('../src/brain/runtime');
function target(id, troops = 100, extra = {}) {
  return { id: () => id, troops: () => troops, incomingAttacks: () => [], type: () => 'Human',
    isTraitor: () => false, isDisconnected: () => false, friendly: false, ...extra };
}
function fixture(options = {}) {
  const calls = []; let active = true;
  const settings = { counterAttackFirst: false, encirclePockets: false, ...options.settings };
  const player = { troops: () => 1000, incomingAttacks: () => [], type: () => 'Human',
    isFriendly: t => t.friendly, allRelationsSorted: () => [], id: () => 'self', units: () => [],
    gold: () => 100, numTilesOwned: () => 100, outgoingAttacks: () => [] };
  const game = { config: () => ({ disableAlliances: () => false, maxTroops: () => 1000, gameConfig: () => ({}) }),
    myPlayer: () => player, ticks: () => 1, inSpawnPhase: () => false, terraNullius: () => target('land') };
  const actor = { player, game, isFFA: () => true,
    hasNeighboringBotWithStructures: () => false, counterReady: () => true,
    hasReserveRatioTroops: () => true, hasTriggerRatioTroops: () => true,
    random: { chance: n => { calls.push(['random', n]); return false; } },
    attackBots: async () => { calls.push(['bots']); return false; },
    assistAllies: async () => { calls.push(['assist']); return false; },
    maybeBetrayAndAttack: async () => { calls.push(['betray']); return false; },
    donateTroops: () => { calls.push(['donate']); return false; },
    findSealablePocket: async () => null, isBorderingNukedTerritory: () => false,
    findNearestIslandEnemy: async () => null,
    sendAttack: async (...args) => { calls.push(['send', ...args]); return true; } };
  const planner = createPlanner({ settings: () => settings, difficulty: () => options.difficulty || 'Impossible',
    botType: 'Bot', hostileRelation: -1 });
  const runtime = createRuntime({ createEngine, createLegacyStrategy: legacy, attackPlanner: planner,
    attackGeographyPlanner: options.attackGeographyPlanner || { async select(subject, mode) {
      const value = mode === 'pocket' ? await subject.findSealablePocket() : await subject.findNearestIslandEnemy();
      return { target:value, decisionId:null, stop:false };
    } },
    botTargetPlanner: options.botTargetPlanner,
    probeLanding: async () => true,
    settings: () => settings, enabled: () => active, isCurrent: () => active, isPublic: () => false,
    emitIntent: () => true, strategies: options.strategies || [] });
  const bot = { mg: game, player, attackBehavior: actor };
  runtime.attach(bot); runtime.begin(bot); runtime.attachBehaviors(bot);
  return { actor, player, game, runtime, planner, calls, settings, stop: () => { active = false; },
    select: (mode, list) => runtime.selectAttackTarget(actor, mode, list),
    run: (friends = [], enemies = []) => runtime.planAttacks(actor, friends, enemies),
    decisions: () => runtime.inspect().records.filter(r => r.kind === 'decision') };
}
test('attack planner is available', () => assert.equal(typeof createPlanner, 'function'));

test('geographic attack links purpose to geography decision to command', async () => {
  const pocket = target('pocket', 10);
  const geography = { async select(_actor, mode, hooks) {
    assert.equal(mode, 'pocket');
    const choice = hooks.choose('attack-geography', [{ id:'geo:pocket', kind:'attack-geography',
      targetId:'pocket', eligible:true, priority:0, reason:'test pocket' }], { mode });
    return { target:pocket, decisionId:choice.decisionId, stop:false };
  } };
  const f = fixture({ settings:{ encirclePockets:true }, attackGeographyPlanner:geography });
  function Attack() {}
  f.actor.sendAttack = (...args) => f.runtime.intent(f.actor, 'AttackBehavior.sendAttack', Attack, ...args);
  await f.run([], []);
  const decisions = f.decisions();
  const purpose = decisions.find(d => d.snapshot.domain === 'attack-plan' && d.selectedId.endsWith(':pocket'));
  const geographic = decisions.find(d => d.snapshot.domain === 'attack-geography');
  const command = decisions.find(d => d.candidates[0]?.source === 'AttackBehavior.sendAttack');
  assert.equal(geographic.snapshot.parentDecisionId, purpose.decisionId);
  assert.equal(command.candidates[0].parentDecisionId, geographic.decisionId);
  assert.equal(command.candidates[0].arguments.length, 2);
  assert.equal(command.candidates[0].arguments[1], true);
});

test('cached geographic target keeps the attack purpose as command parent', async () => {
  const pocket = target('cached-pocket', 10);
  const f = fixture({ settings:{ encirclePockets:true }, attackGeographyPlanner:{
    async select() { return { target:pocket, decisionId:null, stop:false }; }
  } });
  function Attack() {}
  f.actor.sendAttack = (...args) => f.runtime.intent(f.actor, 'AttackBehavior.sendAttack', Attack, ...args);
  await f.run([], []);
  const decisions = f.decisions();
  const purpose = decisions.find(d => d.snapshot.domain === 'attack-plan' && d.selectedId.endsWith(':pocket'));
  const command = decisions.find(d => d.candidates[0]?.source === 'AttackBehavior.sendAttack');
  assert.equal(command.candidates[0].parentDecisionId, purpose.decisionId);
});

test('geography stop records attack-stop and resets for the next pass', async () => {
  let stop=true;
  const geography={async select(){return stop?{target:null,decisionId:41,stop:true}:
    {target:target('pocket'),decisionId:null,stop:false};}};
  const f=fixture({settings:{encirclePockets:true},attackGeographyPlanner:geography});
  await f.run([],[]);
  assert.ok(f.runtime.inspect().records.some(record=>record.kind==='attack-stop'&&record.decisionId===41));
  assert.equal(f.calls.some(call=>call[0]==='assist'),false);
  stop=false; await f.run([],[]);
  assert.ok(f.calls.some(call=>call[0]==='send'));
});
test('incoming selection uses largest individual positive wave and first tie, excluding friendly/bots', () => {
  const f = fixture(), a = target('a'), b = target('b'), bot = target('bot', 1, { type: () => 'Bot' }), friend = target('friend', 1, { friendly: true });
  f.player.incomingAttacks = () => [[a, 60], [a, 60], [b, 100], [a, 100], [bot, 1000], [friend, 2000]]
    .map(([p, n]) => ({ attacker: () => p, troops: () => n }));
  assert.equal(f.select('incoming'), b);
  const d = f.decisions().at(-1); assert.equal(d.snapshot.domain, 'attack-target');
  assert.ok(d.candidates.some(c => c.eligible === false));
});
test('zero incoming waves produce wait', () => {
  const f = fixture(); f.player.incomingAttacks = () => [{ attacker: () => target('zero'), troops: () => 0 }];
  assert.equal(f.select('incoming'), null);
});
test('victim and very-weak rules preserve strict thresholds and target identity', () => {
  const f = fixture();
  const atHalf = target('half', 100, { incomingAttacks: () => [{ troops: () => 50 }] });
  const above = target('above', 1200, { incomingAttacks: () => [{ troops: () => 601 }] });
  assert.equal(f.select('victim', [atHalf, above]), above);
  const atCapacity = target('15percent', 150), weak = target('weak', 149);
  assert.equal(f.select('weak', [atCapacity, weak]), weak);
  const capped = target('self-cap', 1200); f.game.config = () => ({ maxTroops: () => 10000 });
  assert.equal(f.select('weak', [capped]), null);
});
test('traitor/disconnected/hostile thresholds retain strict vs inclusive limits', () => {
  const f = fixture();
  assert.equal(f.select('traitor', [target('equal', 1200, { isTraitor: () => true })]), null);
  assert.equal(f.select('disconnected', [target('equal', 3000, { isDisconnected: () => true })]), null);
  const equal = target('equal', 3000); f.player.allRelationsSorted = () => [{ player: equal, relation: -1 }];
  assert.equal(f.select('hostile'), equal);
});
test('bounded target window retains legacy winner beyond first 79 entries', () => {
  const f = fixture(); const ts = Array.from({ length: 100 }, (_, i) => target(String(i), 100, { isTraitor: () => i === 99 }));
  assert.equal(f.select('traitor', ts), ts[99]);
  assert.equal(f.decisions().at(-1).candidates.length, 80);
  assert.equal(f.decisions().at(-1).snapshot.attack.hiddenTargets, 21);
});
test('replacement policy selects another eligible target', () => {
  const f = fixture({ strategies: [{ id: 'second', version: '1', decide: (s, cs) => ({ selectedId: cs.find(c => c.targetId === 'b')?.id ?? '$wait', reason: 'Choose b' }) }] });
  f.runtime.select('second'); const a = target('a', 1), b = target('b', 2);
  assert.equal(f.select('weak', [a, b]), b);
});
test('priority counter precedes reserve gates and preserves both true flags', async () => {
  const f = fixture({ settings: { counterAttackFirst: true } }); const enemy = target('incoming');
  f.player.incomingAttacks = () => [{ attacker: () => enemy, troops: () => 50 }];
  f.actor.hasReserveRatioTroops = () => { throw Error('must not reach reserve'); };
  await f.run(); assert.deepEqual(f.calls, [['send', enemy, true, true]]);
});
test('normal counter retains opening veto flag and runs after reserve gates', async () => {
  const f = fixture(); const enemy = target('incoming');
  f.player.incomingAttacks = () => [{ attacker: () => enemy, troops: () => 50 }];
  await f.run(); assert.deepEqual(f.calls, [['send', enemy, true]]);
});
test('reserve and trigger gates stop normal purposes with original random cadence', async () => {
  const f = fixture(); f.actor.hasReserveRatioTroops = () => false;
  await f.run(); assert.deepEqual(f.calls, []);
  const g = fixture(); g.actor.hasTriggerRatioTroops = () => false;
  await g.run(); assert.deepEqual(g.calls, [['random', 10]]);
});
test('explicit purpose wait stops entire pass before reserve or attacks', async () => {
  const f = fixture({ strategies: [{ id: 'hold', version: '1', decide: () => ({ selectedId: '$wait', reason: 'Wait' }) }] });
  f.runtime.select('hold'); f.actor.hasReserveRatioTroops = () => { throw Error('wait must stop'); };
  await f.run(); assert.deepEqual(f.calls, []);
});
test('purpose choice executes only selected plan and links purpose -> target -> command', async () => {
  const base = legacy();
  const f = fixture({ strategies: [{ id: 'victim-first', version: '1', decide: (s, cs) => s.domain === 'attack-plan' && s.attack.phase === 'normal' ?
    { selectedId: cs.find(c => c.purpose === 'victim')?.id ?? '$wait', reason: 'Victim first' } : base.decide(s, cs) }] });
  f.runtime.select('victim-first'); const enemy = target('victim', 100, { incomingAttacks: () => [{ troops: () => 80 }] });
  f.actor.sendAttack = async p => f.runtime.intent(f.actor, 'AttackBehavior', function attack() {}, p.id(), 20);
  await f.run([], [enemy]);
  const ds = f.decisions(); const selectedTarget = ds.find(d => d.snapshot.domain === 'attack-target');
  const command = ds.find(d => d.candidates[0].kind === 'intent');
  assert.equal(command.candidates[0].parentDecisionId, selectedTarget.decisionId);
  const purpose = ds.find(d => d.decisionId === selectedTarget.snapshot.parentDecisionId);
  assert.equal(purpose.candidates.find(c => c.id === purpose.selectedId).purpose, 'victim');
  assert.ok(f.runtime.replay('victim-first', f.runtime.inspect()).every(r => r.sameChoice));
});

for (const throws of [false, true]) test(`nested plan restores parent after completion/error (${throws})`, async () => {
  const f = fixture({ botTargetPlanner: { async run(actor, hooks) {
    const choice = hooks.choose([{ id: 'nested-bot', kind: 'bot-target', eligible: true, priority: 0, reason: 'Nested bot' }], {});
    return hooks.execute(null, choice.decisionId, async () => {
      f.runtime.intent(actor, 'AttackBehavior', function attack() {}, 'nested', 1);
      if (throws) throw Error('nested failure');
      return false;
    });
  } } });
  f.actor.attackBots = async () => {
    try { await f.runtime.planBotTargets(f.actor); } catch { /* Test recovery within the original purpose. */ }
    f.runtime.intent(f.actor, 'AttackBehavior', function attack() {}, 'outer', 1);
    return true;
  };
  await f.run();
  f.runtime.intent(f.actor, 'AttackBehavior', function attack() {}, 'outside', 1);
  const ds = f.decisions();
  const nested = ds.find(d => d.snapshot.domain === 'bot-target');
  const commands = ds.filter(d => d.candidates[0].kind === 'intent');
  assert.equal(commands[0].candidates[0].parentDecisionId, nested.decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId, nested.snapshot.parentDecisionId);
  assert.equal(commands[2].candidates[0].parentDecisionId, undefined);
});

test('stopping while pocket search awaits prevents its attack and later purposes', async () => {
  const f = fixture({ settings: { encirclePockets: true } });
  f.actor.findSealablePocket = async () => { await Promise.resolve(); f.stop(); return target('pocket'); };
  await f.run(); assert.deepEqual(f.calls, []);
});
