'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createEngine = require('../src/brain/engine.js');
const createLegacyStrategy = require('../src/brain/legacy-strategy.js');
const createAdaptiveStrategy = require('../src/brain/adaptive-strategy.js');
const createDiplomacyPlanner = require('../src/brain/diplomacy-planner.js');
const createTurnPlanner = require('../src/brain/turn-planner.js');
const file = path.join(__dirname, '../src/brain/runtime.js');
const createRuntime = fs.existsSync(file) ? require(file) : null;

function fixture(options = {}) {
  const f = { tick: 1, enabled: true, public: false, current: true, sent: [] };
  const player = { id: () => 'self', smallID: () => 1, isPlayer: () => true, isAlive: () => true,
    gold: () => 1000n, troops: () => 200, numTilesOwned: () => 50, units: () => [],
    incomingAttacks: () => [], outgoingAttacks: () => [] };
  const game = { myPlayer: () => player, ticks: () => f.tick, players: () => [player],
    inSpawnPhase: () => false, config: () => ({ gameConfig: () => ({ difficulty: 'Hard' }) }) };
  const bot = { mg: game, player, status: 'Thinking' };
  const runtime = createRuntime && createRuntime({ createEngine, createLegacyStrategy,
    createCommandGuard:options.createCommandGuard,isDonationIntent:options.isDonationIntent,
    createSpendingLedger:options.createSpendingLedger,defenseEconomy:options.defenseEconomy,units:options.units,twoTeamOpening:options.twoTeamOpening,
    createSupportPosture:options.createSupportPosture,
    portWaterAccess:options.portWaterAccess,
    startHistory:options.startHistory,
    diplomacyPlanner: createDiplomacyPlanner({ settings: () => ({ winFixes: false, features: { betray: true } }),
      neutralRelation: 0, friendlyRelation: 1, difficulty: () => 'Hard',
      difficulties: { easy: 'Easy', medium: 'Medium' }, humanType: 'Human',
      emojis: { confused: 'confused', scared: 'scared', love: 'love', handshake: 'handshake',
        assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } }),
    attackPlanner: options.attackPlanner, structurePlacementPlanner: options.structurePlacementPlanner, buildingPlanner: options.buildingPlanner,
    structurePlanner: options.structurePlanner,
    attackSequencePlanner: options.attackSequencePlanner,
    botTargetPlanner: options.botTargetPlanner, navalActionPlanner: options.navalActionPlanner,
    boatPlanner: options.boatPlanner,
    transportType: options.transportType,
    isTransportIntent: options.isTransportIntent,
    watchTransportIntents: options.watchTransportIntents,
    attackGeographyPlanner: options.attackGeographyPlanner,
    attackRoutingPlanner: options.attackRoutingPlanner,
    probeLanding: options.probeLanding || (async () => false),
    turnPlanner: createTurnPlanner(),
    strategies: options.strategies || [], defaultStrategy: options.defaultStrategy,
    isCurrent: () => f.current, enabled: () => f.enabled, isPublic: () => f.public,
    settings: () => ({ features: { build: true,...options.features } }),
    emitIntent: (ctor, ...args) => { f.sent.push([ctor, ...args]); return options.emitIntent?options.emitIntent(ctor,...args):true; }, log: () => {} });
  if (runtime) { runtime.attach(bot); runtime.begin(bot); }
  return Object.assign(f, { runtime, bot, game, player });
}
function allianceActor(accepted = true) {
  return {
    player: { relation: () => 0 }, random: { chance: () => false, nextInt: low => low },
    emojiBehavior: { sendEmoji() {} }, isRegularBot: () => !accepted, isConfused: () => false,
    isFarNation: () => false, isDominantForDiplomacy: () => false, hasTooManyAlliances: () => false,
    isAlliancePartnerThreat: () => false, shouldRejectInTeamGame: () => false,
    isAlliancePartnerFriendly: () => false, checkAlreadyEnoughAlliances: () => false,
    isEarlygame: () => false, isAlliancePartnerSimilarlyStrong: () => accepted
  };
}
test('runtime is provided', () => assert.equal(typeof createRuntime, 'function'));

test('shared build guard keeps the SAM reserve and commits surplus across concurrent quotes',()=>{
 const adaptive=createAdaptiveStrategy(createLegacyStrategy());
 const f=fixture({strategies:[adaptive],defaultStrategy:'adaptive-v1',createSpendingLedger:require('../src/brain/spending-ledger'),
   defenseEconomy:{observe:()=>({stage:'reserve',reserve:3000000n})},units:{SAMLauncher:'SAM'}});
 f.player.gold=()=>4000000n;let builds=0;const menu={sendBuildOrUpgrade:()=>{builds++;}};
 f.runtime.build(f.bot,'economy',menu,{type:'Port',canBuild:10,canUpgrade:false,cost:1000000n});
 f.runtime.build(f.bot,'economy',menu,{type:'City',canBuild:20,canUpgrade:false,cost:1000000n});
 assert.equal(builds,1);
});

test('SAM cannot upgrade proactively, and upgrade spending uses the actual one-level quote',()=>{
 const adaptive=createAdaptiveStrategy(createLegacyStrategy());
 const f=fixture({strategies:[adaptive],defaultStrategy:'adaptive-v1',createSpendingLedger:require('../src/brain/spending-ledger'),
   defenseEconomy:{observe:()=>({stage:'reserve',reserve:3000000n})},units:{SAMLauncher:'SAM'}});
 f.player.gold=()=>4000000n;let builds=0;const menu={sendBuildOrUpgrade:()=>{builds++;}};
 assert.equal(f.runtime.build(f.bot,'economy',menu,{type:'SAM',canBuild:false,canUpgrade:1,cost:3000000n}),false);
 f.runtime.build(f.bot,'economy',menu,{type:'Port',canBuild:false,canUpgrade:2,cost:9000000n,upgradeCosts:[1000000n]});
 assert.equal(builds,1);
});

test('final port gateway rejects enclosed builds and upgrades in every strategy',()=>{
 for(const adaptive of [false,true]){
  const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:adaptive?'adaptive-v1':'legacy-v1',
   units:{Port:'Port'},portWaterAccess:{assess:(_,tile)=>({allowed:tile===20,reason:'Open sea required'})}});
  let builds=0;const menu={sendBuildOrUpgrade:()=>{builds++;}};
  assert.equal(f.runtime.build(f.bot,'port',menu,{type:'Port',canBuild:10,canUpgrade:false,cost:1n}),false);
  f.runtime.build(f.bot,'port',menu,{type:'Port',canBuild:20,canUpgrade:false,cost:1n});assert.equal(builds,1);
  f.player.units=()=>[{id:()=>7,tile:()=>10}];
  assert.equal(f.runtime.build(f.bot,'port',menu,{type:'Port',canBuild:false,canUpgrade:7,cost:1n}),false);
  assert.equal(builds,1);
 }
});

test('losing the SAM preserves reserve for optional purchases but funds one replacement',()=>{
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',
   createSpendingLedger:require('../src/brain/spending-ledger'),units:{SAMLauncher:'SAM'},
   defenseEconomy:{observe:()=>({stage:'first-sam',reserve:3000000n,requiredType:'SAM',waitingForSam:false})}});
 f.player.gold=()=>3000000n;let builds=0;const menu={sendBuildOrUpgrade:()=>{builds++;}};
 for(const type of ['Warship','Atom']) assert.equal(f.runtime.build(f.bot,'optional',menu,
   {type,canBuild:10,canUpgrade:false,cost:1000000n}),false);
 f.runtime.build(f.bot,'replacement',menu,{type:'SAM',canBuild:20,canUpgrade:false,cost:1500000n});
 assert.equal(builds,1);
 assert.equal(f.runtime.build(f.bot,'replacement',menu,{type:'SAM',canBuild:30,canUpgrade:false,cost:1500000n}),false);
 assert.equal(builds,1);
});

