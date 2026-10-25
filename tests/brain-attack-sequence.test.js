'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const file=require('node:path').join(__dirname,'../src/brain/attack-sequence-planner.js');
const createPlanner=fs.existsSync(file)?require(file):null;
const legacy=require('../src/brain/legacy-strategy')();
const target=(id,troops=1,disconnected=true)=>({id:()=>id,troops:()=>troops,isPlayer:()=>true,
  type:()=> 'Human',isDisconnected:()=>disconnected});
function fixture(options={}) {
  const calls=[],decisions=[],records=[];let active=true;
  const state={settings:{winFixes:!!options.winFixes,features:{donate:!!options.donate}}};
  const actor={game:{terraNullius:()=>target('land')},
    allianceBehavior:{reachOutToFarNations:()=>calls.push('far-alliance'),maybeSendAllianceRequests:()=>calls.push('alliances')},
    random:{chance:n=>{calls.push('chance:'+n);return !!options.random;}},
    openingSnapshot:()=>{calls.push('opening');return {applies:!!options.opening,built:false,over:false};},
    sendAttack:async t=>{calls.push('send:'+t.id());if(options.stopOnSend) active=false;return t.id()===options.success;},
    attackBots:async()=>{calls.push('bots');return !!options.botSuccess;},
    maybeOpportunisticBoat:async()=>{calls.push('opportunistic');return true;},
    donateTroops:()=>{calls.push('donate');return true;},
    attackWithRandomBoat:async enemies=>{calls.push('random-boat:'+(enemies?.length||0));return !!options.boatSuccess;},
    attackBestTarget:async()=>{calls.push('main');}
  };
  const context={all:options.all||[],friends:[],enemies:options.enemies||[],openLand:!!options.openLand,
    expand:options.expand!==false,boat:options.boat!==false,alliance:options.alliance!==false};
  const planner=createPlanner&&createPlanner({state,botType:'Bot',now:()=>10000,debug:()=>{}});
  const hooks={allowed:()=>active,choose(domain,candidates,facts){decisions.push({domain,candidates,facts});
    return {...(options.choose?options.choose(domain,candidates):legacy.decide({domain},candidates)),decisionId:decisions.length};},
    execute:(_id,run)=>run(),record:(kind,details)=>records.push({kind,...details})};
  return {planner,actor,context,hooks,calls,decisions,records,state};
}
test('attack sequence planner exists',()=>assert.equal(typeof createPlanner,'function'));
test('takeover attempts weakest disconnected neighbor once before expansion',async()=>{
  const f=fixture({winFixes:true,all:[target('strong',50),target('weak',5)],success:'weak'});
  assert.equal(await f.planner.run(f.actor,f.context,f.hooks),undefined);
  assert.deepEqual(f.calls,['send:weak']);
  assert.equal(f.decisions.at(-1).domain,'takeover-target');
});
test('failed takeover falls through to original maintenance and open land',async()=>{
  const f=fixture({winFixes:true,all:[target('weak')],openLand:true,success:'land',donate:true});
  await f.planner.run(f.actor,f.context,f.hooks);
  assert.deepEqual(f.calls,['send:weak','opportunistic','opening','donate','far-alliance','send:land']);
  assert.equal(f.state.lastDonateMs,10000);
});
test('random boat success returns early only when hostile neighbors exist',async()=>{
  for(const enemies of [[],[target('enemy')]]) {
    const f=fixture({random:true,boatSuccess:true,enemies});await f.planner.run(f.actor,f.context,f.hooks);
    assert.deepEqual(f.calls,enemies.length?['opening','chance:10','random-boat:1']:['opening','chance:5','random-boat:0','main']);
  }
});
test('opening prevents donation but retains other original maintenance',async()=>{
  const f=fixture({winFixes:true,donate:true,opening:true,boat:false});await f.planner.run(f.actor,f.context,f.hooks);
  assert.deepEqual(f.calls,['opportunistic','opening','far-alliance','main']);
});

test('safe rear donates after wilderness without waiting for economic buildings and uses a one-second throttle',async()=>{
 const f=fixture({winFixes:true,donate:true,opening:true,boat:false});
 f.hooks.supportPosture=()=>({ready:true,conserve:false,donationThrottleMs:1000});
 f.state.lastDonateMs=8500;
 await f.planner.run(f.actor,f.context,f.hooks);assert.ok(f.calls.includes('donate'));assert.ok(f.calls.includes('main'));
});

