'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require('node:path').join(__dirname,'../src/brain/warship-safety-planner.js');
const create=fs.existsSync(file)?require(file):null;
const legacy=require('../src/brain/legacy-strategy')();
function fixture(policy) {
  assert.equal(typeof create,'function','safety planner exists');
  const records=[],calls=[];
  const self={smallID:()=>1};
  const port=(tile,owner=self)=>({tile:()=>tile,owner:()=>owner,isActive:()=>true,isUnderConstruction:()=>false});
  const ports=[port(10),port(20)],ship={tile:()=>0,id:()=>1};
  const actor={player:self,game:{units:()=>ports,manhattanDist:(a,b)=>Math.abs(a-b),
    neighbors:tile=>[tile+1,tile+2],isWater:()=>true,
    isValidCoord:()=>true,ref:(x,y)=>`${x},${y}`}};
  const hooks={allowed:()=>true,choose:(domain,candidates,facts)=>{
    const decision={decisionId:records.length+1,...(policy?policy(domain,candidates):legacy.decide({domain},candidates))};
    records.push({domain,candidates,facts,decision});return decision;
  },record:(kind,data)=>records.push({kind,...data}),execute:(id,fn)=>fn(),remember:()=>{}};
  return {actor,ports,ship,port,records,calls,hooks,planner:create({portType:'Port',settings:()=>({})})};
}
test('home defaults to nearest eligible port then first water neighbor',()=>{
  const f=fixture();assert.equal(f.planner.home(f.actor,f.ship,f.hooks).tile,11);
});
test('home policy can choose a different port',()=>{
  const f=fixture((d,cs)=>d==='warship-home'?{selectedId:cs[1].id,reason:'second'}:legacy.decide({domain:d},cs));
  assert.equal(f.planner.home(f.actor,f.ship,f.hooks).tile,21);
});
test('home hold differs from empty eligible port pool',()=>{
  const f=fixture(()=>({selectedId:'$wait',reason:'hold'}));assert.equal(f.planner.home(f.actor,f.ship,f.hooks).held,true);
  const g=fixture();g.ports.splice(0);const result=g.planner.home(g.actor,g.ship,g.hooks);
  assert.equal(result.tile,null);assert.equal(result.held,false);
});
test('home dry-port fallback preserves port tile',()=>{
  const f=fixture();f.actor.game.isWater=()=>false;assert.equal(f.planner.home(f.actor,f.ship,f.hooks).tile,10);
});
test('escape default maximizes ETA then minimizes travel distance',()=>{
  const f=fixture();const result=f.planner.escape(f.actor,0,0,[{tx:0,ty:0,radius:10}],()=>Infinity,f.hooks);
  assert.equal(result.eta,Infinity);assert.equal(result.tile,'30,0');
});
test('escape policy hold returns no destination',()=>{
  const f=fixture((d,cs)=>d==='warship-nuke-escape'?{selectedId:'$wait',reason:'hold'}:legacy.decide({domain:d},cs));
  assert.equal(f.planner.escape(f.actor,0,0,[{tx:0,ty:0,radius:10}],()=>Infinity,f.hooks),null);
});
test('large home pool retains nearest winner beyond original window',()=>{
  const f=fixture();f.ports.splice(0,...Array.from({length:100},(_,i)=>f.port(i===99?1:100+i)));
  assert.equal(f.planner.home(f.actor,f.ship,f.hooks).tile,2);
  const record=f.records.find(r=>r.domain==='warship-home');assert.equal(record.candidates.length,80);
});
test('large threat pool retains original closest zone',()=>{
  const f=fixture(),zones=Array.from({length:100},(_,i)=>({tx:i===99?0:100+i,ty:0,radius:10}));
  assert.equal(f.planner.escape(f.actor,0,0,zones,()=>Infinity,f.hooks).tile,'30,0');
  const record=f.records.find(r=>r.domain==='warship-nuke-threat');assert.equal(record.candidates.length,80);
  assert.equal(record.candidates[0].index,99);
});