test('all automatic boat paths share destination deduplication and retry backoff',()=>{
 function Boat(){}const f=fixture({transportType:'Transport',isTransportIntent:c=>c===Boat,createCommandGuard:require('../src/brain/command-guard')});
 assert.equal(f.runtime.intent(f.bot,'targeted',Boat,20,100),true);
 assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,100),false);
 f.tick=41;assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,100),false);
 f.tick=80;assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,100),false);
 f.tick=81;assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,100),true);
 assert.equal(f.sent.length,2);
});

test('donation deduplication is shared across same-tick automatic sources',()=>{
 function Donate(){}const f=fixture({createCommandGuard:require('../src/brain/command-guard'),isDonationIntent:c=>c===Donate});
 const ally={id:()=> 'ally'};
 assert.equal(f.runtime.intent(f.bot,'first',Donate,ally,100),true);
 assert.equal(f.runtime.intent(f.bot,'second',Donate,ally,100),false);
 f.tick++;assert.equal(f.runtime.intent(f.bot,'second',Donate,ally,100),true);
 assert.equal(f.sent.length,2);
});

test('support donations and probes share pending troop commitments above the keep line',()=>{
 function Donate(){}function Boat(){}
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',
  createSupportPosture:()=>({observe:()=>({ready:true,conserve:false,keepFraction:.25})}),
  createSpendingLedger:require('../src/brain/spending-ledger'),isDonationIntent:c=>c===Donate,isTransportIntent:c=>c===Boat,transportType:'Transport'});
 f.player.troops=()=>600;f.game.config=()=>({maxTroops:()=>1000,gameConfig:()=>({})});
 assert.equal(f.runtime.intent(f.bot,'support',Donate,{id:()=> 'ally'},250),true);
 assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,10),true);
 assert.equal(f.runtime.intent(f.bot,'support',Donate,{id:()=> 'other'},250),false);
 assert.equal(f.sent.length,2);
});

test('a new home threat blocks automatic support at dispatch but allows ordinary attack commands',()=>{
 function Donate(){}function Boat(){}function Attack(){}let conserve=false;
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',
  createSupportPosture:()=>({observe:()=>({ready:true,conserve,keepFraction:.25})}),
  createSpendingLedger:require('../src/brain/spending-ledger'),isDonationIntent:c=>c===Donate,isTransportIntent:c=>c===Boat,transportType:'Transport'});
 f.player.troops=()=>600;f.game.config=()=>({maxTroops:()=>1000,gameConfig:()=>({})});
 conserve=true;
 assert.equal(f.runtime.intent(f.bot,'support',Donate,{id:()=> 'ally'},100),false);
 assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,6),false);
 assert.equal(f.runtime.intent(f.bot,'counter',Attack,'enemy',300),true);
 assert.equal(f.sent.length,1);
});

test('a donation cannot bypass the live local expansion lock at final dispatch',()=>{
 function Donate(){}
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',
  createSupportPosture:()=>({observe:()=>({ready:true,conserve:false,keepFraction:.25,donationReady:false,
   donationHoldReason:'Expand local territory first'})}),
  createSpendingLedger:require('../src/brain/spending-ledger'),isDonationIntent:c=>c===Donate});
 f.player.troops=()=>900;f.game.config=()=>({maxTroops:()=>1000,gameConfig:()=>({})});
 assert.equal(f.runtime.intent(f.bot,'donation',Donate,{id:()=> 'ally'},400),false);
 assert.equal(f.sent.length,0);
});

test('explicitly disabling expansion does not leave donations permanently locked',()=>{
 function Donate(){}
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',features:{expand:false},
  createSupportPosture:()=>({observe:()=>({ready:false,conserve:false,keepFraction:.25,donationReady:false})}),
  createSpendingLedger:require('../src/brain/spending-ledger'),isDonationIntent:c=>c===Donate});
 f.player.troops=()=>600;f.game.config=()=>({maxTroops:()=>1000,gameConfig:()=>({})});
 assert.equal(f.runtime.intent(f.bot,'donation',Donate,{id:()=> 'ally'},100),true);
 assert.equal(f.runtime.intent(f.bot,'donation',Donate,{id:()=> 'other'},400),false);
 assert.equal(f.sent.length,1);
});

test('a duplicate boat hold leaves the enclosing attack routing scope available',()=>{
 function Boat(){}let f;
 const planner={targeted:(actor,target,hooks)=>{
   hooks.execute(1,()=>f.runtime.intent(actor,'targeted',Boat,20,100));
   if(hooks.wasDeclined())hooks.hold();
   return hooks.allowed();
 }};
 f=fixture({attackRoutingPlanner:planner,transportType:'Transport',isTransportIntent:c=>c===Boat,
   createCommandGuard:require('../src/brain/command-guard')});
 assert.equal(f.runtime.intent(f.bot,'probe',Boat,20,100),true);
 assert.equal(f.runtime.planTargetedBoat(f.bot,{}),true);
 assert.equal(f.sent.length,1);
});

test('match history observes central records independently of debug buffer eviction',()=>{
  const history=require('../src/brain/match-summary')({segment:'runtime'});
  const f=fixture({startHistory:()=>history});
  f.runtime.intent(f.bot,'test',function Attack(){},'enemy',50);
  for(let i=0;i<6000;i++){f.tick++;f.runtime.begin(f.bot);}
  const result=history.export();assert.ok(result.events.some(e=>e.kind==='command'&&e.status==='submitted'));
  assert.equal(result.counts.observation,6001);
});

test('transport capacity rejection does not stop later donation and main attack phases',async()=>{
  function Boat(){} const calls=[];
  const state={settings:{winFixes:true,features:{donate:true}}};
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    boatPlanner:require('../src/brain/boat-planner')({state}),
    attackSequencePlanner:require('../src/brain/attack-sequence-planner')({state,botType:'Bot',now:()=>10000,debug:()=>{}})});
  f.player.units=()=>[{id:()=>1,isActive:()=>true},{id:()=>2,isActive:()=>true}];
  const actor={player:f.player,game:f.game,openingSnapshot:()=>null,random:{chance:()=>false},
    emitBoat:(tile,troops)=>f.runtime.intent(actor,'AttackBehavior',Boat,tile,troops),
    maybeOpportunisticBoat:async()=>f.runtime.launchBoat(actor,90,'probe-1pct','probe'),
    donateTroops:()=>{calls.push('donate');return false;},attackBestTarget:async()=>calls.push('main')};
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  await f.runtime.planAttackSequence(actor,{all:[],friends:[],enemies:[],expand:true,boat:false,alliance:false,openLand:false});
  assert.deepEqual(calls,['donate','main']);assert.equal(f.sent.length,0);
});

