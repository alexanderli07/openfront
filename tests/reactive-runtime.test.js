'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../src/brain/engine'),legacy=require('../src/brain/legacy-strategy'),adaptive=require('../src/brain/adaptive-strategy');
const U={SAMLauncher:'SAM Launcher',SAMMissile:'SAM Missile',AtomBomb:'Atom Bomb',HydrogenBomb:'Hydrogen Bomb',MIRVWarhead:'MIRV Warhead',City:'City',Port:'Port',Factory:'Factory',MissileSilo:'Missile Silo',DefensePost:'Defense Post'};
function fixture(options={}){
 let runtime,normal=0;const builds=[];
 const self={id:()=> 'self',smallID:()=>1,gold:()=>options.gold??3000000n,troops:()=>1000,numTilesOwned:()=>5000,
   incomingAttacks:()=>[],outgoingAttacks:()=>[],isFriendly:p=>p.smallID()===1};
 const enemy={smallID:()=>2};
 const sam={id:()=>1,type:()=>U.SAMLauncher,tile:()=>0,level:()=>options.level??1,isActive:()=>true,isUnderConstruction:()=>false,
   owner:()=>self,missileTimerQueue:()=>options.queue||[],state:{}};
 const x=options.inside?60:80,length=options.late?5:201,path=Array.from({length},(_,i)=>({tile:x*10000+length-1-i,targetable:true}));
 const nuke={id:()=>2,type:()=>options.hydro?U.HydrogenBomb:U.AtomBomb,tile:()=>path[0].tile,isActive:()=>true,owner:()=>enemy,
   targetTile:()=>x*10000,nukeState:()=>({trajectory:path,trajectoryIndex:0,waitTicks:0})};
 const interceptor={id:()=>3,type:()=>U.SAMMissile,isActive:()=>true,owner:()=>self,targetUnitId:()=>2};
 self.units=()=>[sam];
 const game={myPlayer:()=>self,ticks:()=>100,inSpawnPhase:()=>false,players:()=>[self,enemy],ownerID:()=>options.neighbour?2:1,
   units:()=>[sam,...(options.noThreat?[]:[nuke]),...(options.covered?[interceptor]:[])],
   manhattanDist:(a,b)=>Math.abs(Math.floor(a/10000)-Math.floor(b/10000))+Math.abs(a%10000-b%10000),
   euclideanDistSquared:(a,b)=>(Math.floor(a/10000)-Math.floor(b/10000))**2+(a%10000-b%10000)**2,
   config:()=>({isUnitDisabled:()=>false,gameConfig:()=>({}),samRange:level=>level===1?70:82,SAMCooldown:()=>90,samUpgradeDuration:()=>45})};
 const quote={type:U.SAMLauncher,canBuild:false,canUpgrade:1,cost:9000000n,upgradeCosts:[3000000n]};
 const actor={game,player:self,buildableFor:async()=>quote,placementsCount:1,
   cost:()=>1000000n,ownedLevels:type=>type===U.SAMLauncher?sam.level():3,
   hasHighStartingGold:()=>false,isHighNationDensity:()=>false,samThreatLevels:()=>0,samTargetLevels:()=>1,
   getPerceivedCost:()=>1000000n,shouldBuildStructure:()=>false,maybeSpawnStructure:async()=>false};
 const bot={mg:game,player:self,structureBehavior:actor};const menu={sendBuildOrUpgrade:q=>{builds.push(q);}};
 runtime=require('../src/brain/runtime')({createEngine:engine,createLegacyStrategy:legacy,strategies:[adaptive(legacy())],defaultStrategy:'adaptive-v1',
   units:U,createSpendingLedger:require('../src/brain/spending-ledger'),
   createSamDevelopment:options.planned?require('../src/brain/sam-development'):undefined,
   buildAllowed:options.buildAllowed,
   defenseEconomy:{observe:()=>({stage:options.stage??'reserve',reserve:3000000n,development:options.development??{samTargetLevel:2}})},
   createReactiveSam:require('../src/brain/reactive-sam'),samDefenseObserver:require('../src/brain/sam-defense-observer')({units:U}),
   sendSamUpgrade:(a,q)=>{runtime.build(a,'ReactiveSAM',menu,q);return!runtime.wasDeclined(a);},
   structurePlanner:require('../src/brain/structure-planner')({units:U,settings:()=>({}),difficulty:()=> 'Easy'}),
   buildingPlanner:{handle:async()=>{if(options.planned&&await runtime.planStructures(actor,{cityLevels:3,sharedWater:true}))return true;normal++;return false;}},
   enabled:()=>true,isCurrent:()=>true,isPublic:()=>false,settings:()=>({features:{build:true}}),emitIntent:()=>true});
 runtime.attach(bot);runtime.begin(bot);runtime.attachBehaviors(bot);
 return {runtime,actor,builds,menu,sam,game,nuke,normal:()=>normal,run:()=>runtime.planBuilding(actor,'handle')};
}
test('a timely useful upgrade spends the emergency reserve using its actual upgrade quote',async()=>{
 const f=fixture(),outcome=await f.run();
 const diagnostics=f.runtime.inspect().records.filter(r=>['reactive-sam-result','strategy-error','dispatch'].includes(r.kind));
 assert.equal(outcome,true,JSON.stringify(diagnostics));assert.equal(f.builds.length,1);assert.equal(f.normal(),0);
 await f.run();assert.equal(f.builds.length,1);
 assert.ok(f.runtime.inspect().records.some(r=>r.kind==='reactive-sam-result'&&r.status==='selected'));
});
test('already-intercepted and too-late strikes never consume the reserve',async()=>{
 for(const options of [{covered:true},{late:true,queue:[99]}]){
   const f=fixture(options);assert.equal(await f.run(),false);assert.equal(f.builds.length,0);assert.equal(f.normal(),1);
 }
});

