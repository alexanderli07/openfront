'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/brain/warship-deployment-planner.js');
const create = fs.existsSync(file) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function fixture(options = {}) {
  const calls = [], records = []; let active = true;
  const player = { id: () => 'self', gold: () => options.gold ?? 101,
    units: type => type === 'Port' ? [{ tile: () => 4 }] : [], isFriendly: p => p.friendly === true };
  const actor = { player, game: { players: () => options.players || [] },
    cost: () => 100, random: { randElement: a => { calls.push('random'); return a[0]; } },
    warshipSpawnTile: (tile, radius) => { calls.push(['spawn', tile, radius]); return 0; },
    buildableWarship: async tile => { calls.push(['probe', tile]); return { canBuild: tile }; },
    _deployWarshipReady: (tile, buildable) => { calls.push(['deploy', tile, buildable]); return true; },
    _counterWarshipReady: (tile, buildable) => { calls.push(['counter', tile, buildable]); return 'build-attempted'; } };
  const hooks = { allowed: () => active, execute: (id, fn) => fn(),
    choose: (domain, candidates, facts) => {
      records.push({ kind: 'candidates', domain, candidates, facts });
      return { ...(options.choose ? options.choose(domain, candidates) : legacy().decide({ domain }, candidates)), decisionId: 7 };
    }, record: (kind, data) => records.push({ kind, ...data }) };
  const planner = create({ portType: 'Port', warshipType: 'Warship' });
  return { planner, actor, hooks, calls, records, stop: () => { active = false; } };
}
function enemy(id, count, team = null) {
  return { id: () => id, team: () => team, units: () => Array.from({ length: count }, (_, i) => ({ id: () => `${id}-${i}`, tile: () => i })) };
}
test('deployment planner exists', () => assert.equal(typeof create, 'function'));
test('deployment gold check is strict; selected deployment keeps random port and radius', async () => {
  const f = fixture({ gold: 100 }); assert.equal(await f.planner.deploy(f.actor, f.hooks), false); assert.deepEqual(f.calls, []);
  const g = fixture(); assert.equal(await g.planner.deploy(g.actor, g.hooks), true);
  assert.deepEqual(g.calls, ['random', ['spawn', 4, 250], ['probe', 0], ['deploy', 0, { canBuild: 0 }]]);
});
test('FFA skips threshold and friendly fleets and keeps first eligible', () => {
  const friend = enemy('friend', 90); friend.friendly = true;
  const target = enemy('first', 11);
  const f = fixture({ players: [enemy('small', 10), friend, target, enemy('larger', 20)] });
  assert.equal(f.planner.select(f.actor, false, f.hooks).target.player, target); assert.deepEqual(f.calls, ['random']);
});
test('team aggregate threshold and strongest tie preserve team insertion order', () => {
  const first = enemy('a', 8, 'red');
  const f = fixture({ players: [enemy('below', 15, 'blue'), first, enemy('tie', 8, 'red'), enemy('big', 30, 'green')] });
  assert.equal(f.planner.select(f.actor, true, f.hooks).target.player, first);
});
test('policy can choose another eligible fleet or wait without RNG', () => {
  const later = enemy('later', 20);
  const f = fixture({ players: [enemy('first', 11), later], choose: (d, cs) => ({ selectedId: cs[1].id, reason: 'Choose later' }) });
  assert.equal(f.planner.select(f.actor, false, f.hooks).target.player, later);
  const g = fixture({ players: [later], choose: () => ({ selectedId: '$wait', reason: 'Hold' }) });
  assert.equal(g.planner.select(g.actor, false, g.hooks).target, null); assert.deepEqual(g.calls, []);
});
test('large eligible fleet pool stays within engine limit and includes original winner', () => {
  const players = Array.from({ length: 100 }, (_, i) => enemy(String(i), 11)); const f = fixture({ players });
  assert.equal(f.planner.select(f.actor, false, f.hooks).target.player, players[0]);
  assert.equal(f.records[0].candidates.length, 80);
});
for (const mode of ['deploy', 'counter']) test(`stale ${mode} probe cannot commit or fall back`, async () => {
  const f = fixture({ players: [enemy('enemy', 11)] }); let resolve;
  f.actor.buildableWarship = () => new Promise(r => { resolve = r; });
  const pending = mode === 'deploy' ? f.planner.deploy(f.actor, f.hooks) : f.planner.counter(f.actor, false, f.hooks);
  f.stop(); resolve(null); await pending;
  assert.equal(f.calls.some(c => Array.isArray(c) && ['deploy', 'counter'].includes(c[0])), false);
  assert.ok(f.records.some(r => r.status === 'stopped'));
});