test('infrastructure milestones record actual SAM coordinates and later losses without trade chatter', () => {
  const f=fixture();
  let level=1,building=true;
  const sam={id:()=>10,type:()=>'SAM Launcher',tile:()=>42,level:()=>level,isUnderConstruction:()=>building};
  const trade={id:()=>11,type:()=>'Trade Ship',tile:()=>50,level:()=>1};
  f.player.units=()=>[sam]; f.tick++; f.runtime.begin(f.bot);
  f.player.units=()=>[sam,trade]; f.tick++; f.runtime.begin(f.bot);
  let changes=f.runtime.inspect().records.filter(r=>r.kind==='infrastructure-change');
  assert.equal(changes.at(-1).structures[0].tile,42);
  building=false; f.tick++; f.runtime.begin(f.bot);
  changes=f.runtime.inspect().records.filter(r=>r.kind==='infrastructure-change');
  assert.equal(changes.at(-1).counts['SAM Launcher'].building,0);
  level=2; f.tick++; f.runtime.begin(f.bot);
  changes=f.runtime.inspect().records.filter(r=>r.kind==='infrastructure-change');
  assert.equal(changes.at(-1).structures[0].level,2);
  const count=changes.length;
  f.player.units=()=>[]; f.tick++; f.runtime.begin(f.bot);
  changes=f.runtime.inspect().records.filter(r=>r.kind==='infrastructure-change');
  assert.equal(changes.length,count+1);
  assert.deepEqual(changes.at(-1).structures,[]);
  assert.equal(changes.at(-1).previous['SAM Launcher'].count,1);
});

test('unacknowledged automatic and manual transport reservations expire without ignoring active ships', () => {
  function Boat() {} let observe;
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    watchTransportIntents:handler=>{observe=handler;}});
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,10,10),true);
  observe(20);
  f.tick=40;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),false);
  f.tick=41;
  f.player.units=()=>[{id:()=>1,isActive:()=>true,targetTile:()=>10}];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,40,10),false);
  assert.ok(f.runtime.inspect().records.some(r=>r.kind==='transport-reservation-expired'&&r.tile===20));
});

test('transport reservations cannot expire while the emitter promise is unresolved', async () => {
  function Boat() {} let resolve;
  const promise=new Promise(r=>{resolve=r;});
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,emitIntent:()=>promise});
  f.runtime.intent(f.bot,'AttackBehavior',Boat,10,10);
  f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10);
  f.tick=100;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),false);
  resolve(true); await promise; await Promise.resolve();
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),false);
  f.tick=140;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),promise);
});

test('automatic transports reserve the third slot including manual ships and pending launches', () => {
  function Boat() {}
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat});
  let ships=[{id:()=>10,isActive:()=>true}];
  f.player.units=type=>type==='Transport'?ships:[];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,100),true);
  f.tick++;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,21,100),false);
  assert.equal(f.sent.length,1);
  ships.push({id:()=>11,isActive:()=>true,targetTile:()=>20});
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,21,100),false);
  ships=ships.slice(1); // Manual boat arrives; submitted boat remains underway.
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,22,100),true);
  const capped=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.candidates.some(c=>c.transportCapacity?.active===2));
  assert.ok(capped.length>0);
  assert.equal(capped[0].candidates[0].eligible,false);
});

test('automatic transport capacity counts only active transports and covers all command actors', () => {
  function Boat() {} function Other() {}
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat});
  f.player.units=()=>[{id:()=>1,isActive:()=>false}];
  const actor={}; f.bot.attackBehavior=actor; f.runtime.attachBehaviors(f.bot);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),true);
  assert.equal(f.runtime.intent(actor,'AttackBehavior',Boat,2,10),true);
  assert.equal(f.runtime.intent(actor,'AttackBehavior',Boat,3,10),false);
  assert.equal(f.runtime.intent(actor,'AttackBehavior',Other,3,10),true);
});

test('failed or throwing automatic launches release capacity reservations', () => {
  function Boat() {} let mode='false';
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    emitIntent:()=>{if(mode==='throw')throw new Error('emitter failed');return mode!=='false';}});
  for(let i=0;i<3;i++)assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),false);
  mode='throw';assert.throws(()=>f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),/emitter failed/);
  mode='success';assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,2,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,3,10),false);
});

test('capacity is enforced against alternate policies and unknown unit state', () => {
  function Boat() {}
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    strategies:[{id:'force',version:'1',decide:(s,cs)=>({selectedId:cs[0].id,reason:'force command'})}],defaultStrategy:'force'});
  f.player.units=()=>[{id:()=>1,isActive:()=>true},{id:()=>2,isActive:()=>true}];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,3,10),false);
  f.player.units=()=>{throw new Error('missing state');};
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,3,10),false);
  assert.equal(f.sent.length,0);
});

test('policy holds do not consume automatic transport reservations', () => {
  function Boat() {} let hold=true;
  const legacy=createLegacyStrategy();
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    strategies:[{id:'hold',version:'1',decide:(s,cs)=>hold?{selectedId:'$wait',reason:'hold'}:legacy.decide(s,cs)}],defaultStrategy:'hold'});
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),false);
  hold=false;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,1,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,2,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,3,10),false);
});

test('a new manual boat with a different destination cannot acknowledge a pending bot boat', () => {
  function Boat() {}
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat});let ships=[];
  f.player.units=()=>ships;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,10,10),true);
  ships=[{id:()=>1,isActive:()=>true,targetTile:()=>20}];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),false);
  ships=[];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,40,10),false);
});

test('manual requests sharing a destination retain both pending capacity slots', () => {
  function Boat() {} let observe;
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    watchTransportIntents:handler=>{observe=handler;},emitIntent:()=>{observe(10);return true;}});
  let ships=[];f.player.units=()=>ships;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,10,10),true);
  observe(10); // Manual emission is observed but never intercepted.
  ships=[{id:()=>1,isActive:()=>true,targetTile:()=>10}];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10),false);
  ships.push({id:()=>2,isActive:()=>true,targetTile:()=>10});
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10),false);
  ships=[];
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10),true);
});

test('pending manual launches count before the first automatic launch', () => {
  function Boat() {} let observe;
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    watchTransportIntents:handler=>{observe=handler;}});
  observe(10);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),false);
});

