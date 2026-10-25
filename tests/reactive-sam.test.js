'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const createReactiveSam = require('../src/brain/reactive-sam');

function fixture(overrides = {}) {
  const predictor = createReactiveSam({ range:level => 150 - 480 / (level + 5),
    distance:(a,b) => Math.abs(a-b), distanceSquared:(a,b) => (a-b)**2, ...overrides });
  const sam = { id:1, tile:0, level:1, queue:[], active:true, building:false };
  const threat = { id:10, trajectory:Array.from({length:101}, () => ({tile:80,targetable:true})),
    index:0, waitTicks:0, existingInterceptor:false, threatensSelf:true };
  const input = { tick:100, threats:[threat], sams:[sam], candidates:[{unitId:1,cost:3000000n}] };
  return { predictor, sam, threat, input, assess:() => predictor.assess(input)[0] };
}

test('a completed existing SAM already covering the future trajectory prevents spending', () => {
  const f=fixture(); f.threat.trajectory.forEach(p => {p.tile=60;});
  const result=f.assess(); assert.equal(result.canDefend,false); assert.equal(result.reason,'already-covered');
  assert.deepEqual(result.targetIds,[10]);
});
test('a gradual range upgrade changes an uncovered strike to a timely interception', () => {
  const f=fixture(), result=f.assess(); assert.equal(result.canDefend,true);
  assert.equal(result.reason,'upgrade-enables-interception'); assert.equal(result.cost,3000000n);
  assert.deepEqual(result.targetIds,[10]); assert.ok(result.interceptionTick>=102);
  assert.ok(result.launchTick>=102); assert.ok(result.effectiveRange>=80);
});
test('new capacity starts cooling and does not immediately add a ready interceptor', () => {
  const f=fixture(); f.sam.queue=[99]; f.threat.trajectory=f.threat.trajectory.slice(0,60);
  assert.equal(f.assess().canDefend,false); assert.equal(f.assess().reason,'upgrade-cannot-intercept');
});
test('a strike arriving before an existing slot refills cannot be saved by upgrading', () => {
  const f=fixture(); f.sam.queue=[99]; f.threat.trajectory=f.threat.trajectory.slice(0,5);
  assert.equal(f.assess().canDefend,false);
});
test('a useful range upgrade may use an existing slot after its cooldown ends', () => {
  const f=fixture(); f.sam.queue=[60]; const result=f.assess();
  assert.equal(result.canDefend,true); assert.ok(result.launchTick>=150);
});
test('non-targetable future flight and impact cannot be intercepted', () => {
  const f=fixture(); f.threat.trajectory.forEach(p => {p.targetable=false;});
  assert.equal(f.assess().canDefend,false);
});
test('native final-target fallback can cover detonation despite an out-of-range penultimate tile', () => {
  const f=fixture(); f.threat.trajectory.forEach(point => {point.tile=90;});
  f.threat.trajectory.at(-1).tile=80;
  const result=f.assess(); assert.equal(result.canDefend,true); assert.equal(result.kind,'impact');
  assert.equal(result.coverageTile,80); assert.equal(result.interceptionTile,90);
});
test('final-target fallback still requires a targetable penultimate flight tile', () => {
  const f=fixture(); f.threat.trajectory.forEach(point => {point.tile=90; point.targetable=false;});
  Object.assign(f.threat.trajectory.at(-1),{tile:80,targetable:true});
  assert.equal(f.assess().canDefend,false);
});
test('allied completed SAM coverage also prevents spending on an upgrade', () => {
  const f=fixture(); f.input.sams.push({...f.sam,id:2,tile:50});
  const result=f.assess(); assert.equal(result.canDefend,false); assert.equal(result.reason,'already-covered');
  assert.equal(result.baselineSamId,2);
});
test('an existing friendly interceptor prevents unnecessary upgrades', () => {
  const f=fixture(); f.threat.existingInterceptor=true;
  assert.equal(f.assess().reason,'already-intercepted'); assert.equal(f.assess().canDefend,false);
});
test('a second strike is accounted for before claiming a useful range upgrade', () => {
  const f=fixture(); f.input.threats.push({...f.threat,id:11});
  const r=f.assess();assert.equal(r.canDefend,true);assert.equal(r.competingThreatCount,1);
  assert.ok(r.launchTick>=r.newSlotReadyTick);
});

