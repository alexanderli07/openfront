'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/sam-defense-observer');
const U={SAMLauncher:'SAM',SAMMissile:'Interceptor',AtomBomb:'Atom',HydrogenBomb:'Hydro',
  MIRVWarhead:'Warhead',MIRV:'Carrier',City:'City',Port:'Port',Factory:'Factory',
  MissileSilo:'Silo',DefensePost:'Post'};
function fixture(){
  const list=[], self={smallID:()=>1,isFriendly:owner=>owner.smallID()===2};
  const owner=id=>id===1?self:{smallID:()=>id};
  const game={__src:{isCatchingUp:()=>false},ticks:()=>100,units:(...types)=>list.filter(u=>types.includes(u.type())),
    ownerID:tile=>tile===90?1:3,euclideanDistSquared:(a,b)=>(a-b)**2,
    config:()=>({nukeMagnitudes:()=>({inner:10,outer:30})})};
  function add(type,id,tile,ownerId=1,rawExtra={}){
    const raw={isActive:()=>true,isUnderConstruction:()=>false,missileTimerQueue:()=>[],
      level:()=>1,state:{},...rawExtra};
    const unit={__src:raw,type:()=>type,id:()=>id,tile:()=>tile,owner:()=>owner(ownerId),
      isActive:()=>raw.isActive(),isUnderConstruction:()=>raw.isUnderConstruction(),level:()=>raw.level()};
    list.push(unit);return unit;
  }
  const path=[{tile:10,targetable:true},{tile:30,targetable:true},{tile:90,targetable:true}];
  const nuke=()=>add(U.AtomBomb,10,30,3,{nukeState:()=>({trajectory:path,trajectoryIndex:0,waitTicks:0}),targetTile:()=>90});
  return {list,self,game,add,path,nuke,observe:()=>create({units:U}).observe(game,self)};
}
test('actual live tile corrects a stale native trajectory index',()=>{
  const f=fixture();f.nuke();const observed=f.observe();
  assert.equal(observed.tick,100);assert.equal(observed.threats[0].index,1);
  assert.equal(observed.threats[0].ambiguous,false);assert.equal(observed.threats[0].threatensSelf,true);
});

test('planned defense receives owned economic buildings and SAM ownership',()=>{
 const f=fixture();f.add(U.City,1,80);f.add(U.Port,2,50,2);f.add(U.SAMLauncher,3,0);f.add(U.SAMLauncher,4,50,2);
 const o=f.observe();assert.deepEqual(o.structures,[{id:1,type:U.City,tile:80}]);
 assert.equal(o.sams[0].own,true);assert.equal(o.sams[1].own,false);
});
test('repeated live tiles are ambiguous rather than trusting the stale native index',()=>{
  const f=fixture();f.path[0].tile=30;f.nuke();
  assert.equal(f.observe().threats[0].ambiguous,true);
});
test('allied SAMs and active friendly interceptors normalize using wrapper owners',()=>{
  const f=fixture();const own=f.add(U.SAMLauncher,1,0),ally=f.add(U.SAMLauncher,2,50,2);
  f.add(U.SAMLauncher,3,20,3);f.nuke();
  f.add(U.SAMMissile,20,20,2,{targetUnitId:()=>10});
  const o=f.observe();assert.deepEqual(o.sams.map(s=>s.id),[1,2]);
  assert.deepEqual(o.ownSams,[own]);assert.equal(o.threats[0].existingInterceptor,true);
  assert.equal(ally.__src!==undefined,true);
});
test('friendly nukes and uninterceptable MIRV carriers are excluded',()=>{
  const f=fixture();f.add(U.AtomBomb,10,30,2,{nukeState:()=>({trajectory:f.path,waitTicks:0})});
  f.add(U.MIRV,11,30,3);assert.deepEqual(f.observe().threats,[]);
});

test('a third-party interceptor also marks the strike already assigned',()=>{
  const f=fixture();f.nuke();f.add(U.SAMMissile,20,20,4,{targetUnitId:()=>10});
  assert.equal(f.observe().threats[0].existingInterceptor,true);
});

test('a hostile hydro aimed inside our SAM upgrade area is relevant even on neighbouring land',()=>{
 const f=fixture();f.game.ownerID=()=>2;f.game.config=()=>({samRange:level=>level===1?70:82});
 f.add(U.SAMLauncher,1,0);
 f.add(U.HydrogenBomb,10,30,3,{nukeState:()=>({trajectory:f.path,waitTicks:0}),targetTile:()=>80});
 const t=f.observe().threats[0];assert.equal(t.threatensSelf,false);assert.equal(t.threatensSamArea,true);
 assert.equal(t.isHydrogen,true);assert.equal(t.type,U.HydrogenBomb);
});
test('catch-up state suppresses the complete observation',()=>{
  const f=fixture();f.nuke();f.game.__src.isCatchingUp=()=>true;
  const o=f.observe();assert.equal(o.reason,'catching-up');assert.deepEqual(o.threats,[]);
});
test('missing native missile queue remains invalid and is never guessed ready',()=>{
  const f=fixture();f.add(U.SAMLauncher,1,0,1,{missileTimerQueue:undefined});
  assert.equal(f.observe().sams[0].queue,null);
});
test('renderer SAM range-ramp fields are copied without invented upgrade state',()=>{
  const f=fixture();f.add(U.SAMLauncher,1,0,1,{state:{samUpgradeStartTick:80,
    samUpgradeStartRange:70,samUpgradeTargetLevel:2,samUpgradeDuration:45}});
  const sam=f.observe().sams[0];assert.equal(sam.upgradeStartTick,80);
  assert.equal(sam.upgradeStartRange,70);assert.equal(sam.upgradeTargetLevel,2);assert.equal(sam.upgradeDuration,45);
});
test('positive potentially stale native launch wait cannot inflate the defensive window',()=>{
  const f=fixture();f.nuke().__src.nukeState=()=>({trajectory:f.path,trajectoryIndex:0,waitTicks:30});
  const threat=f.observe().threats[0];assert.equal(threat.ambiguous,true);assert.equal(threat.waitTicks,0);
});
test('missing target tile falls back to the final trajectory tile',()=>{
  const f=fixture();f.nuke().__src.targetTile=()=>undefined;
  assert.equal(f.observe().threats[0].threatensSelf,true);
});
test('a reliable blast radius includes strikes beside an owned structure',()=>{
  const f=fixture();f.game.ownerID=()=>3;f.add(U.City,1,80);f.nuke();
  assert.equal(f.observe().threats[0].threatensSelf,true);
});
test('an absent blast-radius API does not invent peripheral relevance',()=>{
  const f=fixture();f.game.ownerID=()=>3;f.game.config=()=>({});f.add(U.City,1,80);f.nuke();
  assert.equal(f.observe().threats[0].threatensSelf,false);
});
