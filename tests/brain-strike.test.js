'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/strike-planner.js');
const create = fs.existsSync(file) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function fixture(options = {}) {
  const calls = [], records = []; let active = true;
  const state = { settings: { winFixes: false, ...options.settings }, nukeReserveGold: 9n };
  const target = { id: () => 'enemy' };
  const actor = { player: { gold: () => options.gold ?? 100n }, game: { ticks: () => options.tick ?? 100, config: () => ({ isUnitDisabled: () => false }) },
    teamHasWon: () => false, selectWinFixMirvTarget: () => options.winTarget ? target : null,
    wasRecentlyMirved: () => false,
    selectCounterMirvTarget: () => { calls.push('counter'); return null; },
    selectVictoryDenialTarget: () => { calls.push('denial'); return target; },
    selectSteamrollStopTarget: () => { calls.push('steamroll'); return target; },
    maybeSendMIRV: async (t, id) => { calls.push(['mirv', t, id]); },
    cost: async type => { calls.push(['cost', type]); return 10n; }, nukeSpendAllowed: () => true,
    isUnderHeavyAttack: () => false, isHydroNation: false,
    probeCanBuildNuke: async tile => { calls.push(['probe', tile]); return tile !== 1; },
    planSaturationSalvoFor: async () => ({ bombsToFire: 2, waitTicksPerBomb: [0, 4] }),
    sendNuke: async (...args) => { calls.push(['nuke', ...args]); },
    maybeDestroyEnemySam: async (...args) => calls.push(['sam', ...args]) };
  const hooks = { allowed: () => active, choose: (domain, candidates, facts) => {
    records.push({ kind: 'candidates', domain, candidates, facts });
    return { ...(options.choose ? options.choose(domain, candidates) : legacy().decide({ domain }, candidates)), decisionId: 7 };
  }, record: (kind, data) => records.push({ kind, ...data }) };
  const planner = create({ state, units: { HydrogenBomb: 'hydro', AtomBomb: 'atom' }, difficulty: () => 'Impossible',
    salvoPace: async (...args) => calls.push(['pace', ...args]), salvoMessage: n => calls.push(['message', n]) });
  return { state, target, actor, hooks, calls, records, planner, stop: () => { active = false; } };
}
test('strike planner exists', () => assert.equal(typeof create, 'function'));
test('MIRV preserves lazy purpose order and attempted-strike return', async () => {
  const f = fixture(); assert.equal(await f.planner.mirv(f.actor, 10n, f.hooks), true);
  assert.deepEqual(f.calls, ['counter', 'denial', ['mirv', f.target, 7]]);
});
test('MIRV reserve threshold and early clearing preserve old behavior', async () => {
  for (const tick of [99,100]) {
    const f = fixture({ settings: { winFixes: true, mirvEarlyGameTicks: 100 }, gold: 5n, winTarget: true, tick });
    assert.equal(await f.planner.mirv(f.actor, 10n, f.hooks), false);
    assert.equal(f.state.nukeReserveGold, tick === 100 ? 10n : 0n); assert.deepEqual(f.calls, []);
  }
});
test('MIRV wait makes no target search or reserve mutation', async () => {
  const f = fixture({ choose: () => ({ selectedId: '$wait', reason: 'Hold' }) });
  assert.equal(await f.planner.mirv(f.actor, 10n, f.hooks), false);
  assert.deepEqual(f.calls, []); assert.equal(f.state.nukeReserveGold, 9n);
});
test('replacement MIRV order still enforces affordability before target search', async () => {
  const f = fixture({ settings: { winFixes: true }, gold: 5n,
    choose: () => ({ selectedId: 'counter', reason: 'Counter first' }) });
  f.actor.selectCounterMirvTarget = () => { f.calls.push('counter'); return f.target; };
  assert.equal(await f.planner.mirv(f.actor, 10n, f.hooks), false); assert.deepEqual(f.calls, []);
});
test('nuke weapon prefers hydro and lazily falls back to atom', async () => {
  const f = fixture(); assert.equal(await f.planner.weapon(f.actor, { available: 100n, hydroCost: 20n, atomCost: 10n }, f.hooks), 'hydro');
  assert.deepEqual(f.calls, [['cost','hydro']]);
  const g = fixture(); g.actor.nukeSpendAllowed = () => false;
  assert.equal(await g.planner.weapon(g.actor, { available: 100n, hydroCost: 20n, atomCost: 10n }, g.hooks), 'atom');
});
test('nuke sites probe in order then launch selected direct target', async () => {
  const f = fixture(); await f.planner.nuke(f.actor, [{ tile: 1, value: 5 }, { tile: 2, value: 4, arcUp: false }], { target: f.target, weapon: 'hydro' }, f.hooks);
  assert.deepEqual(f.calls, [['probe',1], ['probe',2], ['cost','hydro'], ['nuke',2,'hydro',f.target,0,false,false,7]]);
});
test('large site search refills bounded windows without losing original order', async () => {
  const f = fixture(); f.actor.probeCanBuildNuke = async tile => { f.calls.push(['probe',tile]); return tile === 90; };
  await f.planner.nuke(f.actor, Array.from({ length: 100 }, (_,tile) => ({ tile, value: 100-tile })), { target: f.target, weapon: 'hydro' }, f.hooks);
  assert.deepEqual(f.calls.filter(c => c[0] === 'probe').map(c => c[1]), Array.from({ length: 91 }, (_, i) => i));
  assert.ok(f.records.filter(r => r.domain === 'nuke-site' && r.kind === 'candidates').every(r => r.candidates.length <= 80));
});
test('exhausted sites allow SAM fallback; explicit site wait does not', async () => {
  const f = fixture(); await f.planner.nuke(f.actor, [], { target: f.target, weapon: 'hydro' }, f.hooks);
  assert.deepEqual(f.calls, [['cost','hydro'], ['sam',f.target,7]]);
  const g = fixture({ choose: () => ({ selectedId: '$wait', reason: 'Hold' }) });
  await g.planner.nuke(g.actor, [{ tile: 2, value: 5 }], { target: g.target, weapon: 'hydro' }, g.hooks); assert.deepEqual(g.calls, []);
});
test('salvo preserves waits and pacing; stale probe ends without action', async () => {
  const f = fixture(); await f.planner.nuke(f.actor, [{ tile: 2, value: 5, interceptable: true }], { target: f.target, weapon: 'hydro' }, f.hooks);
  assert.deepEqual(f.calls.filter(c => c[0] === 'nuke').map(c => c.slice(1)), [[2,'atom',f.target,0,true,true,7],[2,'atom',f.target,4,true,true,7]]);
  const g = fixture(); g.actor.probeCanBuildNuke = async () => { g.stop(); return true; };
  await g.planner.nuke(g.actor, [{ tile: 2, value: 5 }], { target: g.target, weapon: 'hydro' }, g.hooks);
  assert.deepEqual(g.calls, []);
});

