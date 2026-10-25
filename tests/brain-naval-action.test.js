'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/naval-action-planner.js');
const createPlanner = fs.existsSync(file) ? require(file) : null;
const createRuntime = require('../src/brain/runtime');
const createEngine = require('../src/brain/engine');
const legacy = require('../src/brain/legacy-strategy');
const createLanding = require('../src/brain/naval-landing-planner');

function fixture(options = {}) {
  let active = true; const calls = [], sends = [];
  const state = { settings: { boatSurplusFill: .75, boatIslandFill: .35, boatProbeFrac: .01,
    boatProbeMinTroops: 10, boatSurgeFrac: .25, ...options.settings },
    beachhead: options.beachhead, lastOppBoatMs: 5 };
  const player = { troops: () => 1000, id: () => 'self', units: () => [], incomingAttacks: () => [],
    outgoingAttacks: () => [], gold: () => 100, numTilesOwned: () => 10 };
  const game = { myPlayer: () => player, ticks: () => 100, config: () => ({ gameConfig: () => ({}) }),
    inSpawnPhase: () => false, hasOwner: () => true, x: x => x, y: () => 0 };
  const actor = { player, game, random: { randElement: a => { calls.push('random'); return a[0]; } },
    landingSucceeded: () => true, boatTargetTaken: () => false,
    findDisconnectedBoatTarget: async () => { calls.push('disconnected'); return null; },
    scanNearbyTargets: () => { calls.push('nearby'); return []; },
    pickMirvCraterTarget: () => { calls.push('crater'); return null; },
    findRandomBoatTarget: async (shore, excluded, free) => { calls.push(free ? 'random-free' : 'random-enemy'); return null; },
    findDistantBoatTarget: async () => { calls.push('distant'); return null; },
    emitBoat: (...args) => { sends.push(args); return options.emit !== false; } };
  const runtime = createRuntime({ createEngine, createLegacyStrategy: legacy,
    boatPlanner: require('../src/brain/boat-planner')({state}),
    navalActionPlanner: createPlanner({ state, transportType: 'Transport', debug: () => {} }),
    navalLandingPlanner: createLanding(), settings: () => state.settings, enabled: () => active,
    twoTeamOpening: options.opening ? {observe:()=>options.opening} : undefined,
    isCurrent: () => active, isPublic: () => false, strategies: options.strategies || [], emitIntent: () => true,
    probeLanding: async (a, tile) => { calls.push(`probe:${tile}`); return options.probeResult ?? 3; },
    landingDiagnostics: () => {} });
  const bot = { mg: game, player, attackBehavior: actor };
  runtime.attach(bot); runtime.begin(bot); runtime.attachBehaviors(bot);
  return { runtime, actor, state, calls, sends, stop: () => { active = false; },
    run: () => runtime.planNavalActions(actor, { now: 10000, fill: options.fill ?? 1, surplusFill: .75, shore: [7] }),
    decisions: () => runtime.inspect().records.filter(r => r.kind === 'decision') };
}
test('naval action planner exists', () => assert.equal(typeof createPlanner, 'function'));

function adaptiveFixture(options={}) {
  const adaptive=require('../src/brain/adaptive-strategy')(legacy());
  const f=fixture({opening:{borderKnown:true,wilderness:false,frontline:false},...options,strategies:[adaptive]});
  f.runtime.select('adaptive-v1'); return f;
}

test('post-opening distant 1% probes are not starved by local targets, low fill or minimum troops',async()=>{
  const f=adaptiveFixture({fill:.05,settings:{boatProbeMinTroops:8000}});
  f.actor.findDisconnectedBoatTarget=async()=>{f.calls.push('disconnected');return 20;};
  f.actor.findDistantBoatTarget=async()=>{f.calls.push('distant');return 9000;};
  assert.equal(await f.run(),true);
  assert.equal(f.sends[0][0],9000); assert.equal(f.sends[0][1],10);
  assert.deepEqual(f.calls,['distant']);
  assert.ok(f.decisions().some(d=>d.selectedId==='naval:enemy-probe'));
});

test('unreachable distant probes fall through to ordinary grabs without repeating the search',async()=>{
  const f=adaptiveFixture();
  f.actor.findDisconnectedBoatTarget=async()=>{f.calls.push('disconnected');return 20;};
  assert.equal(await f.run(),true);
  assert.deepEqual(f.calls,['distant','disconnected']);
  assert.equal(f.sends[0][0],20);
});

