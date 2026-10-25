'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/two-team-opening');
const units={City:'City',Port:'Port',Factory:'Factory',SAMLauncher:'SAM',MissileSilo:'Silo',AtomBomb:'Atom',HydrogenBomb:'Hydro',MIRV:'MIRV'};
function fixture(){
  let tick=1;
  const self={isPlayer:()=>true,type:()=> 'Human',team:()=> 'A',smallID:()=>1,isAlive:()=>true,
    incomingAttacks:()=>[],borderTiles:()=>new Set([0]),units:()=>[],isFriendly:p=>p.team()==='A'};
  const enemy={isPlayer:()=>true,type:()=> 'Human',team:()=> 'B',smallID:()=>2,isAlive:()=>true};
  let owner=null;
  const config={gameConfig:()=>({gameMode:'Team'}),isUnitDisabled:()=>false};
  const game={ticks:()=>tick,players:()=>[self,enemy],config:()=>config,neighbors:()=>[1],isLand:()=>true,
    hasOwner:()=>owner!==null,ownerID:()=>owner,isShore:()=>true,hasFallout:()=>false};
  const observer=create({units,botType:'Bot',teamMode:'Team',buildAllowed:()=>true});
  return {self,enemy,game,config,observer,next:()=>tick++,owner:v=>{owner=v;tick++;}};
}
test('safe two-team opening observes adjacent wilderness and ignores distant islands',()=>{
  const f=fixture();assert.equal(f.observer.observe(f.game,f.self).wilderness,true);
  f.owner(1);assert.equal(f.observer.observe(f.game,f.self).wilderness,false);
});
test('tribes do not classify a safe spawn as an enemy front; enemy teams and attacks do',()=>{
  const f=fixture();f.owner(3);assert.equal(f.observer.observe(f.game,f.self).frontline,false);
  f.owner(2);assert.equal(f.observer.observe(f.game,f.self).frontline,true);
  f.owner(1);f.self.incomingAttacks=()=>[{troops:()=>100}];assert.equal(f.observer.observe(f.game,f.self).frontline,true);
});
test('economy goals count physical active buildings including construction, not levels',()=>{
  const f=fixture();f.self.units=type=>type===units.Port?[{isActive:()=>true,isUnderConstruction:()=>true,level:()=>5}]:[];
  const facts=f.observer.observe(f.game,f.self);assert.equal(facts.ports,1);assert.equal(facts.portTarget,2);assert.equal(facts.cityTarget,1);
});
test('other modes and team counts retain their existing opening',()=>{
  const f=fixture();f.config.gameConfig=()=>({gameMode:'FFA'});assert.equal(f.observer.observe(f.game,f.self),null);
});
test('landlocked or disabled-port opening substitutes an enabled factory',()=>{
  const f=fixture();f.game.isShore=()=>false;
  const facts=f.observer.observe(f.game,f.self);assert.equal(facts.portTarget,0);assert.equal(facts.factoryTarget,1);
});

test('lake-only coasts use a factory opening instead of an impossible port target',()=>{
 const f=fixture();const observer=create({units,botType:'Bot',teamMode:'Team',
  portWaterAccess:{assess:()=>({allowed:false,reason:'Enclosed lake'})}});
 const facts=observer.observe(f.game,f.self);assert.equal(facts.portTarget,0);
 assert.equal(facts.cityTarget,2);assert.equal(facts.factoryTarget,1);
});

