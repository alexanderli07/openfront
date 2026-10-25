'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const createRuntime=require('../src/brain/runtime'),legacy=require('../src/brain/legacy-strategy');
function fixture(options={}){
 const f={tick:100,active:true,conserve:false,queries:0,sent:[],resumed:0,ships:[],owners:new Map([[10,1]])};
 const self={id:()=> 'self',smallID:()=>1,troops:()=>options.troops??1000,gold:()=>0n,numTilesOwned:()=>100,
  units:()=>f.ships,incomingAttacks:()=>[],outgoingAttacks:()=>[]};
 const config={gameConfig:()=>({difficulty:'Medium'}),isUnitDisabled:()=>!!options.disabled,maxTroops:()=>1000};
 const game={ticks:()=>f.tick,myPlayer:()=>self,players:()=>[self],config:()=>config,inSpawnPhase:()=>false,
  isLand:()=>true,hasFallout:()=>false,hasOwner:t=>f.owners.has(t),ownerID:t=>f.owners.get(t),manhattanDist:(a,b)=>Math.abs(a-b)};
 const actor={game,player:self,boatTargetTaken:()=>false};const bot={mg:game,player:self,attackBehavior:actor};function Boat(){}
 const runtime=createRuntime({createEngine:require('../src/brain/engine'),createLegacyStrategy:legacy,
  strategies:[require('../src/brain/adaptive-strategy')(legacy())],defaultStrategy:options.legacy?'legacy-v1':'adaptive-v1',
  createCommandGuard:require('../src/brain/command-guard'),createSpendingLedger:require('../src/brain/spending-ledger'),
  createSupportPosture:options.posture?()=>({observe:()=>({ready:false,conserve:f.conserve,keepFraction:.25})}):undefined,
  wildernessCrossing:{sites:()=>[{tile:12,origin:10,crossingSteps:3,room:64,dist:9}]},
  openingExpansion:{resumeAfterCrossing:()=>f.resumed++},twoTeamOpening:{observe:()=>({borderKnown:true,wilderness:true,frontline:false})},
  units:{TransportShip:'Transport'},transportType:'Transport',isTransportIntent:c=>c===Boat,
  navalLandingPlanner:require('../src/brain/naval-landing-planner')(),boatPlanner:require('../src/brain/boat-planner')({state:{settings:{boatProbeMinTroops:8000}}}),
  probeCrossing:async()=>{f.queries++;return options.probe?options.probe(f):10;},landingDiagnostics:()=>{},
  enabled:()=>true,isCurrent:()=>f.active,isPublic:()=>false,settings:()=>({features:{boat:options.boat!==false}}),
  emitIntent:(ctor,...args)=>{f.sent.push(args);return true;}});
 actor.emitBoat=(tile,troops)=>runtime.intent(actor,'river-test',Boat,tile,troops);
 runtime.attach(bot);runtime.begin(bot);runtime.attachBehaviors(bot);
 return Object.assign(f,{actor,runtime,run:()=>runtime.planWildernessCrossing(actor)});
}
test('nearby wilderness crossing launches an exact 1 percent boat below the old 8000 minimum',async()=>{
 const f=fixture();assert.equal(await f.run(),true);assert.deepEqual(f.sent,[[12,10]]);
 assert.equal(await f.run(),false);assert.equal(f.sent.length,1);
});
test('actual worker spawn must be close and failed shores back off before retrying',async()=>{
 const f=fixture({probe:()=>1000});assert.equal(await f.run(),false);assert.equal(f.queries,1);
 f.tick+=10;assert.equal(await f.run(),false);assert.equal(f.queries,1);
 f.tick+=21;await f.run();assert.equal(f.queries,2);assert.equal(f.sent.length,0);
});
test('a target taken while querying is not turned into an enemy attack',async()=>{
 const f=fixture({probe:f=>{f.owners.set(12,2);return 10;}});assert.equal(await f.run(),false);assert.equal(f.sent.length,0);
});

test('a zero-sized or disabled crossing after the async quote is a local skip, not an allocation hold',async()=>{
 for(const change of [o=>{o.troops=50;},o=>{o.boat=false;}]){
  const options={probe:()=>{change(options);return 10;}};const f=fixture(options);
  assert.equal(await f.run(),false);assert.equal(f.sent.length,0);
  assert.ok(!f.runtime.inspect().records.some(r=>r.snapshot?.domain==='boat-allocation'));
 }
});

test('concurrent crossing calls cannot launch twice while a worker quote is pending',async()=>{
 let release;const f=fixture({probe:()=>new Promise(r=>{release=r;})});
 const pending=f.run();assert.equal(await f.run(),false);release(10);
 assert.equal(await pending,true);assert.equal(f.sent.length,1);
});
test('home danger and stale ownership after a worker response stop crossing dispatch',async()=>{
 for(const change of [f=>{f.active=false;},f=>{f.conserve=true;}]){
  const f=fixture({posture:true,probe:f=>{change(f);return 10;}});
  assert.equal(await f.run(),false);assert.equal(f.sent.length,0);
 }
});
test('two occupied automatic slots, disabled boats, legacy policy and zero-size probes skip lookup',async()=>{
 for(const options of [{boat:false},{disabled:true},{legacy:true},{troops:50},{full:true}]){
  const f=fixture(options);if(options.full)f.ships=[1,2].map(id=>({id:()=>id,isActive:()=>true,targetTile:()=>100+id}));
  assert.equal(await f.run(),false);assert.equal(f.queries,0);assert.equal(f.sent.length,0);
 }
});
test('only a confirmed owned river landing resumes expansion once',async()=>{
 const f=fixture();await f.run();assert.equal(f.resumed,0);
 f.tick+=10;f.owners.set(12,1);await f.run();assert.equal(f.resumed,1);
 f.tick+=10;await f.run();assert.equal(f.resumed,1);
});
