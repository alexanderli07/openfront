'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/warship-combat-planner.js');
const create = fs.existsSync(file) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function fixture(options = {}) {
  const calls = [], records = []; let active = true;
  const ship = { id: () => 1, tile: () => 0 };
  const actor = { game: { ticks: () => 100, manhattanDist: (a,b) => Math.abs(a-b), getWaterComponent: () => 1 },
    findSafeWaypoint: () => { calls.push('waypoint'); return 40; },
    moveWarship: (s,t) => calls.push(['move', t]), player: { smallID: () => 1, units: () => [] },
    random: { nextInt: () => { calls.push('random'); return options.roll ?? 0; } },
    buildableWarship: async () => { calls.push('probe'); return { canBuild: 3 }; },
    _retaliateBuildReady: (...args) => calls.push(['ready', ...args]),
    maybeMoveWarship: tile => calls.push(['reposition', tile]) };
  const smart = { cooldown: new Map() };
  const context = { ship, smart, health: 100, maxHealth: 100, retreatRatio: .75,
    evade: false, enemies: [], trades: [], home: 50, hunt: true, patrol: {}, ...options.context };
  const hooks = { allowed: () => active, hold: () => {}, execute: (id, fn) => fn(),
    choose: (domain, cs) => ({ ...(options.choose ? options.choose(domain, cs) : legacy().decide({ domain }, cs)), decisionId: 7 }),
    record: (kind, data) => records.push({ kind, ...data }) };
  const planner = create({ warshipType: 'Warship', difficulty: () => options.difficulty || 'Impossible' });
  return { actor, context, hooks, calls, records, planner, stop: () => { active = false; }, run: () => planner.combat(actor, context, hooks) };
}
test('combat planner exists', () => assert.equal(typeof create, 'function'));
test('unsupported piracy ships return toward their team instead of waiting at enemy posts',()=>{
 const adaptive=require('../src/brain/adaptive-strategy')(legacy());
 const f=fixture({context:{hotspotMode:true,hotspotCandidates:[],returnToTeam:70},
  choose:(domain,cs)=>adaptive.decide({domain},cs)});
 f.run();assert.deepEqual(f.calls,[['move',70]]);
});

test('hotspot patrol uses a fixed area even with no current trade targets',()=>{
 const assigned=[],f=fixture({context:{hotspotMode:true,hotspotCandidates:[{tile:180,score:300,density:3,reason:'Dense lane'}]}});
 f.hooks.assigned=area=>assigned.push(area);f.run();
 assert.deepEqual(f.calls,[['move',180]]);assert.equal(assigned[0].tile,180);
});
test('hotspot mode does not fall back to chasing an individual ship',()=>{
 const f=fixture({context:{hotspotMode:true,hotspotCandidates:[],trades:[{tile:()=>40}]}});
 f.run();assert.deepEqual(f.calls,[]);
});
test('retreat retains priority over productive trade areas',()=>{
 const f=fixture({context:{health:1,hotspotMode:true,hotspotCandidates:[{tile:180,score:300}]}});
 f.run();assert.deepEqual(f.calls,[['move',50]]);
});
test('held hotspot policy does not move or confirm an assignment',()=>{
 const f=fixture({context:{hotspotMode:true,hotspotCandidates:[{tile:180}]},
  choose:(domain,cs)=>domain==='warship-hotspot'?{selectedId:'$wait'}:legacy().decide({domain},cs)});
 f.hooks.assigned=()=>assert.fail('held assignment');f.run();assert.deepEqual(f.calls,[]);
});
test('failed hotspot movement does not update assignments or cooldown',()=>{
 const f=fixture({context:{hotspotMode:true,hotspotCandidates:[{tile:180}]}});
 f.actor.moveWarship=()=>false;f.hooks.assigned=()=>assert.fail('failed assignment');f.run();
 assert.equal(f.context.smart.cooldown.size,0);
});

test('trade hunting chooses reachable water before nearest distance and candidate truncation', () => {
  const f=fixture({context:{trades:[...Array.from({length:90},(_,i)=>i+1),200].map(tile=>({tile:()=>tile}))}});
  f.actor.game.getWaterComponent=tile=>tile===0||tile===200?1:2;
  f.run(); assert.deepEqual(f.calls,[['move',200]]);
});