const legacy=require('../src/brain/legacy-strategy')();
const adaptive=require('../src/brain/adaptive-strategy')(legacy);
const wait={id:'$wait',kind:'wait',eligible:true};
const safe={frontline:false,borderKnown:true,wilderness:true,sams:0,samEnabled:true,ports:0,cities:0,factories:0,portTarget:2,cityTarget:1,factoryTarget:0};
const decide=(domain,teamOpening,candidates)=>adaptive.decide({domain,teamOpening},[...candidates,wait]).selectedId;
test('safe wilderness pass selects land only, and holds when expansion is disabled',()=>{
  const cs=[{id:'sequence:takeover',kind:'attack-sequence',eligible:true,priority:0},
    {id:'sequence:wilderness-only',kind:'attack-sequence',eligible:true,adaptiveOnly:true}];
  assert.equal(decide('attack-sequence',safe,cs),'sequence:wilderness-only');
  assert.equal(decide('attack-sequence',safe,[cs[0],{...cs[1],eligible:false}]),'$wait');
  assert.equal(decide('attack-sequence',{...safe,borderKnown:false},cs),'$wait');
  assert.equal(legacy.decide({domain:'attack-sequence'},[...cs,wait]).selectedId,'sequence:takeover');
});
test('country gate is strict in safe wilderness and releases old city requirement afterward',()=>{
 const cs=['legacy','allow','defer'].map((mode,priority)=>({id:'team-attack:'+mode,kind:'team-opening-attack',eligible:true,priority}));
 assert.equal(decide('team-opening-attack',safe,cs),'team-attack:defer');
 assert.equal(decide('team-opening-attack',{...safe,wilderness:false},cs),'team-attack:allow');
 assert.equal(decide('team-opening-attack',{...safe,frontline:true},cs),'team-attack:legacy');
});
function openingCandidates(gold=100n){return ['Port','City','Factory','SAM'].map(role=>({
 id:'opening:'+role,kind:'structure-plan',eligible:true,stage:'team-opening',openingRole:role,
 perceivedCost:role==='SAM'?100n:40n,availableGold:gold,affordable:gold>=(role==='SAM'?100n:40n),forceNew:true,adaptiveOnly:true
}));}
test('safe opening constructs physical economy before reserving a SAM',()=>{
 const cs=openingCandidates();
 assert.equal(decide('structure-plan',safe,cs),'opening:Port');
 assert.equal(decide('structure-plan',{...safe,ports:1},cs),'opening:City');
 assert.equal(decide('structure-plan',{...safe,ports:1,cities:1},cs),'opening:Port');
 assert.equal(decide('structure-plan',{...safe,ports:2,cities:1},cs),'opening:SAM');
 assert.equal(decide('structure-plan',{...safe,ports:2,cities:1},openingCandidates(70n)),'$wait');
 assert.equal(decide('structure-plan',{...safe,ports:2,cities:1},openingCandidates(140n)),'opening:Port');
 assert.equal(decide('structure-plan',{...safe,ports:3,cities:1},openingCandidates(140n)),'opening:City');
});
test('unaffordable and failed opening placements do not fall through to old spending',()=>{
 const old={id:'old',kind:'structure-plan',eligible:true,priority:0};
 assert.equal(decide('structure-plan',safe,[...openingCandidates(10n),old]),'$wait');
 assert.equal(decide('structure-plan',safe,[old]),'$wait');
 assert.equal(decide('structure-plan',{...safe,portTarget:0,factoryTarget:1,cities:1},openingCandidates()),'opening:Factory');
});
test('safe opening saves optional defense spending but frontline retains it',()=>{
 const cs=[{id:'building:emergency',kind:'structure-phase',eligible:true,priority:0},
 {id:'building:normal',kind:'structure-phase',eligible:true,priority:1}];
 assert.equal(decide('structure-phase',safe,cs),'building:normal');
 assert.equal(decide('structure-phase',safe,[cs[0]]),'$wait');
 assert.equal(decide('structure-phase',{...safe,frontline:true},cs),'building:emergency');
});

