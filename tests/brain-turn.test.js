'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createTurnPlanner = require('../src/brain/turn-planner.js');

const allEnabled = { alliance: true, nuke: true, build: true, warship: true,
  embargo: true, expand: true, boat: true };

function hooksFixture(options = {}) {
  let allowed = true, decisionId = 0;
  const choices = [], records = [];
  return { choices, records, stop: () => { allowed = false; }, hooks: {
    allowed: () => allowed,
    choose(domain, candidates, facts) {
      choices.push({ domain, candidates, facts });
      if (options.throwPolicy) throw options.throwPolicy;
      const eligible = candidates.filter(candidate => candidate.kind === domain && candidate.eligible);
      const selected = options.wait ? null : options.reverse ? eligible.at(-1) : eligible[0];
      if (options.stopAfterChoose) allowed = false;
      return { selectedId: options.invalid ? 'turn:invalid' : selected?.id ?? '$wait',
        decisionId: ++decisionId, reason: 'test' };
    },
    execute: async (_id, execute) => execute(),
    record: (kind, details) => records.push([kind, details])
  } };
}

function fixture(options = {}) {
  const calls = [];
  const call = (name, value) => () => {
    calls.push(name);
    if (options.throwPhase === name) throw options.error;
    if (options.stopPhase === name) options.stop();
    return value;
  };
  const bot = {
    feat: name => { calls.push(`feat:${name}`); return (options.features || allEnabled)[name] === true; },
    emojiBehavior: { maybeSendCasualEmoji: call('casual-emoji') },
    updateRelationsFromEmbargos: call('embargo-relations'),
    allianceBehavior: {
      handleAllianceRequestsFromBots: call('bot-alliance-requests'),
      handleAllianceRequests: call('alliance-requests'),
      handleAllianceExtensionRequests: call('alliance-extensions')
    },
    mirvBehavior: { considerMIRV: call('mirv', true) },
    structureBehavior: { handleStructures: call('structure', false) },
    warshipBehavior: {
      maybeSpawnWarship: call('warship-deployment'),
      counterWarshipInfestation: call('warship-infestation')
    },
    handleEmbargoesToHostileNations: call('embargo'),
    attackBehavior: { maybeAttack: call('attack', true) },
    nukeBehavior: { maybeSendNuke: call('nuke') }
  };
  return { bot, calls };
}

test('turn planner is available', () => assert.equal(typeof createTurnPlanner, 'function'));

test('full path preserves every original phase in order despite return values', async () => {
  const f = fixture(), h = hooksFixture();
  const result = await createTurnPlanner().run(f.bot, { path: 'full', tick: 10, attackRate: 30 }, h.hooks);
  assert.deepEqual(f.calls, ['casual-emoji', 'embargo-relations', 'bot-alliance-requests', 'feat:alliance',
    'alliance-requests', 'alliance-extensions', 'feat:nuke', 'mirv', 'feat:build', 'structure',
    'feat:warship', 'warship-deployment', 'feat:embargo', 'embargo', 'feat:expand', 'attack',
    'feat:warship', 'warship-infestation', 'feat:nuke', 'nuke']);
  assert.deepEqual(result.completed, ['casual-emoji', 'embargo-relations', 'bot-alliance-requests',
    'alliance-requests', 'mirv', 'structure', 'warship-deployment', 'embargo', 'attack',
    'warship-infestation', 'nuke']);
  assert.equal(result.stopped, false);
});

test('build-only path runs only secondary structures', async () => {
  const f = fixture(), h = hooksFixture();
  const result = await createTurnPlanner().run(f.bot, { path: 'build-only', tick: 9, attackRate: 30 }, h.hooks);
  assert.deepEqual(f.calls, ['structure']);
  assert.deepEqual(result.completed, ['structure-secondary']);
});

test('full path checks disabled gates lazily and skips their helpers', async () => {
  const disabled = { alliance: false, nuke: false, build: false, warship: false,
    embargo: false, expand: false, boat: false };
  const f = fixture({ features: disabled }), h = hooksFixture();
  await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
  assert.deepEqual(f.calls, ['casual-emoji', 'embargo-relations', 'bot-alliance-requests', 'feat:alliance',
    'feat:nuke', 'feat:build', 'feat:warship', 'feat:embargo', 'feat:expand', 'feat:boat',
    'feat:warship', 'feat:nuke']);
  assert.ok(h.choices[0].candidates.some(candidate => candidate.phase === 'attack' &&
    candidate.eligible === true && candidate.readiness === 'unchecked'));
  assert.equal(h.records.filter(([kind, details]) => kind === 'turn-plan-result' &&
    details.status === 'skipped').length, 8);
});

test('replacement policy may reverse phase order without eager execution', async () => {
  const f = fixture(), h = hooksFixture({ reverse: true });
  await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
  assert.deepEqual(f.calls.slice(0, 6), ['feat:nuke', 'nuke', 'feat:warship', 'warship-infestation',
    'feat:expand', 'attack']);
});

test('explicit wait stops without executing a phase', async () => {
  const f = fixture(), h = hooksFixture({ wait: true });
  const result = await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
  assert.equal(result.stopped, true); assert.deepEqual(f.calls, []);
  assert.ok(h.records.some(([kind, details]) => kind === 'turn-plan-result' &&
    details.status === 'stopped' && details.reason === 'Policy selected wait'));
});

test('invalid selection and strategy exception stop with terminal results', async () => {
  for (const options of [{ invalid: true }, { throwPolicy: Error('bad strategy') }]) {
    const f = fixture(), h = hooksFixture(options);
    const result = await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
    assert.equal(result.stopped, true);
    assert.deepEqual(f.calls, []);
    assert.ok(h.records.some(([kind, details]) => kind === 'turn-plan-result' &&
      details.status === 'stopped'));
  }
});

test('stale ownership before and after selection records a terminal stop', async () => {
  for (const afterSelection of [false, true]) {
    const f = fixture(), h = hooksFixture({ stopAfterChoose: afterSelection });
    if (!afterSelection) h.stop();
    const result = await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
    assert.equal(result.stopped, true);
    assert.deepEqual(f.calls, []);
    assert.ok(h.records.some(([kind, details]) => kind === 'turn-plan-result' &&
      details.status === 'stopped'));
  }
});

test('stale async completion stops later phases', async () => {
  const h = hooksFixture();
  const f = fixture({ stopPhase: 'mirv', stop: h.stop });
  const result = await createTurnPlanner().run(f.bot, { path: 'full' }, h.hooks);
  assert.equal(result.stopped, true);
  assert.equal(f.calls.includes('structure'), false);
});

test('phase exceptions retain identity and record the throw', async () => {
  const error = Error('phase failed'), f = fixture({ throwPhase: 'embargo', error }), h = hooksFixture();
  await assert.rejects(() => createTurnPlanner().run(f.bot,
    { path: 'full' }, h.hooks), thrown => thrown === error);
  assert.equal(f.calls.includes('attack'), false);
  assert.ok(h.records.some(([kind, details]) => kind === 'turn-plan-result' && details.status === 'threw'));
});

test('turn candidates and facts contain primitives only', async () => {
  const f = fixture(), h = hooksFixture({ wait: true });
  await createTurnPlanner().run(f.bot, { path: 'full', tick: 5, attackRate: 30 }, h.hooks);
  const encoded = JSON.stringify(h.choices[0]);
  assert.equal(encoded.includes('[object Object]'), false);
  assert.equal(h.choices[0].facts.tick, 5);
  assert.equal(h.choices[0].facts.visiblePhases, 11);
  assert.equal(h.choices[0].facts.eligiblePhases, 11);
});
