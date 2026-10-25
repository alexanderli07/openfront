'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require('node:path').join(__dirname,'../src/brain/boat-planner.js');
const createPlanner=fs.existsSync(file)?require(file):null;
const legacy=require('../src/brain/legacy-strategy')();
function fixture(options={}) {
  let active=true;const decisions=[],probes=[],records=[],launches=[];
  const state={settings:{winFixes:!!options.winFixes,boatProbeFrac:.01,boatProbeMinTroops:8000,boatSurgeFrac:.25}};
  const actor={player:{troops:()=>100000},random:{randElement:items=>items.at(-1)},
    boatTargetTaken:tile=>options.taken?.includes(tile),
    findRandomBoatTarget:async(_shore,_enemies,free)=>{probes.push(free?'free':'enemy');return free?options.free??null:options.enemy??null;}};
  const hooks={allowed:()=>active,
    choose(domain,candidates,facts){decisions.push({domain,candidates,facts});return {...(options.choose?options.choose(domain,candidates):legacy.decide({domain},candidates)),decisionId:decisions.length};},
    execute:(_id,run)=>run(),record:(kind,data)=>records.push({kind,...data}),
    probe:async(_id,tile)=>{probes.push(tile);if(options.stopOnProbe)active=false;return !options.failed?.includes(tile);},
    remember:(tile,id)=>records.push({kind:'remember',tile,id}),
    launch:(_id,tile,troops)=>{launches.push({tile,troops});return true;}};
  return {planner:createPlanner&&createPlanner({state}),actor,hooks,state,decisions,probes,records,launches};
}
test('boat planner exists',()=>assert.equal(typeof createPlanner,'function'));

test('enemy probes use reachable hostile shores rather than inland labels, allies or lakes',()=>{
  const f=fixture();
  const enemy={id:()=> 'enemy',smallID:()=>2,isPlayer:()=>true,isAlive:()=>true,borderTiles:()=>new Set([10,20,30]),nameLocation:()=>({x:10,y:0})};
  const ally={...enemy,id:()=> 'ally',smallID:()=>3,borderTiles:()=>new Set([40])};
  Object.assign(f.actor.player,{smallID:()=>1,borderTiles:()=>new Set([0]),isFriendly:p=>p===ally});
  f.actor.getPlayerCenter=()=>({x:0,y:0});
  f.actor.game={players:()=>[enemy,ally],isLand:t=>t<100,isWater:t=>t>=100,isShore:t=>[0,20,30,40].includes(t),
    neighbors:t=>[100+t],getWaterComponent:t=>t<100?null:t===130?2:1,x:t=>t,y:()=>0,ownerID:t=>t===40?3:2};
  const sites=f.planner.enemyProbeSites(f.actor);
  assert.deepEqual(sites.map(s=>s.tile),[20]);
  assert.equal(sites[0].ownerId,'enemy');
});
test('crater choice preserves newest-first ownership checks and permits an older supplied hit',()=>{
  const f=fixture();f.actor.player.smallID=()=>1;f.actor.game={ownerID:tile=>tile===3?1:2};
  assert.equal(f.planner.crater(f.actor,[{tile:1},{tile:2},{tile:3}],f.hooks),2);
  const other=fixture({choose:(_domain,cs)=>({selectedId:cs.find(c=>c.tile===1).id,reason:'older hit'})});
  other.actor.player.smallID=()=>1;other.actor.game={ownerID:()=>2};
  assert.equal(other.planner.crater(other.actor,[{tile:1},{tile:2}],other.hooks),1);
});
test('origin preserves one random draw and permits an alternate supplied shore',()=>{
  const f=fixture();assert.equal(f.planner.origin(f.actor,[1,2,3],f.hooks),3);
  const alternate=fixture({choose:(_domain,cs)=>({selectedId:cs.find(c=>c.tile===1).id,reason:'alternate'})});
  assert.equal(alternate.planner.origin(alternate.actor,[1,2,3],alternate.hooks),1);
});
test('random destination failure suppresses other sites owned by that player',async()=>{
  const f=fixture({failed:[1]});const sites=[{tile:1,ownerId:'a'},{tile:2,ownerId:'a'},{tile:3,ownerId:'b'}];
  assert.equal(await f.planner.destination(f.actor,sites,{mode:'random'},f.hooks),3);
  assert.deepEqual(f.probes,[1,3]);assert.ok(f.records.some(r=>r.status==='unreachable'));
});
test('nearby cap counts taken slots and resumes after a failed probe',async()=>{
  const f=fixture({taken:[1],failed:[2]});const sites=[1,2,3].map(tile=>({tile,owned:true,dist:tile}));
  assert.equal(await f.planner.destination(f.actor,sites,{mode:'nearby',cap:2},f.hooks),null);
  assert.deepEqual(f.probes,[2]);
});
test('destination hold and stale reachability never return a tile',async()=>{
  for(const options of [{choose:()=>({selectedId:'$wait',reason:'hold'})},{stopOnProbe:true}]) {
    const f=fixture(options);assert.equal(await f.planner.destination(f.actor,[{tile:1}],{mode:'random'},f.hooks),null);
    assert.ok(f.records.some(r=>r.status==='stopped'));
  }
});
test('allocation defaults preserve tactical/probe/surge formulas',()=>{
  for(const [mode,winFixes,expected] of [['tactical',false,20000],['tactical',true,8000],['probe',false,8000],['surge',false,25000]]) {
    const f=fixture({winFixes});const choice=f.planner.allocation(f.actor,{tile:1,mode},f.hooks);
    assert.equal(choice.troops,expected);
    assert.equal(f.decisions[0].candidates[0].troops,expected);
  }
});

test('distant 1% probes round down and cannot exceed 1% for small troop pools',()=>{
  for(const [troops,expected] of [[99999,999],[100,1],[99,null],[0,null]]){
    const f=fixture();f.actor.player.troops=()=>troops;
    const amount=f.planner.allocation(f.actor,{tile:9000,mode:'probe-1pct'},f.hooks);
    assert.equal(amount?.troops??null,expected);
  }
});
test('allocation permits alternate amounts and policy hold',()=>{
  const f=fixture({choose:(_domain,cs)=>({selectedId:'boat:half',reason:'smaller'})});
  assert.equal(f.planner.allocation(f.actor,{tile:1,mode:'surge'},f.hooks).troops,12500);
  const hold=fixture({choose:()=>({selectedId:'$wait',reason:'hold'})});assert.equal(hold.planner.allocation(hold.actor,{tile:1,mode:'probe'},hold.hooks),null);
});
test('tactical legacy arithmetic preserves division for fractional troop counts',()=>{
  const f=fixture();f.actor.player.troops=()=>1.1;
  assert.equal(f.planner.allocation(f.actor,{tile:1,mode:'tactical'},f.hooks).troops,1.1/5);
});
test('tactical search only falls back on null and cannot fall through on a hold',async()=>{
  const f=fixture({enemy:4});assert.equal(await f.planner.tactical(f.actor,[1],[],f.hooks),true);
  assert.deepEqual(f.probes,['free','enemy']);assert.equal(f.launches[0].troops,20000);
  const hold=fixture({choose:(domain,cs)=>domain==='boat-search'?{selectedId:'$wait',reason:'hold'}:legacy.decide({domain},cs)});
  assert.equal(await hold.planner.tactical(hold.actor,[1],[],hold.hooks),false);assert.deepEqual(hold.probes,[]);
});
