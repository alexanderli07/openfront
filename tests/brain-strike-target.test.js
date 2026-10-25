'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, '../src/brain/strike-target-planner.js');
const create = fs.existsSync(file) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function fixture(options = {}) {
  const calls = [], records = []; let active = true;
  const target = { id: () => 'enemy', smallID: () => 2, numTilesOwned: () => 10 };
  const actor = { player: { smallID: () => 1, isFriendly: () => false, allies: () => [], allRelationsSorted: () => [], units: () => [] },
    game: { players: () => [], config: () => ({ gameConfig: () => ({ gameMode: 'FFA' }), maxTroops: () => 100, samRange: () => 10 }), numLandTiles: () => 100, numTilesWithFallout: () => 0, euclideanDistSquared: () => 1 },
    findHighDensityTarget: () => { calls.push('density'); return null; }, findFFACrownTarget: () => { calls.push('crown'); return target; },
    findStrongestTeamTarget: () => { calls.push('team'); return target; },
    planSaturationSalvo: tile => { calls.push(['plan',tile]); return { ok: tile === 2, needsMoreSilos: true, totalBombs: 2, bombsToFire: 1, waitTicksPerBomb: [3] }; },
    sendNuke: async (...args) => calls.push(['send',...args]), maybeUpgradeHelpfulSilo: async (...args) => calls.push(['upgrade',...args]),
    chooseNukeArc: () => ({ intercepted: false }), _upgradeSiloReady: async (...args) => calls.push(['ready',...args]) };
  const hooks = { allowed: () => active, incoming: () => { calls.push('incoming'); return { target: null, stopped: false }; },
    choose: (domain, candidates, facts) => { records.push({ domain, candidates, facts }); return {
      ...(options.choose ? options.choose(domain,candidates) : legacy().decide({ domain }, candidates)), decisionId: records.length
    }; }, record: (kind,data) => records.push({ kind,...data }) };
  const planner = create({ units: { AtomBomb: 'atom', MissileSilo: 'silo', SAMLauncher: 'sam' }, maxSiloLevel: 5,
    difficulty: () => 'Impossible', ffa: 'FFA', friendly: 1, hostile: -1,
    salvoPace: async (...args) => calls.push(['pace',...args]), samMessage: () => calls.push('message') });
  return { actor, target, hooks, planner, calls, records, stop: () => { active = false; } };
}
test('strike target planner exists', () => assert.equal(typeof create, 'function'));
test('target search keeps lazy original order and stops at first result', () => {
  const f = fixture(); assert.equal(f.planner.target(f.actor,f.hooks), f.target);
  assert.deepEqual(f.calls, ['incoming','density','crown']);
});
test('duel target bypasses later searches; nested incoming wait ends lookup', () => {
  const f = fixture(); f.actor.game.players = () => [f.actor.player,f.target];
  assert.equal(f.planner.target(f.actor,f.hooks),f.target); assert.deepEqual(f.calls,[]);
  const g = fixture(); g.hooks.incoming = () => ({ target: null, stopped: true });
  assert.equal(g.planner.target(g.actor,g.hooks),null); assert.deepEqual(g.calls,[]);
});
test('SAM scan falls through failures, sends first viable salvo and skips upgrade', async () => {
  const f = fixture(); await f.planner.sam(f.actor,f.target,[1,2,3].map(tile => ({ tile: () => tile, level: () => tile })),{ cost: 10n, silos: [] },f.hooks);
  assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'plan'), [['plan',1],['plan',2]]);
  assert.equal(f.calls.some(c => c[0] === 'upgrade'),false); assert.equal(f.calls.filter(c => c[0] === 'send').length,1);
});
test('failed SAM scan remembers first capacity request; explicit wait prevents upgrade', async () => {
  const f = fixture(); await f.planner.sam(f.actor,f.target,[1,3].map(tile => ({ tile: () => tile, level: () => tile })),{ cost: 10n, silos: [] },f.hooks);
  assert.equal(f.calls.find(c => c[0] === 'upgrade')[1].targetTile,1);
  const g = fixture({ choose: () => ({ selectedId: '$wait', reason: 'Hold' }) });
  await g.planner.sam(g.actor,g.target,[{ tile: () => 1, level: () => 1 }],{ cost: 10n, silos: [] },g.hooks); assert.deepEqual(g.calls,[]);
});
test('silo upgrade chooses greatest SAM coverage and keeps first tie', async () => {
  const f = fixture(); const silo = (id,level) => ({ id: () => id, tile: () => id, level: () => level });
  f.actor.player.units = type => type === 'silo' ? [silo(1,5),silo(2,1),silo(3,1)] : [silo(9,2)];
  await f.planner.upgrade(f.actor,{ targetTile: 4, coveringSamIds: new Set(), totalBombs: 5 },f.hooks);
  assert.equal(f.calls.find(c => c[0] === 'ready')[1].id(),2);
});