test('asynchronously rejected automatic submissions release reservations', async () => {
  function Boat() {} let settle;
  const pending=new Promise(resolve=>{settle=resolve;});let accepted=false;
  const f=fixture({transportType:'Transport',isTransportIntent:ctor=>ctor===Boat,
    emitIntent:()=>accepted?true:pending});
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,10,10),pending);
  settle(false);await pending;await Promise.resolve();accepted=true;
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,20,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,30,10),true);
  assert.equal(f.runtime.intent(f.bot,'AttackBehavior',Boat,40,10),false);
});
test('boat destination links allocation and command while alternate amounts remain policy choices',async()=>{
  const planner=require('../src/brain/boat-planner')({state:{settings:{boatProbeMinTroops:10}}});
  const legacy=createLegacyStrategy();
  const f=fixture({boatPlanner:planner,probeLanding:async()=>true,strategies:[{id:'half-boat',version:'1',decide(s,cs){
    return s.domain==='boat-allocation'?{selectedId:'boat:half',reason:'half amount'}:legacy.decide(s,cs);
  }}],defaultStrategy:'half-boat'});
  const actor={player:f.player,game:f.game,boatTargetTaken:()=>false,
    emitBoat:(tile,troops)=>f.runtime.intent(actor,'AttackBehavior',function Boat(){},tile,troops)};
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planBoatSites(actor,[{tile:4}],{mode:'nearby',cap:2}),4);
  assert.equal(f.runtime.launchBoat(actor,4,'probe','probe'),true);
  assert.equal(f.sent[0][2],5);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(decisions[1].snapshot.parentDecisionId,decisions[0].decisionId);
  assert.equal(decisions[2].candidates[0].parentDecisionId,decisions[1].decisionId);
});
test('tactical boat trace links origin, search, destination, allocation and command',async()=>{
  const f=fixture({boatPlanner:require('../src/brain/boat-planner')({state:{settings:{winFixes:false}}}),probeLanding:async()=>true});
  const actor={player:f.player,game:f.game,random:{randElement:items=>items[0]},
    findRandomBoatTarget:(origin)=>f.runtime.planBoatSites(actor,[{tile:4}],{mode:'random',origin}),
    _launchTacticalBoat:(tile,troops)=>f.runtime.intent(actor,'AttackBehavior',function Boat(){},tile,troops)};
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planTacticalBoat(actor,[2],[]),true);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.deepEqual(decisions.slice(0,4).map(d=>d.snapshot.domain),['boat-origin','boat-search','boat-destination','boat-allocation']);
  for(let i=1;i<4;i++)assert.equal(decisions[i].snapshot.parentDecisionId,decisions[i-1].decisionId);
  assert.equal(decisions[4].candidates[0].parentDecisionId,decisions[3].decisionId);
  f.runtime.intent(actor,'AttackBehavior',function Boat(){},9,1);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1).candidates[0].parentDecisionId,undefined);
});
test('stale tactical search cannot launch or attempt its fallback',async()=>{
  let searches=0,launches=0;
  const f=fixture({boatPlanner:require('../src/brain/boat-planner')({state:{settings:{}}})});
  const actor={player:f.player,game:f.game,random:{randElement:items=>items[0]},
    findRandomBoatTarget:async()=>{searches++;f.current=false;return null;},_launchTacticalBoat:()=>{launches++;return true;}};
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planTacticalBoat(actor,[2],[]),false);
  assert.equal(searches,1);assert.equal(launches,0);
});
test('attack shortcut target commands retain phase ancestry and holds reset next pass',async()=>{
  let hold=true;
  const legacy=createLegacyStrategy();
  const strategies=[{id:'hold-shortcut',version:'1',decide(s,cs){
    return hold && s.domain==='takeover-target'?{selectedId:'$wait',reason:'hold'}:legacy.decide(s,cs);
  }}];
  const planner=require('../src/brain/attack-sequence-planner')({state:{settings:{winFixes:true,features:{}}},
    botType:'Bot',now:()=>0,debug:()=>{}});
  const f=fixture({attackSequencePlanner:planner,strategies,defaultStrategy:'hold-shortcut'});
  const actor={player:f.player,game:f.game,sendAttack:async()=>f.runtime.intent(actor,'AttackBehavior',function attack(){},'target',50)};
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  const target={id:()=> 'target',troops:()=>1,isPlayer:()=>true,isDisconnected:()=>true};
  const context={all:[target],friends:[],enemies:[],expand:true};
  await f.runtime.planAttackSequence(actor,context);assert.deepEqual(f.sent,[]);
  hold=false;await f.runtime.planAttackSequence(actor,context);assert.equal(f.sent.length,1);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const command=decisions.at(-1),targetDecision=decisions.at(-2),phase=decisions.at(-3);
  assert.equal(targetDecision.snapshot.parentDecisionId,phase.decisionId);
  assert.equal(command.candidates[0].parentDecisionId,targetDecision.decisionId);
});
for(const domain of ['attack-plan','bot-target','naval-action']) test(`nested ${domain} hold stops outer shortcuts without leaking`,async()=>{
  const legacy=createLegacyStrategy();let hold=true,sends=0;
  const strategies=[{id:'nested-hold',version:'1',decide(snapshot,candidates){
    if(snapshot.domain===domain&&hold)return {selectedId:'$wait',reason:'hold nested'};
    if(domain==='attack-plan'&&snapshot.domain==='attack-sequence'&&candidates.some(c=>c.phase==='main'))
      return {selectedId:'sequence:main',reason:'main first'};
    return legacy.decide(snapshot,candidates);
  }}];
  const nested={run:async(...args)=>{
    const hooks=args.at(-1),candidates=[{id:'nested',kind:domain,priority:0,eligible:true,reason:'test action'},{id:'$wait',kind:'wait',eligible:true}];
    if(domain==='attack-plan') hooks.choose(domain,candidates,{});else hooks.choose(candidates,{});
    return false;
  }};
  const planner=require('../src/brain/attack-sequence-planner')({state:{settings:{winFixes:true,features:{}}},botType:'Bot',now:()=>0,debug:()=>{}});
  const f=fixture({attackSequencePlanner:planner,strategies,defaultStrategy:'nested-hold',
    ...(domain==='attack-plan'?{attackPlanner:nested}:domain==='bot-target'?{botTargetPlanner:nested}:{navalActionPlanner:nested})});
  const actor={game:f.game,player:f.player,allianceBehavior:{},
    openingSnapshot:()=>null,random:{chance:()=>false},
    sendAttack:async()=>{sends++;return true;},
    attackBots:()=>domain==='bot-target'?f.runtime.planBotTargets(actor):false,
    maybeOpportunisticBoat:()=>domain==='naval-action'?f.runtime.planNavalActions(actor,{}):false,
    attackBestTarget:()=>domain==='attack-plan'?f.runtime.planAttacks(actor,[],[]):false};
  f.game.terraNullius=()=>({id:()=> 'land'});
  f.bot.attackBehavior=actor;f.runtime.attachBehaviors(f.bot);
  const context={all:[],friends:[],enemies:[{isPlayer:()=>true,type:()=> 'Bot'}],expand:true,boat:false,alliance:false,openLand:true};
  await f.runtime.planAttackSequence(actor,context);assert.equal(sends,0);
  hold=false;await f.runtime.planAttackSequence(actor,context);assert.equal(sends,1);
});
for(const phase of ['far-alliance','enemy-alliance']) for(const error of [false,true]) test(`sequence ${phase} alliance ancestry and hold recovery (${error})`,async()=>{
  const legacy=createLegacyStrategy();let hold=true,main=0;
  const strategies=[{id:'hold-outreach',version:'1',decide(snapshot,candidates){
    if(hold&&snapshot.domain==='alliance-rule') {if(error)throw Error('outreach policy failure');return {selectedId:'$wait',reason:'hold outreach'};}
    return legacy.decide(snapshot,candidates);
  }}];
  const planner=require('../src/brain/attack-sequence-planner')({state:{settings:{winFixes:phase==='far-alliance',features:{}}},botType:'Bot',now:()=>0,debug:()=>{}});
  const f=fixture({attackSequencePlanner:planner,strategies,defaultStrategy:'hold-outreach'});
  const alliance=allianceActor(true),target={id:()=> 'enemy',smallID:()=>2,isTraitor:()=>false,isPlayer:()=>true,type:()=> 'Human'};
  const outreach=()=>{if(f.runtime.decideAlliance(alliance,target,false,'outgoing')) f.runtime.diplomacyIntent(alliance,'outgoing','AllianceBehavior',function Request(){},target);};
  alliance.reachOutToFarNations=phase==='far-alliance'?outreach:()=>{};
  alliance.maybeSendAllianceRequests=phase==='enemy-alliance'?outreach:()=>{};
  const actor={game:f.game,player:f.player,allianceBehavior:alliance,openingSnapshot:()=>null,
    maybeOpportunisticBoat:async()=>false,random:{chance:()=>false},attackBestTarget:async()=>{main++;}};
  f.bot.attackBehavior=actor;f.bot.allianceBehavior=alliance;f.runtime.attachBehaviors(f.bot);
  const context={all:[],friends:[],enemies:[target],expand:true,boat:false,alliance:true,openLand:false};
  await f.runtime.planAttackSequence(actor,context);assert.equal(main,0);assert.equal(f.sent.length,0);
  hold=false;await f.runtime.planAttackSequence(actor,context);assert.equal(main,1);assert.equal(f.sent.length,1);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const command=decisions.findLast(r=>r.candidates.some(c=>c.source==='AllianceBehavior'));
  const rule=decisions.findLast(r=>r.snapshot.domain==='alliance-rule');
  const phaseDecision=decisions.findLast(r=>r.snapshot.domain==='attack-sequence'&&r.selectedId==='sequence:'+phase);
  assert.equal(rule.snapshot.parentDecisionId,phaseDecision.decisionId);
  assert.equal(command.candidates[0].parentDecisionId,rule.decisionId);
});
test('nested building decisions preserve phase and upgrade command ancestry', async () => {
  const quote={canUpgrade:true};
  const planner={
    handle: async (actor,hooks) => {
      const choice=hooks.choose('structure-phase',[{id:'normal',kind:'structure-phase',eligible:true,priority:0,reason:'normal'}],{});
      return hooks.execute(choice.decisionId,()=>actor.runtime.planBuilding(actor,'upgrade',[]));
    },
    upgrade: async (_actor,_units,hooks) => {
      const choice=hooks.choose('structure-upgrade',[{id:'unit',kind:'structure-upgrade',eligible:true,priority:0,reason:'covered'}],{});
      hooks.remember(quote,choice.decisionId);return quote;
    }
  };
  const f=fixture({buildingPlanner:planner});const actor={runtime:f.runtime};
  f.bot.structureBehavior=actor;f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planBuilding(actor,'handle'),quote);
  f.runtime.build(actor,'StructureBehavior',{sendBuildOrUpgrade(){}},quote);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(decisions[1].snapshot.parentDecisionId,decisions[0].decisionId);
  assert.equal(decisions[2].candidates[0].parentDecisionId,decisions[1].decisionId);
});
for (const domain of ['structure-plan','structure-placement']) test(`nested ${domain} hold prevents optional defense and resets next pass`,async()=> {
  let hold=true, defenses=0;
  const wait={id:'$wait',kind:'wait',eligible:true};
  const strategies=[{id:'hold-build',version:'1',decide(snapshot,candidates) {
    return snapshot.domain===domain && hold ? {selectedId:'$wait',reason:'hold'} : createLegacyStrategy().decide(snapshot,candidates);
  }}];
  const planner={run:async(_actor,_context,hooks)=>{
    hooks.choose([{id:'candidate',kind:domain,priority:0,eligible:true,reason:'test candidate'},wait],{});return false;
  }};
  const buildingPlanner=require('../src/brain/building-planner')({units:{DefensePost:'DefensePost'},settings:()=>({defensePosts:true})});
  const f=fixture({buildingPlanner,strategies,defaultStrategy:'hold-build',
    ...(domain==='structure-plan'?{structurePlanner:planner}:{structurePlacementPlanner:planner})});
  const actor={game:f.game,player:f.player,placementsCount:1,defensePostNeeded:()=>false,
    isOnStructureCooldown:()=>false,isInPostSaveUpBlockedPhase:()=>false,
    doHandleStructures:()=>domain==='structure-plan'?f.runtime.planStructures(actor,{}):f.runtime.planStructurePlacement(actor,'City'),
    tryBuildDefensePost:async()=>{defenses++;return true;}};
  const config=f.game.config();f.game.config=()=>({...config,isUnitDisabled:()=>false});
  f.bot.structureBehavior=actor;f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planBuilding(actor,'handle'),false);assert.equal(defenses,0);
  hold=false;assert.equal(await f.runtime.planBuilding(actor,'handle'),true);assert.equal(defenses,1);
});