test('post-opening enemy probe allocation holds stop the pass and preserve throttle',async()=>{
  const adaptive=require('../src/brain/adaptive-strategy')(legacy());
  const f=fixture({opening:{borderKnown:true,wilderness:false},strategies:[{id:'hold',version:'1',decide(s,cs){
    return s.domain==='boat-allocation'?{selectedId:'$wait',reason:'hold troop allocation'}:adaptive.decide(s,cs);
  }}]});
  f.runtime.select('hold');f.actor.findDistantBoatTarget=async()=>9000;
  assert.equal(await f.run(),false);assert.deepEqual(f.sends,[]);assert.equal(f.state.lastOppBoatMs,5);
});

test('wilderness and unknown borders do not select the adaptive post-opening probe',async()=>{
  for(const opening of [{borderKnown:true,wilderness:true},{borderKnown:false,wilderness:false}]){
    const f=adaptiveFixture({opening});await f.run();
    assert.equal(f.decisions().some(d=>d.selectedId==='naval:enemy-probe'),false);
  }
});
test('surge allocation hold changes neither beachhead nor throttle and resets next pass',async()=>{
  const base=legacy();
  const f=fixture({beachhead:{tile:0,at:90,surged:false},strategies:[{id:'hold-amount',version:'1',decide(s,cs){
    return s.domain==='boat-allocation'?{selectedId:'$wait',reason:'save troops'}:base.decide(s,cs);
  }}]});
  f.runtime.select('hold-amount');assert.equal(await f.run(),false);assert.deepEqual(f.sends,[]);
  assert.equal(f.state.lastOppBoatMs,5);assert.equal(f.state.beachhead.surged,false);
  f.runtime.select('legacy-v1');assert.equal(await f.run(),true);assert.equal(f.sends.length,1);
});
test('command-level policy hold stops surge fallback while failed dispatch can still fall through',async()=>{
  const base=legacy();const f=fixture({beachhead:{tile:0,at:90,surged:false},strategies:[{id:'hold-command',version:'1',decide(s,cs){
    return cs.some(c=>c.kind==='intent')?{selectedId:null,reason:'hold command'}:base.decide(s,cs);
  }}]});
  f.actor.emitBoat=(tile,troops)=>f.runtime.intent(f.actor,'AttackBehavior',function boat(){},tile,troops);
  f.runtime.select('hold-command');assert.equal(await f.run(),false);
  assert.deepEqual(f.calls,['probe:0']);assert.equal(f.state.lastOppBoatMs,5);assert.equal(f.state.beachhead.surged,false);
});
test('nearby destination hold prevents probes and fallback searches',async()=>{
  const base=legacy();const f=fixture({strategies:[{id:'hold-nearby',version:'1',decide(s,cs){
    return s.domain==='boat-destination'?{selectedId:'$wait',reason:'hold site'}:base.decide(s,cs);
  }}]});
  f.actor.scanNearbyTargets=()=>[{tile:3,owned:true}];f.runtime.select('hold-nearby');
  assert.equal(await f.run(),false);assert.deepEqual(f.sends,[]);assert.deepEqual(f.calls,['disconnected']);
  assert.equal(f.state.lastOppBoatMs,5);
});
test('original fallback order and RNG cadence are preserved', async () => {
  const f = fixture(); assert.equal(await f.run(), false);
  assert.deepEqual(f.calls, ['disconnected', 'nearby', 'crater', 'random', 'random-free', 'random', 'random-enemy', 'distant']);
});
test('successful surge at tile zero uses original fraction and updates only surge state', async () => {
  const f = fixture({ beachhead: { tile: 0, at: 90, surged: false } });
  assert.equal(await f.run(), true); assert.deepEqual(f.sends, [[0, 250, '⚓ Surge landing']]);
  assert.equal(f.state.beachhead.surged, true); assert.equal(f.state.lastOppBoatMs, 10000);
  assert.deepEqual(f.calls, ['probe:0']);
});
test('failed surge dispatch falls through but failed ordinary dispatch ends pass', async () => {
  const f = fixture({ emit: false, beachhead: { tile: 1, at: 90, surged: false } });
  f.actor.findDisconnectedBoatTarget = async () => { f.calls.push('disconnected'); return 2; };
  assert.equal(await f.run(), false); assert.equal(f.sends.length, 2);
  assert.deepEqual(f.calls, ['probe:1', 'disconnected']);
  assert.equal(f.state.lastOppBoatMs, 5); assert.equal(f.state.beachhead.surged, false);
});
test('selected target below fill threshold ends pass instead of trying another plan', async () => {
  const f = fixture({ fill: .2 }); f.actor.findDisconnectedBoatTarget = async () => 0;
  assert.equal(await f.run(), false); assert.deepEqual(f.calls, []); assert.deepEqual(f.sends, []);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'naval-action-result' && r.status === 'held'));
});
test('nearby fallout flags preserve labels, lower fill and new beachhead', async () => {
  const f = fixture({ fill: .4 }); f.actor.scanNearbyTargets = () => [{ tile: 0, owned: true, fallout: true }];
  assert.equal(await f.run(), true); assert.deepEqual(f.sends, [[0, 10, '☢️ Nuked-coast grab']]);
  assert.deepEqual(f.state.beachhead, { tile: 0, at: 100, surged: false });
});
test('replacement policy chooses random enemy first without other searches', async () => {
  const base = legacy();
  const f = fixture({ strategies: [{ id: 'random-first', version: '1', decide: (s, cs) => s.domain === 'naval-action' ?
    { selectedId: cs.find(c => c.purpose === 'random-enemy').id, reason: 'Test choice' } : base.decide(s, cs) }] });
  f.runtime.select('random-first'); f.actor.findRandomBoatTarget = async (shore, excluded, free) => { f.calls.push(free); return 4; };
  assert.equal(await f.run(), true); assert.deepEqual(f.calls, ['random', false]);
});
test('explicit naval wait does not run any plan', async () => {
  const f = fixture({ strategies: [{ id: 'hold', version: '1', decide: () => ({ selectedId: '$wait', reason: 'Wait' }) }] });
  f.runtime.select('hold'); assert.equal(await f.run(), false); assert.deepEqual(f.calls, []);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'naval-action-result' && r.status === 'wait'));
});
for (const policyError of [false, true]) test(`nested landing wait/error stops fallback and resets next pass (${policyError})`, async () => {
  const base = legacy(); const f = fixture({ strategies: [{ id: 'hold-landing', version: '1', decide(s, cs) {
    if (s.domain === 'naval-landing') { if (policyError) throw Error('policy failed'); return { selectedId: '$wait', reason: 'Wait' }; }
    return base.decide(s, cs);
  } }] });
  f.actor.findDisconnectedBoatTarget = () => f.runtime.planNavalLanding(f.actor, [{ tile: 3, dist: 1 }], { mode: 'disconnected', probeCap: 12 });
  f.runtime.select('hold-landing'); assert.equal(await f.run(), false); assert.deepEqual(f.calls, []);
  assert.ok(f.runtime.inspect().records.some(r => r.kind === 'naval-action-result' && r.status === 'stopped'));
  f.runtime.select('legacy-v1'); assert.equal(await f.run(), true); assert.equal(f.sends[0][0], 3);
});
test('disabled owner after awaited search cannot emit or change timestamps', async () => {
  const f = fixture(); f.actor.findDisconnectedBoatTarget = async () => { f.stop(); return 4; };
  assert.equal(await f.run(), false); assert.deepEqual(f.sends, []); assert.equal(f.state.lastOppBoatMs, 5);
});
test('nested landing and boat command link to selected naval purpose, then clear', async () => {
  const f = fixture();
  f.actor.findDisconnectedBoatTarget = () => f.runtime.planNavalLanding(f.actor, [{ tile: 3 }], { mode: 'disconnected', probeCap: 12 });
  f.actor.emitBoat = (tile, troops) => f.runtime.intent(f.actor, 'AttackBehavior', function boat() {}, tile, troops);
  await f.run(); f.runtime.intent(f.actor, 'AttackBehavior', function boat() {}, 9, 1);
  const ds = f.decisions(), landing = ds.find(d => d.snapshot.domain === 'naval-landing');
  const allocation=ds.find(d=>d.snapshot.domain==='boat-allocation');
  const commands = ds.filter(d => d.candidates[0].kind === 'intent');
  assert.equal(allocation.snapshot.parentDecisionId,landing.decisionId);
  assert.equal(commands[0].candidates[0].parentDecisionId, allocation.decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId, undefined);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
