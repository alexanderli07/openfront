'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/team-geography');
const legacy=require('../src/brain/legacy-strategy')();
const adaptive=require('../src/brain/adaptive-strategy')(legacy);
const {fixture,U}=require('./fixtures/team-geography-game');
test('spawn measurement rewards reachable open land and useful coast',()=>{
 const f=fixture();const metrics=f.geo.spawnMetrics(f.game,f.self,f.ref(11,12),[f.friend,f.enemy]);
 assert.ok(metrics.openSpace>0);assert.equal(metrics.waterAccess,true);assert.ok(metrics.allyDistance<metrics.enemyDistance);
});
test('central spawn ranking avoids cramped coast and prefers teammates among open safe sites',()=>{
 const cs=[{id:'cramped',kind:'team-spawn-site',eligible:true,openSpace:.1,waterAccess:true,allyDistance:60,enemyDistance:300,edgeDistance:40},
 {id:'open',kind:'team-spawn-site',eligible:true,openSpace:1,waterAccess:false,allyDistance:60,enemyDistance:300,edgeDistance:40},
 {id:'group-coast',kind:'team-spawn-site',eligible:true,openSpace:1,waterAccess:true,allyDistance:80,enemyDistance:300,edgeDistance:40}];
 assert.equal(adaptive.decide({domain:'team-spawn-site'},cs).selectedId,'group-coast');
 assert.equal(adaptive.decide({domain:'team-spawn-site'},cs.slice(0,2)).selectedId,'open');
});
test('topology requires completed land scan; a distant bridge is not an island battle',()=>{
 for(const bridge of [true,false]){
  const f=fixture({bridge,landBudget:20});f.add(U.Port,f.ref(13,12));f.add(U.Port,f.ref(26,12),f.enemy);
  assert.equal(f.geo.navalFacts(f.game,f.self).topologyKnown,false);
  let facts;for(let i=0;i<60;i++){f.next();facts=f.geo.navalFacts(f.game,f.self);if(facts.topologyKnown)break;}
  assert.equal(facts.topologyKnown,true);assert.equal(facts.island,!bridge);
 }
});
test('land topology advances once per tick within its work allowance',()=>{
 const f=fixture({landBudget:3});f.geo.navalFacts(f.game,f.self);const first=f.geo.navalFacts(f.game,f.self);
 assert.equal(first.visitedLand,3);f.next();assert.equal(f.geo.navalFacts(f.game,f.self).visitedLand,6);
});
test('transport interception ignores friends, retreats, distant and different-water targets',()=>{
 const f=fixture(),landing=f.ref(13,12),ship=f.add(U.Warship,f.ref(15,12));f.locations.set(landing,3);
 f.add(U.TransportShip,f.ref(18,12),f.enemy,{targetTile:()=>landing});
 f.add(U.TransportShip,f.ref(18,13),f.friend,{targetTile:()=>landing});
 f.add(U.TransportShip,f.ref(18,14),f.enemy,{targetTile:()=>landing,transportShipState:()=>({isRetreating:true})});
 const targets=f.geo.transportTargets(f.game,f.self,ship);
 assert.equal(targets.length,1);assert.equal(targets[0].targetTile,landing);
 f.game.getWaterComponent=t=>t===ship.tile()?1:2;assert.equal(f.geo.transportTargets(f.game,f.self,ship).length,0);
});
test('front-line rear distance outranks factory routes; same safety band retains grouping',()=>{
 const cs=[{id:'front-route',kind:'structure-placement',eligible:true,unitType:'City',frontline:true,rearBand:0,ownedFactoryRoutes:3,originalScore:999},
 {id:'rear',kind:'structure-placement',eligible:true,unitType:'City',frontline:true,rearBand:3,originalScore:1},
 {id:'rear-route',kind:'structure-placement',eligible:true,unitType:'City',frontline:true,rearBand:3,ownedFactoryRoutes:1,originalScore:0}];
 assert.equal(adaptive.decide({domain:'structure-placement'},cs).selectedId,'rear-route');
});
test('island deployment moves before routine structure spending and intercept outranks trade hunting',()=>{
 const cs=[{id:'structure',kind:'turn-plan',phase:'structure',priority:0,eligible:true},
 {id:'fleet',kind:'turn-plan',phase:'warship-deployment',priority:1,eligible:true}];
 assert.equal(adaptive.decide({domain:'turn-plan',teamNaval:{island:true,fleetNeeded:true}},cs).selectedId,'fleet');
 const combat=[{id:'hunt',kind:'warship-combat',purpose:'trade-hunt',priority:3,eligible:true},
 {id:'intercept',kind:'warship-combat',purpose:'intercept',priority:4,adaptiveOnly:true,eligible:true}];
 assert.equal(adaptive.decide({domain:'warship-combat',teamNaval:{twoTeam:true}},combat).selectedId,'intercept');
});

test('rear measurement follows the actual hostile border and updates when it moves',()=>{
 const f=fixture();f.game.isLand=()=>true;f.game.isWater=()=>false;
 const front=f.ref(13,12),back=f.ref(1,12);f.self.borderTiles=()=>new Set([front,back]);
 f.locations.set(f.ref(14,12),2);
 const first=f.geo.placementContext(f.game,f.self);
 assert.equal(first.frontline,true);assert.ok(f.geo.rearMetrics(f.game,back,first,U.City).rearDistance>0);
 f.locations.clear();f.next();assert.equal(f.geo.placementContext(f.game,f.self).frontline,false);
});
test('ordinary economy waits to fund a needed island fleet after opening protection exists',()=>{
 const candidates=[{id:'city',kind:'structure-plan',eligible:true,priority:0},
 {id:'$wait',kind:'wait',eligible:true}];
 assert.equal(adaptive.decide({domain:'structure-plan',teamOpening:{economyReady:true,sams:1,samEnabled:true,frontline:false},
 teamNaval:{island:true,fleetNeeded:true}},candidates).selectedId,'$wait');
});
test('island patrols stay on connected water serving team ports',()=>{
 const f=fixture();f.add(U.Port,f.ref(13,12));f.add(U.Port,f.ref(26,12),f.enemy);f.add(U.Warship,f.ref(15,12));
 const naval=f.geo.navalFacts(f.game,f.self);const sites=f.geo.coastalPatrols(f.game,f.self,naval);
 assert.ok(sites.length>0);assert.ok(sites.every(s=>s.kind==='coast-guard'&&f.game.isWater(s.tile)&&f.game.getWaterComponent(s.tile)===1));
});

test('an enclave cannot classify ports on enemy continuous mainland as an island front',()=>{
 const f=fixture();f.add(U.Port,f.ref(26,10));f.add(U.Port,f.ref(26,14),f.enemy);
 const facts=f.geo.navalFacts(f.game,f.self);assert.equal(facts.island,false);assert.equal(facts.fleetNeeded,false);
});