test('runtime can start on the adaptive baseline while retaining legacy for comparisons', () => {
  const adaptive = createAdaptiveStrategy(createLegacyStrategy());
  const f = fixture({ strategies: [adaptive], defaultStrategy: 'adaptive-v1' });
  assert.deepEqual(f.runtime.strategies().map(strategy => strategy.id), ['legacy-v1', 'adaptive-v1']);
  f.runtime.intent(f.bot, 'NationBot.spawn', function Event() {}, 'target', 25);
  const decision = f.runtime.inspect().records.find(record => record.kind === 'decision');
  assert.equal(decision.strategy.id, 'adaptive-v1');
});

test('successful structure placement becomes the parent of its build command', async () => {
  const quote = { type: 'City', canBuild: 41 };
  const planner = { async run(_actor, unitType, hooks) {
    const choice = hooks.choose([{ id: 'placement:41', kind: 'structure-placement', tile: 41,
      unitType, eligible: true, priority: 0, originalScore: 10, reason: 'best tile' },
      { id: '$wait', kind: 'wait', eligible: true, priority: 999, reason: 'wait' }], { unitType });
    hooks.remember(quote, choice.decisionId);
    return quote;
  } };
  const f = fixture({ structurePlacementPlanner: planner });
  const actor = {}; f.bot.structureBehavior = actor; f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.planStructurePlacement(actor, 'City'), quote);
  f.runtime.build(actor, 'StructureBehavior', { sendBuildOrUpgrade() {} }, quote, quote.canBuild);
  const decisions = f.runtime.inspect().records.filter(record => record.kind === 'decision');
  const placement = decisions.find(record => record.snapshot.domain === 'structure-placement');
  const command = decisions.at(-1);
  assert.equal(command.candidates[0].parentDecisionId, placement.decisionId);
});