function runtimeFixture(policy) {
  const f = fixture({ players: [enemy('enemy', 11)] });
  f.actor.game.myPlayer = () => f.actor.player; f.actor.game.ticks = () => 100;
  const runtime = require('../src/brain/runtime')({ createEngine: require('../src/brain/engine'),
    createLegacyStrategy: legacy, warshipDeploymentPlanner: f.planner,
    enabled: () => true, isCurrent: () => true, isPublic: () => false, settings: () => ({}),
    emitIntent: () => true, strategies: policy ? [policy] : [] });
  const bot = { mg: f.actor.game, warshipBehavior: f.actor };
  runtime.attach(bot); runtime.attachBehaviors(bot);
  if (policy) runtime.select(policy.id);
  return { ...f, runtime };
}
for (const mode of ['deploy', 'counter']) for (const throws of [false, true]) {
  test(`runtime ${mode} ${throws ? 'policy error' : 'wait'} makes no search, RNG or command`, async () => {
    const f = runtimeFixture({ id: 'hold', version: '1', decide() {
      if (throws) throw Error('policy'); return { selectedId: '$wait', reason: 'Hold' };
    } });
    const result = mode === 'deploy' ? await f.runtime.planWarshipDeployment(f.actor) : await f.runtime.planWarshipInfestation(f.actor, false);
    assert.equal(result, mode === 'deploy' ? false : undefined); assert.deepEqual(f.calls, []);
    assert.equal(f.runtime.inspect().records.some(r => r.kind === 'strategy-error'), throws);
    if (!throws) assert.ok(f.runtime.inspect().records.some(r => r.kind === 'decision' && r.selectedId === '$wait'));
  });
}
test('concurrent deployment and counter probes restore separate command parents and replay', async () => {
  const f = runtimeFixture(), pending = [];
  f.actor.buildableWarship = () => new Promise(resolve => pending.push(resolve));
  f.actor._deployWarshipReady = tile => f.runtime.intent(f.actor, 'WarshipBehavior', 'build', tile);
  f.actor._counterWarshipReady = tile => { f.runtime.intent(f.actor, 'WarshipBehavior', 'build', tile); return 'build-attempted'; };
  const deploy = f.runtime.planWarshipDeployment(f.actor);
  const counter = f.runtime.planWarshipInfestation(f.actor, false);
  f.runtime.intent(f.actor, 'WarshipBehavior', 'unrelated', 5);
  pending[1]({ canBuild: 0 }); await counter;
  pending[0]({ canBuild: 0 }); assert.equal(await deploy, true);
  f.runtime.intent(f.actor, 'WarshipBehavior', 'unrelated', 6);
  const ds = f.runtime.inspect().records.filter(r => r.kind === 'decision');
  const plans = ds.filter(d => ['warship-deployment', 'warship-infestation'].includes(d.snapshot.domain));
  const commands = ds.filter(d => d.candidates[0].kind === 'intent');
  const details = ds.filter(d => ['warship-port', 'warship-unit'].includes(d.snapshot.domain));
  assert.deepEqual(details.map(d => d.snapshot.parentDecisionId), plans.map(d => d.decisionId));
  assert.deepEqual(commands.map(d => d.candidates[0].parentDecisionId), [undefined, details[1].decisionId, details[0].decisionId, undefined]);
  assert.ok(f.runtime.replay('legacy-v1', f.runtime.inspect()).every(r => r.sameChoice));
});
test('standalone target lookup returns identity synchronously and does not probe', () => {
  const f = runtimeFixture(); const result = f.runtime.selectWarshipInfestation(f.actor, false);
  assert.equal(result.player, f.actor.game.players()[0]);
  assert.equal(typeof result.then, 'undefined'); assert.deepEqual(f.calls, ['random']);
});