test('trade hunting holds when every trade target is in another water component', () => {
  const f=fixture({context:{trades:[{tile:()=>20}]}});
  f.actor.game.getWaterComponent=tile=>tile===0?1:2;
  f.run(); assert.deepEqual(f.calls,[]);
  assert.ok(f.records.some(r=>r.kind==='warship-target-result'&&r.status==='wait'));
});
test('low health returns home; losing battle chooses safe waypoint', () => {
  const f = fixture({ context: { health: 74 } }); f.run(); assert.deepEqual(f.calls, [['move', 50]]);
  const g = fixture({ context: { evade: true, enemies: [{}] } }); g.run(); assert.deepEqual(g.calls, ['waypoint', ['move', 40]]);
});
test('health boundary attacks weakest first tie and records cooldown', () => {
  const f = fixture({ context: { health: 75, enemies: [30,40].map(tile => ({ tile: () => tile, health: () => 5 })) } });
  f.run(); assert.deepEqual(f.calls, [['move', 30]]); assert.equal(f.context.smart.cooldown.get(1), 100);
});
test('nearest trade and exact patrol distance threshold preserve hold', () => {
  const f = fixture({ context: { trades: [50,30].map(tile => ({ tile: () => tile })), patrol: { patrolTile: 10 } } });
  f.run(); assert.deepEqual(f.calls, []); assert.equal(f.context.smart.cooldown.size, 0);
  assert.ok(f.records.some(r => r.status === 'held'));
});
test('combat wait avoids target search and movement', () => {
  const f = fixture({ context: { health: 1 }, choose: () => ({ selectedId: '$wait' }) }); f.run(); assert.deepEqual(f.calls, []);
});

for (const purpose of ['engage','trade-hunt']) test(`central target can select second ${purpose} candidate`,()=>{
  const units=[30,40].map(tile=>({tile:()=>tile,health:()=>5}));
  const f=fixture({context:purpose==='engage'?{enemies:units}:{trades:units},
    choose:(domain,cs)=>domain==='warship-target'?{selectedId:cs[1].id,reason:'second'}:legacy().decide({domain},cs)});
  f.run();assert.deepEqual(f.calls,[['move',40]]);
});
for (const domain of ['warship-target','warship-destination']) test(`${domain} hold prevents movement and cooldown`,()=>{
  const f=fixture({context:domain==='warship-target'?{enemies:[{tile:()=>30,health:()=>5}]}:{health:1},
    choose:(d,cs)=>d===domain?{selectedId:'$wait',reason:'hold'}:legacy().decide({domain:d},cs)});
  f.run();assert.deepEqual(f.calls,[]);assert.equal(f.context.smart.cooldown.size,0);
});
function waypointFixture(choose) {
  const f=fixture({choose});
  Object.assign(f.actor.game,{getWaterComponent:()=>1,isWater:()=>true,
    neighbors:tile=>tile===0?[1]:tile===1?[0,2]:[1]});
  assert.equal(typeof f.planner.waypoint,'function','waypoint selector is centralized');
  return f;
}
test('waypoint default uses original score and first ties',()=>{
  const f=waypointFixture();assert.equal(f.planner.waypoint(f.actor,0,2,[{tile:()=>0}],f.hooks),2);
});
test('waypoint policy selects another scored water tile',()=>{
  const f=waypointFixture((d,cs)=>({selectedId:cs.find(c=>c.tile===0).id,reason:'stay'}));
  assert.equal(f.planner.waypoint(f.actor,0,2,[{tile:()=>0}],f.hooks),0);
});
test('waypoint policy hold returns no destination',()=>{
  const f=waypointFixture(()=>({selectedId:'$wait',reason:'hold'}));
  assert.equal(f.planner.waypoint(f.actor,0,2,[],f.hooks),null);
});
test('large combat pool includes legacy winner beyond the candidate window',()=>{
  const enemies=Array.from({length:100},(_,i)=>({tile:()=>i,health:()=>i===99?1:5}));
  let batch;
  const f=fixture({context:{enemies},choose:(domain,cs)=>{
    if(domain==='warship-target')batch=cs;
    return legacy().decide({domain},cs);
  }});
  f.run();assert.deepEqual(f.calls,[['move',99]]);assert.equal(batch.length,80);assert.equal(batch[0].tile,99);
});
test('nonfinite enemy health supplies no target while nonfinite trade distance keeps original first trade',()=>{
  const f=fixture({context:{enemies:[{tile:()=>30,health:()=>Infinity},{tile:()=>40,health:()=>NaN}]}});
  f.run();assert.deepEqual(f.calls,[]);assert.equal(f.context.smart.cooldown.size,0);
  const g=fixture({context:{trades:[{tile:()=>30},{tile:()=>40}]}});
  g.actor.game.manhattanDist=()=>Infinity;
  g.run();assert.deepEqual(g.calls,[['move',30]]);
});
test('optional target metadata and unused enemy tiles cannot prevent original winner movement',()=>{
  const enemies=[{id:()=>{throw Error('metadata');},tile:()=>30,health:()=>5},
    {tile:()=>{throw Error('unused tile');},health:()=>6}];
  const f=fixture({context:{enemies}});f.run();assert.deepEqual(f.calls,[['move',30]]);
});
test('retaliation cap repositions without randomness or probe', () => {
  const f = fixture(); f.actor.player.units = () => Array(10);
  assert.equal(f.planner.retaliate(f.actor, 0, { smallID: () => 2 }, 'trade', f.hooks), undefined);
  assert.deepEqual(f.calls, [['reposition', 0]]);
});
test('async retaliation stops stale build completion', async () => {
  const f = fixture(); let resolve;
  f.actor.buildableWarship = () => new Promise(r => { resolve = r; });
  f.planner.retaliate(f.actor, 3, { smallID: () => 2 }, 'transport', f.hooks);
  f.stop(); resolve({ canBuild: 3 }); await new Promise(setImmediate);
  assert.deepEqual(f.calls, ['random']); assert.ok(f.records.some(r => r.status === 'stopped'));
});