test('standalone attack geography adapter returns target and records its decision', async () => {
  const target = { id: () => 'island' };
  const planner = { async select(_actor, mode, hooks) {
    const choice = hooks.choose('attack-geography', [{ id:'geo:island', kind:'attack-geography',
      targetId:'island', eligible:true, priority:0, reason:'reachable' }], { mode });
    return { target, decisionId:choice.decisionId, stop:false };
  } };
  const f = fixture({ attackGeographyPlanner:planner });
  const actor = {}; f.bot.attackBehavior = actor; f.runtime.attachBehaviors(f.bot);
  assert.equal(await f.runtime.selectAttackGeography(actor, 'island'), target);
  assert.equal(f.runtime.inspect().records.find(r => r.kind === 'decision').snapshot.domain, 'attack-geography');
});
test('intent proposal reaches one decision interface with original argument identity', () => {
  const f = fixture(); const target = { id: () => 'enemy' }; function Event() {}
  assert.equal(f.runtime.intent(f.bot, 'NationBot.spawn', Event, target, 50), true);
  assert.equal(f.sent[0][1], target); assert.equal(f.sent[0][2], 50);
  const decision = f.runtime.inspect().records.find(r => r.kind === 'decision');
  assert.equal(decision.candidates[0].source, 'NationBot.spawn');
});
test('build gateway preserves menu this, arguments, and undefined return', () => {
  const f = fixture(); const quote = { type: 'City', cost: 100n, canBuild: 0, canUpgrade: false };
  const menu = { sendBuildOrUpgrade(...args) { assert.equal(this, menu); assert.equal(args[0], quote); assert.equal(args.length, 1); } };
  assert.equal(f.runtime.build(f.bot, 'StructureBehavior.upgrade', menu, quote), undefined);
  assert.equal(f.runtime.inspect().records.at(-1).status, 'submitted');
});
test('private-game and stopped/stale-owner checks block late actions', () => {
  for (const field of ['enabled', 'public', 'current']) {
    const f = fixture(); f[field] = field === 'public';
    assert.equal(f.runtime.intent(f.bot, 'AttackBehavior.attack', function Event() {}), false);
    assert.equal(f.sent.length, 0);
    assert.equal(f.runtime.inspect().records.at(-1).kind, 'blocked');
  }
});
test('behavior instrumentation preserves checks and records actual thresholds', () => {
  const f = fixture(); const behavior = { game: f.game, player: f.player,
    getPerceivedCost(type) { assert.equal(this, behavior); assert.equal(type, 'City'); return 1000n; },
    shouldBuildStructure() { return false; } };
  f.bot.structureBehavior = behavior; f.runtime.attachBehaviors(f.bot);
  assert.equal(behavior.getPerceivedCost('City'), 1000n);
  assert.equal(behavior.shouldBuildStructure('City', 3, false), false);
  const results = f.runtime.inspect().records.filter(r => r.kind === 'rule-result');
  assert.equal(results.find(r => r.rule === 'getPerceivedCost').result, '1000');
  assert.equal(results.find(r => r.rule === 'shouldBuildStructure').result, false);
});
test('asynchronous rule instrumentation returns the original promise', async () => {
  const f = fixture(); const promise = Promise.resolve(false);
  const behavior = { game: f.game, player: f.player, maybeSpawnStructure: () => promise };
  f.bot.structureBehavior = behavior; f.runtime.attachBehaviors(f.bot);
  assert.equal(behavior.maybeSpawnStructure('City'), promise);
  await promise; await Promise.resolve();
  assert.equal(f.runtime.inspect().records.at(-1).result, false);
});
test('later game observations are recorded separately from dispatch success', () => {
  const f = fixture(); f.runtime.intent(f.bot, 'AttackBehavior.attack', function Event() {}, 'enemy', 50);
  f.tick++; f.player.troops = () => 150; f.runtime.begin(f.bot);
  const record = f.runtime.inspect().records.at(-1);
  assert.equal(record.kind, 'observation'); assert.equal(record.snapshot.self.troops, 150);
});
test('old behavior stays attached to its old owner after a new bot is created', () => {
  const f = fixture(); const old = { game: f.game, player: f.player }; f.bot.attackBehavior = old;
  f.runtime.attachBehaviors(f.bot);
  const next = { mg: { ...f.game }, player: f.player };
  f.runtime.attach(next); f.runtime.begin(next);
  f.current = false;
  assert.equal(f.runtime.intent(old, 'AttackBehavior.attack', function Event() {}), false);
  assert.equal(f.sent.length, 0);
});
test('alliance UI callbacks use the same decision boundary and preserve this', () => {
  const f = fixture(); const button = { action() { assert.equal(this, button); return 12; } };
  assert.equal(f.runtime.callback(f.bot, 'AllianceBehavior.accept', button, 'action'), 12);
  assert.equal(f.runtime.inspect().records.some(r => r.kind === 'decision'), true);
});
test('alliance decisions expose rules and attach the final rule as command parent', () => {
  const f = fixture();
  const actor = allianceActor(true);
  f.bot.allianceBehavior = actor; f.runtime.attachBehaviors(f.bot);
  const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => false };
  assert.equal(f.runtime.decideAlliance(actor, target, false, 'outgoing'), true);
  function Request() {}
  assert.equal(f.runtime.diplomacyIntent(actor, 'outgoing', 'AllianceBehavior', Request, target), true);
  const decisions = f.runtime.inspect().records.filter(record => record.kind === 'decision');
  const rule = decisions.filter(record => record.snapshot.domain === 'alliance-rule').at(-1);
  const command = decisions.at(-1);
  assert.equal(rule.selectedId, 'alliance:similar-strength');
  assert.equal(command.candidates[0].parentDecisionId, rule.decisionId);
});
test('alliance wait stops one request, leaks no parent, and the next request recovers', () => {
  const waiting = { id: 'wait-alliance', name: 'wait', version: '1', decide(snapshot, candidates) {
    if (snapshot.domain === 'alliance-rule') return { selectedId: '$wait', reason: 'hold' };
    return { selectedId: candidates.find(candidate => candidate.kind !== 'wait')?.id ?? null, reason: 'allow command' };
  } };
  const f = fixture({ strategies: [waiting] });
  const actor = allianceActor(true);
  f.bot.allianceBehavior = actor; f.runtime.attachBehaviors(f.bot);
  const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => false };
  f.runtime.select('wait-alliance');
  assert.equal(f.runtime.decideAlliance(actor, target, true, 'incoming'), false);
  assert.equal(f.runtime.allianceDecisionStopped(actor), true);
  const button = { action: () => 1 };
  f.runtime.callback(actor, 'AllianceBehavior.unrelated', button, 'action');
  const command = f.runtime.inspect().records.filter(record => record.kind === 'decision').at(-1);
  assert.equal('parentDecisionId' in command.candidates[0], false);
  f.runtime.select('legacy-v1');
  assert.equal(f.runtime.decideAlliance(actor, target, true, 'incoming'), true);
  assert.equal(f.runtime.allianceDecisionStopped(actor), false);
});
test('alliance strategy error and stale owner stop without evaluating or retaining a parent', () => {
  const broken = { id: 'broken-alliance', name: 'broken', version: '1', decide(snapshot, candidates) {
    if (snapshot.domain === 'alliance-rule') throw Error('broken alliance policy');
    return { selectedId: candidates.find(candidate => candidate.kind !== 'wait')?.id ?? null, reason: 'allow command' };
  } };
  for (const mode of ['error', 'stale']) {
    const f = fixture({ strategies: [broken] }); const actor = allianceActor(true); let evaluated = 0;
    actor.isRegularBot = () => { evaluated++; return false; };
    f.bot.allianceBehavior = actor; f.runtime.attachBehaviors(f.bot);
    const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => false };
    if (mode === 'error') f.runtime.select('broken-alliance'); else f.current = false;
    assert.equal(f.runtime.decideAlliance(actor, target, true, 'incoming'), false);
    assert.equal(f.runtime.allianceDecisionStopped(actor), true);
    assert.equal(evaluated, 0);
    const button = { action: () => true };
    f.runtime.callback(actor, 'AllianceBehavior.unrelated', button, 'action');
    const command = f.runtime.inspect().records.filter(record => record.kind === 'decision').at(-1);
    if (mode === 'error') assert.equal('parentDecisionId' in command.candidates[0], false);
  }
});
test('incoming, renewal and outgoing gateways consume only their matching alliance parent', () => {
  for (const { context, accepted } of [
    { context: 'incoming', accepted: true }, { context: 'incoming', accepted: false },
    { context: 'renewal', accepted: true }, { context: 'renewal', accepted: false },
    { context: 'outgoing', accepted: true }, { context: 'outgoing', accepted: false }
  ]) {
    const f = fixture(); const actor = allianceActor(accepted);
    f.bot.allianceBehavior = actor; f.runtime.attachBehaviors(f.bot);
    const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => false };
    assert.equal(f.runtime.decideAlliance(actor, target, true, context), accepted);
    const rule = f.runtime.inspect().records.filter(record => record.kind === 'decision' && record.snapshot.domain === 'alliance-rule').at(-1);
    const button = { action: () => true };
    if (context === 'outgoing' && accepted) f.runtime.diplomacyIntent(actor, context, 'AllianceBehavior', function Request() {}, target);
    else if (context === 'incoming' || accepted) f.runtime.diplomacyCallback(actor, context, `AllianceBehavior.${context}`, button, 'action');
    else f.runtime.callback(actor, 'AllianceBehavior.unrelated', button, 'action');
    const command = f.runtime.inspect().records.filter(record => record.kind === 'decision').at(-1);
    assert.equal(command.candidates[0].parentDecisionId, context === 'incoming' || accepted ? rule.decisionId : undefined);
    f.runtime.callback(actor, 'AllianceBehavior.after', button, 'action');
    const after = f.runtime.inspect().records.filter(record => record.kind === 'decision').at(-1);
    assert.equal('parentDecisionId' in after.candidates[0], false);
  }
});
test('diplomacy snapshots retain primitive facts only', () => {
  const f = fixture(); const actor = allianceActor(true);
  f.bot.allianceBehavior = actor; f.runtime.attachBehaviors(f.bot);
  const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => false, secret: { live: true } };
  f.runtime.decideAlliance(actor, target, false, 'outgoing');
  const decisions = f.runtime.inspect().records.filter(record => record.kind === 'decision' && record.snapshot.domain === 'alliance-rule');
  assert.ok(decisions.length > 0);
  for (const decision of decisions) {
    assert.equal(decision.snapshot.diplomacy.targetId, 'enemy');
    assert.equal(typeof decision.snapshot.diplomacy.incoming, 'boolean');
    assert.equal(JSON.stringify(decision).includes('secret'), false);
  }
});