test('mainland danger skips support donation but leaves the main attack phase running',async()=>{
 const f=fixture({winFixes:true,donate:true,boat:false});
 f.hooks.supportPosture=()=>({ready:true,conserve:true,reason:'Enemy near home'});
 await f.planner.run(f.actor,f.context,f.hooks);assert.ok(!f.calls.includes('donate'));assert.ok(f.calls.includes('main'));
});

test('local expansion can accumulate an army across turns instead of donating it away',async()=>{
 let troops=500,donations=0,attacks=0;
 const opening={frontline:false,borderKnown:true,wilderness:false,expansionPending:true};
 const posture={ready:true,conserve:false,donationReady:false,donationHoldReason:'Expand local territory first',donationThrottleMs:1000};
 const f=fixture({winFixes:true,donate:true,boat:false,
  choose:(domain,cs)=>adaptiveOpening.decide({domain,teamOpening:opening,supportPosture:posture},cs)});
 f.context.teamOpening=opening;f.hooks.supportPosture=()=>posture;
 f.actor.donateTroops=()=>{donations++;troops=250;return false;};
 f.actor.attackBestTarget=async()=>{if(troops>=700){attacks++;troops-=300;}};
 for(let i=0;i<3;i++){await f.planner.run(f.actor,f.context,f.hooks);troops+=100;}
 assert.equal(donations,0);assert.equal(attacks,1);
});
test('takeover policy hold and stale send completion stop the rest of the pass',async()=>{
  for(const options of [{choose:(domain,candidates)=>domain==='takeover-target'?{selectedId:'$wait',reason:'hold'}:legacy.decide({domain},candidates)},
    {stopOnSend:true}]) {
    const f=fixture({...options,winFixes:true,all:[target('weak')],openLand:true});
    await f.planner.run(f.actor,f.context,f.hooks);
    assert.ok(f.calls.length<=1);assert.ok(f.records.some(r=>r.status==='stopped'));
  }
});
test('takeover candidate window contains original weakest target and primitive facts',async()=>{
  const all=Array.from({length:100},(_,i)=>target('p'+i,100-i));
  const f=fixture({winFixes:true,all,success:'p99'});await f.planner.run(f.actor,f.context,f.hooks);
  const d=f.decisions.find(d=>d.domain==='takeover-target');
  assert.equal(d.candidates.length,80);assert.equal(d.candidates[0].targetId,'p99');
  assert.doesNotThrow(()=>JSON.stringify(d));assert.deepEqual(f.calls,['send:p99']);
});

const adaptiveOpening=require('../src/brain/adaptive-strategy')(legacy);
test('safe wilderness attempt never falls through to countries, probes or donation after failure',async()=>{
 for(const expand of [true,false]) {
  const teamOpening={frontline:false,borderKnown:true,wilderness:true};
  const f=fixture({expand,winFixes:true,all:[target('disconnected')],enemies:[target('tribe',1)],donate:true,
    choose:(domain,cs)=>adaptiveOpening.decide({domain,teamOpening},cs)});
  f.context.teamOpening=teamOpening;
  await f.planner.run(f.actor,f.context,f.hooks);
  assert.deepEqual(f.calls,expand?['send:land']:[]);
 }
});

test('a river crossing can run before the wilderness wave without replacing land expansion',async()=>{
 const opening={frontline:false,borderKnown:true,wilderness:true};
 const f=fixture({winFixes:true,choose:(domain,cs)=>adaptiveOpening.decide({domain,teamOpening:opening},cs)});
 f.context.teamOpening=opening;f.hooks.crossWilderness=async()=>{f.calls.push('river');return true;};
 await f.planner.run(f.actor,f.context,f.hooks);assert.deepEqual(f.calls,['river','send:land']);
});

test('a failed river lookup still permits the opening land wave',async()=>{
 const opening={frontline:false,borderKnown:true,wilderness:true};
 const f=fixture({winFixes:true,choose:(domain,cs)=>adaptiveOpening.decide({domain,teamOpening:opening},cs)});
 f.context.teamOpening=opening;f.hooks.crossWilderness=async()=>{f.calls.push('river-failed');return false;};
 await f.planner.run(f.actor,f.context,f.hooks);assert.deepEqual(f.calls,['river-failed','send:land']);
});
