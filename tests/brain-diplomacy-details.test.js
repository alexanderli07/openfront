'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path').join(__dirname,'../src/brain/diplomacy-details-planner.js');
const create=fs.existsSync(path)?require(path):null,legacy=require('../src/brain/legacy-strategy')();
function fixture(policy) {
  assert.equal(typeof create,'function','details planner exists');const calls=[],records=[];
  const self={smallID:()=>1,troops:()=>1000},target=(id,fill,frontline)=>({smallID:()=>id,id:()=>id,
    troops:()=>fill*1000,isAlive:()=>true,incomingAttacks:()=>frontline?[{}]:[],outgoingAttacks:()=>[]});
  const targets=[target(2,.2,false),target(3,.5,true)];
  const actor={player:self,game:{config:()=>({maxTroops:()=>1000})},effectiveReserveRatio:()=>.45,
    random:{randElement:a=>{calls.push('random');return a[0];}},
    _donateReady:(target,amount)=>{calls.push(['donate',target.smallID(),amount]);return true;},
    _outgoingAllianceCandidate:target=>calls.push(['outreach',target.smallID()]),
    _farOutreachReady:target=>calls.push(['far',target.smallID()])};
  const hooks={allowed:()=>true,choose:(domain,candidates,facts)=>{
    records.push({domain,candidates,facts});return {decisionId:records.length,...(policy?policy(domain,candidates):legacy.decide({domain},candidates))};
  },execute:(id,fn)=>fn(),record:()=>{},hold:()=>calls.push('hold'),wasDeclined:()=>false,allianceStopped:()=>false};
  return {actor,targets,calls,records,hooks,planner:create({settings:()=>({winFixes:true,donateMinDonatePct:.2}),debug:()=>{}})};
}
test('donation defaults frontline first and original reserve excess',()=>{
  const f=fixture();assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),true);
  assert.deepEqual(f.calls,[['donate',3,550]]);
});

test('safe rear support sends a small useful top-up without the old 20 percent minimum',()=>{
 const f=fixture();f.actor.player.troops=()=>500;f.hooks.supportPosture=()=>({ready:true,conserve:false,keepFraction:.25});
 assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),true);
 assert.deepEqual(f.calls,[['donate',3,150]]);
});

test('home conservation blocks donations without holding later combat phases',()=>{
 const f=fixture();f.hooks.supportPosture=()=>({ready:true,conserve:true,reason:'Enemy near home'});
 assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),false);assert.deepEqual(f.calls,[]);
});

test('match c3asGc tick4034 donor can support the front despite the old minimum-excess hold',()=>{
 const f=fixture(),ally=f.targets[1];f.targets=[ally];
 f.actor.player.troops=()=>1092788;ally.troops=()=>500000;
 f.actor.game.config=()=>({maxTroops:p=>p===f.actor.player?2295890.4371926133:1000000});
 assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),false);
 f.hooks.supportPosture=()=>({ready:true,conserve:false,keepFraction:.25});
 assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),true);assert.deepEqual(f.calls,[['donate',3,150000]]);
});

test('adaptive skips rear donations without stopping the enclosing attack pass',()=>{
  const adaptive=require('../src/brain/adaptive-strategy')(legacy);
  const f=fixture((domain,cs)=>adaptive.decide({domain,diplomacy:{threshold:.8}},cs));
  f.targets=f.targets.slice(0,1);
  assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),false);
  assert.deepEqual(f.calls,[]);
});

test('bounded donation candidates expose a needy border ally behind many rear allies',()=>{
  const adaptive=require('../src/brain/adaptive-strategy')(legacy);
  const f=fixture((domain,cs)=>adaptive.decide({domain,diplomacy:{threshold:.8}},cs));
  const targets=Array.from({length:100},(_,i)=>({id:()=>i,smallID:()=>i+2,troops:()=>i===99?600:100,
    isAlive:()=>true,incomingAttacks:()=>[],outgoingAttacks:()=>[],nearby:()=>i===99?[{isPlayer:()=>true,isAlive:()=>true}]:[],
    isFriendly:()=>false,sharesBorderWith:()=>true}));
  assert.equal(f.planner.donate(f.actor,targets,f.hooks),true);
  assert.deepEqual(f.calls,[['donate',101,550]]);
});

for(const mode of ['border','not-border','friendly','dead','unknown'])test(`adaptive peaceful ally front-line measurement: ${mode}`,()=>{
  const adaptive=require('../src/brain/adaptive-strategy')(legacy);
  const f=fixture((domain,cs)=>adaptive.decide({domain,diplomacy:{threshold:.8}},cs));
  const ally=f.targets[0],enemy={isPlayer:()=>true,isAlive:()=>mode!=='dead'};
  ally.nearby=()=>mode==='unknown'?[]:[enemy];ally.isFriendly=()=>mode==='friendly';
  ally.sharesBorderWith=()=>mode==='border';
  const result=f.planner.donate(f.actor,[ally],f.hooks);
  assert.equal(result,mode==='border');
  assert.deepEqual(f.calls,mode==='border'?[['donate',2,550]]:[]);
});
test('amount policy can select half excess',()=>{
  const f=fixture((d,c)=>d==='donation-amount'?{selectedId:c[1].id,reason:'half'}:legacy.decide({domain:d},c));
  f.planner.donate(f.actor,f.targets,f.hooks);assert.deepEqual(f.calls,[['donate',3,275]]);
});
test('recipient hold prevents reserve calculation and dispatch',()=>{
  const f=fixture(()=>({selectedId:'$wait',reason:'hold'}));f.actor.effectiveReserveRatio=()=>{throw Error('must not run');};
  assert.equal(f.planner.donate(f.actor,f.targets,f.hooks),false);assert.deepEqual(f.calls,['hold']);
});
test('outreach defaults original target order',()=>{
  const f=fixture();f.planner.outreach(f.actor,f.targets,f.hooks);
  assert.deepEqual(f.calls,[['outreach',2],['outreach',3]]);
});
test('far outreach keeps original random draw and permits alternate target',()=>{
  const f=fixture((d,c)=>({selectedId:c[1].id,reason:'second'}));
  f.planner.far(f.actor,f.targets,100,{},f.hooks);assert.deepEqual(f.calls,['random',['far',3]]);
});
test('large donation pool retains frontline winner beyond window',()=>{
  const f=fixture(),targets=Array.from({length:100},(_,i)=>({id:()=>i,smallID:()=>i+2,
    troops:()=>i===99?500:100,isAlive:()=>true,incomingAttacks:()=>i===99?[{}]:[],outgoingAttacks:()=>[]}));
  f.planner.donate(f.actor,targets,f.hooks);assert.deepEqual(f.calls,[['donate',101,550]]);
  assert.equal(f.records.find(r=>r.domain==='donation-target').candidates.length,80);
});
test('outreach bounded windows still evaluate all original targets',()=>{
  const f=fixture(),targets=Array.from({length:100},(_,i)=>({smallID:()=>i+2}));
  f.planner.outreach(f.actor,targets,f.hooks);assert.equal(f.calls.length,100);
  assert.equal(f.records[0].candidates.length,80);assert.deepEqual(f.calls.at(-1),['outreach',101]);
});
test('far pool keeps drawn winner outside candidate window and receives original array',()=>{
  const f=fixture(),targets=Array.from({length:100},(_,i)=>({smallID:()=>i+2}));
  f.actor.random.randElement=array=>{assert.equal(array,targets);return array.at(-1);};
  f.planner.far(f.actor,targets,100,{},f.hooks);assert.deepEqual(f.calls,[['far',101]]);
  assert.equal(f.records[0].candidates.length,80);
});