function runtimeFixture(policy) {
  const f = fixture();
  f.actor.game.myPlayer = () => f.actor.player;
  const runtime = require('../src/brain/runtime')({ createEngine: require('../src/brain/engine'), createLegacyStrategy: legacy,
    warshipCombatPlanner: f.planner, enabled: () => true, isCurrent: () => true, isPublic: () => false,
    settings: () => ({}), emitIntent: () => true, strategies: policy ? [policy] : [] });
  const bot = { mg: f.actor.game, warshipBehavior: f.actor };
  runtime.attach(bot); runtime.attachBehaviors(bot);
  if (policy) runtime.select(policy.id);
  return { ...f, runtime };
}
for (const throws of [false, true]) test(`runtime policy ${throws ? 'error' : 'wait'} prevents combat and retaliation`, async () => {
  const f = runtimeFixture({ id: 'hold', version: '1', decide() { if (throws) throw Error('policy'); return { selectedId: '$wait', reason: 'Hold' }; } });
  f.context.health = 1; f.runtime.planWarshipCombat(f.actor, f.context);
  f.runtime.planWarshipRetaliation(f.actor, 5, { smallID: () => 2 }, 'trade');
  await new Promise(setImmediate);
  assert.deepEqual(f.calls, ['random']);
  assert.equal(f.context.smart.cooldown.size, 0);
  assert.equal(f.runtime.inspect().records.some(r => r.kind === 'strategy-error'), throws);
  if (!throws) assert.ok(f.runtime.inspect().records.some(r => r.kind === 'decision' && r.selectedId === '$wait'));
});
test('out-of-order retaliation completions keep independent command parents and restore scope', async () => {
  const f = runtimeFixture(); const pending = new Map();
  f.actor.buildableWarship = tile => new Promise(resolve => pending.set(tile, resolve));
  f.actor._retaliateBuildReady = tile => f.runtime.intent(f.actor, 'WarshipBehavior', 'build', tile);
  for (const tile of [10, 20]) f.runtime.planWarshipRetaliation(f.actor, tile, { smallID: () => 2 }, 'trade');
  f.runtime.intent(f.actor, 'WarshipBehavior', 'unrelated', 0);
  pending.get(20)({ canBuild: 20 }); await new Promise(setImmediate);
  pending.get(10)({ canBuild: 10 }); await new Promise(setImmediate);
  f.runtime.intent(f.actor, 'WarshipBehavior', 'unrelated', 0);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const plans = ds.filter(d => d.snapshot.domain === 'warship-retaliation');
  const commands = ds.filter(d => d.candidates[0].kind === 'intent');
  assert.deepEqual(commands.map(d => d.candidates[0].parentDecisionId), [undefined, plans[1].decisionId, plans[0].decisionId, undefined]);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
test('throwing combat executor restores synchronous scope', () => {
  const f = runtimeFixture(); f.context.health = 1;
  f.actor.moveWarship = () => { throw Error('movement'); };
  assert.throws(() => f.runtime.planWarshipCombat(f.actor, f.context), /movement/);
  f.runtime.intent(f.actor, 'WarshipBehavior', 'unrelated', 0);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  assert.equal(ds.at(-1).candidates[0].parentDecisionId, undefined);
});

test('adaptive interception moves toward transport ahead of trade, with retreat still first',()=>{
 const adaptive=require('../src/brain/adaptive-strategy')(legacy());
 const choose=(domain,cs)=>adaptive.decide({domain,teamNaval:{twoTeam:true}},cs);
 const f=fixture({choose,context:{transports:[{tile:90,targetId:'transport',landingDistance:10}],trades:[{tile:()=>20}]}});
 f.run();assert.deepEqual(f.calls,[['move',90]]);
 const low=fixture({choose,context:{health:50,transports:[{tile:90,targetId:'transport'}]}});
 low.run();assert.deepEqual(low.calls,[['move',50]]);
});