test('enemy unit policy selects another ship after exactly one original pool draw',()=>{
  const f=fixture({players:[enemy('fleet',11)],choose:(domain,candidates)=>domain==='warship-unit'?
    {selectedId:candidates[1].id,reason:'second ship'}:legacy().decide({domain},candidates)});
  const result=f.planner.select(f.actor,false,f.hooks);
  assert.equal(result.target.warship.id(),'fleet-1');assert.deepEqual(f.calls,['random']);
});
for(const mode of ['wait','error']) test(`enemy unit ${mode} prevents build probe`,async()=>{
  const f=runtimeFixture({id:'hold-unit',version:'1',decide(snapshot,candidates){
    if(snapshot.domain!=='warship-unit')return legacy().decide(snapshot,candidates);
    if(mode==='error')throw Error('policy error');return {selectedId:'$wait',reason:'hold unit'};
  }});
  await f.runtime.planWarshipInfestation(f.actor,false);
  assert.deepEqual(f.calls,['random']);
});
test('large unit pool retains random winner outside the bounded alternative window',()=>{
  const f=fixture({players:[enemy('fleet',100)]});let drawnArray;
  f.actor.random.randElement=array=>{drawnArray=array;return array.at(-1);};
  const result=f.planner.select(f.actor,false,f.hooks);
  assert.equal(drawnArray.length,100);assert.equal(result.target.warship.id(),'fleet-99');
  const record=f.records.find(r=>r.domain==='warship-unit');
  assert.equal(record.candidates.length,80);assert.equal(record.candidates[0].unitId,'fleet-99');
});

const adaptive=require('../src/brain/adaptive-strategy')(legacy());
function islandFixture(options={}){
 const f=fixture({gold:options.gold??250n});let tick=1;
 const ports=[{tile:()=>4,isUnderConstruction:()=>false,isActive:()=>true}];
 let ships=Array.from({length:options.ships||0},()=>({isActive:()=>true}));
 f.actor.player.units=type=>type==='Port'?ports:ships;
 f.actor.cost=()=>100n;f.actor.game.ticks=()=>tick;
 let facts={island:true,fleetNeeded:ships.length<2,ships:ships.length,targetShips:2,reserve:100n,sharedComponents:[1]};
 f.hooks.naval=()=>facts;
 f.hooks.choose=(domain,candidates,extra)=>({...adaptive.decide({domain,teamNaval:facts,warship:extra},candidates),decisionId:7});
 f.hooks.strategicSite=()=>({tile:0,decisionId:8});
 return {...f,next:()=>{tick++;},setFacts:value=>{facts={...facts,...value};}};
}
test('island fleet builds beyond the first ship but preserves economic reserves and cap',async()=>{
 const f=islandFixture({ships:1});assert.equal(await f.planner.deploy(f.actor,f.hooks),true);
 const poor=islandFixture({gold:199n});assert.equal(await poor.planner.deploy(poor.actor,poor.hooks),false);assert.deepEqual(poor.calls,[]);
 const capped=islandFixture({ships:2});assert.equal(await capped.planner.deploy(capped.actor,capped.hooks),false);
});
test('island deployment rechecks reserve after worker quote and avoids duplicate pending builds',async()=>{
 const f=islandFixture();let resolve;f.actor.buildableWarship=()=>new Promise(r=>{resolve=r;});
 const pending=f.planner.deploy(f.actor,f.hooks);
 assert.equal(await f.planner.deploy(f.actor,f.hooks),false);
 f.setFacts({reserve:200n});resolve({canBuild:0,cost:100n});
 assert.equal(await pending,false);assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0]==='deploy'),false);
 const built=islandFixture();assert.equal(await built.planner.deploy(built.actor,built.hooks),true);
 built.next();assert.equal(await built.planner.deploy(built.actor,built.hooks),false);
});

test('island deployment retries bounded alternative sites when worker rejects the first one',async()=>{
 const f=islandFixture();let probes=0;
 f.hooks.strategicSite=(_ports,_parent,rejected)=>({tile:rejected.has(0)?1:0,decisionId:8});
 f.actor.buildableWarship=async()=>++probes===1?null:{canBuild:1,cost:100n};
 assert.equal(await f.planner.deploy(f.actor,f.hooks),true);assert.equal(probes,2);
});