function combatActor(f, options = {}) {
  const target = { id: () => 'enemy', smallID: () => 2, isPlayer: () => true, troops: () => 50,
    outgoingAttacks: () => [], type: () => 'Human', isTraitor: () => false, capacity: 1000 };
  const ally = { id: () => 'ally', targets: () => [target], troops: () => 50,
    outgoingAttacks: () => [], type: () => 'Human', isTraitor: () => false, capacity: 1000 };
  const allianceBehavior = { betray(victim) {
    return f.runtime.callback(this, 'AllianceBehavior.betray', { action: () => victim.id() }, 'action');
  } };
  const actor = { game: { config: () => ({ disableAlliances: () => false, maxTroops: value => value.capacity }) },
    player: { allies: () => [ally], relation: () => 1, smallID: () => 1, isFriendly: () => false,
      updateRelation() {}, troops: () => 1000, isAlliedWith: () => true }, allianceBehavior,
    emojiBehavior: { sendEmoji() {} },
    sendAttack(value, force) { return f.runtime.intent(this, 'AttackBehavior.sendAttack', function Attack() {}, value, force); }
  };
  Object.assign(actor, options);
  f.bot.attackBehavior = actor; f.bot.allianceBehavior = allianceBehavior; f.runtime.attachBehaviors(f.bot);
  return { actor, ally, target, allianceBehavior };
}

test('combat diplomacy decisions retain attack-purpose and command ancestry', async () => {
  let runtime;
  const attackPlanner = { async run(actor, friends, enemies, hooks) {
    const outer = hooks.choose('attack-plan', [{ id: 'attack:assist', kind: 'attack-plan', priority: 0, eligible: true,
      reason: 'assist' }], { phase: 'normal' });
    return hooks.execute(outer.decisionId, () => actor.assistAllies());
  } };
  const f = fixture({ attackPlanner }); runtime = f.runtime;
  const { actor } = combatActor(f); actor.assistAllies = () => runtime.planAssist(actor);
  await runtime.planAttacks(actor, [], []);
  const decisions = runtime.inspect().records.filter(record => record.kind === 'decision');
  const outer = decisions.find(record => record.snapshot.domain === 'attack-plan');
  const ally = decisions.find(record => record.snapshot.domain === 'assist-ally');
  const inner = decisions.find(record => record.snapshot.domain === 'assist-target');
  const command = decisions.find(record => record.candidates[0]?.source === 'AttackBehavior.sendAttack');
  assert.equal(ally.snapshot.parentDecisionId, outer.decisionId);
  assert.equal(inner.snapshot.parentDecisionId, ally.decisionId);
  assert.equal(command.candidates[0].parentDecisionId, inner.decisionId);
});

test('betrayal scopes both behaviors to the selected diplomacy decision', async () => {
  const f = fixture(); const { actor } = combatActor(f);
  assert.equal(await f.runtime.planBetray(actor, [actor.gameTarget || {
    id: () => 'ally', troops: () => 50, outgoingAttacks: () => [], type: () => 'Human',
    isTraitor: () => false, capacity: 1000
  }], []), true);
  const decisions = f.runtime.inspect().records.filter(record => record.kind === 'decision');
  const selected = decisions.find(record => record.snapshot.domain === 'betray-target');
  const commands = decisions.filter(record => ['AllianceBehavior.betray', 'AttackBehavior.sendAttack'].includes(record.candidates[0]?.source));
  assert.equal(commands.length, 2);
  assert.ok(commands.every(record => record.candidates[0].parentDecisionId === selected.decisionId));
});
test('deferred betrayal restores both behavior scopes after success and rejection', async () => {
  for (const reject of [false, true]) {
    const f = fixture(); const { actor, allianceBehavior } = combatActor(f);
    let settle;
    const deferred = new Promise((resolve, rejectPromise) => { settle = reject ? () => rejectPromise(Error('deferred failure')) : () => resolve(true); });
    actor.sendAttack = victim => {
      f.runtime.intent(actor, 'AttackBehavior.sendAttack', function Attack() {}, victim, true);
      return deferred;
    };
    const target = { id: () => 'ally', troops: () => 50, outgoingAttacks: () => [], type: () => 'Human',
      isTraitor: () => false, capacity: 1000 };
    const pending = f.runtime.planBetray(actor, [target], []); await Promise.resolve(); await Promise.resolve();
    settle();
    if (reject) await assert.rejects(pending, /deferred failure/); else assert.equal(await pending, true);
    f.runtime.intent(actor, 'AttackBehavior.after', function AfterAttack() {});
    f.runtime.callback(allianceBehavior, 'AllianceBehavior.after', { action: () => true }, 'action');
    const decisions = f.runtime.inspect().records.filter(record => record.kind === 'decision');
    for (const record of decisions.slice(-2)) assert.equal('parentDecisionId' in record.candidates[0], false);
  }
});

test('combat diplomacy wait stops the enclosing attack pass', async () => {
  const waiting = { id: 'wait-assist', name: 'wait assist', version: '1', decide(snapshot, candidates) {
    if (snapshot.domain === 'assist-target') return { selectedId: '$wait', reason: 'hold' };
    return { selectedId: candidates.find(candidate => candidate.kind === snapshot.domain && candidate.eligible)?.id ?? '$wait', reason: 'first' };
  } };
  let allowedAfter = true;
  const attackPlanner = { async run(actor, friends, enemies, hooks) {
    const outer = hooks.choose('attack-plan', [{ id: 'attack:assist', kind: 'attack-plan', priority: 0, eligible: true,
      reason: 'assist' }], { phase: 'normal' });
    await hooks.execute(outer.decisionId, () => actor.assistAllies());
    allowedAfter = hooks.allowed();
  } };
  const f = fixture({ attackPlanner, strategies: [waiting] }); const { actor } = combatActor(f);
  actor.assistAllies = () => f.runtime.planAssist(actor); f.runtime.select('wait-assist');
  await f.runtime.planAttacks(actor, [], []);
  assert.equal(allowedAfter, false);
});
test('combat diplomacy strategy error also stops the enclosing attack pass', async () => {
  const broken = { id: 'broken-assist', name: 'broken assist', version: '1', decide(snapshot, candidates) {
    if (snapshot.domain === 'assist-target') throw Error('broken assist policy');
    return { selectedId: candidates.find(candidate => candidate.kind === snapshot.domain && candidate.eligible)?.id ?? '$wait', reason: 'first' };
  } };
  let allowedAfter = true;
  const attackPlanner = { async run(actor, friends, enemies, hooks) {
    const outer = hooks.choose('attack-plan', [{ id: 'attack:assist', kind: 'attack-plan', priority: 0, eligible: true,
      reason: 'assist' }], { phase: 'normal' });
    await hooks.execute(outer.decisionId, () => actor.assistAllies()); allowedAfter = hooks.allowed();
  } };
  const f = fixture({ attackPlanner, strategies: [broken] }); const { actor } = combatActor(f);
  actor.assistAllies = () => f.runtime.planAssist(actor); f.runtime.select('broken-assist');
  await f.runtime.planAttacks(actor, [], []);
  assert.equal(allowedAfter, false);
  assert.ok(f.runtime.inspect().records.some(record => record.kind === 'strategy-error'));
});