test('opening budgets remain numeric after engine serializes gold to strings',()=>{
 const engine=require('../src/brain/engine')();engine.register(adaptive);engine.select(adaptive.id);
 const choice=gold=>engine.decide({domain:'structure-plan',teamOpening:{...safe,ports:2,cities:1}},[...openingCandidates(gold),wait]).selectedId;
 assert.equal(choice(140n),'opening:Port');assert.equal(choice(100n),'opening:SAM');assert.equal(choice(70n),'$wait');
});
test('observer handles disabled economy, nuclear settings, unknown borders and fallout',()=>{
 const f=fixture();f.config.isUnitDisabled=t=>t===units.Port;
 assert.equal(f.observer.observe(f.game,f.self).factoryTarget,1);
 f.config.isUnitDisabled=t=>t===units.City||t===units.MissileSilo;
 let facts=f.observer.observe(f.game,f.self);assert.equal(facts.cityTarget,0);assert.equal(facts.samEnabled,false);
 f.game.hasFallout=()=>true;f.next();assert.equal(f.observer.observe(f.game,f.self).wilderness,false);
 f.self.borderTiles=()=>new Set();f.next();assert.equal(f.observer.observe(f.game,f.self).borderKnown,false);
});
test('three-team games are excluded and inactive buildings do not satisfy targets',()=>{
 const f=fixture();f.self.units=()=>[{isActive:()=>false}];
 assert.equal(f.observer.observe(f.game,f.self).ports,0);
 f.game.players=()=>[f.self,f.enemy,{type:()=> 'Nation',team:()=> 'C'}];
 assert.equal(f.observer.observe(f.game,f.self),null);
});
test('border observations are reused within a tick and renewed on the next tick',()=>{
 const f=fixture();let scans=0;const border=new Set([0]);f.self.borderTiles=()=>border;
 f.game.neighbors=()=>{scans++;return [1];};
 f.observer.observe(f.game,f.self);f.observer.observe(f.game,f.self);assert.equal(scans,1);
 f.next();f.observer.observe(f.game,f.self);assert.equal(scans,2);
});

test('disabled SAMs still require physical economy but never hold a SAM reserve afterward',()=>{
 const opening={...safe,samEnabled:false};
 assert.equal(decide('structure-plan',opening,openingCandidates()),'opening:Port');
 const oldSam={id:'old:sam',kind:'structure-plan',eligible:true,firstSamReserve:true,affordable:false,priority:2};
 const city={id:'old:city',kind:'structure-plan',eligible:true,priority:1};
 assert.equal(decide('structure-plan',{...opening,ports:2,cities:1},[oldSam,city]),'old:city');
});

test('owned SAM releases safe opening policy and frontline retains the original urgent reserve',()=>{
 const cs=[{id:'old:port',kind:'structure-plan',eligible:true,priority:0},
 {id:'old:sam',kind:'structure-plan',eligible:true,priority:1,firstSamReserve:true,affordable:false}];
 assert.equal(decide('structure-plan',{...safe,sams:1},[cs[0]]),'old:port');
 assert.equal(decide('structure-plan',{...safe,frontline:true},cs),'$wait');
});

test('factory opening requires two physical cities and one factory before the first SAM',()=>{
 const f=fixture();f.game.isShore=()=>false;
 const facts=f.observer.observe(f.game,f.self);assert.equal(facts.cityTarget,2);assert.equal(facts.factoryTarget,1);assert.equal(facts.economyMode,'factory');
 const opening={...safe,portTarget:0,cityTarget:2,factoryTarget:1,economyMode:'factory'};
 assert.equal(decide('structure-plan',opening,openingCandidates()),'opening:City');
 assert.equal(decide('structure-plan',{...opening,cities:1},openingCandidates()),'opening:City');
 assert.equal(decide('structure-plan',{...opening,cities:2},openingCandidates()),'opening:Factory');
 assert.equal(decide('structure-plan',{...opening,cities:2,factories:1},openingCandidates()),'opening:SAM');
});

test('a high-level city remains one physical city in the factory opening',()=>{
 const f=fixture();f.game.isShore=()=>false;
 f.self.units=type=>type===units.City?[{isActive:()=>true,level:()=>5}]:[];
 const facts=f.observer.observe(f.game,f.self);assert.equal(facts.cities,1);assert.equal(facts.cityTarget,2);assert.equal(facts.economyReady,false);
});