function actualFixture(policy) {
  const f = fixture(); let active = true;
  f.state.stats = { nukes: 0, builds: 0 };
  f.actor.game.myPlayer = () => f.actor.player;
  const runtime = require('../src/brain/runtime')({ createEngine: require('../src/brain/engine'), createLegacyStrategy: legacy,
    strikeTargetPlanner: require('../src/brain/strike-target-planner')({ units: { AtomBomb: 'atom' },
      salvoPace: (...args) => context.salvoPace(...args), samMessage: n => f.calls.push(['message',n]) }),
    strikePlanner: f.planner, enabled: () => active, isCurrent: () => active, isPublic: () => false,
    settings: () => f.state.settings, strategies: policy ? [policy] : [] });
  const menu = { uiState: { rocketDirectionUp: true }, sendBuildOrUpgrade: (...args) => f.calls.push(['build', ...args]) };
  const context = { UNIT: { AtomBomb: 'atom', HydrogenBomb: 'hydro', MIRV: 'MIRV', MissileSilo: 'silo' },
    state: f.state, ofhBrainRuntime: runtime, withTimeout: p => p, WORKER_TIMEOUT_MS: 10,
    getBuildMenu: () => menu, tr: s => s, setLastAction: (...args) => f.calls.push(['message', ...args]),
    EMOJI_NUKE: [], AllPlayers: 'all', respondToMIRV: () => {}, Map };
  const source = require('../scripts/build').buildSource().source;
  for (const name of ['NukeBehavior', 'MirvBehavior']) {
    const start = source.indexOf(`class ${name}{`), end = source.indexOf('"use strict";', start);
    const C = require('node:vm').runInNewContext(source.slice(start,end) + ';' + name, context);
    if (name === 'NukeBehavior') { f.actor.sendNuke = C.prototype.sendNuke; f.actor.maybeDestroyEnemySam = C.prototype.maybeDestroyEnemySam; }
    else f.actor.maybeSendMIRV = C.prototype.maybeSendMIRV;
  }
  Object.assign(f.actor, { recentlySentNukes: [], atomBombsLaunched: 0, hydrogenBombsLaunched: 0,
    atomBombPerceivedCost: 10n, hydrogenBombPerceivedCost: 10n,
    emojiBehavior: { maybeSendEmoji() {}, maybeSendAttackEmoji() {}, sendEmoji() {} },
    recordMirvHit: () => {}, calculateTerritoryCenter: async () => 8 });
  f.actor.player.buildables = async (tile, types) => [{ type: types[0], canBuild: tile, cost: 10n }];
  const bot = { mg: f.actor.game, nukeBehavior: f.actor }; runtime.attach(bot); runtime.attachBehaviors(bot);
  if (policy) runtime.select(policy.id);
  return { ...f, runtime, menu, context, stop: () => { active = false; } };
}
for (const domain of ['mirv-plan','nuke-weapon','nuke-site','nuke-action']) for (const throws of [false,true]) {
  test(`real runtime ${domain} ${throws ? 'error' : 'wait'} does not launch`, async () => {
    const base = legacy(); const f = actualFixture({ id: 'hold', version: '1', decide(s,cs) {
      if (s.domain !== domain) return base.decide(s,cs);
      if (throws) throw Error('policy'); return { selectedId: '$wait', reason: 'Hold' };
    } });
    if (domain === 'mirv-plan') await f.runtime.planMirv(f.actor, 10n);
    else if (domain === 'nuke-weapon') await f.runtime.selectNukeWeapon(f.actor, { available: 100n, hydroCost: 10n, atomCost: 10n });
    else await f.runtime.planNuke(f.actor, [{ tile: 2, value: 4 }], { target: f.target, weapon: 'hydro' });
    assert.equal(f.calls.some(c => c[0] === 'build'), false); assert.equal(f.state.stats.nukes, 0);
    assert.equal(f.runtime.inspect().records.some(r => r.kind === 'strategy-error'), throws);
  });
}
test('actual nuke build links to action and site then restores command scope', async () => {
  const f = actualFixture(); await f.runtime.planNuke(f.actor, [{ tile: 2, value: 4, arcUp: false }], { target: f.target, weapon: 'hydro' });
  f.runtime.build(f.actor, 'NukeBehavior', f.menu, { type: 'other' }, 9);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const action = ds.find(d => d.snapshot.domain === 'nuke-action'), site = ds.find(d => d.snapshot.domain === 'nuke-site');
  assert.equal(action.snapshot.parentDecisionId, site.decisionId);
  const commands = ds.filter(d => d.candidates[0].kind.startsWith('build '));
  assert.equal(commands[0].candidates[0].parentDecisionId, action.decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId, undefined);
  assert.equal(f.menu.uiState.rocketDirectionUp, true); assert.equal(f.state.stats.nukes, 1);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
test('pending actual MIRV and nuke launches preserve separate parents', async () => {
  const f = actualFixture(), pending = new Map();
  f.actor.player.buildables = (tile, types) => new Promise(resolve => pending.set(types[0], () => resolve([{ type: types[0], canBuild: tile, cost: 10n }])));
  const mirv = f.runtime.planMirv(f.actor, 10n);
  const nuke = f.runtime.planNuke(f.actor, [{ tile: 2, value: 4 }], { target: f.target, weapon: 'hydro' });
  await new Promise(setImmediate);
  pending.get('hydro')(); await nuke; pending.get('MIRV')(); await mirv;
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const commands = ds.filter(d => d.candidates[0].kind.startsWith('build '));
  assert.equal(commands[0].candidates[0].parentDecisionId, ds.find(d => d.snapshot.domain === 'nuke-action').decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId, ds.find(d => d.snapshot.domain === 'mirv-plan' && d.selectedId === 'denial').decisionId);
});
for (const mode of ['mirv', 'nuke']) test(`stopped ${mode} buildability completion cannot dispatch or update stats`, async () => {
  const f = actualFixture(); let resolve;
  f.actor.player.buildables = (tile, types) => new Promise(r => { resolve = () => r([{ type: types[0], canBuild: tile, cost: 10n }]); });
  const pending = mode === 'mirv' ? f.runtime.planMirv(f.actor, 10n) : f.runtime.planNuke(f.actor, [{ tile: 2, value: 4 }], { target: f.target, weapon: 'hydro' });
  await new Promise(setImmediate); f.stop(); resolve(); await pending;
  assert.equal(f.calls.some(c => c[0] === 'build'), false); assert.equal(f.state.stats.nukes, 0);
  assert.equal(f.menu.uiState.rocketDirectionUp, true);
});
test('stopped post-launch cost lookup does not mutate shared stats or messages', async () => {
  const f = actualFixture(); let resolve; f.actor.hydrogenBombPerceivedCost = null;
  f.actor.cost = () => new Promise(r => { resolve = r; });
  const pending = f.actor.sendNuke(2,'hydro',f.target);
  await new Promise(setImmediate); f.stop(); resolve(10n); await pending;
  assert.equal(f.calls.filter(c => c[0] === 'build').length, 1);
  assert.equal(f.state.stats.nukes, 0); assert.equal(f.calls.some(c => c[0] === 'message'), false);
});
test('stop during final SAM pacing prevents stale completion message', async () => {
  const f = actualFixture();
  f.actor.player.units = type => type === 'silo' ? [{ isUnderConstruction: () => false }] : [];
  f.target.units = () => [{ tile: () => 2, level: () => 1 }];
  f.actor.planSaturationSalvo = () => ({ ok: true, bombsToFire: 1, waitTicksPerBomb: [0] });
  f.context.salvoPace = async () => f.stop();
  await f.actor.maybeDestroyEnemySam(f.target, 1);
  assert.equal(f.calls.filter(c => c[0] === 'build').length, 1);
  assert.equal(f.calls.some(c => c[0] === 'message'), false);
});