function turnBot(f, overrides = {}) {
  const noop = () => undefined;
  Object.assign(f.bot, {
    feat: () => false,
    emojiBehavior: { maybeSendCasualEmoji: noop }, updateRelationsFromEmbargos: noop,
    allianceBehavior: { handleAllianceRequestsFromBots: noop, handleAllianceRequests: noop,
      handleAllianceExtensionRequests: noop },
    mirvBehavior: { considerMIRV: noop }, structureBehavior: { handleStructures: noop },
    warshipBehavior: { maybeSpawnWarship: noop, counterWarshipInfestation: noop },
    handleEmbargoesToHostileNations: noop, attackBehavior: { maybeAttack: noop },
    nukeBehavior: { maybeSendNuke: noop }
  }, overrides);
  f.runtime.attachBehaviors(f.bot);
  return f.bot;
}
const turnContext = enabled => ({ path: 'full', tick: 1, attackRate: 30, phaseEnabled: {
  alliance: false, mirv: false, structure: false, warshipDeployment: false, embargo: false,
  attack: false, warshipInfestation: false, nuke: false, ...enabled
} });

test('turn phase links nested attack decision and command ancestry', async () => {
  let runtime;
  const attackPlanner = { async run(actor, friends, enemies, hooks) {
    const decision = hooks.choose('attack-plan', [{ id: 'attack:test', kind: 'attack-plan', priority: 0,
      eligible: true, reason: 'test attack' }], { phase: 'normal' });
    return hooks.execute(decision.decisionId,
      () => runtime.intent(actor, 'AttackBehavior.sendAttack', function Attack() {}, 'enemy'));
  } };
  const f = fixture({ attackPlanner }); runtime = f.runtime;
  const bot = turnBot(f, { feat: name => name === 'expand' });
  bot.attackBehavior.maybeAttack = () => runtime.planAttacks(bot.attackBehavior, [], []);
  await runtime.planTurn(bot, turnContext({ attack: true }));
  const decisions = runtime.inspect().records.filter(record => record.kind === 'decision');
  const turn = decisions.find(record => record.snapshot.domain === 'turn-plan' && record.selectedId.endsWith(':attack'));
  const attack = decisions.find(record => record.snapshot.domain === 'attack-plan');
  const command = decisions.find(record => record.candidates[0]?.source === 'AttackBehavior.sendAttack');
  assert.equal(attack.snapshot.parentDecisionId, turn.decisionId);
  assert.equal(command.candidates[0].parentDecisionId, attack.decisionId);
  assert.equal(JSON.stringify(turn.snapshot.turn).includes('Behavior'), false);
});

test('turn wait stops one pass and the next pass recovers', async () => {
  const waiting = { id: 'wait-turn', name: 'wait turn', version: '1', decide(snapshot, candidates) {
    if (snapshot.domain === 'turn-plan') return { selectedId: '$wait', reason: 'hold turn' };
    return { selectedId: candidates.find(candidate => candidate.kind !== 'wait')?.id ?? null, reason: 'allow' };
  } };
  const f = fixture({ strategies: [waiting] }), calls = [];
  const bot = turnBot(f, { emojiBehavior: { maybeSendCasualEmoji: () => calls.push('emoji') } });
  f.runtime.select('wait-turn');
  assert.equal((await f.runtime.planTurn(bot, turnContext())).stopped, true);
  assert.deepEqual(calls, []);
  f.runtime.select('legacy-v1');
  assert.equal((await f.runtime.planTurn(bot, turnContext())).stopped, false);
  assert.deepEqual(calls, ['emoji']);
});

test('deferred turn phases restore behavior parents after fulfillment and rejection', async () => {
  for (const reject of [false, true]) {
    const f = fixture(); let settle;
    const deferred = new Promise((resolve, rejectPromise) => {
      settle = reject ? () => rejectPromise(Error('turn failed')) : () => resolve(true);
    });
    const structureBehavior = { handleStructures: () => deferred };
    const bot = turnBot(f, { structureBehavior });
    const pending = f.runtime.planTurn(bot, { path: 'build-only', tick: 1, attackRate: 30 });
    await Promise.resolve(); settle();
    if (reject) await assert.rejects(pending, /turn failed/); else await pending;
    f.runtime.intent(structureBehavior, 'StructureBehavior.after', function After() {});
    const command = f.runtime.inspect().records.filter(record => record.kind === 'decision').at(-1);
    assert.equal('parentDecisionId' in command.candidates[0], false);
  }
});
module.exports = { fixture };

test('broken telemetry getters preserve original rule execution and return', () => {
  const f = fixture(); let called = false;
  const hostile = Object.defineProperties({}, {
    isPlayer: { get() { throw Error('telemetry getter'); } },
    then: { get() { throw Error('then getter'); } }
  });
  const behavior = { shouldBuildStructure(arg) { called = true; assert.equal(arg, hostile); return hostile; } };
  f.bot.structureBehavior = behavior; f.runtime.attachBehaviors(f.bot);
  assert.equal(behavior.shouldBuildStructure(hostile), hostile);
  assert.equal(called, true);
  assert.equal(f.runtime.intent(f.bot, 'test', function Event() {}, hostile), true);
});

test('after economic destruction the final gateway can rebuild below3M while protecting pending commitments',()=>{
 const units={Port:'Port',City:'City',Factory:'Factory',SAMLauncher:'SAM'};
 const opening={borderKnown:true,frontline:false,samEnabled:true,portTarget:2,cityTarget:1};
 const model=require('../src/brain/defense-economy')({units});
 const f=fixture({strategies:[createAdaptiveStrategy(createLegacyStrategy())],defaultStrategy:'adaptive-v1',
  createSpendingLedger:require('../src/brain/spending-ledger'),defenseEconomy:model,units,
  twoTeamOpening:{observe:()=>opening}});
 const config=f.game.config();config.isUnitDisabled=()=>false;f.game.config=()=>config;
 let counts={Port:4,City:3,Factory:0,SAM:1};
 f.player.units=(...types)=>(types.length?types:Object.keys(counts)).flatMap(type=>Array.from({length:counts[type]||0},()=>({
  type:()=>type,level:()=>1,isActive:()=>true,isUnderConstruction:()=>false})));
 f.bot.structureBehavior={cost:()=>500000n};assert.equal(f.runtime.defenseEconomyFacts(f.bot).reserve,3000000n);
 counts={Port:0,City:0,Factory:0,SAM:0};f.player.gold=()=>1000000n;
 assert.equal(f.runtime.defenseEconomyFacts(f.bot).recovering,true);
 let builds=0;const menu={sendBuildOrUpgrade:()=>{builds++;}};
 f.runtime.build(f.bot,'recovery',menu,{type:'Port',canBuild:10,canUpgrade:false,cost:500000n});
 f.runtime.build(f.bot,'optional',menu,{type:'City',canBuild:20,canUpgrade:false,cost:500000n});
 assert.equal(builds,1);
});