test('disabling SAMs while awaiting a quote prevents the final upgrade',async()=>{
 let allowed=true;const f=fixture({buildAllowed:()=>allowed});
 const quote=f.actor.buildableFor;
 f.actor.buildableFor=async()=>{const result=await quote();allowed=false;return result;};
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});

test('developed economy upgrades an existing SAM before optional spending and keeps 3m',async()=>{
 const f=fixture({planned:true,noThreat:true,gold:6000000n});
 assert.equal(await f.run(),true);assert.equal(f.builds.length,1);assert.equal(f.normal(),0);
 await f.run();assert.equal(f.builds.length,1);
 assert.ok(f.runtime.inspect().records.some(r=>r.kind==='reactive-sam-result'&&r.status==='selected'&&r.assessments.some(a=>a.mode==='planned')));
 assert.ok(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain==='structure-plan'&&r.selectedId==='structure:sam-development'));
 const records=f.runtime.inspect().records;
 const plan=records.find(r=>r.kind==='decision'&&r.selectedId==='structure:sam-development');
 const execution=records.find(r=>r.kind==='decision'&&r.snapshot.domain==='reactive-sam-upgrade'&&r.selectedId!=='$wait');
 assert.equal(execution.snapshot.parentDecisionId,plan.decisionId);
});

test('planned upgrade savings block optional purchases until actual quote plus reserve is funded',async()=>{
 const f=fixture({planned:true,noThreat:true,gold:5000000n});
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
 assert.equal(f.runtime.build(f.actor,'optional',f.menu,{type:U.Port,canBuild:50,canUpgrade:false,cost:1000000n}),false);
 assert.equal(f.builds.length,0);
});