test('three geometrically covered strikes cannot reuse one ready missile slot',()=>{
 const f=fixture();f.threat.trajectory=f.threat.trajectory.slice(0,30).map(p=>({...p,tile:60}));
 f.input.threats.push({...f.threat,id:11},{...f.threat,id:12});
 assert.equal(f.assess().reason,'competing-threats');assert.equal(f.assess().canDefend,false);
});

test('a strike aimed elsewhere also reserves upgraded SAM ammunition', () => {
  const f=fixture(); f.input.threats.push({...f.threat,id:11,threatensSelf:false});
  const r=f.assess();assert.equal(r.canDefend,true);assert.equal(r.competingThreatCount,1);
  assert.ok(r.launchTick>=r.newSlotReadyTick);
});

test('a hydro requiring more range can be protected despite another competing atom',()=>{
 const f=fixture();f.threat.isHydrogen=true;
 f.input.threats.push({...f.threat,id:11,isHydrogen:false,trajectory:f.threat.trajectory.map(p=>({...p,tile:60}))});
 const r=f.assess();assert.equal(r.canDefend,true);assert.deepEqual(r.targetIds,[10]);
 assert.equal(r.competingThreatCount,1);assert.ok(r.launchTick>=r.newSlotReadyTick);
});

test('competition cannot borrow a cooling upgrade slot before it is ready',()=>{
 const f=fixture();f.threat.trajectory=f.threat.trajectory.slice(0,80);
 f.input.threats.push({...f.threat,id:11});assert.equal(f.assess().canDefend,false);
});

test('a distant unrelated strike outside upgraded coverage does not block defense', () => {
  const f=fixture(); f.input.threats.push({...f.threat,id:11,threatensSelf:false,
    trajectory:f.threat.trajectory.map(p=>({...p,tile:1000}))});
  assert.equal(f.assess().canDefend,true);
});

test('an ambiguous unassigned unrelated strike cannot prove ammunition availability', () => {
  const f=fixture(); f.input.threats.push({...f.threat,id:11,threatensSelf:false,ambiguous:true});
  assert.equal(f.assess().reason,'competing-threats');
});
test('an ongoing range upgrade is not stacked', () => {
  const f=fixture(); Object.assign(f.sam,{level:2,upgradeStartTick:90,upgradeStartRange:70,
    upgradeTargetLevel:2,upgradeDuration:45});
  assert.equal(f.assess().reason,'upgrade-in-progress'); assert.equal(f.assess().canDefend,false);
});
test('absent, ambiguous, and malformed trajectory state all fail closed', () => {
  for (const patch of [{trajectory:[]},{ambiguous:true},{index:NaN},{index:999},{waitTicks:-1},
    {trajectory:[{tile:80,targetable:true},{}]}]) {
    const f=fixture(); Object.assign(f.threat,patch);
    assert.equal(f.assess().canDefend,false); assert.equal(f.assess().reason,'uncertain-trajectory');
  }
});
test('inactive and unfinished SAMs cannot be upgraded or counted as coverage', () => {
  for (const patch of [{active:false},{building:true}]) {
    const f=fixture(); Object.assign(f.sam,patch);
    assert.equal(f.assess().reason,'sam-unavailable'); assert.equal(f.assess().canDefend,false);
  }
});
test('short remaining flight fails even if final upgraded radius would cover it', () => {
  const f=fixture(); f.threat.index=98;
  assert.equal(f.assess().canDefend,false);
});
test('range expansion is gradual and cannot be treated as instantly complete', () => {
  const f=fixture(); f.threat.trajectory=f.threat.trajectory.slice(0,20);
  assert.equal(f.assess().canDefend,false);
});
test('unrelated and already assigned strikes do not cause upgrades', () => {
  const f=fixture(); f.threat.threatensSelf=false;
  assert.equal(f.assess().reason,'no-relevant-threat'); assert.equal(f.assess().canDefend,false);
});
test('read-only assessment preserves normalized objects and quotes', () => {
  const f=fixture(), snapshot=JSON.stringify({...f.input,candidates:[]});
  f.assess(); assert.equal(JSON.stringify({...f.input,candidates:[]}),snapshot);
});