function runtimeFixture(policy) {
  const f = fixture(); let active = true;
  f.actor.game.myPlayer = () => f.actor.player; f.actor.game.ticks = () => 100;
  f.actor.player.type = () => 'Human'; f.target.type = () => 'Human';
  f.actor.player.incomingAttacks = () => [{ attacker: () => f.target, troops: () => 10 }];
  const runtime = require('../src/brain/runtime')({ createEngine: require('../src/brain/engine'), createLegacyStrategy: legacy,
    strikeTargetPlanner: f.planner, attackPlanner: require('../src/brain/attack-planner')({ botType: 'Bot' }),
    enabled: () => active, isCurrent: () => active, isPublic: () => false, settings: () => ({}), emitIntent: () => true,
    strategies: policy ? [policy] : [] });
  const attacker = { game: f.actor.game, player: f.actor.player, findIncomingAttackPlayer() { return runtime.selectAttackTarget(this,'incoming'); } };
  f.actor.attackBehavior = attacker;
  const bot = { mg: f.actor.game, nukeBehavior: f.actor, attackBehavior: attacker };
  runtime.attach(bot); runtime.attachBehaviors(bot); if (policy) runtime.select(policy.id);
  return { ...f, runtime, attacker, stop: () => { active = false; } };
}
for (const throws of [false,true]) test(`nested incoming ${throws ? 'error' : 'wait'} stops nuke search and restores next lookup`, () => {
  const base = legacy(), f = runtimeFixture({ id: 'hold', version: '1', decide(s,cs) {
    if (s.domain !== 'attack-target') return base.decide(s,cs);
    if (throws) throw Error('policy'); return { selectedId: '$wait', reason: 'Hold incoming counter' };
  } });
  assert.equal(f.runtime.selectNukeTarget(f.actor),null); assert.deepEqual(f.calls,[]);
  assert.equal(f.runtime.inspect().records.some(r => r.kind === 'strategy-error'),throws);
  f.runtime.select('legacy-v1'); assert.equal(f.runtime.selectNukeTarget(f.actor),f.target);
  f.attacker.findIncomingAttackPlayer();
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const nested = ds.filter(d => d.snapshot.domain === 'attack-target');
  assert.equal(nested.filter(d => d.snapshot.parentDecisionId !== undefined).length,throws ? 1 : 2);
  assert.equal(nested.at(-1).snapshot.parentDecisionId,undefined);
  const trace = f.runtime.inspect(); trace.records = trace.records.filter(r => r.kind !== 'decision' || r.strategy.id === 'legacy-v1');
  const replay = f.runtime.replay('legacy-v1',trace); assert.ok(replay.length > 0); assert.ok(replay.every(r => r.sameChoice));
});
for (const domain of ['nuke-target','sam-target','sam-upgrade','strike-silo']) test(`runtime ${domain} wait performs no selected action`, async () => {
  const base = legacy(), f = runtimeFixture({ id: 'hold', version: '1', decide(s,cs) {
    return s.domain === domain ? { selectedId: '$wait', reason: 'Hold' } : base.decide(s,cs);
  } });
  if (domain === 'nuke-target') assert.equal(f.runtime.selectNukeTarget(f.actor),null);
  else if (domain === 'strike-silo') {
    f.actor.player.units = type => type === 'silo' ? [{ tile: () => 1, level: () => 1 }] : [];
    await f.runtime.planHelpfulSilo(f.actor,{ targetTile: 4, totalBombs: 1 });
  } else await f.runtime.planSamClear(f.actor,f.target,[{ tile: () => 1, level: () => 1 }],{ cost: 1n,silos: [] });
  assert.equal(f.calls.some(c => Array.isArray(c) && ['send','ready','upgrade'].includes(c[0])),false);
  assert.equal(f.runtime.inspect().records.some(r => r.kind === 'strategy-error'),false);
});
test('SAM to silo to build preserves explicit decision ancestry and stale probe safety', async () => {
  const f = runtimeFixture(); const state = { stats: { builds: 0 } }; let resolve;
  const menu = { sendBuildOrUpgrade: () => f.calls.push('build') };
  const source = require('../scripts/build').buildSource().source;
  const start = source.indexOf('class NukeBehavior{'), end = source.indexOf('"use strict";',start);
  const C = require('node:vm').runInNewContext(source.slice(start,end)+';NukeBehavior', {
    ofhBrainRuntime: f.runtime, UNIT: { MissileSilo: 'silo' }, state, getBuildMenu: () => menu,
    withTimeout: p => p, WORKER_TIMEOUT_MS: 1, tr: s => s, setLastAction: () => {}
  });
  f.actor.maybeUpgradeHelpfulSilo = C.prototype.maybeUpgradeHelpfulSilo;
  f.actor._upgradeSiloReady = C.prototype._upgradeSiloReady;
  f.actor.player.units = type => type === 'silo' ? [{ tile: () => 1, level: () => 1 }] : [];
  f.actor.player.buildables = () => new Promise(r => { resolve = r; });
  const run = () => f.runtime.planSamClear(f.actor,f.target,[{ tile: () => 1, level: () => 1 }],{ cost: 1n,silos: [],parentDecisionId: 999 });
  const pending = run(); await new Promise(setImmediate);
  resolve([{ type: 'silo', canUpgrade: 1 }]); await pending;
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const request = ds.find(d => d.snapshot.domain === 'sam-upgrade'), silo = ds.find(d => d.snapshot.domain === 'strike-silo');
  const build = ds.find(d => d.candidates[0].kind === 'upgrade');
  assert.equal(request.snapshot.parentDecisionId,999); assert.equal(silo.snapshot.parentDecisionId,request.decisionId);
  assert.equal(build.candidates[0].parentDecisionId,silo.decisionId); assert.equal(state.stats.builds,1);
  const second = run(); await new Promise(setImmediate); f.stop(); resolve([{ type: 'silo', canUpgrade: 1 }]); await second;
  assert.equal(state.stats.builds,1); assert.equal(f.calls.filter(c => c === 'build').length,1);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'strike-target-result' && r.domain === 'strike-silo' && r.status === 'stopped'));
});
test('failed saturation calculation records failure before propagating', async () => {
  const f = fixture(); f.actor.planSaturationSalvo = () => { throw Error('calculation'); };
  await assert.rejects(f.planner.sam(f.actor,f.target,[{ tile: () => 1, level: () => 1 }],{ cost: 1n,silos: [] },f.hooks),/calculation/);
  assert.ok(f.records.some(r => r.kind === 'strike-target-result' && r.status === 'threw'));
});
test('SAM windows refill beyond 79 without losing level order', async () => {
  const f = fixture(); f.actor.planSaturationSalvo = tile => { f.calls.push(['plan',tile]); return { ok: tile === 90, bombsToFire: 0 }; };
  await f.planner.sam(f.actor,f.target,Array.from({ length: 100 },(_,tile) => ({ tile: () => tile, level: () => tile })),{ cost: 1n,silos: [] },f.hooks);
  assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'plan').map(c => c[1]),Array.from({ length: 91 },(_,i) => i));
  assert.ok(f.records.filter(r => r.candidates).every(r => r.candidates.length <= 80));
});