test('manual level two satisfies development and does not cause another purchase',async()=>{
 const f=fixture({planned:true,noThreat:true,gold:6000000n,level:2});
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});
test('central development upgrades main SAM through later levels without waiting for nukes',async()=>{
 for(const level of [2,3,4,5]){
  const f=fixture({planned:true,noThreat:true,gold:6000000n,level,development:{samTargetLevel:level+1}});
  assert.equal(await f.run(),true);assert.equal(f.builds.length,1);
  const decision=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.selectedId==='structure:sam-development');
  assert.ok(decision);assert.match(decision.reason,new RegExp(`level ${level+1}`));
 }
});
test('late-game planned SAM upgrade cannot spend the3M emergency reserve',async()=>{
 const f=fixture({planned:true,noThreat:true,gold:5000000n,level:4,development:{samTargetLevel:5}});
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
 assert.equal(f.runtime.build(f.actor,'optional',f.menu,{type:U.Port,canBuild:50,canUpgrade:false,cost:1000000n}),false);
});

test('planned upgrades preserve the opening and emergency upgrades can still use reserve',async()=>{
 const opening=fixture({planned:true,noThreat:true,gold:6000000n,stage:'development'});
 assert.equal(await opening.run(),false);assert.equal(opening.builds.length,0);
 const emergency=fixture({planned:true,gold:3000000n});
 assert.equal(await emergency.run(),true);assert.equal(emergency.builds.length,1);
});

test('a manual upgrade received while a planned quote is loading cancels the stale purchase',async()=>{
 const f=fixture({planned:true,noThreat:true,gold:6000000n});const quote=f.actor.buildableFor;
 f.actor.buildableFor=async()=>{const q=await quote();f.sam.level=()=>2;return q;};
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});

test('observed triple salvos prepare another level without claiming an emergency interception',async()=>{
 const f=fixture({planned:true,gold:6000000n,level:2});
 f.game.units=()=>[f.sam,...[10,11,12].map(id=>({...f.nuke,id:()=>id}))];
 assert.equal(await f.run(),true);assert.equal(f.builds.length,1);
 const record=f.runtime.inspect().records.find(r=>r.kind==='reactive-sam-result'&&r.status==='selected');
 assert.equal(record.assessments[0].mode,'planned');assert.equal(record.assessments[0].targetLevel,3);
 assert.equal(record.assessments[0].canDefend,false);
});

test('planned defense rechecks building permission after the async quote',async()=>{
 let allowed=true;const f=fixture({planned:true,noThreat:true,gold:6000000n,buildAllowed:()=>allowed});
 const quote=f.actor.buildableFor;
 f.actor.buildableFor=async()=>{const q=await quote();allowed=false;return q;};
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});

test('hydro emergency can spend exactly 3m despite planned saving and a competing atom',async()=>{
 const f=fixture({planned:true,hydro:true,gold:3000000n});
 f.game.units=()=>[f.sam,f.nuke,{...f.nuke,id:()=>3,type:()=>U.AtomBomb}];
 assert.equal(await f.run(),true);assert.equal(f.builds.length,1);
 const r=f.runtime.inspect().records.find(r=>r.kind==='reactive-sam-result'&&r.status==='selected').assessments[0];
 assert.equal(r.mode,'emergency');assert.equal(r.protectedReserve,'0');assert.equal(r.threatType,U.HydrogenBomb);
 assert.equal(r.spending.allowed,true);assert.equal(r.spending.gold,'3000000');assert.equal(r.spending.reserve,'0');
 assert.equal(r.competingThreatCount,1);
 assert.equal(f.runtime.build(f.actor,'optional',f.menu,{type:U.Port,canBuild:40,canUpgrade:false,cost:1n}),false);
});

test('a defendable hydro on neighbouring land inside the upgraded SAM area also uses emergency funds',async()=>{
 const f=fixture({planned:true,hydro:true,neighbour:true,gold:3000000n});
 assert.equal(await f.run(),true);assert.equal(f.builds.length,1);
});

test('emergency upgrades never spend money that is unavailable',async()=>{
 const f=fixture({planned:true,hydro:true,gold:2999999n});
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});

test('an in-range nuke already defendable without upgrading does not consume emergency money',async()=>{
 const f=fixture({planned:true,hydro:true,inside:true,gold:3000000n,level:2});
 assert.equal(await f.run(),false);assert.equal(f.builds.length,0);
});
