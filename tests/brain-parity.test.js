'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { buildSource } = require('../scripts/build.js');
const createEngine = require('../src/brain/engine.js');
const createLegacyStrategy = require('../src/brain/legacy-strategy.js');
const createRuntime = require('../src/brain/runtime.js');
const createStructurePlanner = require('../src/brain/structure-planner.js');
const createBotTargetPlanner = require('../src/brain/bot-target-planner.js');
const createAttackPlanner = require('../src/brain/attack-planner.js');
const createAttackGeographyPlanner = require('../src/brain/attack-geography-planner.js');
const createDiplomacyPlanner = require('../src/brain/diplomacy-planner.js');
const createTurnPlanner = require('../src/brain/turn-planner.js');
const createNavalLandingPlanner = require('../src/brain/naval-landing-planner.js');
const createNavalActionPlanner = require('../src/brain/naval-action-planner.js');
const original = fs.readFileSync(path.join(__dirname, '../vendor/openfront-helper-1.84.0.user.js'), 'utf8');
const instrumented = buildSource().source;
function nativeMirvResponse(f){
  const start=f.source.indexOf('function respondToMIRV('),end=f.source.indexOf('function recipientCanSendEmoji(',start);
  return vm.runInNewContext(f.source.slice(start,end)+';respondToMIRV',f.context);
}
test('social MIRV reaction hold prevents original shared random draws',()=>{
  const base=createLegacyStrategy(),policy={id:'reaction-hold',version:'1',decide(s,cs){return s.domain==='social-reaction'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'MirvBehavior',{strategies:[policy]});f.context.recipientCanSendEmoji=()=>true;f.context.EMOJI_OVERWHELMED=['wow'];f.actor.random={chance:n=>{f.commands.push(n);return true;},randElement:pool=>{f.commands.push(pool);return pool[0];}};
  f.attach();f.runtime.select(policy.id);nativeMirvResponse(f)(f.game,f.actor.random,{},f.actor);assert.deepEqual(f.commands,[]);
});
for(const scenario of ['allowed','chance-fails','permission-fails','empty'])test(`social MIRV native reaction parity ${scenario}`,async()=>{
  await parity('MirvBehavior',f=>{
    f.context.recipientCanSendEmoji=()=>scenario!=='permission-fails';f.context.EMOJI_OVERWHELMED=scenario==='empty'?[]:['wow'];
    f.actor.random={chance:n=>{f.commands.push({chance:n});return scenario!=='chance-fails';},randElement:pool=>{f.commands.push({sample:pool});return pool[0];}};
    f.attach();f.commands.push({result:nativeMirvResponse(f)(f.game,f.actor.random,{},f.actor)});
  });
});
test('alliance bot event response hold prevents actioned mark',()=>{
  const base=createLegacyStrategy(),policy={id:'event-hold',version:'1',decide(s,cs){return s.domain==='alliance-event-response'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f);f.actor.isRegularBot=()=>true;
  f.attach();f.runtime.select(policy.id);f.actor.handleAllianceRequestsFromBots();assert.equal(f.context._allianceBehaviorActioned.size,0);
});
test('social message hold revokes request cooldown',()=>{
  const base=createLegacyStrategy(),policy={id:'message-stop',version:'1',decide(s,cs){return s.domain==='social-message'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);delete f.actor.sendEmoji;delete f.actor.maybeSendEmoji;
  f.context.discoverCtors=()=>({emoji:function emoji(){}});f.actor.random.randElement=pool=>pool[0];f.setTick(1000);f.attach();f.runtime.select(policy.id);
  f.actor.maybeSendEmoji(make('a'),['hi']);assert.equal(f.actor.lastEmojiSent.size,0);
});
test('social cooldown hold prevents timestamp mutation',()=>{
  const base=createLegacyStrategy(),policy={id:'cooldown-stop',version:'1',decide(s,cs){return s.domain==='social-cooldown'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.setTick(1000);f.attach();f.runtime.select(policy.id);assert.equal(f.actor.shouldSendEmoji(make('a')),false);assert.equal(f.actor.lastEmojiSent.size,0);
});
test('social phase hold prevents all original casual checks',()=>{
  const policy={id:'social-hold',version:'1',decide:()=>({selectedId:'$wait',reason:'Hold'})};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});f.actor.gameOver=false;
  for(const method of ['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag','charmAllies','annoyTraitors','findRat','greetNearbyPlayers'])f.actor[method]=()=>f.commands.push(method);
  f.attach();f.runtime.select(policy.id);f.actor.maybeSendCasualEmoji();assert.deepEqual(f.commands,[]);
});
test('social recipient hold prevents ally message',()=>{
  const base=createLegacyStrategy(),policy={id:'recipient-hold',version:'1',decide(s,cs){return s.domain==='social-recipient'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});f.player.allies=()=>[{type:()=> 'Human',id:()=> 'ally'}];f.actor.sendEmoji=()=>f.commands.push('sent');
  f.attach();f.runtime.select(policy.id);f.actor.charmAllies();assert.deepEqual(f.commands,[]);
});
test('production bootstrap outgoing trade queries the TradeShip type',()=>{
  const bootstrap=fs.readFileSync(path.join(__dirname,'../src/brain/bootstrap.js'),'utf8');
  const expression=bootstrap.match(/warshipTransportPlanner:\s*(createWarshipTransportPlanner\(\{[^\n]*\}\))/)[1];
  const planner=vm.runInNewContext(expression,{UNIT:{TransportShip:'transport',TradeShip:'trade',Warship:'warship'},createWarshipTransportPlanner:require('../src/brain/warship-transport-planner')});
  const calls=[],actor={trackedTradeShips:new Set(),player:{units:type=>{calls.push(type);return[];}},game:{units:type=>{calls.push(type);return[];}},indexById:()=>new Map()};
  planner.outgoing(actor,'trade',{allowed:()=>true});assert.deepEqual(calls,['trade','trade']);
});
for(const mode of ['transport','trade'])test(`outgoing ${mode} response hold preserves tracked ship`,()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-hold',version:'1',decide(s,cs){return s.domain===`warship-${mode}-outgoing-response`?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupOutgoingResponse(f,mode);
  f.attach();f.runtime.select(policy.id);f.actor[mode==='trade'?'trackTradeShipsAndRetaliate':'trackTransportShipsAndRetaliate']();
  assert.equal(f.actor[mode==='trade'?'trackedTradeShips':'trackedTransportShips'].has('ship'),true);assert.equal(f.commands.length,0);
});
for(const domain of ['warship-invasion-source','warship-loss-source'])test(`central ${domain} hold prevents original winner`,()=>{
  const base=createLegacyStrategy(),policy={id:'source-hold',version:'1',decide(s,cs){return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});
  setupIncomingTransport(f);f.game.isValidCoord=()=>true;f.game.ref=()=>5;f.game.isWater=()=>true;
  f.attach();f.runtime.select(policy.id);
  const result=domain==='warship-invasion-source'?f.actor.findInvasionThreat():f.actor.findLossZone([{x:0,y:0},{x:1,y:0}]);
  assert.equal(result,null);
});
const UNIT = Object.fromEntries(['City', 'Port', 'Factory', 'SAMLauncher', 'MissileSilo', 'DefensePost',
  'Warship', 'AtomBomb', 'HydrogenBomb', 'MIRV', 'TransportShip', 'TradeShip'].map(name => [name, name]));

function fixture(source, name, options = {}) {
  const commands = [], messages = [];
  const state = { stats: { builds: 0, attacks: 0, spawns: 0, nukes: 0 }, settings: { enabled: true,
    features: { build: true, expand: true, alliance: true, nuke: true }, economyFirst: true,
    winFixes: false, samDefense: false, defensePosts: false, buildStructures: {} } };
  let tick = 1;
  const player = { id: () => 'self', smallID: () => 1, isPlayer: () => true, isAlive: () => true,
    troops: () => 1000, gold: () => 1000000n, numTilesOwned: () => 5000,
    unitsConstructed: () => false,
    units: type => type === UNIT.Port ? [{ id: () => 1, tile: () => 2, level: () => 1, isUnderConstruction: () => false, type: () => UNIT.Port }] : [],
    incomingAttacks: () => [], outgoingAttacks: () => [],
    buildables: async (tile, types) => types.map(type => ({ type, canBuild: tile, canUpgrade: false, cost: 100n })) };
  const game = { ticks: () => tick, myPlayer: () => player, inSpawnPhase: () => false,
    players: () => [player], config: () => ({ isUnitDisabled: () => false,
      gameConfig: () => ({ difficulty: 'Impossible' }), unitInfo: () => ({ upgradable: true }) }) };
  const menu = { uiState: { rocketDirectionUp: true }, sendBuildOrUpgrade(...args) {
    commands.push({ kind: 'build', args, arc: this.uiState.rocketDirectionUp });
    return options.buildReturn;
  } };
  const ctors = Object.fromEntries(['spawn', 'attack', 'boat', 'embargoAll', 'embargo', 'moveWarship', 'allianceRequest', 'donateTroops'].map(key => [key, Object.defineProperty(function () {}, 'name', { value: key })]));
  const emitIntent = (ctor, ...args) => { commands.push({ kind: ctor.name, args }); return options.emitReturn ?? true; };
  const runtime = createRuntime({ createEngine, createLegacyStrategy, openingExpansion:options.openingExpansion,
    twoTeamOpening: options.twoTeamOpening, teamGeography:options.teamGeography, units:UNIT, isCurrent: () => options.current?.()??true,
    socialPlanner:require('../src/brain/social-planner')(),
    turnPlanner: createTurnPlanner({ warshipAutoSpawn: () => state.settings.warshipAutoSpawn !== false }),
    warshipMaintenancePlanner: require('../src/brain/warship-maintenance-planner')({settings:()=>state.settings}),
    buildingPlanner: require('../src/brain/building-planner')({ units: UNIT, settings: () => state.settings,
      difficulty: () => context.currentDifficulty(), densityThreshold: 1/1500, samProtectWeight: () => 1 }),
    attackSequencePlanner: require('../src/brain/attack-sequence-planner')({ state, botType:'Bot',
      now: () => context.performance.now(), debug:()=>{} }),
    boatPlanner: require('../src/brain/boat-planner')({state}),
    embargoPlanner: require('../src/brain/embargo-planner')(),
    embargoAllCtor:()=>context.discoverCtors().embargoAll,botType:'Bot',
    spawnPlanner: require('../src/brain/spawn-planner')({settings:()=>state.settings,geography:options.teamGeography}),
    attackAllocationPlanner: require('../src/brain/attack-allocation-planner')({settings:()=>state.settings,
      difficulty:()=>context.currentDifficulty(),easy:'Easy',botType:'Bot'}),
    attackRoutingPlanner: require('../src/brain/attack-routing-planner')({settings:()=>state.settings,botType:'Bot',
      closestTwoTiles:(...args)=>context.closestTwoTiles(...args)}),
    diplomacyDetailsPlanner: require('../src/brain/diplomacy-details-planner')({settings:()=>state.settings,debug:()=>{}}),
    allianceEventPlanner:require('../src/brain/alliance-event-planner')({collect:()=>context.collectAllianceEvents(),requestTypes:()=>context.ALLIANCE_REQUEST_TYPES,renewTypes:()=>context.RENEW_TYPES,isActioned:event=>context._allianceBehaviorActioned.has(event),veto:target=>typeof context.companionAllianceVeto==='function'&&context.companionAllianceVeto(target),pick:(...args)=>context.pickAllianceButton(...args)}),
    strikeRanking: require('../src/brain/strike-ranking')({ settings: () => state.settings, difficulty: () => context.currentDifficulty(),
      ffa: 'FFA', team: 'Team', botType: 'Bot', structureTypes: ['City'], densityThreshold: .1, minLevels: 5 }),
    strikeTargetPlanner: require('../src/brain/strike-target-planner')({ units: UNIT, settings: () => state.settings, difficulty: () => context.currentDifficulty(),
      ffa: 'FFA', friendly: 1, hostile: -1, maxSiloLevel: 5, salvoPace: (...args) => context.salvoPace(...args),
      samMessage: count => context.setLastAction(context.tr('☢️ Salvo ×{n} → SAM break', { n: count }), 'nuke') }),
    strikePlanner: require('../src/brain/strike-planner')({ state, units: UNIT, difficulty: () => context.currentDifficulty(),
      salvoPace: (...args) => context.salvoPace(...args),
      salvoMessage: count => context.setLastAction(context.tr('☢️ Salvo ×{n} → dense target', { n: count }), 'nuke') }),
    warshipDeploymentPlanner: require('../src/brain/warship-deployment-planner')({ portType: UNIT.Port, warshipType: UNIT.Warship }),
    warshipDetailsPlanner: require('../src/brain/warship-details-planner')({warshipType: UNIT.Warship, settings:()=>state.settings}),
    warshipTransportPlanner: require('../src/brain/warship-transport-planner')({transportType:UNIT.TransportShip,tradeType:UNIT.TradeShip,warshipType:UNIT.Warship}),
    warshipPatrolPlanner: require('../src/brain/warship-patrol-planner')(),
    warshipThreatPlanner: require('../src/brain/warship-threat-planner')({transportType:UNIT.TransportShip,tradeType:UNIT.TradeShip,warshipType:UNIT.Warship,settings:()=>state.settings}),
    warshipTradeHotspots:options.warshipTradeHotspots,warshipMoveCtor:()=>context.discoverCtors().moveWarship,
    warshipCombatPlanner: require('../src/brain/warship-combat-planner')({ warshipType: UNIT.Warship, difficulty: () => context.currentDifficulty() }),
    warshipSafetyPlanner: require('../src/brain/warship-safety-planner')({portType: UNIT.Port, settings:()=>state.settings}),
    navalLandingPlanner: createNavalLandingPlanner(),
    navalActionPlanner: createNavalActionPlanner({ state, transportType: UNIT.TransportShip, debug: () => {} }),
    probeLanding: (actor, tile, fallback) => context.withTimeout(actor.player.bestTransportShipSpawn(tile), context.WORKER_TIMEOUT_MS, fallback),
    landingDiagnostics: data => { state._distantDiag = data; },
    strategies: options.strategies || [],
    diplomacyPlanner: createDiplomacyPlanner({ settings: () => state.settings, neutralRelation: 0,
      friendlyRelation: 1, difficulty: () => context.currentDifficulty(),
      difficulties: { easy: 'Easy', medium: 'Medium' }, humanType: 'Human',
      emojis: { confused: 'confused', scared: 'scared', love: 'love', handshake: 'handshake',
        assistLow: 'assist-low', assistMe: 'assist-me', assistAlly: 'assist-ally', assistAccept: 'assist-accept' } }),
    attackPlanner: createAttackPlanner({ settings: () => state.settings, difficulty: () => context.currentDifficulty(), botType: 'Bot', hostileRelation: -1 }),
    attackGeographyPlanner: createAttackGeographyPlanner({ settings: () => state.settings,
      transportType: UNIT.TransportShip, ffaMode: 'FFA', closestTwoTiles: (...args) => context.closestTwoTiles(...args) }),
    structurePlanner: createStructurePlanner({ units: UNIT, settings: () => state.settings, difficulty: () => 'Impossible' }),
    botTargetPlanner: createBotTargetPlanner({ botType: 'Bot', attackStructures: new Set(['City']) }),
    isPublic: () => false, enabled: () => true, settings: () => state.settings, emitIntent,
    intentName: ctor => ctor.name, log: () => {} });
  const context = {
    UNIT, state, console, Map, Set, Number, Math, Date, performance,
    PlayerType: { Bot: 'Bot', Human: 'Human', Nation: 'Nation' },
    Difficulty: { Easy: 'Easy', Medium: 'Medium', Hard: 'Hard', Impossible: 'Impossible' },
    GameMode: { Team: 'Team', FFA: 'FFA' }, Relation: { Neutral: 0, Friendly: 1, Hostile: -1 },
    currentDifficulty: () => 'Impossible', getEventBus: () => ({}), discoverCtors: () => ctors,
    closestTwoTiles: (_game, own, theirs) => own.length && theirs.length ? { x: own[0], y: theirs[0] } : null,
    getBuildMenu: () => menu, emitIntent, ofhBrainRuntime: runtime,
    setLastAction: (message, category) => messages.push([message, category]),
    tr: text => text, safeName: target => target.id(), ofhDebug: () => {},
    withTimeout: promise => promise, WORKER_TIMEOUT_MS: 2000,
    autoBotBuildAllowed: () => true, mirvReserveHold: () => 0n,
    UPGRADE_DENSITY_THRESHOLD: 1 / 1500,
    ENCIRCLE_SCAN_TICKS: 100,
    shimSharedWaterComponents: () => options.coastal === false ? null : new Set([-1]),
    TILES_PER_CITY_EQUIVALENT: 2000, sampleBotIncome: () => {},
    EMOJI_NUKE: [], EMOJI_CONFUSED: 'confused', EMOJI_SCARED_OF_THREAT: 'scared',
    EMOJI_LOVE: 'love', EMOJI_HANDSHAKE: 'handshake',
    EMOJI_ASSIST_RELATION_TOO_LOW: 'assist-low', EMOJI_ASSIST_TARGET_ME: 'assist-me',
    EMOJI_ASSIST_TARGET_ALLY: 'assist-ally', EMOJI_ASSIST_ACCEPT: 'assist-accept',
    AllPlayers: 'AllPlayers', respondToMIRV: () => {},
    EMOJI_WARSHIP_RETALIATION: [], sample: () => {},
    AttackStructures: new Set(['City']),
  };
  const start = source.indexOf(`class ${name}{`);
  const end = source.indexOf('"use strict";', start);
  const Class = vm.runInNewContext(`${source.slice(start, end)};${name}`, context);
  const actor = Object.create(Class.prototype);
  Object.assign(actor, { game, mg: game, player, random: { chance: () => true, randElement: a => a[0], nextInt: low => low },
    emojiBehavior: { maybeSendEmoji() {}, sendEmoji() {}, maybeSendAttackEmoji() {} } });
  const bot = name === 'NationBot' ? actor : { mg: game, player };
  const property = { StructureBehavior: 'structureBehavior', AttackBehavior: 'attackBehavior',
    EmojiBehavior:'emojiBehavior',
    NukeBehavior: 'nukeBehavior', WarshipBehavior: 'warshipBehavior', MirvBehavior: 'mirvBehavior', AllianceBehavior: 'allianceBehavior' }[name];
  if (property) bot[property] = actor;
  runtime.attach(bot); runtime.begin(bot);
  // Attach ownership/instrumentation after scenario overrides have been installed.
  return { actor, bot, runtime, player, game, menu, state, commands, messages, context, source,
    attach: () => runtime.attachBehaviors(bot), setTick: value => { tick = value; },
    result: () => JSON.parse(JSON.stringify({ commands, messages, stats: state.stats }, (_, v) => typeof v === 'bigint' ? v.toString() : v)) };
}

function fixtureClass(f, name) {
  const start = f.source.indexOf(`class ${name}{`);
  const end = f.source.indexOf('"use strict";', start);
  return vm.runInNewContext(`${f.source.slice(start, end)};${name}`, f.context);
}
function setupThreatPatrol(f){
  setupIncomingTransport(f);
  f.game.x=t=>t;f.game.y=()=>0;f.game.isValidCoord=(x,y)=>x>=0;
  f.game.ref=x=>x;f.game.isWater=()=>true;
  f.actor.smartState={transportPos:new Map(),tradePos:new Map(),losses:[],raids:[],cooldown:new Map(),serviced:new Map(),lastPassMs:-1e9};
  f.actor.moveBestWarshipTo=(tile,kind)=>{f.commands.push({tile,kind});return true;};
}
function setupSocial(f){
  f.actor.gameOver=false;f.actor.lastEmojiSent=new Map();f.player.type=()=> 'Nation';f.player.allies=()=>[];f.player.nearby=()=>[];f.player.team=()=> 'ours';f.game.getWinner=()=>null;f.game.numLandTiles=()=>10000;
  for(const key of ['OVERWHELMED','BORED','CONGRATULATE','BRAG','CHARM_ALLIES','CLOWN','RAT','GREET'])f.context[`EMOJI_${key}`]=[key];
  f.actor.sendEmoji=(target,pool)=>f.commands.push({target:target==='AllPlayers'?target:target.id(),pool});
  f.actor.maybeSendEmoji=(target,pool)=>f.actor.sendEmoji(target,pool);
  f.actor.random={chance:n=>{f.commands.push({chance:n});return true;},randElement:pool=>{f.commands.push({sample:pool.map(p=>p.id())});return pool[pool.length-1];}};
  return id=>({id:()=>id,smallID:()=>id,type:()=> 'Human',numTilesOwned:()=>10,isPlayer:()=>true,isFriendly:()=>false,isTraitor:()=>true});
}
function setupAllianceEvents(f){
  const player={id:()=> 'other',smallID:()=>2,isPlayer:()=>true,type:()=> 'Human'};
  const buttons=[{kind:'accept',action:()=>f.commands.push('accept')},{kind:'reject',action:()=>f.commands.push('reject')}];
  const events=[{type:1,focusID:2,createdAt:100,buttons}];
  Object.assign(f.context,{collectAllianceEvents:()=>events,ALLIANCE_REQUEST_TYPES:new Set([1]),RENEW_TYPES:new Set([2]),_allianceBehaviorActioned:new Set(),
    pickAllianceButton:(values,css)=>css==='btn'?values[0]:values[1],runAndCaptureAllianceCtor:fn=>fn(),companionAllianceVeto:()=>false});
  f.actor.resolveEventPlayer=()=>player;f.actor.getAllianceDecision=()=>true;
  const cfg=f.game.config();cfg.disableAlliances=()=>false;cfg.numSpawnPhaseTurns=()=>10;f.game.config=()=>cfg;
  return events;
}
function setupRealSocial(f){
  const make=setupSocial(f);delete f.actor.sendEmoji;delete f.actor.maybeSendEmoji;
  f.context.discoverCtors=()=>({emoji:function emoji(){}});f.context.EMOJI_AGGRESSIVE_ATTACK=['aggressive'];f.context.EMOJI_ATTACK=['attack'];
  f.actor.random.randElement=pool=>{f.commands.push({sample:Array.from(pool)});return pool[0];};f.player.relation=()=>0;f.setTick(1000);return make;
}
for(const scenario of ['send','cooldown','boundary','bot','nation-target','broadcast','cannot-send','no-ctor','attack-send','attack-skip','hostile-send','hostile-skip','empty-pool'])test(`final social baseline parity ${scenario}`,async()=>{
  await parity('EmojiBehavior',f=>{
    const make=setupRealSocial(f);let target=make('a');
    if(scenario==='cooldown')f.actor.lastEmojiSent.set('a',900);
    if(scenario==='boundary')f.actor.lastEmojiSent.set('a',700);
    if(scenario==='bot')f.player.type=()=> 'Bot';
    if(scenario==='nation-target')target.type=()=> 'Nation';
    if(scenario==='broadcast')target='AllPlayers';
    if(scenario==='cannot-send')f.actor.canSendEmoji=()=>false;
    if(scenario==='no-ctor')f.context.discoverCtors=()=>({});
    if(scenario.startsWith('hostile'))f.player.relation=()=>-1;
    if(scenario.endsWith('skip'))f.actor.random.chance=n=>{f.commands.push({chance:n});return false;};
    f.attach();const result=scenario.startsWith('attack')||scenario.startsWith('hostile')?f.actor.maybeSendAttackEmoji(target):f.actor.maybeSendEmoji(target,scenario==='empty-pool'?[]:['hi','hey']);
    f.commands.push({result,stamps:[...f.actor.lastEmojiSent]});
  });
});
for(const domain of ['social-message','social-attack-message'])for(const outcome of ['wait','invalid','throw','null'])test(`final social ${domain} ${outcome} rolls back only held request`,()=>{
  const base=createLegacyStrategy(),policy={id:'social-final-hold',version:'1',decide(s,cs){if(s.domain!==domain)return base.decide(s,cs);if(outcome==='throw')throw Error('policy');return {selectedId:outcome==='wait'?'$wait':outcome==='null'?null:'bad',reason:'Hold'};}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupRealSocial(f);f.actor.lastEmojiSent.set('older',900);f.attach();f.runtime.select(policy.id);
  if(domain==='social-message')f.actor.maybeSendEmoji(make('a'),['hi']);else f.actor.maybeSendAttackEmoji(make('a'));
  assert.deepEqual([...f.actor.lastEmojiSent],[['older',900]]);f.runtime.select('legacy-v1');f.actor.maybeSendEmoji(make('a'),['hi']);assert.equal(f.actor.lastEmojiSent.get('a'),1000);
});
test('final social nested hold restores previous expired cooldown',()=>{
  const base=createLegacyStrategy(),policy={id:'expired-hold',version:'1',decide(s,cs){return s.domain==='social-message'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupRealSocial(f);f.actor.lastEmojiSent.set('a',1);f.attach();f.runtime.select(policy.id);f.actor.maybeSendEmoji(make('a'),['hi']);assert.equal(f.actor.lastEmojiSent.get('a'),1);
});
test('final social stale permission callback rolls back request timestamp',()=>{
  let current=true;const f=fixture(instrumented,'EmojiBehavior',{current:()=>current});const make=setupRealSocial(f);f.actor.canSendEmoji=()=>{current=false;return true;};f.attach();f.actor.maybeSendEmoji(make('a'),['hi']);assert.equal(f.actor.lastEmojiSent.size,0);
});
test('final social message hold restores winner flag',()=>{
  const base=createLegacyStrategy(),policy={id:'winner-message-hold',version:'1',decide(s,cs){return s.domain==='social-message'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});setupRealSocial(f);f.game.getWinner=()=> 'other';const cfg=f.game.config();cfg.gameConfig=()=>({gameMode:'Team'});f.game.config=()=>cfg;
  f.attach();f.runtime.select(policy.id);f.actor.congratulateWinner();assert.equal(f.actor.gameOver,false);
});
test('final social raw send preserves no-emission behavior with central sample',()=>{
  const f=fixture(instrumented,'EmojiBehavior');setupRealSocial(f);f.attach();f.actor.sendEmoji('AllPlayers',['hi']);assert.deepEqual(f.commands,[{sample:['hi']}]);assert.ok(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain==='social-message'));
});
for(const mode of ['collect','requests','renewal','bots'])for(const scenario of ['normal','ignored-type','actioned','no-buttons','no-player','veto','early','reject','callback-throws','disabled','timestamp-fallback'])test(`alliance event baseline parity ${mode} ${scenario}`,async()=>{
  await parity('AllianceBehavior',f=>{
    const events=setupAllianceEvents(f),event=events[0];if(mode==='renewal')event.type=2;
    if(scenario==='ignored-type')event.type=99;
    if(scenario==='actioned')f.context._allianceBehaviorActioned.add(event);
    if(scenario==='no-buttons')event.buttons=[];
    if(scenario==='no-player')f.actor.resolveEventPlayer=()=>null;
    if(scenario==='veto')f.context.companionAllianceVeto=()=>true;
    if(scenario==='early')event.createdAt=1;
    if(scenario==='reject')f.actor.getAllianceDecision=()=>false;
    if(scenario==='callback-throws')event.buttons[0].action=()=>{throw Error('button');};
    if(scenario==='disabled')f.game.config().disableAlliances=()=>true;
    if(scenario==='timestamp-fallback'){delete event.createdAt;f.game.inSpawnPhase=()=>true;}
    f.actor.isRegularBot=()=>mode==='bots';f.attach();
    if(mode==='collect'){const result=f.actor.incomingAllianceRequests();f.commands.push({requests:result.map(r=>({time:r.createdAt(),spawn:r.__createdInSpawnPhase}))});}
    else f.actor[mode==='requests'?'handleAllianceRequests':mode==='renewal'?'handleAllianceExtensionRequests':'handleAllianceRequestsFromBots']();
    f.commands.push({actioned:[...f.context._allianceBehaviorActioned].map(e=>events.indexOf(e))});
  });
});
for(const mode of ['requests','renewal','bots'])for(const domain of ['alliance-event-target','alliance-event-response','alliance-event-action'])test(`alliance event ${mode} ${domain} hold prevents marks`,()=>{
  const base=createLegacyStrategy(),policy={id:'events-held',version:'1',decide(s,cs){return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f);if(mode==='renewal')events[0].type=2;f.actor.isRegularBot=()=>mode==='bots';
  f.attach();f.runtime.select(policy.id);f.actor[mode==='requests'?'handleAllianceRequests':mode==='renewal'?'handleAllianceExtensionRequests':'handleAllianceRequestsFromBots']();
  if(mode==='bots'&&domain==='alliance-event-action'){assert.equal(f.context._allianceBehaviorActioned.size,1);return;} // Bot marks are owned by response, with no callback.
  assert.equal(f.context._allianceBehaviorActioned.size,0);assert.equal(f.commands.length,0);
});
test('alliance event direct request callback obeys action hold',()=>{
  const base=createLegacyStrategy(),policy={id:'direct-callback-hold',version:'1',decide(s,cs){return s.domain==='alliance-event-action'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});setupAllianceEvents(f);f.attach();const request=f.actor.incomingAllianceRequests()[0];f.runtime.select(policy.id);request.accept();assert.equal(f.commands.length,0);assert.equal(f.context._allianceBehaviorActioned.size,0);
});
test('alliance event direct callback retains queue provenance',()=>{
  const f=fixture(instrumented,'AllianceBehavior');setupAllianceEvents(f);f.attach();const request=f.actor.incomingAllianceRequests()[0];request.accept();
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision'),queue=decisions.find(r=>r.snapshot.domain==='alliance-event-response'&&r.selectedId==='queue');
  const action=decisions.find(r=>r.snapshot.domain==='alliance-event-action');assert.equal(action.snapshot.parentDecisionId,queue.decisionId);
});
test('alliance event nested callback hold prevents outer actioned mark',()=>{
  const base=createLegacyStrategy(),policy={id:'nested-event-hold',version:'1',decide(s,cs){return s.domain==='alliance-event-action'&&s.event.action==='reject'?{selectedId:'$wait',reason:'Nested hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f);f.attach();const request=f.actor.incomingAllianceRequests()[0];events[0].buttons[0].action=()=>request.reject();f.runtime.select(policy.id);request.accept();assert.equal(f.context._allianceBehaviorActioned.size,0);
});
test('alliance event nested command hold prevents outer actioned mark',()=>{
  const base=createLegacyStrategy(),policy={id:'nested-command-hold',version:'1',decide(s,cs){return cs[0].kind==='nested'?{selectedId:'$wait',reason:'Nested command hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f);f.attach();const request=f.actor.incomingAllianceRequests()[0];events[0].buttons[0].action=()=>f.runtime.intent(f.actor,'AllianceBehavior',function nested(){});f.runtime.select(policy.id);request.accept();assert.equal(f.context._allianceBehaviorActioned.size,0);assert.equal(f.commands.length,0);
});
for(const mode of ['requests','renewal'])test(`alliance event ${mode} alliance-rule hold prevents response and resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'event-rule-hold',version:'1',decide(s,cs){return s.domain==='alliance-rule'?{selectedId:'$wait',reason:'Hold rule'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f);if(mode==='renewal')events[0].type=2;delete f.actor.getAllianceDecision;
  f.attach();f.runtime.select(policy.id);f.actor[mode==='requests'?'handleAllianceRequests':'handleAllianceExtensionRequests']();assert.equal(f.commands.length,0);assert.equal(f.context._allianceBehaviorActioned.size,0);
  f.actor.getAllianceDecision=()=>true;f.runtime.select('legacy-v1');f.actor[mode==='requests'?'handleAllianceRequests':'handleAllianceExtensionRequests']();assert.equal(f.commands.length,1);
});
for(const outcome of ['invalid','throw','null','command'])test(`alliance event ${outcome} failure prevents callback marks and resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'event-failure',version:'1',decide(s,cs){if(outcome==='command'&&cs[0].kind==='accept')return {selectedId:'$wait',reason:'Hold command'};if(outcome==='command'||s.domain!=='alliance-event-action')return base.decide(s,cs);if(outcome==='throw')throw Error('policy');return {selectedId:outcome==='null'?null:'bad',reason:'Invalid'};}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});setupAllianceEvents(f);f.attach();f.runtime.select(policy.id);f.actor.handleAllianceRequests();assert.equal(f.commands.length,0);assert.equal(f.context._allianceBehaviorActioned.size,0);
  f.runtime.select('legacy-v1');f.actor.handleAllianceRequests();assert.equal(f.commands.length,1);assert.equal(f.context._allianceBehaviorActioned.size,1);
});
test('alliance event collection handles more than 79 events with bounded candidates',()=>{
  const base=createLegacyStrategy(),sizes=[],policy={id:'event-windows',version:'1',decide(s,cs){if(s.domain==='alliance-event-target')sizes.push(cs.length);return base.decide(s,cs);}};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]});const events=setupAllianceEvents(f),first=events[0];events.push(...Array.from({length:100},()=>({...first})));f.attach();f.runtime.select(policy.id);assert.equal(f.actor.incomingAllianceRequests().length,101);assert.ok(sizes.every(size=>size<=80));
});
test('alliance event direct command parent is callback action and restores after call',()=>{
  const f=fixture(instrumented,'AllianceBehavior');setupAllianceEvents(f);f.attach();f.actor.incomingAllianceRequests()[0].accept();f.runtime.intent(f.actor,'AllianceBehavior',function later(){});
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision'),action=decisions.find(r=>r.snapshot.domain==='alliance-event-action'),command=decisions.find(r=>r.candidates[0].kind==='accept'),later=decisions.find(r=>r.candidates[0].kind==='later');
  assert.equal(command.candidates[0].parentDecisionId,action.decisionId);assert.equal(later.candidates[0].parentDecisionId,undefined);assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
});
for(const method of ['charmAllies','annoyTraitors','findRat','greetNearbyPlayers'])for(const scenario of ['targets','empty','chance-fail','time-gate'])test(`social recipient parity ${method} ${scenario}`,async()=>{
  await parity('EmojiBehavior',f=>{
    const make=setupSocial(f),targets=scenario==='empty'?[]:[make('a'),make('b')];f.player.allies=()=>targets;f.player.nearby=()=>targets;f.game.players=()=>targets;
    f.setTick(method==='findRat'?6000:100);if(scenario==='time-gate')f.setTick(method==='findRat'?5999:601);
    if(scenario==='chance-fail')f.actor.random.chance=n=>{f.commands.push({chance:n});return false;};
    f.attach();f.actor[method]();
  });
});
for(const scenario of ['none','team-other','team-own','ffa-string','ffa-winner','ffa-other','no-nations'])test(`social winner parity ${scenario}`,async()=>{
  await parity('EmojiBehavior',f=>{
    const make=setupSocial(f),winner=make('winner'),nation={...make('nation'),type:()=> 'Nation',smallID:()=>1,numTilesOwned:()=>100};
    f.game.getWinner=()=>scenario==='none'?null:scenario==='team-own'?'ours':scenario==='ffa-string'?'string':scenario==='team-other'?'theirs':winner;
    f.game.players=()=>scenario==='no-nations'?[]:[{...nation,smallID:()=>scenario==='ffa-other'?2:1}];
    const cfg=f.game.config();cfg.gameConfig=()=>({gameMode:scenario.startsWith('team')?'Team':'FFA'});f.game.config=()=>cfg;
    f.attach();f.actor.congratulateWinner();f.commands.push({gameOver:f.actor.gameOver});
  });
});
for(const scenario of ['tiny','boundary','non-human','no-troops','none','chance-fail','mixed'])test(`social small attack parity ${scenario}`,async()=>{
  await parity('EmojiBehavior',f=>{
    const make=setupSocial(f),a=make('a'),b=make('b');if(scenario==='non-human')a.type=()=> 'Nation';
    f.player.incomingAttacks=()=>scenario==='none'?[]:[{attacker:()=>a,troops:()=>scenario==='boundary'?100:10},...(scenario==='mixed'?[{attacker:()=>b,troops:()=>20}]:[])];
    if(scenario==='no-troops')f.player.troops=()=>0;
    if(scenario==='chance-fail')f.actor.random.chance=n=>{f.commands.push({chance:n});return false;};
    f.attach();f.actor.checkVerySmallAttack();
  });
});
test('social casual parity retains current pass after gameOver and gates next pass',async()=>{
  await parity('EmojiBehavior',f=>{
    setupSocial(f);
    for(const method of ['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag','charmAllies','annoyTraitors','findRat','greetNearbyPlayers'])f.actor[method]=()=>{f.commands.push(method);if(method==='congratulateWinner')f.actor.gameOver=true;};
    f.attach();f.actor.maybeSendCasualEmoji();f.actor.maybeSendCasualEmoji();
  });
});
for(const outcome of ['wait','invalid','throw','null'])test(`social recipient ${outcome} stops later casual phases and resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'social-stop',version:'1',decide(s,cs){if(s.domain!=='social-recipient')return base.decide(s,cs);if(outcome==='throw')throw Error('policy');return {selectedId:outcome==='wait'?'$wait':outcome==='null'?null:'bad',reason:'Stop'};}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.player.allies=()=>[make('ally')];
  for(const method of ['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag'])f.actor[method]=()=>{};
  f.actor.annoyTraitors=()=>f.commands.push('later');f.actor.findRat=()=>{};f.actor.greetNearbyPlayers=()=>{};
  f.attach();f.runtime.select(policy.id);f.actor.maybeSendCasualEmoji();assert.ok(!f.commands.includes('later'));assert.equal(f.actor.lastEmojiSent.size,0);
  f.runtime.select('legacy-v1');f.actor.maybeSendCasualEmoji();assert.ok(f.commands.includes('later'));
});
test('social recipient alternative preserves original draw then selects another ally',()=>{
  const base=createLegacyStrategy(),policy={id:'other-ally',version:'1',decide(s,cs){return s.domain==='social-recipient'?{selectedId:'recipient:0',reason:'Other ally'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.player.allies=()=>[make('a'),make('b')];f.attach();f.runtime.select(policy.id);f.actor.charmAllies();
  assert.deepEqual(f.commands.filter(c=>c.sample).map(c=>c.sample),[['a','b']]);assert.equal(f.commands.find(c=>c.target).target,'a');
});
for(const method of ['charmAllies','annoyTraitors','findRat','greetNearbyPlayers'])test(`social ${method} recipient hold blocks its own send`,()=>{
  const base=createLegacyStrategy(),policy={id:'all-recipient-holds',version:'1',decide(s,cs){return s.domain==='social-recipient'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f),targets=[make('a'),make('b')];f.player.allies=()=>targets;f.player.nearby=()=>targets;f.game.players=()=>targets;f.setTick(method==='findRat'?6000:100);
  f.attach();f.runtime.select(policy.id);f.actor[method]();assert.equal(f.commands.filter(c=>Object.hasOwn(c,'target')).length,0);
});
test('social rat recipient policy can choose an alternative player',()=>{
  const base=createLegacyStrategy(),policy={id:'rat-alternative',version:'1',decide(s,cs){return s.domain==='social-recipient'?{selectedId:'recipient:0',reason:'Other rat'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.game.players=()=>[make('a'),make('b')];f.setTick(6000);f.attach();f.runtime.select(policy.id);f.actor.findRat();assert.equal(f.commands.find(c=>c.target).target,'a');
});
test('social recipient windows allow later entries and remain bounded',()=>{
  const base=createLegacyStrategy(),sizes=[],policy={id:'social-tail',version:'1',decide(s,cs){if(s.domain==='social-recipient'){sizes.push(cs.length);return {selectedId:cs.find(c=>c.id==='$next')?.id??cs[0].id,reason:'Later window'};}return base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.player.allies=()=>Array.from({length:100},(_,i)=>make(i));f.attach();f.runtime.select(policy.id);f.actor.charmAllies();
  assert.deepEqual(sizes,[80,23]);assert.equal(f.commands.find(c=>Object.hasOwn(c,'target')).target,77);
});
test('social small attack hold stops later phases without cooldown mutation',()=>{
  const base=createLegacyStrategy(),policy={id:'small-stop',version:'1',decide(s,cs){return s.domain==='social-small-attack-target'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.player.incomingAttacks=()=>[{attacker:()=>make('enemy'),troops:()=>10}];
  f.actor.checkOverwhelmedByAttacks=()=>{};f.actor.congratulateWinner=()=>f.commands.push('winner');f.attach();f.runtime.select(policy.id);f.actor.maybeSendCasualEmoji();assert.ok(!f.commands.includes('winner'));assert.equal(f.actor.lastEmojiSent.size,0);
});
test('social phase and recipient ancestry reaches command then resets synchronously',()=>{
  const f=fixture(instrumented,'EmojiBehavior');const make=setupSocial(f);f.player.allies=()=>[make('ally')];
  for(const method of ['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag','annoyTraitors','findRat','greetNearbyPlayers'])f.actor[method]=()=>{};
  f.actor.sendEmoji=target=>f.runtime.intent(f.actor,'EmojiBehavior',function emoji(){},target.id());
  f.attach();f.actor.maybeSendCasualEmoji();f.runtime.intent(f.actor,'EmojiBehavior',function emoji(){},'later');
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const phase=decisions.find(r=>r.snapshot.domain==='social-phase'&&r.selectedId==='charmAllies'),recipient=decisions.find(r=>r.snapshot.domain==='social-recipient');
  const commands=decisions.filter(r=>r.candidates[0].kind==='emoji');
  assert.equal(recipient.snapshot.parentDecisionId,phase.decisionId);assert.equal(commands[0].candidates[0].parentDecisionId,recipient.decisionId);assert.equal(commands[1].candidates[0].parentDecisionId,undefined);
  assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
});
test('social small attack windows process every observation without truncation',()=>{
  const base=createLegacyStrategy(),sizes=[],policy={id:'small-windows',version:'1',decide(s,cs){if(s.domain==='social-small-attack-target')sizes.push(cs.length);return base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});const make=setupSocial(f);f.player.incomingAttacks=()=>Array.from({length:101},(_,i)=>({attacker:()=>make(i),troops:()=>1}));
  f.attach();f.runtime.select(policy.id);f.actor.checkVerySmallAttack();assert.equal(f.commands.filter(c=>Object.hasOwn(c,'target')).length,101);assert.ok(sizes.every(n=>n<=80));
});
test('social phase policy can reorder a pass without repeating phases',()=>{
  const base=createLegacyStrategy(),policy={id:'social-reverse',version:'1',decide(s,cs){return s.domain==='social-phase'?{selectedId:cs.filter(c=>c.kind==='social-phase').at(-1).id,reason:'Reverse'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'EmojiBehavior',{strategies:[policy]});setupSocial(f);const phases=['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag','charmAllies','annoyTraitors','findRat','greetNearbyPlayers'];
  phases.forEach(method=>f.actor[method]=()=>f.commands.push(method));f.attach();f.runtime.select(policy.id);f.actor.maybeSendCasualEmoji();assert.deepEqual(f.commands,[...phases].reverse());
});
function setupOutgoingResponse(f,mode){
  f.context.UNIT.TradeShip='TradeShip';
  const enemy={id:()=> 'enemy',smallID:()=>2},ship={id:()=> 'ship',tile:()=>5,isActive:()=>mode==='trade',owner:()=>enemy,
    wasDestroyedByEnemy:()=>true,destroyer:()=>enemy};
  f.actor.trackedTransportShips=new Set(mode==='transport'?['ship']:[]);f.actor.trackedTradeShips=new Set(mode==='trade'?['ship']:[]);
  f.actor.trackedIncomingTransportShips=new Set();f.actor.dealtWithTransportShip=new Set();
  f.player.units=()=>[];f.game.units=()=>[ship];
  f.actor.maybeRetaliateWithWarship=(tile,target,cause)=>f.commands.push({tile,target:target.id(),cause});
  return {ship,enemy,tracked:f.actor[mode==='trade'?'trackedTradeShips':'trackedTransportShips']};
}
function outgoingMethod(mode){return mode==='trade'?'trackTradeShipsAndRetaliate':'trackTransportShipsAndRetaliate';}
function setupRealOutgoingResponse(f,mode){
  const result=setupOutgoingResponse(f,mode);delete f.actor.maybeRetaliateWithWarship;
  f.actor.buildableWarship=async()=>({type:UNIT.Warship,canBuild:true});f.player.updateRelation=()=>{};return result;
}
for(const mode of ['transport','trade'])for(const scenario of ['retaliate','missing','active-own','inactive','no-destroyer','not-destroyed','no-method','own-observed','getter-error','disabled'])test(`outgoing ${mode} baseline parity ${scenario}`,async()=>{
  await parity('WarshipBehavior',f=>{
    const {ship,tracked}=setupOutgoingResponse(f,mode);
    if(scenario==='missing')f.game.units=()=>[];
    if(scenario==='active-own'){ship.isActive=()=>true;ship.owner=()=>f.player;}
    if(scenario==='inactive')ship.isActive=()=>false;
    if(scenario==='no-destroyer')ship.destroyer=()=>undefined;
    if(scenario==='not-destroyed')ship.wasDestroyedByEnemy=()=>false;
    if(scenario==='no-method')delete ship.destroyer;
    if(scenario==='own-observed'){tracked.clear();f.player.units=()=>[ship];}
    if(scenario==='getter-error')ship.isActive=()=>{throw Error('active getter');};
    if(scenario==='disabled'){const cfg=f.game.config();cfg.isUnitDisabled=()=>true;f.game.config=()=>cfg;}
    f.attach();if(scenario==='getter-error')assert.throws(()=>f.actor[outgoingMethod(mode)](),/active getter/);else f.actor[outgoingMethod(mode)]();
    f.commands.push({tracked:[...tracked]});
  });
});
for(const mode of ['transport','trade'])for(const where of ['target','response','warship-retaliation','build Warship'])test(`outgoing ${mode} ${where} hold prevents removal`,async()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-nested',version:'1',decide(s,cs){return s.domain===`warship-${mode}-outgoing-${where}`||s.domain===where||cs[0].kind===where?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupRealOutgoingResponse(f,mode);
  f.attach();f.runtime.select(policy.id);f.actor[outgoingMethod(mode)]();
  if(where==='build Warship')assert.equal(tracked.size,0);
  await new Promise(setImmediate);assert.equal(tracked.has('ship'),true);assert.equal(f.commands.length,0);
});
for(const mode of ['transport','trade'])for(const failure of ['quote-error','unbuildable','emitter-false','success','easy'])test(`outgoing ${mode} ordinary ${failure} retains baseline removal`,async()=>{
  await parity('WarshipBehavior',async f=>{
    const {tracked}=setupRealOutgoingResponse(f,mode);
    if(failure==='quote-error')f.actor.buildableWarship=async()=>{throw Error('quote');};
    if(failure==='unbuildable')f.actor.buildableWarship=async()=>({type:UNIT.Warship,canBuild:false});
    f.actor.maybeMoveWarship=()=>{};
    if(failure==='emitter-false')f.menu.sendBuildOrUpgrade=()=>false;
    if(failure==='easy')f.context.currentDifficulty=()=> 'Easy';
    f.attach();f.actor[outgoingMethod(mode)]();f.commands.push({immediate:[...tracked]});await new Promise(setImmediate);f.commands.push({final:[...tracked]});
  });
});
for(const mode of ['transport','trade'])test(`outgoing ${mode} old command hold cannot restore newer forgotten entry`,async()=>{
  const base=createLegacyStrategy(),policy={id:'old-outgoing',version:'1',decide(s,cs){return cs[0].kind==='build Warship'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupRealOutgoingResponse(f,mode);let release;
  f.actor.buildableWarship=()=>new Promise(resolve=>release=resolve);f.attach();f.runtime.select(policy.id);f.actor[outgoingMethod(mode)]();
  tracked.add('ship');f.game.units=()=>[];f.actor[outgoingMethod(mode)]();
  release({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);assert.equal(tracked.size,0);assert.equal(f.commands.length,0);
});
for(const mode of ['transport','trade'])test(`outgoing ${mode} response defer leaves tracked state`,()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-defer',version:'1',decide(s,cs){return s.domain===`warship-${mode}-outgoing-response`?{selectedId:'defer',reason:'Later'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupOutgoingResponse(f,mode);f.attach();f.runtime.select(policy.id);f.actor[outgoingMethod(mode)]();assert.equal(tracked.size,1);assert.equal(f.commands.length,0);
});
test('outgoing transport windows process more than 79 targets in original order',()=>{
  const base=createLegacyStrategy(),sizes=[],policy={id:'outgoing-windows',version:'1',decide(s,cs){if(s.domain==='warship-transport-outgoing-target')sizes.push(cs.length);return base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {ship,tracked}=setupOutgoingResponse(f,'transport');
  const ships=Array.from({length:101},(_,i)=>({...ship,id:()=>i,tile:()=>i}));tracked.clear();ships.forEach(s=>tracked.add(s.id()));f.game.units=()=>ships;
  f.attach();f.runtime.select(policy.id);f.actor.trackTransportShipsAndRetaliate();assert.equal(tracked.size,0);assert.equal(f.commands.length,101);assert.deepEqual(f.commands.map(c=>c.tile),Array.from({length:101},(_,i)=>i));assert.ok(sizes.every(n=>n<=80));
});
for(const where of ['warship-transport-outgoing-response','warship-retaliation'])test(`warship tracking ${where} hold stops later phases and resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'tracking-stop',version:'1',decide(s,cs){return s.domain===where?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealOutgoingResponse(f,'transport');let calls=0;
  f.actor.trackTradeShipsAndRetaliate=()=>calls++;f.actor.trackIncomingTransportsAndRetaliate=()=>calls++;
  f.attach();f.runtime.select(policy.id);f.actor.trackShipsAndRetaliate();assert.equal(calls,0);
  f.runtime.select('legacy-v1');f.actor.trackShipsAndRetaliate();assert.equal(calls,2);
});
test('warship tracking disabled transport still runs trade and incoming',()=>{
  const f=fixture(instrumented,'WarshipBehavior');setupOutgoingResponse(f,'transport');const cfg=f.game.config();cfg.isUnitDisabled=()=>true;f.game.config=()=>cfg;
  const calls=[];f.actor.trackTradeShipsAndRetaliate=()=>calls.push('trade');f.actor.trackIncomingTransportsAndRetaliate=()=>calls.push('incoming');f.attach();f.actor.trackShipsAndRetaliate();assert.deepEqual(calls,['trade','incoming']);
});
for(const mode of ['transport','trade'])for(const outcome of ['invalid','throw','null'])test(`outgoing ${mode} ${outcome} response fails closed and lookup resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-error',version:'1',decide(s,cs){if(s.domain!==`warship-${mode}-outgoing-response`)return base.decide(s,cs);if(outcome==='throw')throw Error('policy');return {selectedId:outcome==='null'?null:'bad',reason:'Stop'};}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupOutgoingResponse(f,mode);f.attach();f.runtime.select(policy.id);
  f.actor[outgoingMethod(mode)]();assert.equal(tracked.size,1);assert.equal(f.commands.length,0);
  f.runtime.select('legacy-v1');f.actor[outgoingMethod(mode)]();assert.equal(tracked.size,0);assert.equal(f.commands.length,1);
});
for(const mode of ['transport','trade'])test(`outgoing ${mode} late old decline cannot undo a newer successful request`,async()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-race',version:'1',decide(s,cs){return cs[0].kind==='build Warship'?{selectedId:'$wait',reason:'Old hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupRealOutgoingResponse(f,mode);const releases=[];
  f.actor.buildableWarship=()=>new Promise(resolve=>releases.push(resolve));f.attach();f.runtime.select(policy.id);f.actor[outgoingMethod(mode)]();
  tracked.add('ship');f.actor[outgoingMethod(mode)]();f.runtime.select('legacy-v1');releases[1]({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  f.runtime.select(policy.id);releases[0]({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);assert.equal(tracked.size,0);assert.equal(f.commands.length,1);
});
test('outgoing decisions link tracking phase through response and command',async()=>{
  const f=fixture(instrumented,'WarshipBehavior');setupRealOutgoingResponse(f,'transport');f.actor.trackTradeShipsAndRetaliate=()=>{};f.actor.trackIncomingTransportsAndRetaliate=()=>{};
  f.attach();f.actor.trackShipsAndRetaliate();await new Promise(setImmediate);
  const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const phase=decisions.find(r=>r.snapshot.domain==='warship-tracking'),target=decisions.find(r=>r.snapshot.domain==='warship-transport-outgoing-target');
  const response=decisions.find(r=>r.snapshot.domain==='warship-transport-outgoing-response'),retaliation=decisions.find(r=>r.snapshot.domain==='warship-retaliation');
  const command=decisions.find(r=>r.candidates[0].kind==='build Warship');
  assert.equal(target.snapshot.parentDecisionId,phase.decisionId);assert.equal(response.snapshot.parentDecisionId,target.decisionId);
  assert.equal(retaliation.snapshot.parentDecisionId,response.decisionId);assert.equal(command.candidates[0].parentDecisionId,retaliation.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
});
test('warship tracking root hold does not begin observation and resets',()=>{
  const base=createLegacyStrategy(),policy={id:'tracking-root',version:'1',decide(s,cs){return s.domain==='warship-tracking'?{selectedId:'$wait',reason:'Stop'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupOutgoingResponse(f,'transport');let calls=0;
  for(const method of ['trackTransportShipsAndRetaliate','trackTradeShipsAndRetaliate','trackIncomingTransportsAndRetaliate'])f.actor[method]=()=>calls++;
  f.attach();f.runtime.select(policy.id);f.actor.trackShipsAndRetaliate();assert.equal(calls,0);f.runtime.select('legacy-v1');f.actor.trackShipsAndRetaliate();assert.equal(calls,3);
});
for(const mode of ['transport','trade'])for(const holdAt of ['warship-unit','moveWarship'])test(`outgoing ${mode} capped ${holdAt} hold keeps tracked entry`,()=>{
  const base=createLegacyStrategy(),policy={id:'outgoing-cap',version:'1',decide(s,cs){return s.domain===holdAt||cs[0].kind===holdAt?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {tracked}=setupRealOutgoingResponse(f,mode);
  f.player.units=type=>type===UNIT.Warship?Array.from({length:10},(_,i)=>({id:()=>i,tile:()=>10,warshipState:()=>({patrolTile:10})})):[];
  f.game.manhattanDist=()=>0;f.game.isWater=()=>true;f.attach();f.runtime.select(policy.id);f.actor[outgoingMethod(mode)]();assert.equal(tracked.size,1);assert.equal(f.commands.length,0);
});
test('warship source invasion preserves winner after improving tile read throws',async()=>{
  await parity('WarshipBehavior',f=>{
    const {transport}=setupIncomingTransport(f);let reads=0;
    const ships=[{...transport,tile:()=>50},{...transport,tile:()=>{if(++reads===2)throw Error('tile');return 20;}},{...transport,tile:()=>30}];
    f.game.units=()=>ships;f.game.manhattanDist=tile=>tile;f.attach();f.commands.push({result:f.actor.findInvasionThreat()});
  });
});
test('warship source loss does not validate a non-improving cluster by default',async()=>{
  await parity('WarshipBehavior',f=>{
    setupThreatPatrol(f);let probes=0;f.game.isValidCoord=()=>{if(++probes>1)throw Error('extra probe');return true;};
    f.attach();f.commands.push({result:f.actor.findLossZone([{x:0,y:0},{x:1,y:0}]),probes});
  });
});
for(const scenario of ['nearest','tie','inactive','no-target','zero-target','retreat','ally','own','wrong-owner','close','distance20','covered','throws','infinite','nan'])test(`warship source invasion parity ${scenario}`,async()=>{
  await parity('WarshipBehavior',f=>{
    const {enemy,transport}=setupIncomingTransport(f);
    const other={...transport,id:()=>2,tile:()=>2};f.game.units=()=>[transport,other];
    f.game.manhattanDist=(tile,target)=>scenario==='tie'?30:tile===1?50:25;
    if(scenario==='inactive')transport.isActive=()=>false;
    if(scenario==='no-target')transport.targetTile=()=>null;
    if(scenario==='zero-target')transport.targetTile=()=>0;
    if(scenario==='retreat')transport.transportShipState=()=>({isRetreating:true});
    if(scenario==='ally')enemy.isAlliedWith=()=>true;
    if(scenario==='own')enemy.smallID=()=>1;
    if(scenario==='wrong-owner')f.game.ownerID=()=>2;
    if(scenario==='close'||scenario==='distance20')f.game.manhattanDist=()=>scenario==='close'?19:20;
    if(scenario==='covered')f.game.hasUnitNearby=()=>true;
    if(scenario==='throws')transport.isActive=()=>{throw Error('bad ship');};
    if(scenario==='infinite'||scenario==='nan')f.game.manhattanDist=()=>scenario==='nan'?NaN:Infinity;
    f.attach();f.commands.push({result:f.actor.findInvasionThreat()});
  });
});
for(const scenario of ['cluster','tie','too-few','invalid','land','zero-settings','negative-min','nan-min'])test(`warship source loss parity ${scenario}`,async()=>{
  await parity('WarshipBehavior',f=>{
    setupThreatPatrol(f);f.state.settings.warshipLossZoneRadius=2;
    const points=[{x:0,y:0},{x:1,y:0},{x:100,y:0},{x:101,y:0},{x:102,y:0}];
    if(scenario==='tie')points.pop();if(scenario==='too-few')points.splice(1);
    if(scenario==='invalid')f.game.isValidCoord=()=>false;
    if(scenario==='land')f.game.isWater=()=>false;
    if(scenario==='zero-settings'){f.state.settings.warshipLossZoneMin=0;f.state.settings.warshipLossZoneRadius=0;}
    if(scenario==='negative-min')f.state.settings.warshipLossZoneMin=-1;
    if(scenario==='nan-min')f.state.settings.warshipLossZoneMin='bad';
    f.attach();f.commands.push({result:f.actor.findLossZone(points)});
  });
});
for(const scenario of ['latest','invalid-latest','land','none'])test(`warship source trade patrol parity ${scenario}`,async()=>{
  await parity('WarshipBehavior',f=>{
    setupThreatPatrol(f);f.game.units=()=>[];f.actor.smartState.raids=scenario==='none'?[]:[{x:5,y:0,at:1},{x:scenario==='invalid-latest'?-1:10,y:0,at:1}];
    if(scenario==='land')f.game.isWater=()=>false;
    f.attach();f.actor.smartWarshipPatrol();f.commands.push({serviced:[...f.actor.smartState.serviced]});
  });
});
for(const domain of ['warship-invasion-source','warship-loss-source','warship-trade-source'])for(const outcome of ['hold','invalid','throw'])test(`warship source patrol ${domain} ${outcome} stops and resets`,()=>{
  const base=createLegacyStrategy(),policy={id:'source-stop',version:'1',decide(s,cs){if(s.domain!==domain)return base.decide(s,cs);if(outcome==='throw')throw Error('policy');return {selectedId:outcome==='hold'?'$wait':'bad',reason:'Stop'};}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupThreatPatrol(f);
  f.actor.smartState.losses=[{x:5,y:0,at:1},{x:6,y:0,at:1}];f.actor.smartState.raids=[{x:10,y:0,at:1}];
  f.attach();f.runtime.select(policy.id);f.actor.smartWarshipPatrol();assert.deepEqual(f.commands,[]);assert.equal(f.actor.smartState.serviced.size,0);
  f.runtime.select('legacy-v1');f.actor.smartState.lastPassMs=-1e9;f.actor.smartWarshipPatrol();assert.equal(f.commands.length,1);
});
test('warship source alternate and later-window selection remain bounded',()=>{
  const base=createLegacyStrategy(),sizes=[],policy={id:'source-tail',version:'1',decide(s,cs){
    if(s.domain==='warship-invasion-source'){sizes.push(cs.length);return {selectedId:cs.find(c=>c.id==='$next')?.id??cs[1].id,reason:'Later source'};}return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {transport}=setupIncomingTransport(f);
  f.game.units=()=>Array.from({length:100},(_,i)=>({...transport,id:()=>i,tile:()=>i+1}));
  f.game.manhattanDist=tile=>tile+20;f.attach();f.runtime.select(policy.id);
  assert.equal(f.actor.findInvasionThreat().tile,80);assert.deepEqual(sizes,[80,23]);
});
test('warship source decisions retain provenance on patrol candidates',()=>{
  const base=createLegacyStrategy(),seen=[],policy={id:'source-links',version:'1',decide(s,cs){if(s.domain==='warship-patrol')seen.push(...cs.filter(c=>c.kind==='warship-patrol'));return base.decide(s,cs);}};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupThreatPatrol(f);
  f.attach();f.runtime.select(policy.id);f.actor.smartWarshipPatrol();assert.ok(seen[0].sourceDecisionId);
});
async function parity(name, scenario, options) {
  const outputs = [];
  for (const source of [original, instrumented]) {
    const f = fixture(source, name, options);
    await scenario(f); outputs.push(f.result());
  }
  assert.deepEqual(outputs[1], outputs[0]);
  return outputs[1];
}

function combatTarget(id, troops = 100, extra = {}) {
  return { id: () => id, isPlayer: () => true, type: () => 'Human', troops: () => troops,
    incomingAttacks: () => [], isTraitor: () => false, isDisconnected: () => false, ...extra };
}
function setupMaintenance(f,opts={}){
  f.game.inSpawnPhase=()=>true;f.actor.behaviorsInitialized=opts.initialized!==false;
  f.actor.feat=name=>name==='warship'&&opts.enabled!==false;f.player.isAlive=()=>opts.alive!==false;
  f.player.unitsConstructed=()=>opts.port!==false;
  f.context.currentDifficulty=()=>opts.easy?'Easy':'Impossible';
  const config=f.game.config();config.isUnitDisabled=()=>opts.disabled===true;f.game.config=()=>config;
  f.state.settings.winFixes=opts.winFixes??true;
  f.state.settings.warshipAutoSpawn=opts.autoSpawn;f.state.settings.warshipNukeDodge=opts.dodge;
  f.actor.warshipBehavior={game:f.game,player:f.player};
  for(const [method,phase] of [['trackShipsAndRetaliate','tracking'],['dodgeNukes','dodge'],['smartWarshipPatrol','patrol'],['smartWarshipCombat','combat']])
    f.actor.warshipBehavior[method]=()=>{f.commands.push({phase});if(opts.throwPhase===phase)throw Error('maintenance');};
}
test('central warship maintenance wait prevents all early phases',async()=>{
  const base=createLegacyStrategy(),policy={id:'hold-maintenance',version:'1',decide(s,cs){
    return s.domain==='warship-maintenance'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupMaintenance(f);f.attach();f.runtime.select(policy.id);
  await f.actor.tick(10);assert.equal(f.commands.length,0);
});
test('central warship maintenance policy can reorder phases',async()=>{
  const base=createLegacyStrategy(),policy={id:'combat-first',version:'1',decide(s,cs){
    return s.domain==='warship-maintenance'&&cs.some(c=>c.id==='combat')?{selectedId:'combat',reason:'Combat first'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupMaintenance(f);f.attach();f.runtime.select(policy.id);
  await f.actor.tick(10);assert.deepEqual(f.commands.map(c=>c.phase),['combat','tracking','dodge','patrol']);
});
for(const opts of [{},{autoSpawn:false},{autoSpawn:null},{autoSpawn:0},{winFixes:false},{winFixes:0},{dodge:false},{dodge:null},{dodge:0},
  {autoSpawn:false,dodge:false},{autoSpawn:false,winFixes:false},{initialized:false},{alive:false},{enabled:false},{easy:true},{port:false},{disabled:true},
  {throwPhase:'tracking'},{throwPhase:'dodge'},{throwPhase:'patrol'},{throwPhase:'combat'}])
  test(`warship maintenance generated parity ${JSON.stringify(opts)}`,async()=>{
    await parity('NationBot',async f=>{setupMaintenance(f,opts);f.attach();await f.actor.tick(10);});
  });
for(const changePhase of ['tracking','dodge'])test(`warship maintenance caches original smart block entry after ${changePhase} mutation`,async()=>{
  await parity('NationBot',async f=>{
    setupMaintenance(f);const method=changePhase==='tracking'?'trackShipsAndRetaliate':'dodgeNukes';
    f.actor.warshipBehavior[method]=()=>{f.commands.push({phase:changePhase});f.state.settings.winFixes=false;};
    f.attach();await f.actor.tick(10);
  });
});
for(const fault of ['error','invalid','null'])test(`central warship maintenance ${fault} prevents later phases and resets next tick`,async()=>{
  const base=createLegacyStrategy(),policy={id:'broken-maintenance',version:'1',decide(s,cs){
    if(s.domain==='warship-maintenance'){if(fault==='error')throw Error('maintenance policy');return {selectedId:fault==='null'?null:'missing',reason:'Stop'};}
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupMaintenance(f);f.attach();f.runtime.select(policy.id);
  await f.actor.tick(10);assert.equal(f.commands.length,0);
  f.runtime.select('legacy-v1');await f.actor.tick(11);assert.deepEqual(f.commands.map(c=>c.phase),['tracking','dodge','patrol','combat']);
});
test('central warship maintenance can stop after tracking without invoking later phases',async()=>{
  const base=createLegacyStrategy(),policy={id:'track-only',version:'1',decide(s,cs){
    return s.domain==='warship-maintenance'&&!cs.some(c=>c.id==='tracking')?{selectedId:'$wait',reason:'Done tracking'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupMaintenance(f);f.attach();f.runtime.select(policy.id);
  await f.actor.tick(10);assert.deepEqual(f.commands,[{phase:'tracking'}]);
});
test('central warship maintenance stale owner after tracking prevents later phases',async()=>{
  let active=true;const f=fixture(instrumented,'NationBot',{current:()=>active});setupMaintenance(f);
  f.actor.warshipBehavior.trackShipsAndRetaliate=()=>{f.commands.push({phase:'tracking'});active=false;};
  f.attach();await f.actor.tick(10);assert.deepEqual(f.commands,[{phase:'tracking'}]);
});
test('central warship maintenance wait leaves ordinary cadence available',async()=>{
  const base=createLegacyStrategy(),policy={id:'maintenance-only-hold',version:'1',decide(s,cs){
    return s.domain==='warship-maintenance'?{selectedId:'$wait',reason:'Hold early pass'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupMaintenance(f);
  f.game.inSpawnPhase=()=>false;f.actor.lastSeenTick=9;f.actor.attackRate=30;f.actor.attackTick=10;
  f.actor.emojiBehavior={maybeSendCasualEmoji:()=>f.commands.push({phase:'ordinary-emoji'})};
  f.actor.updateRelationsFromEmbargos=()=>{};f.actor.allianceBehavior={handleAllianceRequestsFromBots:()=>{}};
  f.actor.warshipBehavior.maybeSpawnWarship=()=>f.commands.push({phase:'ordinary-deployment'});
  f.actor.warshipBehavior.counterWarshipInfestation=()=>f.commands.push({phase:'ordinary-infestation'});
  f.attach();f.runtime.select(policy.id);await f.actor.tick(10);
  assert.deepEqual(f.commands.map(c=>c.phase),['ordinary-emoji','ordinary-deployment','ordinary-infestation']);
});
test('central warship maintenance links synchronous commands and restores parent',async()=>{
  const f=fixture(instrumented,'NationBot');setupMaintenance(f);const ship=f.actor.warshipBehavior;
  const emit=()=>f.runtime.intent(ship,'WarshipBehavior',f.context.discoverCtors().moveWarship,[1],2);
  ship.trackShipsAndRetaliate=emit;f.attach();await f.actor.tick(10);emit();
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  const tracking=ds.find(r=>r.snapshot.domain==='warship-maintenance'&&r.selectedId==='tracking');
  const commands=ds.filter(r=>r.candidates[0].source==='WarshipBehavior');
  assert.equal(commands.length,2);assert.equal(commands[0].candidates[0].parentDecisionId,tracking.decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId,undefined);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
function setupIncomingTransport(f){
  const enemy={id:()=> 'enemy',smallID:()=>2,isAlliedWith:()=>false};
  const transport={id:()=> 'transport',targetTile:()=>20,tile:()=>1,isActive:()=>true,
    transportShipState:()=>({}),owner:()=>enemy};
  f.game.units=()=>[transport];f.game.ownerID=()=>1;f.game.hasUnitNearby=()=>false;
  f.game.manhattanDist=()=>30;f.player.units=()=>[];
  f.actor.trackedIncomingTransportShips=new Set();f.actor.dealtWithTransportShip=new Set();
  f.actor.warshipSpawnTile=()=>5;f.actor.maybeRetaliateWithWarship=()=>f.commands.push({retaliation:true});
  return {enemy,transport};
}
for(const domain of ['warship-transport-target','warship-transport-response'])test(`central ${domain} hold keeps incoming threat unhandled`,()=>{
  const base=createLegacyStrategy(),policy={id:'hold-transport',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupIncomingTransport(f);f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.commands.length,0);assert.equal(f.actor.dealtWithTransportShip.size,0);
});
for(const scenario of ['retaliate','close','distance20','covered','patrol-covered','allied','handled','missing','inactive','retreating','target-undefined','target-zero','target-null','spawn-null'])
  test(`incoming transport response parity ${scenario}`,async()=>{
    await parity('WarshipBehavior',f=>{
      const {enemy,transport}=setupIncomingTransport(f);f.actor.trackedIncomingTransportShips.add('transport');
      if(scenario==='close')f.game.manhattanDist=()=>19;
      if(scenario==='distance20')f.game.manhattanDist=()=>20;
      if(scenario==='covered')f.game.hasUnitNearby=()=>true;
      if(scenario==='patrol-covered')f.player.units=()=>[{warshipState:()=>({patrolTile:5})}];
      if(scenario==='allied')enemy.isAlliedWith=()=>true;
      if(scenario==='handled')f.actor.dealtWithTransportShip.add('transport');
      if(scenario==='missing')f.game.units=()=>[];
      if(scenario==='inactive')transport.isActive=()=>false;
      if(scenario==='retreating')transport.transportShipState=()=>({isRetreating:true});
      if(scenario==='target-undefined')transport.targetTile=()=>undefined;
      if(scenario==='target-zero')transport.targetTile=()=>0;
      if(scenario==='target-null')transport.targetTile=()=>null;
      if(scenario==='spawn-null')f.actor.warshipSpawnTile=()=>null;
      f.attach();assert.equal(f.actor.trackIncomingTransportsAndRetaliate(),undefined);
      f.commands.push({tracked:[...f.actor.trackedIncomingTransportShips],handled:[...f.actor.dealtWithTransportShip]});
    });
  });
for(const domain of ['warship-transport-target','warship-transport-response'])for(const fault of ['error','invalid','null'])
  test(`incoming transport ${domain} ${fault} stops without handled marks`,()=>{
    const base=createLegacyStrategy(),policy={id:'bad-response',version:'1',decide(s,cs){
      if(s.domain===domain){if(fault==='error')throw Error('response');return {selectedId:fault==='null'?null:'missing',reason:'Stop'};}
      return base.decide(s,cs);
    }};
    const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupIncomingTransport(f);f.attach();f.runtime.select(policy.id);
    f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,0);assert.equal(f.commands.length,0);
    f.runtime.select('legacy-v1');f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,1);
  });
function setupRealTransportResponse(f){
  const {enemy,transport}=setupIncomingTransport(f);
  delete f.actor.maybeRetaliateWithWarship;delete f.actor.warshipSpawnTile;
  f.actor.random.nextInt=()=>0;f.game.x=()=>0;f.game.y=()=>0;f.game.isValidCoord=()=>true;f.game.ref=()=>5;f.game.isWater=()=>true;
  f.actor.buildableWarship=async()=>({type:UNIT.Warship,canBuild:true});
  f.player.updateRelation=()=>{};return {enemy,transport};
}
for(const domain of ['warship-placement','warship-retaliation'])test(`incoming transport nested ${domain} hold prevents handled mark`,()=>{
  const base=createLegacyStrategy(),policy={id:'nested-transport-hold',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealTransportResponse(f);f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,0);assert.equal(f.commands.length,0);
});
test('incoming transport late command hold revokes provisional mark',async()=>{
  const base=createLegacyStrategy(),policy={id:'late-command-hold',version:'1',decide(s,cs){
    return cs[0].kind==='build Warship'?{selectedId:'$wait',reason:'Hold build'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealTransportResponse(f);
  let release;f.actor.buildableWarship=()=>new Promise(resolve=>{release=resolve;});f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,1);
  release({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,0);assert.equal(f.commands.length,0);
});
for(const outcome of ['unbuildable','quote-error','emitter-false','success'])test(`incoming transport ordinary ${outcome} retains baseline handled mark`,async()=>{
  const f=fixture(instrumented,'WarshipBehavior');setupRealTransportResponse(f);
  f.actor.maybeMoveWarship=()=>{};
  if(outcome==='unbuildable')f.actor.buildableWarship=async()=>null;
  if(outcome==='quote-error')f.actor.buildableWarship=async()=>{throw Error('quote');};
  if(outcome==='emitter-false')f.menu.sendBuildOrUpgrade=()=>false;
  f.attach();f.actor.trackIncomingTransportsAndRetaliate();await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,1);
});
test('incoming transport old declined build cannot clear newer coverage mark',async()=>{
  const base=createLegacyStrategy(),policy={id:'decline-old-build',version:'1',decide(s,cs){
    return cs[0].kind==='build Warship'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealTransportResponse(f);
  let release;f.actor.buildableWarship=()=>new Promise(resolve=>{release=resolve;});f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,1);
  f.actor.dealtWithTransportShip.delete('transport');f.game.hasUnitNearby=()=>true;
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,1);
  release({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,1);
});
test('incoming transport late stale quote clears provisional mark',async()=>{
  let active=true;const f=fixture(instrumented,'WarshipBehavior',{current:()=>active});setupRealTransportResponse(f);
  let release;f.actor.buildableWarship=()=>new Promise(resolve=>{release=resolve;});f.attach();
  f.actor.trackIncomingTransportsAndRetaliate();active=false;release({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,0);assert.equal(f.commands.length,0);
});
test('incoming transport target can select a later tracked threat',()=>{
  const base=createLegacyStrategy(),policy={id:'second-transport',version:'1',decide(s,cs){
    return s.domain==='warship-transport-target'?{selectedId:cs[1].id,reason:'Later threat'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {transport}=setupIncomingTransport(f);
  f.game.units=()=>[transport,{...transport,id:()=> 'second'}];f.attach();f.runtime.select(policy.id);f.actor.trackIncomingTransportsAndRetaliate();
  assert.deepEqual([...f.actor.dealtWithTransportShip],['second']);
});
test('incoming transport response defer leaves threat tracked and unhandled',()=>{
  const base=createLegacyStrategy(),policy={id:'defer-transport',version:'1',decide(s,cs){
    return s.domain==='warship-transport-response'?{selectedId:'defer',reason:'Later'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupIncomingTransport(f);f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,0);
  assert.deepEqual([...f.actor.trackedIncomingTransportShips],['transport']);assert.equal(f.commands.length,0);
});
test('incoming transport windows scan beyond 79 and retain bounded candidates',()=>{
  const f=fixture(instrumented,'WarshipBehavior');const {transport}=setupIncomingTransport(f);
  f.game.units=()=>Array.from({length:101},(_,i)=>({...transport,id:()=>`ship${i}`}));
  for(let i=0;i<100;i++)f.actor.dealtWithTransportShip.add(`ship${i}`);
  f.attach();f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.has('ship100'),true);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');assert.ok(ds.every(r=>r.candidates.length<=80));
  assert.equal(ds.filter(r=>r.snapshot.domain==='warship-transport-target').length,101);
});
test('incoming transport action, placement, retaliation and command form explicit parents',async()=>{
  const f=fixture(instrumented,'WarshipBehavior');setupRealTransportResponse(f);f.attach();
  f.actor.trackIncomingTransportsAndRetaliate();await new Promise(setImmediate);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision'),find=d=>ds.find(r=>r.snapshot.domain===d);
  const target=find('warship-transport-target'),response=find('warship-transport-response'),placement=find('warship-placement'),retaliation=find('warship-retaliation');
  assert.equal(response.snapshot.parentDecisionId,target.decisionId);assert.equal(placement.snapshot.parentDecisionId,response.decisionId);
  assert.equal(retaliation.snapshot.parentDecisionId,placement.decisionId);
  const command=ds.find(r=>r.candidates[0].kind==='build Warship');assert.equal(command.candidates[0].parentDecisionId,retaliation.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
for(const scenario of ['build','easy','medium-fail','hard-fail','unbuildable','quote-error','emitter-false'])
  test(`incoming transport real retaliation parity ${scenario}`,async()=>{
    await parity('WarshipBehavior',async f=>{
      setupRealTransportResponse(f);
      f.context.currentDifficulty=()=>scenario==='easy'?'Easy':scenario==='medium-fail'?'Medium':scenario==='hard-fail'?'Hard':'Impossible';
      f.actor.random.nextInt=()=>scenario.endsWith('fail')?99:0;
      // Geometry samples must remain valid even when the probability roll fails.
      f.game.isValidCoord=()=>true;f.game.isWater=()=>true;
      f.actor.maybeMoveWarship=()=>f.commands.push({fallback:true});
      if(scenario==='unbuildable')f.actor.buildableWarship=async()=>null;
      if(scenario==='quote-error')f.actor.buildableWarship=async()=>{throw Error('quote');};
      if(scenario==='emitter-false')f.menu.sendBuildOrUpgrade=()=>false;
      f.attach();f.actor.trackIncomingTransportsAndRetaliate();
      f.commands.push({immediateHandled:[...f.actor.dealtWithTransportShip]});
      await new Promise(setImmediate);f.commands.push({handled:[...f.actor.dealtWithTransportShip]});
    });
  });
for(const holdAt of ['warship-unit','intent'])test(`incoming transport capped fleet ${holdAt} hold prevents handled mark`,()=>{
  const base=createLegacyStrategy(),policy={id:'cap-response-hold',version:'1',decide(s,cs){
    return s.domain===holdAt||holdAt==='intent'&&cs[0].kind==='moveWarship'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealTransportResponse(f);
  f.player.units=()=>Array.from({length:10},(_,i)=>({id:()=>i,tile:()=>100,warshipState:()=>({patrolTile:100})}));
  // Keep patrol coverage outside the incoming destination's 90-tile gate,
  // while each ship is at its own patrol point for movement eligibility.
  f.game.manhattanDist=(a,b)=>a===b?0:100;f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();assert.equal(f.actor.dealtWithTransportShip.size,0);assert.equal(f.commands.length,0);
});
test('incoming transport old declined request cannot clear a newer pending request',async()=>{
  const base=createLegacyStrategy(),policy={id:'request-token-race',version:'1',decide(s,cs){
    return cs[0].kind==='build Warship'?{selectedId:'$wait',reason:'Hold old completion'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupRealTransportResponse(f);
  const releases=[];f.actor.buildableWarship=()=>new Promise(resolve=>releases.push(resolve));f.attach();f.runtime.select(policy.id);
  f.actor.trackIncomingTransportsAndRetaliate();f.actor.dealtWithTransportShip.delete('transport');f.actor.trackIncomingTransportsAndRetaliate();
  assert.equal(releases.length,2);releases[0]({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,1);
  f.runtime.select('legacy-v1');releases[1]({type:UNIT.Warship,canBuild:true});await new Promise(setImmediate);
  assert.equal(f.actor.dealtWithTransportShip.size,1);assert.equal(f.state.stats.builds,1);
});
function setupSpawn(f,opts={}) {
  f.state.settings.smartSpawn=!!opts.smart;
  Object.assign(f.game,{width:()=>100,height:()=>100,inSpawnPhase:()=>true,
    x:tile=>Math.floor(tile/100),y:tile=>tile%100,ref:(x,y)=>x*100+y,
    isValidCoord:(x,y)=>x>=0&&y>=0&&x<100&&y<100,isLand:()=>!opts.noLand,hasOwner:()=>false,isBorder:()=>false,
    manhattanDist:(a,b)=>Math.abs(Math.floor(a/100)-Math.floor(b/100))+Math.abs(a%100-b%100)});
  const config=f.game.config();config.minDistanceBetweenPlayers=()=>30;f.game.config=()=>config;
  f.player.team=()=>null;f.actor.feat=()=>opts.enabled!==false;
  f.actor.spawnExecAdded=false;f.actor.behaviorsInitialized=false;
  f.context.companionSpawnCenter=()=>opts.companion??null;
  f.context.getSpawnHeatmapTopSpots=()=>opts.spots??null;
  f.context.computeSpawnTopSpotsForBot=()=>opts.computed??null;
  let draws=0;f.actor.random.nextInt=()=>{draws++;return draws%2?40:50;};
  f.actor.scoreSpawnTile=()=>10;
  return ()=>draws;
}
for(const domain of ['spawn-action','spawn-source','spawn-random'])test(`central ${domain} hold leaves spawn metadata unchanged`,async()=>{
  const base=createLegacyStrategy(),policy={id:'spawn-hold',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:'$wait',reason:'hold spawn'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupSpawn(f);f.attach();f.runtime.select(policy.id);
  await f.actor.tick(10);assert.equal(f.commands.length,0);assert.equal(f.state.stats.spawns,0);
  assert.equal(f.actor.spawnExecAdded,false);assert.equal(f.actor.lastSpawnPickTick,undefined);assert.equal(f.actor.lastSpawnTopKey,undefined);
});
for(const opts of [{},{smart:true},{companion:0},{companion:123},{smart:true,spots:[{x:20,y:20}]},
  {smart:true,computed:[{x:25,y:25}]},{smart:true,spots:[],computed:[{x:25,y:25}]},{noLand:true},
  {smart:true,noLand:true},{enabled:false}])test(`spawn baseline source/timing parity: ${JSON.stringify(opts)}`,async()=>{
  await parity('NationBot',async f=>{const draws=setupSpawn(f,opts);f.attach();await f.actor.tick(10);
    f.commands.push({kind:'result',draws:draws(),tick:f.actor.lastSpawnPickTick,key:f.actor.lastSpawnTopKey,
      tile:f.actor.lastSpawnTile,added:f.actor.spawnExecAdded,status:f.actor.status});});
});
test('smart spawn candidates retain distinct alternatives and the original best tile',()=>{
  const base=createLegacyStrategy();let candidates;
  const policy={id:'other-random-spawn',version:'1',decide(s,cs){
    if(s.domain==='spawn-random'){candidates=cs;return {selectedId:cs[1].id,reason:'alternate site'};}
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupSpawn(f,{smart:true});
  let draws=0;f.actor.random.nextInt=()=>{const d=draws++;return d%2?50:Math.floor(d/2)%2?60:40;};
  f.actor.scoreSpawnTile=tile=>tile===4050?20:10;f.attach();f.runtime.select(policy.id);
  assert.equal(f.actor.pickSpawnCenter(),6050);assert.equal(draws,2000);
  assert.deepEqual(candidates.filter(c=>c.kind!=='wait').map(c=>c.tile),[4050,6050]);
});
for(const mode of ['companion','heatmap-spot','neighborhood','source-random'])test(`spawn policy alternative: ${mode}`,()=>{
  const base=createLegacyStrategy(),policy={id:'spawn-alternative',version:'1',decide(s,cs){
    if(mode==='source-random'&&s.domain==='spawn-source')return {selectedId:cs.find(c=>c.source==='random').id,reason:'random source'};
    if(mode==='heatmap-spot'&&s.domain==='spawn-heatmap-spot'||mode==='neighborhood'&&s.domain==='spawn-neighborhood')
      return {selectedId:cs[1].id,reason:'alternative'};
    if(mode==='companion'&&s.domain==='spawn-companion')return {selectedId:'$wait',reason:'hold companion'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});const draws=setupSpawn(f,{smart:true,
    companion:mode==='companion'||mode==='source-random'?123:null,spots:[{x:20,y:20},{x:30,y:30}]});
  f.attach();f.runtime.select(policy.id);const tile=f.actor.pickSpawnCenter();
  assert.equal(tile,mode==='companion'?null:mode==='heatmap-spot'?3030:mode==='neighborhood'?1818:4050);
  assert.equal(draws(),mode==='source-random'?2000:0);
});
for(const mode of ['first-nearby','second-spot','too-close','team-area','score-tie','no-score','fallback-error'])test(`spawn geography parity: ${mode}`,async()=>{
  await parity('NationBot',f=>{
    const opts={smart:true,spots:mode==='first-nearby'||mode==='second-spot'?[{x:20,y:20},{x:30,y:30}]:null};
    const draws=setupSpawn(f,opts);
    if(mode==='first-nearby')f.game.hasOwner=tile=>tile===2020;
    if(mode==='second-spot')f.game.isLand=tile=>tile===3030;
    if(mode==='too-close')f.game.players=()=>[f.player,{smallID:()=>2,hasSpawned:()=>true,nameLocation:()=>({x:40,y:50})}];
    if(mode==='team-area'){f.player.team=()=> 'A';f.game.__src={teamSpawnArea:()=>({x:35,y:45,width:10,height:10})};}
    if(mode==='score-tie')f.actor.scoreSpawnTile=()=>0;
    if(mode==='no-score')f.actor.scoreSpawnTile=()=>-Infinity;
    if(mode==='fallback-error')f.context.getSpawnHeatmapTopSpots=()=>{throw Error('heatmap');};
    f.attach();const tile=f.actor.pickSpawnCenter();f.commands.push({kind:'result',tile,draws:draws()});
  });
});
for(const mode of ['normal','missing-ctor','emit-false','duplicate-companion'])test(`spawn cadence and reselection parity: ${mode}`,async()=>{
  await parity('NationBot',async f=>{
    const opts={smart:true,spots:[{x:20,y:20}],companion:mode==='duplicate-companion'?123:null};
    const draws=setupSpawn(f,opts);if(mode==='missing-ctor')delete f.context.discoverCtors().spawn;f.attach();
    for(const tick of [10,11,15,16,22]){if(tick===22)opts.spots=[{x:30,y:30}];await f.actor.tick(tick);}
    f.commands.push({kind:'result',draws:draws(),tick:f.actor.lastSpawnPickTick,key:f.actor.lastSpawnTopKey,
      tile:f.actor.lastSpawnTile,added:f.actor.spawnExecAdded,status:f.actor.status});
  },{emitReturn:mode!=='emit-false'});
});
for(const mode of ['source-error','site-hold','command-hold'])test(`spawn ${mode} rolls back prior cadence/key and permits next tick`,async()=>{
  const base=createLegacyStrategy(),policy={id:'spawn-failure',version:'1',decide(s,cs){
    if(mode==='source-error'&&s.domain==='spawn-source')throw Error('spawn policy');
    if(mode==='site-hold'&&s.domain==='spawn-neighborhood'||mode==='command-hold'&&cs[0].kind==='spawn')
      return {selectedId:'$wait',reason:'hold'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupSpawn(f,{smart:true,spots:[{x:30,y:30}]});
  Object.assign(f.actor,{spawnExecAdded:true,lastSpawnTile:2020,lastSpawnTopKey:'20,20',lastSpawnPickTick:1});
  f.attach();f.runtime.select(policy.id);await f.actor.tick(10);
  assert.equal(f.actor.lastSpawnPickTick,1);assert.equal(f.actor.lastSpawnTopKey,'20,20');assert.equal(f.actor.lastSpawnTile,2020);
  assert.equal(f.commands.length,0);assert.equal(f.state.stats.spawns,0);
  f.runtime.select('legacy-v1');await f.actor.tick(11);assert.equal(f.actor.lastSpawnTile,3030);assert.equal(f.commands.length,1);
});
test('ordinary spawn can resample without changing its default draw limit',()=>{
  const base=createLegacyStrategy();let samples=0;
  const policy={id:'resample-spawn',version:'1',decide(s,cs){
    if(s.domain==='spawn-random'&&samples++===0)return {selectedId:cs.find(c=>c.mode==='resample').id,reason:'resample'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});const draws=setupSpawn(f);f.attach();f.runtime.select(policy.id);
  assert.equal(f.actor.pickSpawnCenter(),4050);assert.equal(draws(),4);
});
test('spawn command links action/source/heatmap/nearby and clears ancestry',async()=>{
  const f=fixture(instrumented,'NationBot');setupSpawn(f,{smart:true,spots:[{x:20,y:20}]});f.attach();await f.actor.tick(10);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision'),action=ds.find(d=>d.snapshot.domain==='spawn-action');
  const source=ds.find(d=>d.snapshot.domain==='spawn-source'&&d.candidates.find(c=>c.id===d.selectedId)?.source==='heatmap');
  const spot=ds.find(d=>d.snapshot.domain==='spawn-heatmap-spot'),near=ds.find(d=>d.snapshot.domain==='spawn-neighborhood');
  assert.equal(source.snapshot.parentDecisionId,action.decisionId);assert.equal(spot.snapshot.parentDecisionId,source.decisionId);
  assert.equal(near.snapshot.parentDecisionId,spot.decisionId);assert.equal(ds.at(-1).candidates[0].parentDecisionId,near.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
  f.actor.pickSpawnCenter();assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='spawn-source').at(-1).snapshot.parentDecisionId,undefined);
});
test('spawn invalid-neighbor geometry does not produce a decision for every rejected coordinate',()=>{
  const f=fixture(instrumented,'NationBot');setupSpawn(f,{smart:true,spots:[{x:20,y:20}]});
  f.game.isLand=tile=>tile===3030;f.attach();assert.equal(f.actor.pickSpawnCenter(),3030);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='spawn-neighborhood');
  assert.equal(ds.length,1);
});
test('smart random spawn bounds candidates while retaining a late best tile',()=>{
  const f=fixture(instrumented,'NationBot');setupSpawn(f,{smart:true});let draws=0;
  f.actor.random.nextInt=()=>{const d=draws++,trial=Math.floor(d/2);return d%2?Math.floor(trial/100):trial%100;};
  f.actor.scoreSpawnTile=tile=>tile;f.attach();assert.equal(f.actor.pickSpawnCenter(),9909);assert.equal(draws,2000);
  const decision=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='spawn-random');
  assert.equal(decision.candidates.length,80);assert.equal(decision.candidates[0].tile,9909);
});
test('spawn heatmap windows reach a valid spot beyond the first 79',()=>{
  const spots=[...Array.from({length:80},()=>({x:-1000,y:-1000})),{x:20,y:20}];
  const f=fixture(instrumented,'NationBot');setupSpawn(f,{smart:true,spots});f.attach();assert.equal(f.actor.pickSpawnCenter(),2020);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');assert.ok(ds.every(d=>d.candidates.length<=80));
  assert.equal(ds.filter(d=>d.snapshot.domain==='spawn-heatmap-spot').length,81);
});
test('stale spawn owner cannot select or commit metadata',async()=>{
  let current=true;const f=fixture(instrumented,'NationBot',{current:()=>current}),draws=setupSpawn(f);
  f.attach();current=false;await f.actor.tick(10);assert.equal(draws(),0);assert.equal(f.commands.length,0);
  assert.equal(f.actor.lastSpawnPickTick,undefined);assert.equal(f.actor.spawnExecAdded,false);
});
function setupEmbargo(f,opts={}) {
  const embargoed=new Set(opts.active?['enemy']:[]),relation=opts.relation??-1;
  const targets=[combatTarget('enemy',100,{smallID:()=>2,type:()=>opts.bot?'Bot':'Nation',
    numTilesOwned:()=>opts.denial?4000:100,
    units:()=>Array.from({length:opts.targetStations??1},()=>({hasTrainStation:()=>true})),
    hasEmbargoAgainst:()=>!!opts.incoming})];
  f.context.EMBARGO_DENIAL_SHARE=.3;f.context.currentDifficulty=()=>opts.difficulty??'Impossible';
  Object.assign(f.game,{players:()=>[f.player,...targets],numLandTiles:()=>10000});
  const config=f.game.config();config.gameConfig=()=>({difficulty:opts.difficulty??'Impossible',gameMode:opts.team?'Team':'FFA'});
  f.game.config=()=>config;
  Object.assign(f.player,{type:()=> 'Nation',isOnSameTeam:()=>!!opts.teammate,isAlliedWith:()=>!!opts.allied,
    relation:()=>relation,hasEmbargoAgainst:t=>embargoed.has(t.id()),
    units:()=>Array.from({length:opts.selfStations??1},()=>({hasTrainStation:()=>true})),
    updateRelation:(t,delta)=>f.commands.push({kind:'relation',target:t.id(),delta})});
  f.actor.embargoMalusApplied=new Set(opts.applied?[2]:[]);
  return targets;
}
for(const domain of ['embargo-target','embargo-action','embargo-relation-target','embargo-relation-response']) {
  test(`central ${domain} hold changes no state`,()=>{
    const base=createLegacyStrategy(),policy={id:'embargo-hold',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'hold embargo'}:base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupEmbargo(f,{incoming:true});
    f.attach();f.runtime.select(policy.id);
    if(domain.includes('relation'))f.actor.updateRelationsFromEmbargos();else f.actor.handleEmbargoesToHostileNations();
    assert.equal(f.commands.length,0);assert.equal(f.messages.length,0);assert.equal(f.actor.embargoMalusApplied.size,0);
    assert.ok(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain===domain));
  });
}
test('embargo policy can keep a proposed start unchanged',()=>{
  const base=createLegacyStrategy(),policy={id:'keep-embargo',version:'1',decide(s,cs){
    return s.domain==='embargo-action'?{selectedId:cs.find(c=>c.action==='keep').id,reason:'keep trade'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupEmbargo(f);f.attach();f.runtime.select(policy.id);
  f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,0);
});
for(const opts of [{},{active:true},{active:true,relation:0},{relation:0},{allied:true},{teammate:true},
  {targetStations:2},{active:true,targetStations:2},{denial:true,targetStations:5},
  {team:true,relation:0},{team:true,active:true,relation:0},{team:true,difficulty:'Easy',relation:0},
  {team:true,difficulty:'Medium',relation:0},{team:true,difficulty:'Hard',relation:0},
  {team:true,bot:true,relation:0},{team:true,allied:true,active:true},{team:true,teammate:true,active:true}]) {
  test(`embargo rule baseline parity: ${JSON.stringify(opts)}`,async()=>{
    await parity('NationBot',f=>{setupEmbargo(f,opts);f.attach();const result=f.actor.handleEmbargoesToHostileNations();
      f.commands.push({kind:'result',result});});
  });
}
for(const incoming of [true,false])for(const applied of [true,false])test(`embargo relation baseline parity incoming=${incoming}/applied=${applied}`,async()=>{
  await parity('NationBot',f=>{setupEmbargo(f,{incoming,applied});f.attach();const result=f.actor.updateRelationsFromEmbargos();
    f.commands.push({kind:'result',result,applied:[...f.actor.embargoMalusApplied]});});
});
for(const relations of [false,true])test(`embargo ${relations?'relation':'outgoing'} target policy can reorder players`,()=>{
  const base=createLegacyStrategy(),domain=relations?'embargo-relation-target':'embargo-target';
  const policy={id:'reorder-embargo',version:'1',decide(s,cs){
    if(s.domain===domain)return {selectedId:(cs.find(c=>c.targetId==='second')??cs[0]).id,reason:'second first'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]}),[first]=setupEmbargo(f,{incoming:true});
  first.__src={id:'enemy'};const second={...first,id:()=> 'second',smallID:()=>3,__src:{id:'second'}};
  f.game.players=()=>[f.player,first,second];f.attach();f.runtime.select(policy.id);
  if(relations)f.actor.updateRelationsFromEmbargos();else f.actor.handleEmbargoesToHostileNations();
  assert.deepEqual(f.result().commands.map(c=>relations?c.target:c.args[0].id),['second','enemy']);
});
for(const mode of ['penalty','restore'])test(`keeping embargo ${mode} leaves tracking unchanged until selected`,()=>{
  const base=createLegacyStrategy(),policy={id:'keep-relation',version:'1',decide(s,cs){
    return s.domain==='embargo-relation-response'?{selectedId:cs.find(c=>c.action==='keep').id,reason:'defer relation'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupEmbargo(f,{incoming:mode==='penalty',applied:mode==='restore'});
  f.attach();f.runtime.select(policy.id);f.actor.updateRelationsFromEmbargos();assert.equal(f.commands.length,0);
  assert.deepEqual([...f.actor.embargoMalusApplied],mode==='restore'?[2]:[]);
  f.runtime.select('legacy-v1');f.actor.updateRelationsFromEmbargos();
  assert.equal(f.commands[0].delta,mode==='penalty'?-20:20);
  assert.deepEqual([...f.actor.embargoMalusApplied],mode==='penalty'?[2]:[]);
});
for(const mode of ['hold','error','invalid','ineligible','emit-false','missing-ctor'])test(`embargo action failure semantics: ${mode}`,async()=>{
  const base=createLegacyStrategy(),policy={id:'embargo-failure',version:'1',decide(s,cs){
    if(s.domain==='embargo-action'){
      if(mode==='error')throw Error('embargo policy');
      if(mode==='invalid')return {selectedId:'missing',reason:'invalid'};
      if(mode==='ineligible')return {selectedId:cs.find(c=>c.action==='stop').id,reason:'unpermitted'};
    }
    if(mode==='hold'&&cs[0].kind==='embargo')return {selectedId:'$wait',reason:'hold command'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy],emitReturn:mode!=='emit-false'});setupEmbargo(f);
  if(mode==='missing-ctor')delete f.context.discoverCtors().embargo;
  f.attach();f.runtime.select(policy.id);f.actor.handleEmbargoesToHostileNations();
  assert.equal(f.commands.length,mode==='emit-false'?1:0);assert.equal(f.messages.length,mode==='emit-false'?1:0);
  if(mode==='error')assert.ok(f.runtime.inspect().records.some(r=>r.kind==='strategy-error'));
});
for(const emitReturn of [true,false])test(`failed embargo emit retains original label and helper return: ${emitReturn}`,async()=>{
  await parity('NationBot',f=>{setupEmbargo(f);f.attach();const result=f.actor.handleEmbargoesToHostileNations();
    f.commands.push({kind:'result',result});},{emitReturn});
});
for(const relations of [false,true])test(`embargo ${relations?'relation':'outgoing'} covers large pools in bounded windows`,()=>{
  const f=fixture(instrumented,'NationBot'),[originalTarget]=setupEmbargo(f,{incoming:true});
  const targets=Array.from({length:105},(_,i)=>({...originalTarget,id:()=>`target-${i}`,smallID:()=>i+2}));
  f.game.players=()=>[f.player,...targets];f.attach();
  if(relations)f.actor.updateRelationsFromEmbargos();else f.actor.handleEmbargoesToHostileNations();
  assert.equal(f.commands.length,105);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');assert.ok(ds.every(d=>d.candidates.length<=80));
  assert.equal(ds.filter(d=>d.snapshot.domain===(relations?'embargo-relation-target':'embargo-target')).length,105);
});
test('embargo command ancestry and replay include target and action decisions',()=>{
  const f=fixture(instrumented,'NationBot');setupEmbargo(f);f.attach();f.actor.handleEmbargoesToHostileNations();
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  const target=ds.find(d=>d.snapshot.domain==='embargo-target'),action=ds.find(d=>d.snapshot.domain==='embargo-action');
  const command=ds.find(d=>d.candidates[0].kind==='embargo');
  assert.equal(action.snapshot.parentDecisionId,target.decisionId);assert.equal(command.candidates[0].parentDecisionId,action.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
for(const domain of ['embargo-action','embargo-relation-response'])test(`nested ${domain} hold stops turn and resets next turn`,async()=>{
  const base=createLegacyStrategy(),policy={id:'turn-embargo-hold',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:'$wait',reason:'hold turn'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NationBot',{strategies:[policy]});setupEmbargo(f,{incoming:domain.includes('relation')});
  const calls=[];f.actor.emojiBehavior={maybeSendCasualEmoji:()=>calls.push('emoji')};
  f.actor.allianceBehavior={handleAllianceRequestsFromBots:()=>calls.push('bot-alliance')};
  f.actor.feat=name=>name==='embargo';f.attach();f.runtime.select(policy.id);
  const stopped=await f.runtime.planTurn(f.actor,{path:'full',tick:1});
  assert.equal(stopped.stopped,true);assert.equal(f.commands.length,0);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision'),action=ds.find(d=>d.snapshot.domain===domain);
  const target=ds.find(d=>d.decisionId===action.snapshot.parentDecisionId);
  assert.equal(ds.find(d=>d.decisionId===target.snapshot.parentDecisionId).snapshot.domain,'turn-plan');
  assert.equal(calls.includes('bot-alliance'),!domain.includes('relation'));
  f.runtime.select('legacy-v1');const next=await f.runtime.planTurn(f.actor,{path:'full',tick:2});
  assert.equal(next.stopped,false);assert.ok(f.commands.length>0);
});
for(const relations of [false,true])test(`stale embargo ${relations?'relation':'outgoing'} pass has no effects`,()=>{
  let current=true;const f=fixture(instrumented,'NationBot',{current:()=>current});setupEmbargo(f,{incoming:true});
  f.attach();current=false;if(relations)f.actor.updateRelationsFromEmbargos();else f.actor.handleEmbargoesToHostileNations();
  assert.equal(f.commands.length,0);assert.equal(f.actor.embargoMalusApplied.size,0);
});
test('throwing relation update does not mark penalty as applied',()=>{
  const f=fixture(instrumented,'NationBot');setupEmbargo(f,{incoming:true});
  f.player.updateRelation=()=>{throw Error('relation effect failed');};f.attach();
  assert.throws(()=>f.actor.updateRelationsFromEmbargos(),/relation effect failed/);assert.equal(f.actor.embargoMalusApplied.size,0);
});
for(const method of ['handleEmbargoesToHostileNations','updateRelationsFromEmbargos'])test(`null player embargo parity: ${method}`,async()=>{
  await parity('NationBot',f=>{f.actor.player=null;assert.equal(f.actor[method](),undefined);});
});

function setupMovingShips(f, scenario = 'success') {
  f.game.isWater = () => scenario !== 'land';
  f.game.x = tile => tile; f.game.y = () => 0;
  f.game.manhattanDist = (a,b) => Math.abs(a-b);
  f.game.getWaterComponent = tile => scenario === 'component' && tile === 10 ? 2 : 1;
  const unit = (id,tile,extra={}) => ({ id:()=>id,tile:()=>tile,
    warshipState:()=>({state:'patrolling',patrolTile:tile,...extra}) });
  const ships = [unit(1,10),unit(2,scenario==='tie'?10:20)];
  if (scenario==='state') ships[0]=unit(1,10,{state:'moving'});
  if (scenario==='no-patrol') ships[0]=unit(1,10,{patrolTile:undefined});
  if (scenario==='far-patrol') ships[0]=unit(1,10,{patrolTile:140});
  if (scenario==='bad-metadata') ships[0].warshipState=()=>{throw Error('metadata');};
  f.player.units = () => scenario==='empty'?[]:ships;
  const smart = { cooldown: new Map(), serviced:new Map() };
  if (scenario==='cooldown') smart.cooldown.set(1,95);
  if (scenario==='cooldown-boundary') smart.cooldown.set(1,40);
  if (scenario==='missing-ctor') delete f.context.discoverCtors().moveWarship;
  return {smart,ships};
}
for (const smartMode of [false,true]) for (const scenario of ['success','tie','land','empty','no-patrol',
  'far-patrol','state','component','cooldown','cooldown-boundary','far-target','distance-boundary','missing-ctor','emit-reject']) {
  test(`warship unit selection parity: ${smartMode?'smart':'fallback'}/${scenario}`,async()=>{
    await parity('WarshipBehavior',async f=>{
      const {smart}=setupMovingShips(f,scenario);
      const tile=scenario==='far-target'?181:scenario==='distance-boundary'?180:0;
      f.attach(); const result=smartMode?f.actor.moveBestWarshipTo(tile,'test',smart,100):f.actor.maybeMoveWarship(tile);
      f.commands.push({kind:'result',value:result,cooldown:[...smart.cooldown]});
    },{emitReturn:scenario!=='emit-reject'});
  });
}
test('smart ship metadata errors are skipped; fallback preserves original thrown error',async()=>{
  for (const smartMode of [false,true]) await parity('WarshipBehavior',async f=>{
    const {smart}=setupMovingShips(f,'bad-metadata'); f.attach();
    if(smartMode) f.actor.moveBestWarshipTo(0,'test',smart,100);
    else assert.throws(()=>f.actor.maybeMoveWarship(0),/metadata/);
  });
});
for(const scenario of ['first','invalid-coordinate','land-first','exhausted']) test(`warship water sampling parity: ${scenario}`,async()=>{
  await parity('WarshipBehavior',async f=>{
    let draws=0,probes=0;
    f.game.x=x=>x;f.game.y=()=>0;f.game.ref=x=>x;
    f.game.isValidCoord=()=>++probes> (scenario==='invalid-coordinate'?2:0);
    f.game.isWater=()=>scenario!=='exhausted' && (scenario!=='land-first'||probes>2);
    f.actor.random.nextInt=(low,high)=>{draws++;f.commands.push({kind:'random',low,high});return low;};
    f.attach();const tile=f.actor.warshipSpawnTile(300,250);
    f.commands.push({kind:'sample',tile,draws,probes});
  });
});
for(const choice of ['wait','error','second']) test(`central ship policy: ${choice}`,()=>{
  const policy={id:'ship-policy',version:'1',decide(snapshot,candidates){
    if(snapshot.domain!=='warship-unit')return createLegacyStrategy().decide(snapshot,candidates);
    if(choice==='error')throw Error('test error');
    return {selectedId:choice==='wait'?'$wait':candidates[1].id,reason:'test choice'};
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});
  const {smart}=setupMovingShips(f);f.attach();f.runtime.select(policy.id);
  f.runtime.planWarshipPatrol(f.actor,[{tile:0,kind:'invasion'},{tile:40,kind:'trade-lane'}],
    {smart,tick:100,cellSize:40,serviceTicks:90});
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(ds.filter(d=>d.snapshot.domain==='warship-patrol').length,1);
  if(choice!=='second'){
    assert.deepEqual(f.commands,[]);assert.equal(smart.cooldown.size,0);assert.equal(smart.serviced.size,0);
  }else{
    assert.deepEqual(f.result().commands[0].args,[[2],0]);
    assert.deepEqual([...smart.cooldown],[[2,100]]);assert.deepEqual([...smart.serviced],[['0,0',100]]);
    const ship=ds.find(d=>d.snapshot.domain==='warship-unit');
    assert.equal(ship.snapshot.parentDecisionId,ds[0].decisionId);
    assert.equal(ds.at(-1).candidates[0].parentDecisionId,ship.decisionId);
  }
});
test('deployment placement trace parents retain their local chain across probes',async()=>{
  const f=fixture(instrumented,'WarshipBehavior');
  f.actor.cost=()=>100n;f.game.x=x=>x;f.game.y=()=>0;f.game.isValidCoord=()=>true;
  f.game.ref=x=>x;f.game.isWater=()=>true;
  let resolve;f.actor.buildableWarship=()=>new Promise(r=>resolve=r);
  f.attach();const pending=f.actor.maybeSpawnWarship();
  f.runtime.intent(f.actor,'WarshipBehavior',function unrelated(){},7);
  resolve({type:UNIT.Warship,canBuild:0});await pending;
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const deploy=ds.find(d=>d.snapshot.domain==='warship-deployment');
  const port=ds.find(d=>d.snapshot.domain==='warship-port');
  const site=ds.find(d=>d.snapshot.domain==='warship-placement');
  assert.equal(port.snapshot.parentDecisionId,deploy.decisionId);
  assert.equal(site.snapshot.parentDecisionId,port.decisionId);
  const build=ds.find(d=>d.candidates[0].kind==='build Warship');
  assert.equal(build.candidates[0].parentDecisionId,site.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
});
test('command policy hold stops patrol without trying a different zone',()=>{
  const policy={id:'hold-command',version:'1',decide(snapshot,candidates){
    return candidates[0].kind==='moveWarship'?{selectedId:'$wait',reason:'hold command'}:
      createLegacyStrategy().decide(snapshot,candidates);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});
  const {smart}=setupMovingShips(f);f.attach();f.runtime.select(policy.id);
  f.runtime.planWarshipPatrol(f.actor,[{tile:0,kind:'invasion'},{tile:40,kind:'trade-lane'}],
    {smart,tick:100,cellSize:40,serviceTicks:90});
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='warship-patrol').length,1);
  assert.deepEqual(f.commands,[]);assert.equal(smart.cooldown.size,0);assert.equal(smart.serviced.size,0);
});

function setupWaypointMap(f, mode='line') {
  f.game.manhattanDist=(a,b)=>Math.abs(a-b);
  f.game.isWater=tile=>mode!=='land' || tile!==2;
  f.game.getWaterComponent=tile=>mode==='component'&&tile>=2?2:1;
  f.game.neighbors=tile=>[tile-1,tile+1].filter(n=>n>=0&&n<=(mode==='large'?500:5));
}
function setupDonation(f,mode='success') {
  f.state.settings.features.donate=mode!=='feature-off';f.state.settings.winFixes=mode!=='legacy';
  f.game.config=()=>({gameConfig:()=>({gameMode:mode==='ffa'?'FFA':'Team'}),donateTroops:()=>mode!=='lobby-off',maxTroops:()=>1000});
  f.game.getWinner=()=>mode==='winner'?{}:null;f.setTick(100);
  f.context.performance={now:()=>10000};f.player.isOnSameTeam=()=>true;
  f.player.troops=()=>mode==='poor'?400:mode==='small-chunk'?500:1000;
  f.player.incomingAttacks=()=>mode==='attacked'?[{}]:[];
  const targets=[2,3].map((id,i)=>({id:()=>String(id),smallID:()=>id,__src:`ally-${id}`,isAlive:()=>true,
    troops:()=>mode==='healthy'?900:i===0?200:500,incomingAttacks:()=>i===1?[{}]:[],outgoingAttacks:()=>[],name:()=>`ally-${id}`}));
  if(mode==='no-target')targets.splice(0);
  if(mode==='dead-front')targets[1].isAlive=()=>false;
  if(mode==='tie')targets[0].incomingAttacks=()=>[{}];
  f.game.players=()=>[f.player,...targets];f.actor.effectiveReserveRatio=()=>.45;f.actor.reserveRatio=.45;
  if(mode==='missing-ctor')delete f.context.discoverCtors().donateTroops;
  return targets;
}
for(const mode of ['missing-ctor','emit-false'])test(`failed donation submission returns false instead of starting cooldown: ${mode}`,()=>{
  const f=fixture(instrumented,'AttackBehavior',{emitReturn:mode!=='emit-false'});
  setupDonation(f,mode);f.attach();
  assert.equal(f.actor.donateTroops(),false);
});

test('real enemy probe searches a shared coast and dispatches 1% instead of probing an inland label',async()=>{
  const f=fixture(instrumented,'AttackBehavior');
  f.state.settings.features.boat=true;
  const enemy={id:()=> 'enemy',smallID:()=>2,isPlayer:()=>true,isAlive:()=>true,
    nameLocation:()=>({x:10,y:0}),borderTiles:()=>new Set([10,20])};
  Object.assign(f.player,{borderTiles:()=>new Set([0]),isFriendly:()=>false,unitCount:()=>0,
    bestTransportShipSpawn:async tile=>{assert.equal(tile,20);return 0;}});
  Object.assign(f.game,{players:()=>[enemy],isLand:t=>t<100,isWater:t=>t>=100,isShore:t=>t===0||t===20,
    neighbors:t=>[100+t],getWaterComponent:t=>t<100?null:1,x:t=>t,y:()=>0,ownerID:()=>2,
    config:()=>({boatMaxNumber:()=>3,gameConfig:()=>({})})});
  f.actor.getPlayerCenter=()=>({x:0,y:0});f.actor.openingVetoesTile=()=>false;f.attach();
  const tile=await f.actor.findDistantBoatTarget(true);
  assert.equal(tile,20);
  assert.equal(f.runtime.launchBoat(f.actor,tile,'probe-1pct','probe'),true);
  assert.deepEqual(f.commands,[{kind:'boat',args:[20,10]}]);
});

test('native wilderness dispatch uses 20% at 20% capacity without calling the old reserve gate',()=>{
  const adaptive=require('../src/brain/adaptive-strategy')(createLegacyStrategy());
  const f=fixture(instrumented,'AttackBehavior',{strategies:[adaptive],openingExpansion:require('../src/brain/opening-expansion')(),
    twoTeamOpening:{observe:()=>({borderKnown:true,wilderness:true,frontline:false})}});
  f.game.config=()=>({maxTroops:()=>10000,gameConfig:()=>({})});f.player.troops=()=>2000;
  f.actor.underThreat=()=>false;
  f.actor._landReserveFacts=()=>{throw Error('old opening reserve must not gate this wave');};
  f.attach();f.runtime.select('adaptive-v1');
  assert.equal(f.actor.sendLandAttack({isPlayer:()=>false}),true);
  assert.deepEqual(f.commands,[{kind:'attack',args:[null,400]}]);
});
for(const mode of ['success','legacy','feature-off','ffa','lobby-off','winner','poor','small-chunk','healthy',
  'attacked','no-target','dead-front','tie'])test(`donation actual parity: ${mode}`,async()=>{
  await parity('AttackBehavior',async f=>{
    setupDonation(f,mode);f.attach();const result=f.actor.donateTroops();
    f.commands.push({kind:'result',result,unsafeAt:f.actor._donateUnsafeAtTick});
  },{emitReturn:mode!=='emit-false'});
});
function setupOutreach(f,mode='normal') {
  f.state.settings.winFixes=true;f.context.performance={now:()=>10000};
  f.game.config=()=>({disableAlliances:()=>mode==='disabled'});
  f.player.isFriendly=()=>false;
  const targets=[2,3,4].map(id=>({id:()=>String(id),smallID:()=>id,__src:`target-${id}`,isPlayer:()=>true,
    isAlive:()=>true,type:()=>mode==='bots'?'Bot':'Nation',isTraitor:()=>false}));
  f.game.players=()=>[f.player,...targets];
  Object.assign(f.actor,{isDominantForDiplomacy:()=>mode==='dominant',isFarNation:()=>true,
    canSendAllianceRequest:()=>mode!=='cannot',isRegularBot:()=>false,isConfused:()=>false});
  f.actor.random.chance=()=>{f.commands.push({kind:'chance'});return mode!=='roll-fail';};
  f.actor.random.randElement=array=>{f.commands.push({kind:'random',ids:array.map(t=>t.id())});return array[0];};
  f.context.companionAllianceVeto=()=>mode==='veto';
  if(mode==='missing-ctor')delete f.context.discoverCtors().allianceRequest;
  if(mode==='empty')targets.splice(0);
  if(mode==='throttle')f.state.lastFarAllyMs=9999;
  return targets;
}
for(const far of [false,true])for(const mode of ['normal','disabled','dominant','cannot','bots','roll-fail','veto','empty','throttle','missing-ctor','emit-false'])
test(`outreach actual parity: ${far?'far':'normal'}/${mode}`,async()=>{
  await parity('AllianceBehavior',async f=>{
    const targets=setupOutreach(f,mode);f.attach();
    const result=far?f.actor.reachOutToFarNations():f.actor.maybeSendAllianceRequests(targets);
    assert.equal(result,undefined);f.commands.push({farAt:f.state.lastFarAllyMs});
  },{emitReturn:mode!=='emit-false'});
});
for(const domain of ['donation-target','donation-amount','command'])for(const mode of ['second','wait','error'])
test(`central donation ${domain}/${mode}`,()=>{
  const policy={id:'donate-choice',version:'1',decide(snapshot,cs){
    if(snapshot.domain!==domain&&!(domain==='command'&&cs[0].kind==='donateTroops'))return createLegacyStrategy().decide(snapshot,cs);
    if(mode==='error')throw Error('policy');
    return {selectedId:mode==='wait'?'$wait':cs[Math.min(1,cs.length-2)].id,reason:'choice'};
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]});setupDonation(f);f.attach();f.runtime.select(policy.id);
  const result=f.actor.donateTroops(),ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  if(mode==='second'){
    assert.equal(result,true);assert.equal(f.commands.length,1);
    if(domain==='donation-target')assert.equal(f.commands[0].args[0],'ally-2');
    if(domain==='donation-amount')assert.equal(f.commands[0].args[1],275);
    const target=ds.find(d=>d.snapshot.domain==='donation-target'),amount=ds.find(d=>d.snapshot.domain==='donation-amount');
    assert.equal(amount.snapshot.parentDecisionId,target.decisionId);assert.equal(ds.at(-1).candidates[0].parentDecisionId,amount.decisionId);
  }else{
    assert.equal(result,false);assert.deepEqual(f.commands,[]);assert.deepEqual(f.messages,[]);
  }
});
for(const far of [false,true])for(const mode of ['second','wait','error','command-hold','rule-hold'])
test(`central outreach ${far?'far':'normal'}/${mode}`,()=>{
  const domain=far?'far-outreach-target':'outreach-target';
  const policy={id:'outreach-choice',version:'1',decide(snapshot,cs){
    if(mode==='command-hold'&&cs[0].kind==='allianceRequest'||mode==='rule-hold'&&snapshot.domain==='alliance-rule')return {selectedId:'$wait',reason:'hold'};
    if(snapshot.domain!==domain||mode==='command-hold'||mode==='rule-hold')return createLegacyStrategy().decide(snapshot,cs);
    if(mode==='error')throw Error('policy');return {selectedId:mode==='wait'?'$wait':cs[cs.length>2?1:0].id,reason:'choice'};
  }};
  const f=fixture(instrumented,'AllianceBehavior',{strategies:[policy]}),targets=setupOutreach(f);
  f.attach();f.runtime.select(policy.id);far?f.actor.reachOutToFarNations():f.actor.maybeSendAllianceRequests(targets);
  const sends=f.commands.filter(c=>c.kind==='allianceRequest');
  if(mode==='second')assert.equal(sends[0].args[1],'target-3');
  else if(!(far&&mode==='rule-hold')){
    assert.equal(sends.length,0);assert.equal(f.state.lastFarAllyMs,undefined);assert.deepEqual(f.messages,[]);
  }
  assert.ok(f.runtime.replay(policy.id,f.runtime.inspect()).every(r=>r.sameChoice));
});
for(const domain of ['donation-target','donation-amount'])test(`donation hold stops enclosing attack sequence: ${domain}`,async()=>{
  const policy={id:'sequence-donate-hold',version:'1',decide(snapshot,cs){
    return snapshot.domain===domain?{selectedId:'$wait',reason:'hold'}:createLegacyStrategy().decide(snapshot,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]});setupDonation(f);
  f.actor.openingSnapshot=()=>null;f.actor.maybeOpportunisticBoat=async()=>false;
  f.actor.allianceBehavior={reachOutToFarNations:()=>{throw Error('later phase must not run');}};
  f.attach();f.runtime.select(policy.id);
  await f.runtime.planAttackSequence(f.actor,{all:[],friends:[],enemies:[],expand:false,boat:false,alliance:true,openLand:false});
  assert.equal(f.state.lastDonateMs,undefined);assert.deepEqual(f.commands,[]);
  f.runtime.intent(f.actor,'AttackBehavior',function unrelated(){},1);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1).candidates[0].parentDecisionId,undefined);
});
for(const far of [false,true])test(`outreach command ancestry and restored scope: ${far?'far':'normal'}`,()=>{
  const f=fixture(instrumented,'AllianceBehavior'),targets=setupOutreach(f);f.attach();
  far?f.actor.reachOutToFarNations():f.actor.maybeSendAllianceRequests(targets);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  for(const command of ds.filter(d=>d.candidates[0].kind==='allianceRequest')){
    const parent=ds.find(d=>d.decisionId===command.candidates[0].parentDecisionId);
    assert.equal(parent.snapshot.domain,far?'far-outreach-target':'alliance-rule');
    if(!far)assert.equal(ds.find(d=>d.decisionId===parent.snapshot.parentDecisionId).snapshot.domain,'outreach-target');
  }
  f.runtime.intent(f.actor,'AllianceBehavior',function unrelated(){},1);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1).candidates[0].parentDecisionId,undefined);
});

function setupHomeCombat(f,mode='nearest') {
  f.state.settings.winFixes=true;f.state.settings.features.warship=true;
  const own={id:()=>1,tile:()=>0,health:()=>1,maxHealth:()=>100,isActive:()=>true,
    isUnderConstruction:()=>false,warshipState:()=>({state:'patrolling'})};
  const team={smallID:()=>2,isOnSameTeam:()=>true},hostile={smallID:()=>3,isOnSameTeam:()=>false};
  const port=(id,tile,owner=f.player)=>({id:()=>id,tile:()=>tile,owner:()=>owner,isActive:()=>true,isUnderConstruction:()=>false});
  const ports=[port(2,60),port(3,mode==='tie'?60:80,mode==='team'?team:f.player)];
  if(mode==='hostile')ports[0]=port(2,10,hostile);
  if(mode==='inactive')ports[0].isActive=()=>false;
  if(mode==='building')ports[0].isUnderConstruction=()=>true;
  if(mode==='bad-owner')ports[0].owner=()=>{throw Error('owner');};
  if(mode==='metadata')ports[0].id=()=>{throw Error('telemetry');};
  if(mode==='empty')ports.splice(0);
  f.player.units=type=>type===UNIT.Warship?[own]:[];
  f.game.units=type=>type===UNIT.Port?ports:[];
  f.game.manhattanDist=(a,b)=>Math.abs(a-b);f.game.euclideanDistSquared=(a,b)=>(a-b)**2;
  f.game.neighbors=tile=>[tile+1,tile+2];f.game.isWater=()=>mode!=='dry';f.game.getWaterComponent=()=>1;
  f.game.x=x=>x;f.game.y=()=>0;f.context.performance={now:()=>10000};f.setTick(100);
  return {ports,own};
}
for(const mode of ['nearest','tie','team','hostile','inactive','building','bad-owner','metadata','empty','dry'])
test(`home port actual combat parity: ${mode}`,async()=>{
  await parity('WarshipBehavior',async f=>{
    setupHomeCombat(f,mode);f.attach();assert.equal(f.actor.smartWarshipCombat(),undefined);
    f.commands.push({cooldown:[...f.actor.ensureSmartState().cooldown]});
  });
});
for(const domain of ['warship-home','warship-home-tile'])for(const mode of ['second','wait','error'])
test(`home policy ${domain}/${mode}`,()=>{
  const policy={id:'home-policy',version:'1',decide(snapshot,cs){
    if(snapshot.domain!==domain)return createLegacyStrategy().decide(snapshot,cs);
    if(mode==='error')throw Error('home policy');
    return {selectedId:mode==='wait'?'$wait':cs[1].id,reason:'home choice'};
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupHomeCombat(f);
  f.attach();f.runtime.select(policy.id);f.actor.smartWarshipCombat();
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  if(mode==='second'){
    assert.equal(f.commands[0].args[1],domain==='warship-home'?81:62);
    const home=ds.find(d=>d.snapshot.domain==='warship-home'),tile=ds.find(d=>d.snapshot.domain==='warship-home-tile');
    assert.equal(tile.snapshot.parentDecisionId,home.decisionId);
    assert.equal(ds.find(d=>d.snapshot.domain==='warship-combat').snapshot.parentDecisionId,tile.decisionId);
    assert.ok(f.runtime.replay(policy.id,trace).every(r=>r.sameChoice));
  }else{
    assert.deepEqual(f.commands,[]);assert.equal(f.actor.ensureSmartState().cooldown.size,0);
    assert.equal(ds.some(d=>d.snapshot.domain==='warship-combat'),false);
  }
});
function setupNukeDodge(f,mode='success') {
  f.game.x=tile=>Number(String(tile).split(',')[0]);f.game.y=tile=>Number(String(tile).split(',')[1]);
  f.game.ref=(x,y)=>`${x},${y}`;f.game.isValidCoord=(x,y)=>Math.abs(x)<=200&&Math.abs(y)<=200;
  f.game.isWater=()=>mode!=='land';f.setTick(100);
  f.context.performance={now:()=>10000};
  f.game.config=()=>({isUnitDisabled:()=>mode==='disabled',nukeMagnitudes:()=>({outer:2})});
  const ships=[1,2].map(id=>({id:()=>id,tile:()=>mode==='outside'?'100,0':'0,0',
    warshipState:()=>({patrolTile:mode==='safe-patrol'?'100,0':undefined})}));
  if(mode==='bad-ship')ships[0].tile=()=>{throw Error('ship');};
  if(mode==='empty')ships.splice(0);
  const nukes=[{id:()=>9,isActive:()=>mode!=='inactive',targetTile:()=>mode==='no-target'?null:'0,0',
    type:()=>UNIT.AtomBomb,owner:()=>({smallID:()=>2})}];
  if(mode==='bad-nuke')nukes[0].id=()=>{throw Error('metadata');};
  f.player.units=()=>ships;f.game.units=()=>mode==='no-nukes'?[]:nukes;
  f.actor.nukeEtaById=new Map([[8,{}]]);
  f.actor.nukeEtaTicks=()=>10;
  if(mode==='not-safer')f.actor.findNukeEscapeTile=()=>({tile:'30,0',eta:10});
  if(mode==='missing-ctor')delete f.context.discoverCtors().moveWarship;
  return {ships,nukes};
}
for(const mode of ['success','outside','empty','no-nukes','inactive','no-target','land','safe-patrol',
  'not-safer','disabled','missing-ctor','emit-false','bad-ship','bad-nuke'])
test(`nuke dodge actual baseline parity: ${mode}`,async()=>{
  await parity('WarshipBehavior',async f=>{
    setupNukeDodge(f,mode);f.attach();assert.equal(f.actor.dodgeNukes(),undefined);
    f.commands.push({cooldown:[...f.actor.ensureSmartState().cooldown],cache:[...f.actor.nukeEtaById]});
  },{emitReturn:mode!=='emit-false'});
});
for(const domain of ['warship-nuke-dodge','warship-nuke-threat','warship-nuke-escape','command'])
for(const mode of ['wait','error'])test(`nuke dodge central ${domain}/${mode}`,()=>{
  const policy={id:'dodge-policy',version:'1',decide(snapshot,cs){
    if(snapshot.domain!==domain&&!(domain==='command'&&cs[0].kind==='moveWarship'))return createLegacyStrategy().decide(snapshot,cs);
    if(mode==='error')throw Error('dodge policy');return {selectedId:'$wait',reason:'hold'};
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupNukeDodge(f);f.attach();f.runtime.select(policy.id);
  f.actor.dodgeNukes();assert.deepEqual(f.commands,[]);assert.deepEqual(f.messages,[]);
  assert.equal(f.actor.ensureSmartState().cooldown.size,0);
  const trace=f.runtime.inspect();assert.equal(trace.records.some(r=>r.kind==='strategy-error'),mode==='error');
});
test('nuke escape trace follows each ship and restores its command scope',()=>{
  const f=fixture(instrumented,'WarshipBehavior');setupNukeDodge(f);f.attach();f.actor.dodgeNukes();
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const plans=ds.filter(d=>d.snapshot.domain==='warship-nuke-dodge');assert.equal(plans.length,2);
  for(const plan of plans){
    const threat=ds.find(d=>d.snapshot.domain==='warship-nuke-threat'&&d.snapshot.parentDecisionId===plan.decisionId);
    const escape=ds.find(d=>d.snapshot.domain==='warship-nuke-escape'&&d.snapshot.parentDecisionId===threat.decisionId);
    assert.ok(ds.some(d=>d.candidates[0].kind==='moveWarship'&&d.candidates[0].parentDecisionId===escape.decisionId));
  }
  assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
  f.runtime.intent(f.actor,'WarshipBehavior',function unrelated(){},9);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1).candidates[0].parentDecisionId,undefined);
});
for(const mode of ['defaults','single','fractional','zero-settings','invalid','land','no-zones','overlap','large'])
test(`nuke escape sampling actual parity: ${mode}`,async()=>{
  await parity('WarshipBehavior',async f=>{
    setupNukeDodge(f);
    if(mode==='single')Object.assign(f.state.settings,{warshipNukeDodgeSamples:1,warshipNukeDodgeRings:1});
    if(mode==='fractional')Object.assign(f.state.settings,{warshipNukeDodgeSamples:2.5,warshipNukeDodgeRings:2.5});
    if(mode==='zero-settings')Object.assign(f.state.settings,{warshipNukeDodgeSamples:0,warshipNukeDodgeRings:0,warshipNukeDodgeBuffer:0});
    if(mode==='large')Object.assign(f.state.settings,{warshipNukeDodgeSamples:64,warshipNukeDodgeRings:4});
    if(mode==='invalid')f.game.isValidCoord=(x,y)=>x<0;
    if(mode==='land')f.game.isWater=()=>false;
    const zones=mode==='no-zones'?[]:[{tx:0,ty:0,radius:10},{tx:2,ty:2,radius:20}];
    const eta=(x,y)=>{f.commands.push({kind:'eta',x,y});return mode==='overlap'&&x>0?10:Infinity;};
    f.attach();const result=f.actor.findNukeEscapeTile(0,0,zones,eta);
    f.commands.push({kind:'escape',result});
    if(mode==='large'&&f.source===instrumented){
      const d=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='warship-nuke-escape');
      assert.equal(d.candidates.length,80);assert.ok(d.snapshot.warship.probes>79);
    }
  });
});
for(const domain of ['warship-nuke-threat','warship-nuke-escape'])test(`dodge alternate ${domain} choice`,()=>{
  const policy={id:'other-dodge',version:'1',decide(snapshot,cs){
    return snapshot.domain===domain?{selectedId:cs[1].id,reason:'second'}:createLegacyStrategy().decide(snapshot,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});const {nukes}=setupNukeDodge(f);
  nukes.push({...nukes[0],id:()=>10,targetTile:()=>'1,0'});
  f.attach();f.runtime.select(policy.id);f.actor.dodgeNukes();
  assert.equal(f.commands.length,2);const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const escape=ds.find(d=>d.snapshot.domain==='warship-nuke-escape');
  assert.equal(f.commands[0].args[1],escape.candidates.find(c=>c.id===escape.selectedId).tile);
  assert.ok(f.runtime.replay(policy.id,f.runtime.inspect()).every(r=>r.sameChoice));
});
for(const mode of ['line','land','component','large','tie','no-enemies','zero-home','null-home'])
test(`escape waypoint actual baseline parity: ${mode}`,async()=>{
  await parity('WarshipBehavior',async f=>{
    setupWaypointMap(f,mode);
    const enemies=mode==='no-enemies'?[]:[{tile:()=>mode==='tie'?3:0}];
    const home=mode==='zero-home'?0:mode==='null-home'?null:mode==='tie'?3:5;
    f.attach();const tile=f.actor.findSafeWaypoint(0,home,enemies);
    f.commands.push({kind:'waypoint',tile});
    if(mode==='large') assert.ok(tile<=30,'original thirty-step BFS cap');
  });
});
for(const purpose of ['engage','trade-hunt','retreat','evade']) for(const mode of ['second','wait','error'])
test(`combat destination runtime ${purpose}/${mode}`,()=>{
  const domain=purpose==='retreat'?'warship-destination':purpose==='evade'?'warship-waypoint':'warship-target';
  const policy={id:'destination-choice',version:'1',decide(snapshot,candidates){
    if(snapshot.domain!==domain)return createLegacyStrategy().decide(snapshot,candidates);
    if(mode==='error')throw Error('policy error');
    return {selectedId:mode==='wait'?'$wait':candidates[Math.min(1,candidates.length-2)].id,reason:'choice'};
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});setupWaypointMap(f);
  const ship={id:()=>1,tile:()=>0},smart={cooldown:new Map()};
  const targets=[4,5].map((tile,i)=>({id:()=>i+2,tile:()=>tile,health:()=>5}));
  const context={ship,smart,health:purpose==='retreat'?1:100,maxHealth:100,retreatRatio:.75,
    evade:purpose==='evade',enemies:['engage','evade'].includes(purpose)?targets:[],
    trades:purpose==='trade-hunt'?targets:[],home:5,hunt:true,patrol:{}};
  f.attach();f.runtime.select(policy.id);f.runtime.planWarshipCombat(f.actor,context);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  if(mode!=='second'){
    assert.deepEqual(f.commands,[]);assert.equal(smart.cooldown.size,0);
    assert.equal(trace.records.some(r=>r.kind==='strategy-error'),mode==='error');
  }else{
    assert.equal(f.commands.length,1);assert.equal(smart.cooldown.get(1),1);
    const destination=ds.find(d=>d.snapshot.domain===domain);
    assert.equal(destination.snapshot.parentDecisionId,ds[0].decisionId);
    assert.equal(ds.at(-1).candidates[0].parentDecisionId,destination.decisionId);
    if(purpose==='engage'||purpose==='trade-hunt')assert.equal(f.commands[0].args[1],5);
    assert.ok(f.runtime.replay(policy.id,trace).every(r=>r.sameChoice));
  }
  f.runtime.intent(f.actor,'WarshipBehavior',function unrelated(){},9);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1).candidates[0].parentDecisionId,undefined);
});
test('waypoint windows retain original winner when BFS visits over seventy-nine tiles',async()=>{
  await parity('WarshipBehavior',async f=>{
    const size=20;f.game.neighbors=tile=>[tile-size,tile+size,
      ...(tile%size?[tile-1]:[]),...(tile%size<size-1?[tile+1]:[])].filter(n=>n>=0&&n<size*size);
    f.game.manhattanDist=(a,b)=>Math.abs(a%size-b%size)+Math.abs(Math.floor(a/size)-Math.floor(b/size));
    f.game.isWater=()=>true;f.game.getWaterComponent=()=>1;
    f.attach();const tile=f.actor.findSafeWaypoint(0,399,[{tile:()=>0}]);
    f.commands.push({kind:'waypoint',tile});
    if(f.source===instrumented){
      const decision=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='warship-waypoint');
      assert.ok(decision.snapshot.warship.visited>79);assert.equal(decision.candidates.length,80);
      assert.equal(decision.candidates[0].tile,tile);
      assert.ok(f.runtime.replay('legacy-v1',f.runtime.inspect()).every(r=>r.sameChoice));
    }
  });
});
for(const mode of ['wait','error','emit-false'])test(`combat command ${mode} cooldown bookkeeping`,()=>{
  const policy={id:'combat-command',version:'1',decide(snapshot,cs){
    if(cs[0].kind==='moveWarship'&&mode!=='emit-false'){
      if(mode==='error')throw Error('command policy');return {selectedId:'$wait',reason:'hold command'};
    }
    return createLegacyStrategy().decide(snapshot,cs);
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy],emitReturn:false});setupWaypointMap(f);
  const smart={cooldown:new Map()},ship={id:()=>1,tile:()=>0};
  f.attach();f.runtime.select(policy.id);f.runtime.planWarshipCombat(f.actor,{ship,smart,health:1,
    maxHealth:100,retreatRatio:.75,evade:false,enemies:[],trades:[],home:5,hunt:true,patrol:{}});
  assert.equal(smart.cooldown.size,mode==='emit-false'?1:0);
  assert.equal(f.commands.length,mode==='emit-false'?1:0);
});
for(const domain of ['warship-port','warship-placement']) for(const mode of ['second','wait','error'])
test(`deployment detail policy ${domain}/${mode}`,async()=>{
  const policy={id:'deployment-detail',version:'1',decide(snapshot,candidates){
    if(snapshot.domain!==domain)return createLegacyStrategy().decide(snapshot,candidates);
    if(mode==='error')throw Error('policy error');
    const selected=domain==='warship-placement' ? candidates.find(c=>c.resample&&c.eligible):candidates[1];
    return {selectedId:mode==='wait'?'$wait':selected?.id??'$wait',reason:'test choice'};
  }};
  const f=fixture(instrumented,'WarshipBehavior',{strategies:[policy]});
  const ports=[{id:()=>1,tile:()=>300},{id:()=>2,tile:()=>400}];
  f.player.units=type=>type===UNIT.Port?ports:[];f.actor.cost=()=>1n;
  f.game.x=x=>x;f.game.y=()=>0;f.game.ref=x=>x;f.game.isValidCoord=()=>true;f.game.isWater=()=>true;
  let draws=0,randomArray;
  f.actor.random.randElement=array=>{randomArray=array;return array[0];};
  f.actor.random.nextInt=low=>{draws++;return low;};
  f.actor.buildableWarship=async()=>({type:UNIT.Warship,canBuild:0});
  f.attach();f.runtime.select(policy.id);const result=await f.actor.maybeSpawnWarship();
  assert.equal(randomArray,ports);
  if(domain==='warship-port'&&mode==='second'){
    assert.equal(result,true);assert.equal(f.commands[0].args[1],150);assert.equal(draws,2);
  }else{
    assert.equal(result,false);assert.deepEqual(f.commands,[]);
    assert.equal(draws,domain==='warship-port'?0:mode==='second'?100:2);
  }
});
for(const scenario of ['newest','owned-newest','expired','zero']) test(`MIRV landing target parity: ${scenario}`,async()=>{
  await parity('AttackBehavior',async f=>{
    f.setTick(100);f.state.settings.mirvBoatWindowTicks=150;
    f.state.recentMirvHits=scenario==='expired'?[{tile:2,at:-51}]:scenario==='zero'?[{tile:0,at:20}]:
      [{tile:1,at:0},{tile:2,at:20},{tile:3,at:30}];
    f.game.ownerID=tile=>scenario==='owned-newest'&&tile===3?1:2;
    f.attach();f.commands.push({kind:'crater',tile:f.actor.pickMirvCraterTarget(),hits:f.state.recentMirvHits});
  });
});
for(const scenario of [{},{fallback:true},{winFixes:true},{veto:true},{emit:false},{boatOff:true},{disabled:true},{capped:true},{share:true}])
test(`tactical boat destination/allocation parity: ${JSON.stringify(scenario)}`,async()=>{
  await parity('AttackBehavior',async f=>{
    Object.assign(f.state.settings,{winFixes:!!scenario.winFixes,features:{boat:!scenario.boatOff},boatProbeFrac:.05,boatProbeMinTroops:10});
    const config=f.game.config();Object.assign(config,{isUnitDisabled:()=>!!scenario.disabled,boatMaxNumber:()=>5});f.game.config=()=>config;
    Object.assign(f.game,{isShore:()=>true,numLandTiles:()=>1000});
    Object.assign(f.player,{troops:()=>110.11,numTilesOwned:()=>scenario.share?500:50,unitCount:()=>scenario.capped?5:0,borderTiles:()=>new Set([7,8])});
    Object.assign(f.actor,{openingVetoesTile:()=>!!scenario.veto,
      findRandomBoatTarget:async(shore,enemies,free)=>{f.commands.push({kind:'search',shore,free,excluded:enemies.length});return free&&scenario.fallback?null:4;},
      random:{randElement:items=>{f.commands.push({kind:'origin',items});return items[1];}}});
    f.attach();f.commands.push({kind:'result',value:await f.actor.attackWithRandomBoat([])});
  },{emitReturn:scenario.emit});
});
for(const scenario of [{},{free:true},{excluded:true},{strong:true},{unreachable:true}])
test(`sampled random boat search parity: ${JSON.stringify(scenario)}`,async()=>{
  await parity('AttackBehavior',async f=>{
    f.context.BOAT_PROBE_CANDIDATES=4;
    const owners={
      a:combatTarget('a',scenario.strong?1500:100,{smallID:()=>2,type:()=> 'Bot',isFriendly:()=>false}),
      b:combatTarget('b',100,{smallID:()=>3,type:()=> 'Bot',isFriendly:()=>false})
    };
    Object.assign(f.game,{x:()=>0,y:()=>0,isValidCoord:()=>true,ref:x=>x,isLand:()=>true,owner:tile=>tile<=2?owners.a:owners.b});
    let draws=0;const coordinates=[1,0,2,0,3,0,4,0];
    Object.assign(f.actor,{isFFA:()=>true,random:{nextInt:(low,high)=>{
      const value=coordinates[draws++%coordinates.length];f.commands.push({kind:'draw',low,high,value});return value;}}});
    f.player.bestTransportShipSpawn=async tile=>{f.commands.push({kind:'probe',tile});return !scenario.unreachable&&tile>=3;};
    f.attach();const excluded=scenario.excluded?[owners.a]:[];
    f.commands.push({kind:'result',tile:await f.actor.findRandomBoatTarget(0,excluded,!!scenario.free)});
  });
});
test('current browser config no longer aborts the real attack sequence before donations and main attack',async()=>{
  const adapt=require('../src/brain/game-config-compat');
  for(const patched of [false,true]){
    const f=fixture(instrumented,'AttackBehavior');
    Object.assign(f.state.settings,{winFixes:true,features:{expand:true,boat:true,donate:true,alliance:false}});
    const raw={isUnitDisabled:()=>false,maxTroops:()=>1000,gameConfig:()=>({gameMode:'Team'})};
    const cfg=patched?adapt(raw,x=>x):raw;f.game.config=()=>cfg;
    f.context.performance={now:()=>10000};
    Object.assign(f.player,{nearby:()=>[],borderTiles:()=>new Set(),unitCount:()=>0});
    Object.assign(f.actor,{allianceBehavior:{},noteOpenLand:()=>{},openingSnapshot:()=>({applies:false}),
      donateTroops:()=>{f.commands.push('donate');return false;},attackBestTarget:async()=>f.commands.push('main'),
      random:{chance:()=>false}});
    f.attach();
    if(!patched){await assert.rejects(()=>f.actor.maybeAttack(),/boatMaxNumber/);assert.deepEqual(f.commands,[]);}
    else{await f.actor.maybeAttack();assert.deepEqual(f.commands,['donate','main']);}
  }
});

for (const scenario of [
  {}, {winFixes:true,takeover:true,send:true}, {winFixes:true,takeover:true},
  {winFixes:true,bot:true,botSuccess:true}, {openLand:true,send:true},
  {random:true,boatSuccess:true}, {enemy:true,random:true,boatSuccess:true},
  {enemy:true,random:true}, {winFixes:true,donate:true},
  {winFixes:true,donate:true,opening:true}, {expand:false,boat:false,alliance:false}
]) test(`outer attack sequence matches original: ${JSON.stringify(scenario)}`,async()=> {
  await parity('AttackBehavior',async f=>{
    f.context.performance={now:()=>10000};
    Object.assign(f.state.settings,{winFixes:!!scenario.winFixes,
      features:{expand:scenario.expand!==false,boat:scenario.boat!==false,alliance:scenario.alliance!==false,donate:!!scenario.donate}});
    const enemy=combatTarget('neighbor',5,{smallID:()=>2,isDisconnected:()=>!!scenario.takeover,type:()=>scenario.bot?'Bot':'Human'});
    Object.assign(f.game,{neighbors:()=>[],isLand:()=>true,ownerID:()=>0,hasOwner:()=>false,hasFallout:()=>false,
      terraNullius:()=>combatTarget('land'),playerBySmallID:()=>null});
    Object.assign(f.player,{borderTiles:()=>new Set([1]),nearby:()=>scenario.enemy||scenario.takeover||scenario.bot?[enemy]:[],isFriendly:()=>false});
    Object.assign(f.actor,{allianceBehavior:{reachOutToFarNations:()=>{f.commands.push({kind:'far-alliance'});},
      maybeSendAllianceRequests:()=>{f.commands.push({kind:'alliance'});}},
      noteOpenLand:()=>{},openingSnapshot:()=>{f.commands.push({kind:'opening'});return {applies:!!scenario.opening,over:false,built:false};},
      sendAttack:async t=>{f.commands.push({kind:'send',target:t.id()});return !!scenario.send;},
      attackBots:async()=>{f.commands.push({kind:'bots'});return !!scenario.botSuccess;},
      maybeOpportunisticBoat:async()=>{f.commands.push({kind:'opportunistic'});return true;},
      donateTroops:()=>{f.commands.push({kind:'donate'});return true;},
      attackWithRandomBoat:async enemies=>{f.commands.push({kind:'boat',enemyCount:enemies?.length||0});return !!scenario.boatSuccess;},
      attackBestTarget:async()=>{f.commands.push({kind:'main'});},
      random:{chance:n=>{f.commands.push({kind:'chance',n});return !!scenario.random;}}});
    // Use nearby terra-nullius marker for the original expansion shortcut.
    if(scenario.openLand) f.player.nearby=()=>[{isPlayer:()=>false}];
    f.attach();const value=await f.actor.maybeAttack();
    f.commands.push({kind:'outcome',value,donationAt:f.state.lastDonateMs,pass:f.actor._openingPassId});
  });
});

for (const scenario of [
  { name: 'regular Bot', regularBot: true, accepted: false },
  { name: 'confused accept', confused: true, chances: [true], accepted: true },
  { name: 'confused reject', confused: true, chances: [false], accepted: false },
  { name: 'traitor rejection', traitor: true, ints: [90], chances: [true], incoming: true, accepted: false },
  { name: 'traitor mercy then final accept', traitor: true, ints: [9], similar: true, accepted: true },
  { name: 'far nation accept', winFixes: true, far: true, accepted: true },
  { name: 'far nation dominant reject', winFixes: true, far: true, dominant: true, accepted: false },
  { name: 'alliance cap reject', cap: true, accepted: false },
  { name: 'incoming threat accept', threat: true, incoming: true, chances: [true], accepted: true },
  { name: 'outgoing threat accept', threat: true, chances: [true], accepted: true },
  { name: 'team reject', teamReject: true, accepted: false },
  { name: 'negative relation reject', relation: -1, incoming: true, chances: [true], accepted: false },
  { name: 'friendly accept', friendly: true, chances: [true], accepted: true },
  { name: 'enough alliances reject', enough: true, accepted: false },
  { name: 'early game accept', early: true, accepted: true },
  { name: 'final strength reject', similar: false, accepted: false }
]) test('original alliance decision parity: ' + scenario.name, async () => {
  const result = await parity('AllianceBehavior', async f => {
    f.state.settings.winFixes = !!scenario.winFixes;
    const randomCalls = [], chances = [...(scenario.chances || [])], ints = [...(scenario.ints || [])];
    f.actor.random = {
      chance: odds => { randomCalls.push(['chance', odds]); return chances.shift() ?? false; },
      nextInt: (low, high) => { randomCalls.push(['nextInt', low, high]); return ints.shift() ?? low; }
    };
    f.actor.isRegularBot = () => !!scenario.regularBot;
    f.actor.isConfused = () => !!scenario.confused;
    f.actor.isFarNation = () => !!scenario.far;
    f.actor.isDominantForDiplomacy = () => !!scenario.dominant;
    f.actor.hasTooManyAlliances = () => !!scenario.cap;
    f.actor.isAlliancePartnerThreat = () => !!scenario.threat;
    f.actor.shouldRejectInTeamGame = () => !!scenario.teamReject;
    f.actor.isAlliancePartnerFriendly = () => !!scenario.friendly;
    f.actor.checkAlreadyEnoughAlliances = () => !!scenario.enough;
    f.actor.isEarlygame = () => !!scenario.early;
    f.actor.isAlliancePartnerSimilarlyStrong = () => !!scenario.similar;
    f.player.relation = () => scenario.relation ?? 0;
    f.actor.emojiBehavior = { sendEmoji: (_target, emoji) => f.commands.push({ kind: 'emoji', emoji }) };
    const target = { id: () => 'enemy', smallID: () => 2, isTraitor: () => !!scenario.traitor };
    f.attach();
    const accepted = f.actor.getAllianceDecision(target, !!scenario.incoming);
    f.commands.push({ kind: 'alliance-result', accepted, randomCalls });
    assert.equal(accepted, scenario.accepted);
  });
  assert.equal(result.commands.at(-1).accepted, scenario.accepted);
});

for (const accepted of [false, true]) test(`incoming alliance ${accepted ? 'accept' : 'reject'} action parity`, async () => {
  const result = await parity('AllianceBehavior', async f => {
    const actions = [];
    f.actor.incomingAllianceRequests = () => [{ requestor: () => ({ id: () => 'enemy' }), createdAt: () => 999,
      accept: () => actions.push('accept'), reject: () => actions.push('reject') }];
    f.actor.isRegularBot = () => false;
    f.actor.getAllianceDecision = () => accepted;
    f.game.config = () => ({ disableAlliances: () => false, numSpawnPhaseTurns: () => 10, gameConfig: () => ({ difficulty: 'Impossible' }) });
    f.attach(); f.actor.handleAllianceRequests();
    f.commands.push({ kind: 'actions', actions });
  });
  assert.deepEqual(result.commands.at(-1).actions, [accepted ? 'accept' : 'reject']);
});
test('disabled alliances skip incoming decisions and actions in both builds', async () => {
  const result = await parity('AllianceBehavior', async f => {
    f.actor.incomingAllianceRequests = () => { throw Error('disabled loop should not enumerate'); };
    f.game.config = () => ({ disableAlliances: () => true, numSpawnPhaseTurns: () => 10,
      gameConfig: () => ({ difficulty: 'Impossible' }) });
    f.attach(); assert.equal(f.actor.handleAllianceRequests(), undefined);
    f.commands.push({ kind: 'disabled-complete' });
  });
  assert.equal(result.commands.at(-1).kind, 'disabled-complete');
});

for (const scenario of [
  { name: 'disabled', disabled: true, targets: ['enemy'] },
  { name: 'no requests', targets: [] },
  { name: 'low relation', relation: 0, targets: ['enemy'] },
  { name: 'self then friendly', targets: ['self', 'friendly'] },
  { name: 'failed attack then success', targets: ['enemy-a', 'enemy-b'], attackResults: [false, true] }
]) test(`ally assistance parity: ${scenario.name}`, async () => {
  await parity('AttackBehavior', async f => {
    const targets = scenario.targets.map((id, index) => ({ id: () => id, smallID: () => id === 'self' ? 1 : index + 2,
      isPlayer: () => true, friendly: id === 'friendly' }));
    const ally = { id: () => 'ally', targets: () => targets };
    const config = f.game.config(); Object.assign(config, { disableAlliances: () => !!scenario.disabled });
    f.game.config = () => config;
    Object.assign(f.player, { allies: () => [ally], relation: () => scenario.relation ?? 1,
      isFriendly: target => !!target.friendly,
      updateRelation: (target, amount) => f.commands.push({ kind: 'relation', target: target.id(), amount }) });
    f.actor.emojiBehavior = { sendEmoji: (target, emoji) => f.commands.push({ kind: 'emoji', target: target.id(), emoji }) };
    const results = [...(scenario.attackResults || [])];
    f.actor.sendAttack = async target => { f.commands.push({ kind: 'assist-attack', target: target.id() }); return results.shift() ?? true; };
    f.attach(); const result = await f.actor.assistAllies();
    f.commands.push({ kind: 'assist-result', result });
  });
});
test('ally assistance preserves the uninitialized guard', async () => {
  await parity('AttackBehavior', async f => {
    f.actor.emojiBehavior = undefined; f.attach();
    await assert.rejects(() => f.actor.assistAllies(), /not initialized/);
  });
});

for (const scenario of [
  { name: 'disabled alliances', disabled: true, difficulty: 'Hard', troops: 10 },
  { name: 'disabled feature', betrayFeature: false, difficulty: 'Hard', troops: 10 },
  { name: 'non ally', allied: false, difficulty: 'Hard', troops: 10 },
  { name: 'hard weak capacity', difficulty: 'Hard', troops: 100, outgoing: [50], capacity: 1000, total: 2 },
  { name: 'hard capacity boundary', difficulty: 'Hard', troops: 200, capacity: 1000, total: 2 },
  { name: 'easy human excluded', difficulty: 'Easy', troops: 100, type: 'Human', total: 2 },
  { name: 'easy bot ten times', difficulty: 'Easy', troops: 100, type: 'Bot', total: 2 },
  { name: 'medium ten times boundary', difficulty: 'Medium', troops: 100, total: 2 },
  { name: 'hard traitor', difficulty: 'Hard', troops: 800, traitor: true, total: 2 },
  { name: 'hard traitor boundary', difficulty: 'Hard', troops: 1200, traitor: true, capacity: 1000, total: 2 },
  { name: 'sole opponent', difficulty: 'Hard', troops: 300, capacity: 1000, total: 1 },
  { name: 'sole opponent boundary', difficulty: 'Hard', troops: 1000 / 3, capacity: 1000, total: 1 },
  { name: 'attack false is exact result', difficulty: 'Hard', troops: 100, capacity: 1000, total: 2, attackResult: false }
]) test(`betrayal parity: ${scenario.name}`, async () => {
  await parity('AttackBehavior', async f => {
    f.context.currentDifficulty = () => scenario.difficulty;
    f.state.settings.features.betray = scenario.betrayFeature ?? true;
    const config = f.game.config(); Object.assign(config, { disableAlliances: () => !!scenario.disabled,
      maxTroops: target => target.capacity }); f.game.config = () => config;
    Object.assign(f.player, { troops: () => 1000, isAlliedWith: () => scenario.allied !== false });
    const target = { id: () => 'ally', troops: () => scenario.troops,
      outgoingAttacks: () => (scenario.outgoing || []).map(troops => ({ troops: () => troops })),
      type: () => scenario.type || 'Human', isTraitor: () => !!scenario.traitor, capacity: scenario.capacity ?? 1000 };
    const Alliance = fixtureClass(f, 'AllianceBehavior');
    const alliance = Object.create(Alliance.prototype);
    Object.assign(alliance, { game: f.game, player: f.player,
      betray: victim => f.commands.push({ kind: 'betray', target: victim.id() }) });
    f.actor.allianceBehavior = alliance; f.bot.allianceBehavior = alliance;
    f.actor.sendAttack = async (victim, force) => {
      f.commands.push({ kind: 'betray-attack', target: victim.id(), force }); return scenario.attackResult ?? true;
    };
    const friends = [target], enemies = Array(Math.max(0, (scenario.total ?? 2) - 1)).fill({});
    f.attach(); const result = await f.actor.maybeBetrayAndAttack(friends, enemies);
    f.commands.push({ kind: 'betray-result', result });
  });
});
test('betrayal preserves the uninitialized guard', async () => {
  await parity('AttackBehavior', async f => {
    f.actor.allianceBehavior = undefined; f.attach();
    await assert.rejects(() => f.actor.maybeBetrayAndAttack([], []), /not initialized/);
  });
});

for (const scenario of [
  { name: 'reinforce tile zero', surge: true },
  { name: 'expired reinforcement falls through', surge: true, expired: true, success: 'disconnected' },
  { name: 'failed reinforcement probe falls through', surge: true, surgeProbeFails: true, success: 'disconnected' },
  { name: 'failed surge and ordinary dispatch', surge: true, emit: false, success: 'disconnected' },
  { name: 'disconnected grab', success: 'disconnected' },
  { name: 'nearby island grab', success: 'nearby', owned: false },
  { name: 'nearby weak coast', success: 'nearby', owned: true },
  { name: 'nearby fallout grab', success: 'nearby', owned: true, fallout: true },
  { name: 'MIRV crater probe', success: 'crater' },
  { name: 'random free probe', success: 'random-free' },
  { name: 'random enemy probe', success: 'random-enemy' },
  { name: 'distant grab', success: 'distant' },
  { name: 'no destination', success: null },
  { name: 'low island fill stops', fill: .2, success: 'disconnected' },
  { name: 'island below surplus can launch', fill: .4, success: 'nearby' },
  { name: 'random below surplus stops', fill: .4, success: 'random-free' },
  { name: 'ordinary failed emit stops', success: 'disconnected', emit: false },
  { name: 'nearby cap counts taken destinations', success: 'nearby', taken: [2], probeCap: 1 },
  { name: 'feature gate', boatOff: true },
  { name: 'boat disabled gate', disabled: true },
  { name: 'concurrent boat gate', capped: true },
  { name: 'cooldown gate', throttled: true },
  { name: 'no shore gate', noShore: true }
]) test(`opportunistic naval action parity: ${scenario.name}`, async () => {
  await parity('AttackBehavior', async f => {
    f.context.performance = { now: () => 10000 };
    f.setTick(100);
    Object.assign(f.state.settings, { features: { boat: !scenario.boatOff }, boatSurplusFill: .75,
      boatIslandFill: .35, boatProbeFrac: .05, boatProbeMinTroops: 10, boatSurgeFrac: .25,
      islandProbeMax: scenario.probeCap ?? 4, maxConcurrentBoats: 3, oppBoatThrottleMs: 1200 });
    f.state.lastOppBoatMs = scenario.throttled ? 9999 : 5;
    f.state.beachhead = scenario.surge ? { tile: 0, at: scenario.expired ? -1000 : 90, surged: false } : null;
    const config = f.game.config();
    Object.assign(config, { boatMaxNumber: () => 5, maxTroops: () => 1000, isUnitDisabled: () => !!scenario.disabled });
    f.game.config = () => config;
    f.game.isShore = () => !scenario.noShore;
    f.game.hasOwner = () => true;
    f.game.x = tile => tile; f.game.y = () => 0;
    Object.assign(f.player, { troops: () => 1000 * (scenario.fill ?? 1), unitCount: () => scenario.capped ? 3 : 0,
      borderTiles: () => new Set([7, 8]),
      units: type => {
        if (type !== UNIT.TransportShip) return [];
        f.commands.push({ kind: 'read-ships' });
        return [{ targetTile: () => 7 }, { targetTile: () => null }];
      },
      bestTransportShipSpawn: async tile => {
        f.commands.push({ kind: 'probe', tile });
        return tile === 0 ? !scenario.surgeProbeFails : tile === 2 ? false : 9;
      }
    });
    Object.assign(f.actor, {
      landingSucceeded: () => true, openingVetoesTile: () => false,
      boatTargetTaken: tile => { f.commands.push({ kind: 'taken', tile }); return (scenario.taken || []).includes(tile); },
      findDisconnectedBoatTarget: async () => { f.commands.push({ kind: 'disconnected' }); return scenario.success === 'disconnected' ? 1 : null; },
      scanNearbyTargets: () => {
        f.commands.push({ kind: 'nearby' }); return scenario.success === 'nearby' ?
          [{ tile: 2 }, { tile: 3, owned: !!scenario.owned, fallout: !!scenario.fallout }] : [];
      },
      pickMirvCraterTarget: () => { f.commands.push({ kind: 'crater' }); return scenario.success === 'crater' ? 3 : null; },
      findRandomBoatTarget: async (shore, excluded, free) => {
        f.commands.push({ kind: 'random-target', shore, excluded, free });
        return scenario.success === (free ? 'random-free' : 'random-enemy') ? 4 : null;
      },
      findDistantBoatTarget: async () => { f.commands.push({ kind: 'distant' }); return scenario.success === 'distant' ? 6 : null; }
    });
    f.actor.random.randElement = list => { f.commands.push({ kind: 'random-shore', list }); return list[0]; };
    f.attach(); const result = await f.actor.maybeOpportunisticBoat();
    f.commands.push({ kind: 'naval-result', result, lastOppBoatMs: f.state.lastOppBoatMs,
      beachhead: f.state.beachhead, inflight: f.actor._inflightBoatTargets ?? null });
  }, { emitReturn: scenario.emit ?? true });
});

for (const mode of ['distant', 'disconnected']) {
  for (const scenario of [
    { name: 'zero tile', results: { 0: 9 } },
    { name: 'false then reachable', results: { 4: 9 } },
    { name: 'timeout then reachable', results: { 0: 'TIMEOUT', 4: 9 } },
    { name: 'all unreachable', results: {} },
    { name: 'taken slot caps search', taken: [0], cap: 1, results: { 2: 9 } },
    { name: 'fractional cap', cap: 1.5, results: { 4: 9 } },
    { name: 'no center preserves input ties', noCenter: true, results: { 4: 9 } },
    { name: 'empty eligible set', empty: true, results: {} }
  ]) test(`naval landing parity ${mode}: ${scenario.name}`, async () => {
    await parity('AttackBehavior', async f => {
      const makePlayer = (sid, tile, extra = {}) => ({ isPlayer: () => true, isAlive: () => true,
        smallID: () => sid, isDisconnected: () => true, nameLocation: () => ({ x: tile, y: 0 }), ...extra });
      const targets = scenario.empty ? [] : [makePlayer(4, 4), makePlayer(2, 0), makePlayer(3, 2),
        makePlayer(9, 1, { friendly: true }), makePlayer(1, 8), makePlayer(7, 6, { isAlive: () => false }),
        makePlayer(8, -1)];
      f.game.players = () => targets;
      f.game.isValidCoord = (x, y) => x >= 0 && y >= 0;
      f.game.ref = x => x;
      f.player.isFriendly = target => !!target.friendly;
      f.actor.getPlayerCenter = () => scenario.noCenter ? null : { x: 0, y: 0 };
      f.actor.boatTargetTaken = tile => (scenario.taken || []).includes(tile);
      f.state.settings.distantBoatProbeMax = scenario.cap ?? 12;
      f.state._distantDiag = { previous: true };
      f.player.bestTransportShipSpawn = async tile => {
        f.commands.push({ kind: 'probe', tile }); return scenario.results[tile] ?? false;
      };
      f.context.withTimeout = async (promise, ms, fallback) => {
        const result = await promise; return result === 'TIMEOUT' ? fallback : result;
      };
      f.attach();
      const result = await f.actor[mode === 'distant' ? 'findDistantBoatTarget' : 'findDisconnectedBoatTarget']();
      f.commands.push({ kind: 'result', tile: result, diagnostic: f.state._distantDiag });
    });
  });
}
function setupAttackChoices(f, options = {}) {
  const incoming = combatTarget('counter');
  const weak = combatTarget('weak', 10);
  const traitor = combatTarget('traitor', 300, { isTraitor: () => true });
  const disconnected = combatTarget('disconnected', 400, { isDisconnected: () => true });
  const victim = combatTarget('victim', 500, { incomingAttacks: () => [{ troops: () => 300 }] });
  const pocket = combatTarget('pocket', 10, { smallID: () => 42, isAlive: () => true,
    numTilesOwned: () => 10, borderTiles: () => new Set([20]) });
  const island = combatTarget('island', 10, { smallID: () => 43, isAlive: () => true,
    numTilesOwned: () => 10, borderTiles: () => new Set([30]) });
  const enemies = options.empty ? [] : [weak, traitor, disconnected, victim];
  f.context.currentDifficulty = () => options.difficulty || 'Impossible';
  f.state.settings.winFixes = !!options.winFixes;
  f.state.settings.encirclePockets = true;
  f.state.settings.counterAttackFirst = !!options.priority;
  const config = f.game.config();
  Object.assign(config, { maxTroops: () => 1000, disableAlliances: () => false,
    isUnitDisabled: () => false, boatMaxNumber: () => 5, gameConfig: () => ({ gameMode: 'FFA' }) });
  f.game.config = () => config;
  f.game.terraNullius = () => combatTarget('crater');
  Object.assign(f.game, { numLandTiles: () => 1000, width: () => 100, height: () => 100,
    playerBySmallID: id => id === 42 ? pocket : id === 43 ? island : null,
    ensureBorderTiles: async () => {}, isShore: tile => tile === 1 || tile === 30,
    x: tile => tile, y: () => 10, neighbors: tile => tile === 20 ? [201,202,203] : [],
    isLand: () => true, hasOwner: tile => tile !== 203, ownerID: () => 1,
    players: () => [f.player,island], ref: (x,y) => `${x},${y}`,
    manhattanDist: (a,b) => Math.abs(Number(a.split(',')[0])-Number(b.split(',')[0])) });
  Object.assign(f.player, { type: () => 'Human', isFriendly: () => false,
    incomingAttacks: () => [{ attacker: () => incoming, troops: () => 30 }],
    allRelationsSorted: () => [{ relation: -1, player: combatTarget('hostile') }],
    nearby: () => [pocket], borderTiles: () => new Set([1]), unitCount: () => 0,
    bestTransportShipSpawn: async () => true });
  Object.assign(f.actor, {
    hasNeighboringBotWithStructures: () => !!options.structuredBots,
    counterReady: () => true,
    hasReserveRatioTroops: () => { f.commands.push({ kind: 'reserve' }); return options.reserve !== false; },
    hasTriggerRatioTroops: () => { f.commands.push({ kind: 'trigger' }); return options.trigger !== false; },
    attackBots: async () => { f.commands.push({ kind: 'bots' }); return !!options.botSuccess; },
    assistAllies: async () => { f.commands.push({ kind: 'assist' }); return false; },
    maybeBetrayAndAttack: async () => { f.commands.push({ kind: 'betray' }); return false; },
    donateTroops: () => { f.commands.push({ kind: 'donate' }); return false; },
    findSealablePocket: async () => combatTarget('pocket'),
    isBorderingNukedTerritory: () => true,
    findNearestIslandEnemy: async () => combatTarget('island'),
    getPlayerCenter: player => ({ x:player.smallID?.() || 1, y:0 }),
    sendAttack: async (t, ...flags) => { f.commands.push({ kind: 'selected-target', id: t.id(), flags }); return !!options.sendSuccess; }
  });
  f.actor.random.chance = n => { f.commands.push({ kind: 'random', n }); return !!options.randomSuccess; };
  return enemies;
}

for (const policyError of [false, true]) test(`readiness target wait/error stops whole attack pass without leaking (${policyError})`, async () => {
  const base = createLegacyStrategy();
  const f = fixture(instrumented, 'AttackBehavior', { strategies: [{ id: 'hold-incoming', version: '1', decide(s, cs) {
    if (s.domain === 'attack-target' && s.attack.mode === 'incoming') {
      if (policyError) throw Error('policy failed');
      return { selectedId: '$wait', reason: 'Hold incoming counter' };
    }
    return base.decide(s, cs);
  } }] });
  const realReady = f.actor.counterReady;
  const enemies = setupAttackChoices(f);
  f.actor.counterReady = realReady;
  f.state.settings.absorbThenCounter = true;
  f.actor.hostileWaveRemaining = () => 100;
  f.actor.shieldThreatened = () => false;
  f.attach(); f.runtime.select('hold-incoming');
  await f.actor.attackBestTarget([], enemies);
  assert.equal(f.commands.some(c => c.kind === 'bots' || c.kind === 'selected-target'), false);
  f.runtime.select('legacy-v1'); f.commands.length = 0;
  await f.actor.attackBestTarget([], enemies);
  assert.ok(f.commands.some(c => c.kind === 'selected-target'));
});

for (const difficulty of ['Easy', 'Medium', 'Hard', 'Impossible']) {
  for (const winFixes of [false, true]) {
    for (const sendSuccess of [false, true]) test(`attack purpose/target parity ${difficulty}, winFixes=${winFixes}, success=${sendSuccess}`, async () => {
      await parity('AttackBehavior', async f => {
        const enemies = setupAttackChoices(f, { difficulty, winFixes, sendSuccess }); f.attach();
        assert.equal(await f.actor.attackBestTarget([], enemies), undefined);
      });
    });
  }
}
for (const options of [
  { priority: true, reserve: false, sendSuccess: true },
  { priority: true, reserve: false, sendSuccess: false },
  { structuredBots: true, botSuccess: true, priority: true },
  { trigger: false, randomSuccess: false },
  { trigger: false, randomSuccess: true },
  { empty: true }
]) test(`attack preflight/gates/fallback parity ${JSON.stringify(options)}`, async () => {
  await parity('AttackBehavior', async f => {
    const enemies = setupAttackChoices(f, options); f.attach(); await f.actor.attackBestTarget([], enemies);
  });
});

test('real absorb-then-counter readiness retains peak, shield, weakness and timeout behavior', async () => {
  await parity('AttackBehavior', f => {
    let wave = 100, shield = true, enemyTroops = 900;
    const enemy = combatTarget('incoming', 0, { troops: () => enemyTroops });
    f.state.settings.absorbThenCounter = true;
    f.state.settings.counterSpentFrac = .4; f.state.settings.counterWeakRatio = .5; f.state.settings.absorbMaxTicks = 300;
    Object.assign(f.player, { type: () => 'Human', isFriendly: () => false,
      incomingAttacks: () => [{ attacker: () => enemy, troops: () => wave }] });
    f.actor.hostileWaveRemaining = () => wave; f.actor.shieldThreatened = () => shield;
    f.attach();
    for (const step of [
      [10, 100, true, 900], [20, 200, true, 900], [30, 80, true, 900],
      [40, 150, false, 400], [50, 150, false, 900], [310, 150, false, 900], [311, 0, false, 900]
    ]) {
      f.setTick(step[0]); wave = step[1]; shield = step[2]; enemyTroops = step[3];
      f.commands.push({ kind: 'ready', value: f.actor.counterReady(), absorb: f.actor._absorb ? { ...f.actor._absorb } : null });
    }
  });
});

for (const ffa of [false, true]) test(`real target predicate boundaries match original, FFA=${ffa}`, async () => {
  await parity('AttackBehavior', f => {
    const config = f.game.config();
    Object.assign(config, { maxTroops: () => 1000, disableAlliances: () => false,
      gameConfig: () => ({ gameMode: ffa ? 'FFA' : 'Team' }) });
    f.game.config = () => config;
    const targets = [
      combatTarget('threshold', 1200, { isTraitor: () => true, incomingAttacks: () => [{ troops: () => 601 }] }),
      combatTarget('weak-threshold', 150), combatTarget('weak', 149),
      combatTarget('traitor', 1199, { isTraitor: () => true })
    ];
    Object.assign(f.player, { type: () => 'Human', isFriendly: t => t.id() === 'friend', incomingAttacks: () => [
      [combatTarget('bot', 10, { type: () => 'Bot' }), 1000], [combatTarget('friend'), 1000],
      [targets[0], 0], [targets[1], 50], [targets[2], 50]
    ].map(([p, troops]) => ({ attacker: () => p, troops: () => troops })) });
    f.attach();
    for (const name of ['findTraitor', 'findVictim', 'findVeryWeakEnemy', 'findIncomingAttackPlayer']) {
      f.commands.push({ kind: name, target: f.actor[name](targets)?.id() ?? null });
    }
  });
});

test('initial land attack matches original target, troop amount and counters', async () => {
  const result = await parity('AttackBehavior', async f => { f.attach(); await f.actor.forceSendAttack({ isPlayer: () => true, id: () => 'enemy' }); });
  assert.deepEqual(result.commands[0], { kind: 'attack', args: ['enemy', 500] });
  assert.equal(result.stats.attacks, 1);
});
test('failed original event dispatch retains original bookkeeping behavior', async () => {
  await parity('AttackBehavior', async f => { f.attach(); await f.actor.forceSendAttack({ isPlayer: () => false }); }, { emitReturn: false });
});

function setupLandAllocation(f, type='Human', troops=100) {
  const config=f.game.config(); config.maxTroops=()=>1000;f.game.config=()=>config;
  Object.assign(f.player,{type:()=> 'Nation'});
  Object.assign(f.actor,{expandRatio:.1,openingReserve:.4,botAttackTroopsSent:20,
    effectiveReserveRatio:()=>.3,underThreat:()=>false,
    openingSnapshot:()=>({applies:true,over:false,built:false}),freeLandShare:()=>.5,borderingBotCount:()=>5});
  return combatTarget('enemy',troops,{type:()=>type,units:()=>[]});
}
function setupTargetedBoat(f,type='Human') {
  const target=setupLandAllocation(f,type,20);
  f.state.settings.features.boat=true;
  const config=f.game.config();config.boatMaxNumber=()=>3;f.game.config=()=>config;
  f.game.ensureBorderTiles=async()=>{};f.game.isShore=()=>true;
  f.game.x=tile=>tile;f.game.y=()=>0;
  f.player.borderTiles=()=>new Set([1,2]);target.borderTiles=()=>new Set([10,20,30]);
  f.player.bestTransportShipSpawn=async()=>1;f.player.unitCount=()=>0;
  f.actor.openingVetoes=()=>false;f.actor.shouldAttack=()=>true;
  f.player.sharesBorderWith=()=>false;f.actor.hasLandBorderWithTerraNullius=()=>false;
  return target;
}
function setupFreeBoat(f) {
  const target=setupTargetedBoat(f);target.isPlayer=()=>false;
  f.context.BOAT_PROBE_CANDIDATES=10;
  Object.assign(f.game,{x:()=>10,y:()=>10,ref:(x,y)=>x*100+y,isValidCoord:()=>true,
    isWater:()=>true,isLand:()=>true,hasOwner:()=>false,hasFallout:()=>false});
  f.player.borderTiles=()=>new Set([1]);return target;
}
for(const domain of ['free-boat-site','free-boat-allocation'])test(`central ${domain} hold stops free-land boat`,async()=>{
  const base=createLegacyStrategy(),policy={id:'free-hold',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:'$wait',reason:'hold free boat'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupFreeBoat(f);
  f.attach();f.runtime.select(policy.id);assert.equal(await f.actor.sendAttack(target),false);
  assert.equal(f.commands.length,0);
});
test('free-land boat ancestry stays under its route and clears after awaits',async()=>{
  const f=fixture(instrumented,'AttackBehavior'),target=setupFreeBoat(f);f.attach();await f.actor.sendAttack(target);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const route=ds.find(d=>d.snapshot.domain==='attack-route'),site=ds.find(d=>d.snapshot.domain==='free-boat-site');
  const amount=ds.find(d=>d.snapshot.domain==='free-boat-allocation'),command=ds.at(-1);
  assert.equal(site.snapshot.parentDecisionId,route.decisionId);assert.equal(amount.snapshot.parentDecisionId,site.decisionId);
  assert.equal(command.candidates[0].parentDecisionId,amount.decisionId);
  f.actor.forceSendAttack(target);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='forced-allocation').at(-1).snapshot.parentDecisionId,undefined);
});
for(const mode of ['success','first-unreachable','all-unreachable','probe-min','emit-false'])test(`nearby free-land boat parity: ${mode}`,async()=>{
  await parity('AttackBehavior',async f=>{
    const target=setupFreeBoat(f);let probes=0;
    f.player.bestTransportShipSpawn=async tile=>{probes++;return mode==='all-unreachable'||mode==='first-unreachable'&&probes===1?false:1;};
    if(mode==='probe-min')f.state.settings.winFixes=true;
    f.attach();const result=await f.actor.sendAttack(target);
    f.commands.push({kind:'result',result,probes});
  },{emitReturn:mode!=='emit-false'});
});
for(const domain of ['attack-route','targeted-boat-site','targeted-boat-allocation']) {
  test(`central ${domain} hold stops targeted boat`,async()=>{
    const base=createLegacyStrategy(),policy={id:'route-hold',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'hold boat'}:base.decide(s,cs);
    }};
    const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupTargetedBoat(f,'Bot');
    f.attach();f.runtime.select(policy.id);const result=await f.actor.sendAttack(target);
    assert.equal(result,false);assert.equal(f.commands.length,0);assert.equal(f.actor.botAttackTroopsSent,20);
    assert.ok(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain===domain));
  });
}
test('targeted boat policy selects an alternative shore and smaller force',async()=>{
  const base=createLegacyStrategy(),policy={id:'other-boat',version:'1',decide(s,cs){
    return ['targeted-boat-site','targeted-boat-allocation'].includes(s.domain)?
      {selectedId:cs[1].id,reason:'alternate shore and force'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupTargetedBoat(f);
  f.attach();f.runtime.select(policy.id);await f.actor.sendAttack(target);
  assert.deepEqual(f.result().commands,[{kind:'boat',args:[20,150]}]);
});
test('route policy can select a boat for a bordering player',async()=>{
  const base=createLegacyStrategy(),policy={id:'boat-route',version:'1',decide(s,cs){
    return s.domain==='attack-route'?{selectedId:cs.find(c=>c.route==='targeted-boat').id,reason:'boat route'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupTargetedBoat(f);
  f.player.sharesBorderWith=()=>true;f.attach();f.runtime.select(policy.id);await f.actor.sendAttack(target);
  assert.equal(f.commands[0].kind,'boat');
});
test('overlapping targeted boat holds do not erase another allocation',async()=>{
  const base=createLegacyStrategy();const policy={id:'one-boat-hold',version:'1',decide(s,cs){
    return s.domain==='targeted-boat-allocation'&&s.routing.tile===20?
      {selectedId:'$wait',reason:'hold second boat'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),first=setupTargetedBoat(f,'Bot');
  const second={...first,id:()=> 'second',borderTiles:()=>new Set([20])};first.borderTiles=()=>new Set([10]);
  let release;const pending=new Promise(resolve=>{release=resolve;});
  f.player.bestTransportShipSpawn=tile=>tile===20?pending:Promise.resolve(1);
  f.attach();f.runtime.select(policy.id);
  const held=f.actor.sendBoatAttack(second);await f.actor.sendBoatAttack(first);release(1);await held;
  assert.equal(f.actor.botAttackTroopsSent,100);assert.equal(f.commands.length,1);
});
test('targeted boat parent IDs survive overlapping probe completions',async()=>{
  const f=fixture(instrumented,'AttackBehavior'),first=setupTargetedBoat(f);
  const second={...first,id:()=> 'second',borderTiles:()=>new Set([20])};first.borderTiles=()=>new Set([10]);
  let release;const pending=new Promise(resolve=>{release=resolve;});
  f.player.bestTransportShipSpawn=tile=>tile===20?pending:Promise.resolve(1);f.attach();
  const later=f.actor.sendAttack(second);await f.actor.sendAttack(first);release(1);await later;
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'),routes=ds.filter(d=>d.snapshot.domain==='attack-route');
  for(const tile of [10,20]){
    const site=ds.find(d=>d.snapshot.domain==='targeted-boat-site'&&d.candidates[0].tile===tile);
    const amount=ds.find(d=>d.snapshot.domain==='targeted-boat-allocation'&&d.snapshot.routing.tile===tile);
    const command=ds.find(d=>d.candidates[0].kind==='boat'&&d.candidates[0].parentDecisionId===amount.decisionId);
    assert.equal(site.snapshot.parentDecisionId,routes[tile===20?0:1].decisionId);
    assert.equal(amount.snapshot.parentDecisionId,site.decisionId);assert.ok(command);
  }
  f.actor.forceSendAttack(first);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='forced-allocation').at(-1).snapshot.parentDecisionId,undefined);
});
for(const mode of ['border-load','probe'])test(`stale targeted boat stops after ${mode}`,async()=>{
  let current=true;const f=fixture(instrumented,'AttackBehavior',{current:()=>current}),target=setupTargetedBoat(f);
  let probes=0;f.player.bestTransportShipSpawn=async()=>{probes++;if(mode==='probe')current=false;return 1;};
  f.game.ensureBorderTiles=async()=>{if(mode==='border-load')current=false;};
  f.attach();assert.equal(await f.actor.sendAttack(target),false);assert.equal(f.commands.length,0);
  assert.equal(probes,mode==='probe'?1:0);assert.equal(f.actor.botAttackTroopsSent,20);
});
test('original targeted shore failure does not try alternatives or land routing',async()=>{
  const f=fixture(instrumented,'AttackBehavior'),target=setupTargetedBoat(f);let probes=0;
  f.player.bestTransportShipSpawn=async()=>{probes++;return false;};f.attach();
  assert.equal(await f.actor.sendAttack(target),false);assert.equal(probes,1);assert.equal(f.commands.length,0);
});
for(const mode of ['hold','error','invalid','command-hold','emit-false','boat-cap'])test(`targeted bot budget on ${mode}`,async()=>{
  const base=createLegacyStrategy(),policy={id:'target-budget',version:'1',decide(s,cs){
    if(s.domain==='targeted-boat-allocation'){
      if(mode==='error')throw Error('target policy');
      if(mode==='hold'||mode==='invalid')return {selectedId:mode==='hold'?'$wait':'missing',reason:'hold'};
    }
    if(mode==='command-hold'&&cs[0].kind==='boat')return {selectedId:'$wait',reason:'hold command'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy],emitReturn:mode!=='emit-false'}),target=setupTargetedBoat(f,'Bot');
  if(mode==='boat-cap')f.player.unitCount=()=>3;
  f.attach();f.runtime.select(policy.id);assert.equal(await f.actor.sendAttack(target),false);
  assert.equal(f.actor.botAttackTroopsSent,['emit-false','boat-cap'].includes(mode)?100:20);
  assert.equal(f.commands.length,mode==='emit-false'?1:0);
});
test('targeted bot alternatives preserve the two-times-defender minimum',async()=>{
  let candidates;const base=createLegacyStrategy(),policy={id:'target-floor',version:'1',decide(s,cs){
    if(s.domain==='targeted-boat-allocation')candidates=cs;
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupTargetedBoat(f,'Bot');
  target.troops=()=>80;f.attach();f.runtime.select(policy.id);await f.actor.sendBoatAttack(target);
  assert.equal(f.commands[0].args[1],200);assert.equal(candidates[1].eligible,false);assert.equal(candidates[2].eligible,false);
});
test('targeted destination candidates are bounded and retain original winner',async()=>{
  const f=fixture(instrumented,'AttackBehavior'),target=setupTargetedBoat(f);
  target.borderTiles=()=>new Set(Array.from({length:200},(_,i)=>i+10));
  f.context.closestTwoTiles=()=>({x:1,y:209});f.attach();await f.actor.sendBoatAttack(target);
  const site=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='targeted-boat-site');
  assert.equal(site.candidates.length,80);assert.equal(site.candidates[0].tile,209);assert.equal(f.commands[0].args[0],209);
});
test('targeted allocation hold stops the enclosing bot wave and resets next call',async()=>{
  const base=createLegacyStrategy(),policy={id:'target-wave-hold',version:'1',decide(s,cs){
    return s.domain==='targeted-boat-allocation'?{selectedId:'$wait',reason:'hold wave'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupTargetedBoat(f,'Bot');
  const second={...target,id:()=> 'second'};
  target.numTilesOwned=second.numTilesOwned=()=>100;target.isAlive=second.isAlive=()=>true;
  Object.assign(f.player,{nearby:()=>[target,second],isFriendly:()=>false});f.actor.getBotAttackMaxParallelism=()=>2;
  f.attach();f.runtime.select(policy.id);assert.equal(await f.actor.attackBots(),false);
  const routes=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='attack-route');
  assert.equal(routes.length,1);assert.equal(f.commands.length,0);assert.equal(f.actor.botAttackTroopsSent,0);
  f.runtime.select('legacy-v1');await f.actor.attackBots();assert.equal(f.commands.length,2);
});
for(const player of [true,false])for(const border of [true,false])for(const counter of [true,false])test(`attack routing parity: player=${player}/border=${border}/counter=${counter}`,async()=>{
  await parity('AttackBehavior',async f=>{
    const target=setupTargetedBoat(f);target.isPlayer=()=>player;
    f.player.sharesBorderWith=()=>border;f.actor.hasLandBorderWithTerraNullius=()=>border;
    f.actor.sendBoatAttackToNearbyTerraNullius=async()=>{f.commands.push({kind:'nearby-route'});return true;};
    f.attach();const result=await f.actor.sendAttack(target,false,counter);f.commands.push({kind:'route-result',result});
  });
});
for(const mode of ['success','disabled','feature-off','no-shore','unreachable','boat-cap','cap-throws','missing-ctor','emit-false','bot','bot-zero','probe-min','empty']) {
  test(`normal targeted boat baseline parity: ${mode}`,async()=>{
    await parity('AttackBehavior',async f=>{
      const target=setupTargetedBoat(f,mode.startsWith('bot')?'Bot':'Human');
      if(mode==='disabled')f.game.config().isUnitDisabled=()=>true;
      if(mode==='feature-off')f.state.settings.features.boat=false;
      if(mode==='no-shore')f.game.isShore=()=>false;
      if(mode==='unreachable')f.player.bestTransportShipSpawn=async()=>false;
      if(mode==='boat-cap')f.player.unitCount=()=>3;
      if(mode==='cap-throws')f.player.unitCount=()=>{throw Error('cap');};
      if(mode==='missing-ctor')delete f.context.discoverCtors().boat;
      if(mode==='bot-zero')target.troops=()=>200;
      if(mode==='probe-min')f.state.settings.winFixes=true;
      if(mode==='empty')f.player.troops=()=>0;
      f.attach();const result=await f.actor.sendBoatAttack(target);
      f.commands.push({kind:'result',result,budget:f.actor.botAttackTroopsSent});
    },{emitReturn:mode!=='emit-false'});
  });
}
for(const mode of ['opening-free','opening-bots','opening-threat','built-bot','gentle','combat','counter-cap','minimum','empty','bot-zero']) {
  test(`land reserve and force gate parity: ${mode}`,async()=>{
    await parity('AttackBehavior',f=>{
      const target=setupLandAllocation(f,mode.includes('bot')?'Bot':'Human',mode==='bot-zero'?600:100);
      if(mode==='opening-free'){target.isPlayer=()=>false;f.actor.freeLandShare=()=>.01;}
      if(mode.startsWith('opening'))f.state.settings.phasedOpening=true;
      if(mode==='opening-bots')f.actor.borderingBotCount=()=>1;
      if(mode==='opening-threat'){target.isPlayer=()=>false;f.actor.underThreat=()=>true;}
      if(mode==='built-bot')target.units=()=>[{type:()=> 'City'}];
      if(mode==='gentle')f.state.settings.gentleNeighbors=true;
      if(mode==='combat'){target.isPlayer=()=>false;f.state.settings.combatReserve=true;f.actor.underThreat=()=>true;}
      if(mode==='counter-cap'){f.state.settings.combatReserve=true;f.state.settings.counterKeepFrac=.8;}
      if(mode==='minimum'){f.state.settings.minAttackForce=true;f.state.settings.minAttackFrac=.8;}
      if(mode==='empty')f.player.troops=()=>100;
      f.attach();const result=f.actor.sendLandAttack(target,mode==='counter-cap');
      f.commands.push({kind:'result',result,budget:f.actor.botAttackTroopsSent});
    });
  });
}
for(const mode of ['hold','error','command-hold','emit-false'])test(`bot budget on land allocation ${mode}`,()=>{
  const base=createLegacyStrategy();
  const policy={id:'budget-policy',version:'1',decide(s,cs){
    if(s.domain==='land-allocation'&&mode==='error')throw Error('allocation broken');
    if(s.domain==='land-allocation'&&mode==='hold'||mode==='command-hold'&&cs[0].kind==='attack')
      return {selectedId:'$wait',reason:'hold'};
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy],emitReturn:mode!=='emit-false'});
  const target=setupLandAllocation(f,'Bot');f.attach();f.runtime.select(policy.id);
  const result=f.actor.sendLandAttack(target);assert.equal(result,false);
  assert.equal(f.actor.botAttackTroopsSent,mode==='emit-false'?420:20);
  assert.equal(f.commands.length,mode==='emit-false'?1:0);
});
test('land allocation links reserve, bot amount and command decisions and replays',()=>{
  const f=fixture(instrumented,'AttackBehavior'),target=setupLandAllocation(f,'Bot');f.attach();f.actor.sendLandAttack(target);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  const reserve=ds.find(d=>d.snapshot.domain==='land-reserve'),bot=ds.find(d=>d.snapshot.domain==='bot-allocation');
  const amount=ds.find(d=>d.snapshot.domain==='land-allocation'),command=ds.find(d=>d.candidates[0].kind==='attack');
  assert.equal(bot.snapshot.parentDecisionId,reserve.decisionId);
  assert.equal(amount.snapshot.parentDecisionId,reserve.decisionId);
  assert.equal(command.candidates[0].parentDecisionId,amount.decisionId);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
test('land reserve policy can keep more troops',()=>{
  const base=createLegacyStrategy();const policy={id:'reserve-more',version:'1',decide(s,cs){
    return s.domain==='land-reserve'?{selectedId:cs[1].id,reason:'keep more'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupLandAllocation(f);
  f.attach();f.runtime.select(policy.id);f.actor.sendLandAttack(target);assert.equal(f.commands[0].args[1],500);
});
test('bot amount policy can select a smaller viable force',()=>{
  const base=createLegacyStrategy();const policy={id:'bot-smaller',version:'1',decide(s,cs){
    return s.domain==='bot-allocation'?{selectedId:cs[1].id,reason:'keep more'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupLandAllocation(f,'Bot');
  f.attach();f.runtime.select(policy.id);f.actor.sendLandAttack(target);
  assert.equal(f.commands[0].args[1],300);assert.equal(f.actor.botAttackTroopsSent,320);
});
test('Easy bot allocation preserves the original no-defender-read behavior',async()=>{
  await parity('AttackBehavior',f=>{
    const target=setupLandAllocation(f,'Bot');target.troops=()=>{throw Error('unused defender troops');};
    f.context.currentDifficulty=()=> 'Easy';f.attach();
    const amount=f.actor.calculateBotAttackTroops(target,300);
    f.commands.push({kind:'result',amount,budget:f.actor.botAttackTroopsSent});
  });
});
test('allocation hold stops a directly called bot wave and clears for the next wave',async()=>{
  const base=createLegacyStrategy();let choices=0;
  const policy={id:'wave-hold',version:'1',decide(s,cs){
    if(s.domain==='land-allocation'){choices++;return {selectedId:'$wait',reason:'hold wave'};}
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]});
  const target=setupLandAllocation(f,'Bot',10),second={...target,id:()=> 'second'};
  target.numTilesOwned=second.numTilesOwned=()=>100;target.isAlive=second.isAlive=()=>true;
  Object.assign(f.player,{nearby:()=>[target,second],isFriendly:()=>false,sharesBorderWith:()=>true});
  f.actor.openingVetoes=()=>false;f.actor.getBotAttackMaxParallelism=()=>2;
  f.attach();f.runtime.select(policy.id);await f.actor.attackBots();
  assert.equal(choices,1);assert.equal(f.commands.length,0);assert.equal(f.actor.botAttackTroopsSent,0);
  f.runtime.select('legacy-v1');await f.actor.attackBots();assert.equal(f.commands.length,2);
});
test('reduced final bot force respects non-Easy viability floor',()=>{
  const base=createLegacyStrategy();let visible;
  const policy={id:'bot-floor',version:'1',decide(s,cs){
    if(s.domain==='land-allocation'){visible=cs;return {selectedId:cs[0].id,reason:'original'};}
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'AttackBehavior',{strategies:[policy]}),target=setupLandAllocation(f,'Bot',100);
  f.player.troops=()=>570;f.attach();f.runtime.select(policy.id);f.actor.sendLandAttack(target);
  assert.equal(f.commands[0].args[1],250);
  assert.equal(visible[1].eligible,false);assert.equal(visible[2].eligible,false);
});
for(const domain of ['land-reserve','land-allocation','bot-allocation','forced-allocation']) {
  test(`central ${domain} hold prevents attack and budget consumption`,()=>{
    const base=createLegacyStrategy();
    const f=fixture(instrumented,'AttackBehavior',{strategies:[{id:'allocation-hold',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'hold allocation'}:base.decide(s,cs);
    }}]});
    const target=setupLandAllocation(f,domain==='bot-allocation'?'Bot':'Human');f.attach();f.runtime.select('allocation-hold');
    if(domain==='forced-allocation')f.actor.forceSendAttack(target);else f.actor.sendLandAttack(target);
    assert.equal(f.commands.length,0);assert.equal(f.actor.botAttackTroopsSent,20);
    assert.ok(f.runtime.inspect().records.some(e=>e.kind==='decision'&&e.snapshot.domain===domain));
  });
}
for(const domain of ['land-allocation','forced-allocation'])test(`central ${domain} can choose smaller amount`,()=>{
  const base=createLegacyStrategy();
  const f=fixture(instrumented,'AttackBehavior',{strategies:[{id:'smaller',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:cs.find(c=>c.priority===1&&c.eligible).id,reason:'smaller force'}:base.decide(s,cs);
  }}]});
  const target=setupLandAllocation(f);f.attach();f.runtime.select('smaller');
  if(domain==='forced-allocation')f.actor.forceSendAttack(target);else f.actor.sendLandAttack(target);
  assert.equal(f.commands[0].args[1],domain==='forced-allocation'?375:525);
});
for(const type of ['Human','Bot','land'])for(const counter of [false,true])for(const emitReturn of [true,false]) {
  test(`land allocation parity ${type}/counter=${counter}/emit=${emitReturn}`,async()=>{
    await parity('AttackBehavior',f=>{const target=setupLandAllocation(f,type);
      if(type==='land')target.isPlayer=()=>false;
      f.attach();const result=f.actor.sendLandAttack(target,counter);
      f.commands.push({kind:'result',result,budget:f.actor.botAttackTroopsSent});
    },{emitReturn});
  });
}

for (const difficulty of ['Easy', 'Medium', 'Hard', 'Impossible']) {
  for (const emits of [true, false]) test(`bot wave matches original troop allocation: ${difficulty}, emit=${emits}`, async () => {
    await parity('AttackBehavior', async f => {
      const enemies = [
        ['plain', 10, 100, false], ['city-dense', 100, 100, true],
        ['city-weak', 30, 100, true], ['tie', 30, 100, true], ['last', 50, 100, false]
      ].map(([id, troops, tiles, built]) => ({ id: () => id, isPlayer: () => true, type: () => 'Bot',
        troops: () => troops, numTilesOwned: () => tiles, isAlive: () => true,
        units: () => built ? [{ type: () => 'City' }] : [] }));
      f.context.currentDifficulty = () => difficulty;
      const config = f.game.config(); config.maxTroops = () => 1000;
      f.game.config = () => config;
      Object.assign(f.player, { nearby: () => enemies, isFriendly: () => false,
        type: () => 'Human', sharesBorderWith: () => true });
      Object.assign(f.actor, { botAttackTroopsSent: 999, expandRatio: 0.1,
        effectiveReserveRatio: () => 0.3, openingVetoes: () => false });
      f.actor.random.chance = n => { f.commands.push({ kind: 'random', n }); return true; };
      f.attach();
      const result = await f.actor.attackBots();
      f.commands.push({ kind: 'wave-result', result, counter: f.actor.botAttackTroopsSent });
    }, { emitReturn: emits });
  });
}

for (const count of [0, 105]) test(`original bot wave attempt count preserved for ${count} targets`, async () => {
  await parity('AttackBehavior', async f => {
    const enemies = Array.from({ length: count }, (_, i) => ({ id: () => String(i), isPlayer: () => true,
      type: () => 'Bot', troops: () => 1, numTilesOwned: () => 10, units: () => [], isAlive: () => true }));
    Object.assign(f.player, { nearby: () => enemies, isFriendly: () => false });
    f.actor.botAttackTroopsSent = 123;
    f.actor.sendAttack = async target => { f.commands.push({ kind: 'attempt', target: target.id() }); return false; };
    f.attach(); const result = await f.actor.attackBots();
    f.commands.push({ kind: 'wave-result', result, counter: f.actor.botAttackTroopsSent });
  });
});
test('spawn at tile zero preserves original flags and command', async () => {
  await parity('NationBot', f => {
    f.actor.pickSpawnCenter = () => 0; f.actor.spawnExecAdded = false;
    f.actor.doSpawn(); assert.equal(f.actor.spawnExecAdded, true); assert.equal(f.actor.lastSpawnTile, 0);
  });
});
test('a strategy veto of spawn does not record it as spawned', () => {
  const f = fixture(instrumented, 'NationBot');
  // Use a runtime with an installed wait policy to test the real rewritten dispatch site.
  const holdRuntime = createRuntime({ createEngine, createLegacyStrategy, isCurrent: () => true,
    spawnPlanner: require('../src/brain/spawn-planner')({settings:()=>f.state.settings}),
    isPublic: () => false, enabled: () => true, settings: () => f.state.settings,
    emitIntent: () => { throw new Error('must not dispatch'); },
    strategies: [{ id: 'hold', version: '1', decide: () => ({ selectedId: null, reason: 'Wait' }) }] });
  f.context.ofhBrainRuntime = holdRuntime;
  holdRuntime.attach(f.actor); holdRuntime.begin(f.actor); holdRuntime.select('hold');
  f.actor.pickSpawnCenter = () => 0; f.actor.spawnExecAdded = false;
  f.actor.doSpawn(); assert.equal(f.actor.spawnExecAdded, false); assert.equal(f.state.stats.spawns, 0);
});
for (const coastal of [true, false]) test(`original building priorities are preserved (${coastal ? 'coastal' : 'landlocked'})`, async () => {
  const result = await parity('StructureBehavior', async f => {
    Object.assign(f.actor, { placementsCount: 1, ownedLevels: type => type === UNIT.City ? 3 : 0,
      hasHighStartingGold: () => false, isHighNationDensity: () => false,
      shouldBuildStructure: () => true, getPerceivedCost: () => 100n, getTotalStructureDensity: () => 0,
      structureSpawnTile: async type => ({ type, cost: 100n, canBuild: 9, canUpgrade: false }) });
    f.attach(); assert.equal(await f.actor.doHandleStructures(), true);
  }, { coastal });
  assert.equal(result.commands[0].args[0].type, coastal ? UNIT.Port : UNIT.Factory);
});

for (const scenario of [
  { name: 'all placements fail' },
  { name: 'first high-gold SAM fails before normal structures', first: true, highGold: true },
  { name: 'dense coastal opening', dense: true, cities: 0 },
  { name: 'dense landlocked opening', dense: true, cities: 0, coastal: false },
  { name: 'SAM threat priority', samDefense: true },
  { name: 'all nuclear weapons disabled', disabled: ['AtomBomb', 'HydrogenBomb', 'MIRV'] },
  { name: 'silos disabled', disabled: ['MissileSilo'] },
  { name: 'cities disabled', disabled: ['City'] },
  { name: 'all structure targets met', ratios: false },
  { name: 'port disabled in dense opening', dense: true, cities: 0, disabled: ['Port'] },
  { name: 'successful city fallback', success: 'City' }
]) test(`batch planning matches original attempts: ${scenario.name}`, async () => {
  await parity('StructureBehavior', async f => {
    const config = f.game.config(); config.isUnitDisabled = type => (scenario.disabled || []).includes(type);
    f.game.config = () => config;
    f.state.settings.samDefense = !!scenario.samDefense;
    Object.assign(f.actor, { placementsCount: scenario.first ? 0 : 1,
      ownedLevels: type => type === UNIT.City ? scenario.cities ?? 3 : 0,
      hasHighStartingGold: () => !!scenario.highGold, isHighNationDensity: () => !!scenario.dense,
      samThreatLevels: () => 1, shouldBuildStructure: () => scenario.ratios !== false,
      maybeSpawnStructure: async type => { f.commands.push({ kind: 'attempt', type }); return type === scenario.success; } });
    f.attach(); await f.actor.doHandleStructures();
    for (const row of f.runtime.replay('legacy-v1', f.runtime.inspect())) assert.equal(row.sameChoice, true);
  }, { coastal: scenario.coastal });
});
for (const initiallyNeeded of [true, false]) test(`live factory target change matches original (${initiallyNeeded})`, async () => {
  await parity('StructureBehavior', async f => {
    let factoryNeeded = initiallyNeeded;
    Object.assign(f.actor, { placementsCount: 1, ownedLevels: type => type === UNIT.City ? 3 : 0,
      hasHighStartingGold: () => false, isHighNationDensity: () => false,
      shouldBuildStructure: type => type === UNIT.Port || type === UNIT.Factory && factoryNeeded,
      maybeSpawnStructure: async type => {
        f.commands.push({ kind: 'attempt', type });
        if (type === UNIT.Port) { await Promise.resolve(); factoryNeeded = !initiallyNeeded; return false; }
        return true;
      } });
    f.attach(); await f.actor.doHandleStructures();
  });
});

for (const scenario of [
  {emergency:true}, {emergency:true,timing:true,normal:true}, {emergency:true,defense:true},
  {optional:true,defense:true}, {normal:true}, {cooldown:true,optional:true}, {saveBlocked:true,optional:true}
]) test(`building phases match original outcomes: ${JSON.stringify(scenario)}`, async () => {
  await parity('StructureBehavior',async f => {
    f.state.settings.defensePosts=!!scenario.optional;
    Object.assign(f.actor,{placementsCount:1,defensePostNeeded:()=>!!scenario.emergency,
      isOnStructureCooldown:()=>!!scenario.cooldown,isInPostSaveUpBlockedPhase:()=>!!scenario.saveBlocked,
      tryBuildDefensePost:async()=>{f.commands.push({kind:'defense'});f.actor.dpDeclinedOnTiming=!!scenario.timing;return !!scenario.defense;},
      doHandleStructures:async()=>{f.commands.push({kind:'normal'});return !!scenario.normal;}});
    f.attach();const result=await f.actor.handleStructures();
    f.commands.push({kind:'outcome',result,count:f.actor.placementsCount,tick:f.actor.lastStructureTick});
  });
});
for (const scenario of ['dense-fail','dense-success','sparse','empty']) test(`upgrade versus new build matches original: ${scenario}`,async()=> {
  await parity('StructureBehavior',async f => {
    const originalUnits=f.player.units;
    f.player.units=type=>type===UNIT.City && scenario!=='empty' ? [{type:()=>UNIT.City}] : originalUnits(type);
    Object.assign(f.actor,{getPerceivedCost:()=>100n,getTotalStructureDensity:()=>scenario==='sparse'?0:1,
      maybeUpgradeStructure:async()=>{f.commands.push({kind:'upgrade'});return scenario==='dense-success';},
      structureSpawnTile:async()=>({type:UNIT.City,canBuild:5})});
    f.attach();f.commands.push({kind:'outcome',result:await f.actor.maybeSpawnStructure(UNIT.City)});
  });
});
test('upgrades preserve the original one-argument build-menu call', async () => {
  const result = await parity('StructureBehavior', async f => {
    const structure = { type: () => UNIT.City };
    Object.assign(f.actor, { getTotalStructureDensity: () => 1,
      findBestStructureToUpgrade: async () => ({ structure, bu: { type: UNIT.City, cost: 100n, canUpgrade: 1, canBuild: false } }) });
    f.attach(); assert.equal(await f.actor.maybeUpgradeStructure([structure]), true);
  });
  assert.equal(result.commands[0].args.length, 1);
});
for (const mode of ['coverage','random','sam-value']) test(`upgrade ranking matches original score and RNG cadence: ${mode}`,async()=> {
  await parity('StructureBehavior',async f => {
    const unit=(id,tile,type=UNIT.City,level=1)=>({id:()=>id,tile:()=>tile,type:()=>type,level:()=>level});
    const economic=[unit('a',1),unit('b',9,UNIT.Factory,3)];
    const sams=[unit('s1',1,UNIT.SAMLauncher),unit('s2',9,UNIT.SAMLauncher,2)];
    const units=mode==='sam-value'?sams:economic;
    f.state.settings.samDefense=mode==='sam-value';
    const config=f.game.config();config.samRange=()=>2;f.game.config=()=>config;
    f.game.euclideanDistSquared=(a,b)=>(a-b)**2;
    f.player.units=(...types)=>types.includes(UNIT.SAMLauncher)?sams:economic;
    f.context.currentDifficulty=()=>mode==='random'?'Easy':'Impossible';
    f.context.samProtectWeight=()=>1;
    Object.assign(f.actor,{random:{nextInt:(a,b)=>{f.commands.push({kind:'rng',a,b});return 0;},
      randElement:items=>{f.commands.push({kind:'random-choice',size:items.length});return items.at(-1);}},
      buildableFor:async(type,tile)=>{f.commands.push({kind:'probe',type,tile});return {canUpgrade:true};}});
    f.attach();const target=await f.actor.findBestStructureToUpgrade(units);
    f.commands.push({kind:'winner',id:target.structure.id()});
  });
});
test('nuke dispatch preserves target, temporary arc setting and counters', async () => {
  const result = await parity('NukeBehavior', async f => {
    Object.assign(f.actor, { recentlySentNukes: [], atomBombsLaunched: 0, atomBombPerceivedCost: 100n });
    f.attach(); await f.actor.sendNuke(5, UNIT.AtomBomb, { id: () => 'enemy' }, 0, false, false);
    assert.equal(f.menu.uiState.rocketDirectionUp, true);
    assert.equal(f.actor.atomBombsLaunched, 1);
  });
  assert.equal(result.commands[0].arc, false); assert.equal(result.stats.nukes, 1);
});
test('warship deployment preserves the original quote and random gate', async () => {
  const result = await parity('WarshipBehavior', async f => {
    Object.assign(f.actor, { cost: () => 100n, warshipSpawnTile: () => 4,
      buildableWarship: async tile => ({ type: UNIT.Warship, canBuild: tile, cost: 100n }) });
    f.attach(); assert.equal(await f.actor.maybeSpawnWarship(), true);
  });
  assert.equal(result.commands[0].args[0].type, UNIT.Warship);
});
test('MIRV dispatch preserves its original target and bookkeeping', async () => {
  const result = await parity('MirvBehavior', async f => {
    Object.assign(f.actor, { calculateTerritoryCenter: async () => 8, recordMirvHit() {} });
    f.attach(); await f.actor.maybeSendMIRV({ id: () => 'enemy' });
  });
  assert.equal(result.stats.nukes, 1); assert.equal(result.commands[0].args[1], 8);
});

function geographyPlayer(id, troops = 20, border = [id * 10]) {
  return { id: () => `p${id}`, smallID: () => id, isPlayer: () => true, isAlive: () => true,
    troops: () => troops, numTilesOwned: () => troops, borderTiles: () => new Set(border) };
}

async function pocketGeographyTrace(source, cached = false) {
  const f = fixture(source, 'AttackBehavior'), calls = [];
  const a = geographyPlayer(2, 20, [20]), b = geographyPlayer(3, 20, [30]);
  const neighbors = new Map([[20,[201,202,203]], [30,[301,302,303,304]]]);
  const owners = new Map([[201,1],[202,1],[301,1],[302,1],[303,1]]);
  f.state.settings.encircleMaxShare = .1; f.state.settings.encircleMinSealShare = .6;
  Object.assign(f.player, { nearby: () => [a,b], isFriendly: () => false });
  Object.assign(f.game, { numLandTiles: () => 1000, width: () => 100, height: () => 100,
    playerBySmallID: id => [a,b].find(player => player.smallID() === id),
    ensureBorderTiles: async player => calls.push(`border:${player.smallID()}`),
    isShore: () => false, x: () => 10, y: () => 10,
    neighbors: tile => neighbors.get(tile), isLand: () => true,
    hasOwner: tile => owners.has(tile), ownerID: tile => owners.get(tile) });
  if (cached) Object.assign(f.actor, { _pocketTick:1, _pocketSid:2 });
  f.attach();
  const selected = await f.actor.findSealablePocket();
  return { target:selected?.id() ?? null, calls, tick:f.actor._pocketTick, sid:f.actor._pocketSid };
}

test('pocket geography preserves winner, border order, cache state, and cache hits', async () => {
  for (const cached of [false,true]) {
    const traces = await Promise.all([original,instrumented].map(source => pocketGeographyTrace(source,cached)));
    assert.deepEqual(traces[1], traces[0]);
  }
});

async function islandGeographyTrace(source, probeResults, dynamicShore = false) {
  const f = fixture(source, 'AttackBehavior'), calls = []; let borderReads = 0;
  const a = geographyPlayer(2, 20, [20]), b = geographyPlayer(3, 20, [30]);
  Object.assign(f.player, { troops: () => 100, unitCount: () => 0,
    borderTiles: () => new Set([dynamicShore && ++borderReads > 1 ? 9 : 1]),
    isFriendly: () => false, bestTransportShipSpawn: async tile => { calls.push(`probe:${tile}`); return probeResults.get(tile); } });
  Object.assign(f.game, { players: () => [f.player,a,b], isShore: tile => [1,9,20,30].includes(tile),
    ref: (x,y) => `${x},${y}`, manhattanDist: (x,y) => Math.abs(Number(x.split(',')[0])-Number(y.split(',')[0])),
    ensureBorderTiles: async player => calls.push(`border:${player.smallID()}`),
    config: () => ({ isUnitDisabled: () => false, boatMaxNumber: () => 5,
      gameConfig: () => ({ gameMode:'FFA', difficulty:'Impossible' }) }) });
  f.actor.getPlayerCenter = player => ({ x:player.smallID()*10, y:0 });
  f.context.closestTwoTiles = (_game, own, theirs) => {
    calls.push(`source:${own[0]}`); return own.length && theirs.length ? { x:own[0], y:theirs[0] } : null;
  };
  f.attach();
  const selected = await f.actor.findNearestIslandEnemy();
  return { target:selected?.id() ?? null, calls, borderReads };
}

test('island geography preserves distance, failed probes, and two-reachable scan limit', async () => {
  for (const probes of [new Map([[20,true],[30,true]]), new Map([[20,false],[30,true]])]) {
    const traces = await Promise.all([original,instrumented].map(source => islandGeographyTrace(source,probes)));
    assert.deepEqual(traces[1], traces[0]);
  }
  const dynamic = await Promise.all([original,instrumented].map(source =>
    islandGeographyTrace(source,new Map([[20,true],[30,true]]),true)));
  assert.deepEqual(dynamic[1],dynamic[0]);
  assert.equal(dynamic[0].borderReads,2);
  assert.ok(dynamic[0].calls.includes('source:9'));
});

for (const tick of [10, 30]) test(`original bot scheduling is preserved at tick ${tick}`, async () => {
  const traces = [];
  for (const source of [original, instrumented]) {
    const f = fixture(source, 'NationBot'); const calls = [];
    Object.assign(f.actor, { behaviorsInitialized: true, lastSeenTick: 0, attackRate: 30, attackTick: 0,
      updateRelationsFromEmbargos: () => calls.push('relations'),
      structureBehavior: { handleStructures: async () => calls.push('build') },
      emojiBehavior: { maybeSendCasualEmoji: () => calls.push('emoji') },
      allianceBehavior: { handleAllianceRequestsFromBots: () => calls.push('bots'),
        handleAllianceRequests: () => calls.push('alliances'), handleAllianceExtensionRequests: () => calls.push('renew') },
      mirvBehavior: { considerMIRV: async () => calls.push('mirv') },
      attackBehavior: { maybeAttack: async () => calls.push('attack') },
      nukeBehavior: { maybeSendNuke: async () => calls.push('nuke') } });
    f.setTick(tick); await f.actor.tick(tick); traces.push(calls);
  }
  assert.deepEqual(traces[1], traces[0]);
  assert.ok(traces[0].length > 0);
});

async function turnScheduleTrace(source, options = {}) {
  const f = fixture(source, 'NationBot'), calls = [];
  f.context.currentDifficulty = () => 'Hard';
  const enabled = { spawn: true, expand: true, build: true, boat: true, nuke: true, warship: true,
    alliance: true, embargo: true, donate: true, betray: true, ...(options.features || {}) };
  f.state.settings.features = enabled;
  f.state.settings.warshipAutoSpawn = options.warshipAutoSpawn ?? true;
  const phase = (name, value) => async () => {
    calls.push(name);
    if (options.throwPhase === name) throw Error('scheduled failure');
    return value;
  };
  Object.assign(f.actor, { behaviorsInitialized: true, lastSeenTick: (options.tick ?? 30) - 1,
    attackRate: 30, attackTick: 0,
    feat: name => { calls.push(`feat:${name}`); return !!enabled[name]; },
    updateRelationsFromEmbargos: phase('relations'),
    handleEmbargoesToHostileNations: phase('embargo'),
    structureBehavior: { handleStructures: phase('build', false) },
    emojiBehavior: { maybeSendCasualEmoji: phase('emoji') },
    allianceBehavior: { handleAllianceRequestsFromBots: phase('bot-alliances'),
      handleAllianceRequests: phase('alliances'), handleAllianceExtensionRequests: phase('extensions') },
    mirvBehavior: { considerMIRV: phase('mirv', true) },
    warshipBehavior: { maybeSpawnWarship: phase('warship-deploy'),
      counterWarshipInfestation: phase('warship-counter') },
    attackBehavior: { maybeAttack: phase('attack', false) },
    nukeBehavior: { maybeSendNuke: phase('nuke') } });
  const tick = options.tick ?? 30;
  f.setTick(tick); await f.actor.tick(tick);
  return calls;
}

test('turn coordinator preserves full phase and feature-read order', async () => {
  const traces = await Promise.all([original, instrumented].map(source => turnScheduleTrace(source)));
  assert.deepEqual(traces[1], traces[0]);
  assert.deepEqual(traces[0], ['feat:warship', 'emoji', 'relations', 'bot-alliances', 'feat:alliance', 'alliances', 'extensions',
    'feat:nuke', 'mirv', 'feat:build', 'build', 'feat:warship', 'warship-deploy', 'feat:embargo', 'embargo',
    'feat:expand', 'attack', 'feat:warship', 'warship-counter', 'feat:nuke', 'nuke']);
});

test('turn coordinator preserves disabled gates and boat short circuit', async () => {
  const options = { features: { expand: false, build: false, nuke: false, warship: false,
    alliance: false, embargo: false, boat: false } };
  const traces = await Promise.all([original, instrumented].map(source => turnScheduleTrace(source, options)));
  assert.deepEqual(traces[1], traces[0]);
  assert.deepEqual(traces[0], ['feat:warship', 'emoji', 'relations', 'bot-alliances', 'feat:alliance', 'feat:nuke', 'feat:build',
    'feat:warship', 'feat:embargo', 'feat:expand', 'feat:boat', 'feat:warship', 'feat:nuke']);
});

test('turn coordinator preserves build-only cadence and warship setting gates', async () => {
  const buildTraces = await Promise.all([original, instrumented].map(source => turnScheduleTrace(source, { tick: 10 })));
  assert.deepEqual(buildTraces[1], buildTraces[0]);
  assert.deepEqual(buildTraces[0], ['feat:warship', 'feat:build', 'build']);
  const warshipTraces = await Promise.all([original, instrumented].map(source => turnScheduleTrace(source,
    { warshipAutoSpawn: false })));
  assert.deepEqual(warshipTraces[1], warshipTraces[0]);
  assert.equal(warshipTraces[0].includes('warship-deploy'), false);
  assert.equal(warshipTraces[0].includes('warship-counter'), false);
});

test('turn coordinator preserves thrown-phase abort behavior', async () => {
  const traces = await Promise.all([original, instrumented].map(source => turnScheduleTrace(source,
    { throwPhase: 'mirv' })));
  assert.deepEqual(traces[1], traces[0]);
  assert.equal(traces[0].includes('build'), false);
  assert.equal(traces[0].includes('attack'), false);
});

for (const scenario of ['retreat', 'low-evade', 'evade', 'engage', 'trade', 'no-home', 'water-mismatch', 'water-error', 'patrol-boundary', 'cooldown', 'docked', 'disabled', 'feature-off', 'winfix-off', 'no-enemies']) {
  test('original warship combat parity: ' + scenario, async () => {
    await parity('WarshipBehavior', async f => {
      f.state.settings.winFixes = scenario !== 'winfix-off';
      f.state.settings.features.warship = scenario !== 'feature-off';
      f.state.settings.warshipRetreatHealthPct = 75;
      const enemyOwner = { smallID: () => 2, isFriendly: () => false };
      const unit = (id, tile, hp, owner) => ({ id: () => id, tile: () => tile, health: () => hp,
        maxHealth: () => 100, owner: () => owner, isActive: () => true, isUnderConstruction: () => false,
        warshipState: () => ({ state: 'patrolling' }) });
      const own = unit(1, 0, ['retreat','low-evade','no-home'].includes(scenario) ? 74 : 75, f.player);
      own.warshipState = () => ({ state: scenario === 'docked' ? 'docked' : 'patrolling', patrolTile: scenario === 'patrol-boundary' ? 10 : undefined });
      const enemies = ['trade','no-enemies'].includes(scenario) ? [] : [unit(2, 30, 5, enemyOwner), unit(3, 40, 5, enemyOwner)];
      const trades = scenario === 'trade' ? [unit(4, 50, 10, enemyOwner), unit(5, 30, 10, enemyOwner)] : [];
      const ports = scenario === 'no-home' ? [] : [unit(6, 60, 1, f.player)];
      f.player.units = type => type === UNIT.Warship ? [own] : [];
      f.game.units = type => type === UNIT.Warship ? enemies : type === 'TradeShip' ? trades : type === UNIT.Port ? ports : [];
      f.context.UNIT.TradeShip = 'TradeShip';
      f.game.config = () => ({ isUnitDisabled: () => scenario === 'disabled', warshipTargettingRange: () => 130 });
      f.game.manhattanDist = (a,b) => Math.abs(a-b);
      f.game.euclideanDistSquared = (a,b) => (a-b)**2;
      f.game.neighbors = () => [61]; f.game.isWater = () => true;
      f.game.getWaterComponent = tile => { if (scenario === 'water-error') throw Error('missing'); return scenario === 'water-mismatch' ? tile : 1; };
      f.actor.simulateBattle = () => ({ win: !['evade','low-evade'].includes(scenario), survivalPct: 100 });
      f.actor.findSafeWaypoint = () => { f.commands.push({ kind: 'waypoint' }); return 70; };
      f.context.performance = { now: () => 10000 }; f.setTick(100);
      if (scenario === 'cooldown') f.actor.ensureSmartState().cooldown.set(1, 98);
      f.attach(); assert.equal(f.actor.smartWarshipCombat(), undefined);
      f.commands.push({ cooldown: [...f.actor.ensureSmartState().cooldown] });
    });
  });
}
for (const scenario of ['build-trade','build-transport','unbuildable','no-menu','cap','self','easy','medium-pass','medium-fail','hard-pass','hard-fail','probe-throws','build-throws']) {
  test('original retaliation parity: ' + scenario, async () => {
    await parity('WarshipBehavior', async f => {
      const target = { smallID: () => scenario === 'self' ? 1 : 2 };
      f.context.currentDifficulty = () => scenario === 'easy' ? 'Easy' : scenario.startsWith('medium') ? 'Medium' : scenario.startsWith('hard') ? 'Hard' : 'Impossible';
      f.player.units = () => scenario === 'cap' ? Array(10) : [];
      f.actor.random.nextInt = () => { f.commands.push({ kind: 'roll' }); return scenario.endsWith('fail') ? 99 : 0; };
      f.actor.buildableWarship = async () => { f.commands.push({ kind: 'probe' }); if (scenario === 'probe-throws') throw Error('probe'); return scenario === 'unbuildable' ? null : { type: UNIT.Warship, canBuild: 0 }; };
      if (scenario === 'no-menu') f.context.getBuildMenu = () => null;
      if (scenario === 'build-throws') f.menu.sendBuildOrUpgrade = () => { throw Error('build'); };
      f.actor.maybeMoveWarship = tile => f.commands.push({ kind: 'reposition', tile });
      f.actor.emojiBehavior.maybeSendEmoji = () => f.commands.push({ kind: 'emoji' });
      f.player.updateRelation = (target, amount) => f.commands.push({ kind: 'relation', amount });
      f.attach(); assert.equal(f.actor.maybeRetaliateWithWarship(0, target, scenario === 'build-trade' ? 'trade' : 'transport'), undefined);
      await new Promise(setImmediate);
      if (typeof f.actor._retaliateBuildReady === 'function') {
        const expected = { 'build-trade': 'build-attempted', 'build-transport': 'build-attempted', unbuildable: 'fallback-unbuildable', 'no-menu': 'fallback-menu', 'build-throws': 'failed' }[scenario];
        if (expected) assert.ok(f.runtime.inspect().records.some(r => r.kind === 'warship-retaliation-result' && r.outcome === expected), `Missing retaliation outcome: ${expected}`);
      }
    });
  });
}

for (const scenario of ['success','equal-gold','low-gold','no-port','has-ship','chance-fail','disabled','no-site','unbuildable','no-menu','probe-throws','build-throws']) {
  test('initial warship deployment parity: ' + scenario, async () => {
    await parity('WarshipBehavior', async f => {
      f.actor.cost = () => 100n;
      f.player.gold = () => scenario === 'equal-gold' ? 100n : scenario === 'low-gold' ? 99n : 101n;
      f.player.units = type => type === UNIT.Port ? (scenario === 'no-port' ? [] : [{ tile: () => 5 }]) : (scenario === 'has-ship' ? [{}] : []);
      f.game.config = () => ({ isUnitDisabled: () => scenario === 'disabled' });
      f.actor.random.chance = n => { f.commands.push({ kind: 'chance', n }); return scenario !== 'chance-fail'; };
      f.actor.random.randElement = a => { f.commands.push({ kind: 'port-random' }); return a[0]; };
      f.actor.warshipSpawnTile = (tile,radius) => { f.commands.push({ kind: 'site', tile, radius }); return scenario === 'no-site' ? null : 0; };
      f.actor.buildableWarship = async tile => { f.commands.push({ kind: 'probe', tile }); if (scenario === 'probe-throws') throw Error('probe'); return scenario === 'unbuildable' ? { canBuild: false } : { type: UNIT.Warship, canBuild: tile }; };
      if (scenario === 'no-menu') f.context.getBuildMenu = () => null;
      if (scenario === 'build-throws') f.menu.sendBuildOrUpgrade = () => { throw Error('build'); };
      f.attach();
      if (scenario.endsWith('throws')) await assert.rejects(f.actor.maybeSpawnWarship(), /probe|build/);
      else { const result = await f.actor.maybeSpawnWarship(); assert.equal(result, scenario === 'success'); }
    });
  });
}
for (const scenario of ['ffa','ffa-threshold','ffa-friendly','team','team-threshold','team-small-fleets','team-tie','team-no-team','disabled','easy','global-threshold','poor','not-rich','no-port','own-cap','unbuildable','no-menu','probe-throws','build-throws']) {
  test('infestation counter parity: ' + scenario, async () => {
    await parity('WarshipBehavior', async f => {
      const teamGame = scenario.startsWith('team');
      const target = (id,count,team) => ({ id: () => id, team: () => team, type: () => 'Human', gold: () => 0n,
        units: () => Array.from({ length: count }, (_, i) => ({ id: () => id + i, tile: () => id * 100 + i })) });
      let enemies = [target(2, scenario === 'ffa-threshold' ? 10 : 11, null), target(3, scenario === 'ffa-threshold' ? 10 : 20, null)];
      if (teamGame) enemies = scenario === 'team-small-fleets' ? Array.from({ length: 6 }, (_, i) => target(i+2, 3, 'red')) :
        scenario === 'team-no-team' ? [target(2,20,null)] : [target(2,8,'red'), target(3, scenario === 'team-threshold' ? 7 : 8, 'red'), ...(scenario === 'team-threshold' ? [] : [target(4,30,'green')])];
      f.player.team = () => teamGame ? 'own' : null;
      f.player.type = () => 'Nation'; f.player.gold = () => scenario === 'poor' ? 99n : 100n;
      f.player.isFriendly = p => scenario === 'ffa-friendly' && p.id() === 2;
      f.player.units = type => type === UNIT.Port ? (scenario === 'no-port' ? [] : [{}]) : (scenario === 'own-cap' ? Array(10) : []);
      f.actor.cost = () => 100n; f.game.unitCount = () => scenario === 'global-threshold' ? 10 : 11;
      f.game.config = () => ({ isUnitDisabled: () => scenario === 'disabled' });
      f.context.currentDifficulty = () => scenario === 'easy' ? 'Easy' : 'Impossible';
      const richer = scenario === 'not-rich' ? Array.from({ length: 3 }, (_, i) => ({ ...target(10+i,0,null), type: () => 'Nation', gold: () => 200n })) : [];
      f.game.players = () => [f.player, ...enemies, ...richer];
      f.actor.random.randElement = a => { f.commands.push({ kind: 'ship-random', first: a[0].id() }); return a[0]; };
      f.actor.buildableWarship = async tile => { f.commands.push({ kind: 'probe', tile }); if (scenario === 'probe-throws') throw Error('probe'); return scenario === 'unbuildable' ? null : { type: UNIT.Warship, canBuild: tile }; };
      f.actor.maybeMoveWarship = tile => f.commands.push({ kind: 'fallback', tile });
      f.actor.emojiBehavior.sendEmoji = () => f.commands.push({ kind: 'emoji' });
      if (scenario === 'no-menu') f.context.getBuildMenu = () => null;
      if (scenario === 'build-throws') f.menu.sendBuildOrUpgrade = () => { throw Error('build'); };
      f.attach();
      if (scenario.endsWith('throws')) await assert.rejects(f.actor.counterWarshipInfestation(), /probe|build/);
      else assert.equal(await f.actor.counterWarshipInfestation(), undefined);
    });
  });
}

for (const scenario of ['counter','denial','steamroll','none','recent-counter','poor','disabled','no-silo','win-send','win-reserve','win-early','win-none','win-recent','team-won','send-noop']) {
  test('MIRV planning parity: ' + scenario, async () => {
    await parity('MirvBehavior', async f => {
      f.state.nukeReserveGold = 9n; f.state.settings.winFixes = scenario.startsWith('win-') || scenario === 'team-won';
      f.state.settings.mirvEarlyGameTicks = 100; f.setTick(scenario === 'win-early' ? 99 : 100);
      f.player.units = () => scenario === 'no-silo' ? [] : [{}];
      f.player.gold = () => ['poor','win-reserve','win-early'].includes(scenario) ? 5n : 10n;
      f.game.config = () => ({ isUnitDisabled: () => scenario === 'disabled' });
      f.actor.cost = async () => { f.commands.push({ kind: 'cost' }); return 10n; };
      f.actor.teamHasWon = () => scenario === 'team-won';
      const target = { id: () => 'target', smallID: () => 2 };
      f.actor.selectWinFixMirvTarget = () => { f.commands.push({ kind: 'win-search' }); return ['win-send','win-reserve','win-early','win-recent'].includes(scenario) ? target : null; };
      f.actor.selectCounterMirvTarget = () => { f.commands.push({ kind: 'counter-search' }); return ['counter','recent-counter','send-noop'].includes(scenario) ? target : null; };
      f.actor.selectVictoryDenialTarget = () => { f.commands.push({ kind: 'denial-search' }); return scenario === 'denial' ? target : null; };
      f.actor.selectSteamrollStopTarget = () => { f.commands.push({ kind: 'steamroll-search' }); return scenario === 'steamroll' ? target : null; };
      f.actor.wasRecentlyMirved = () => ['recent-counter','win-recent'].includes(scenario);
      f.actor.maybeSendMIRV = async t => { if (scenario !== 'send-noop') f.commands.push({ kind: 'mirv-attempt', id: t.id() }); };
      f.attach(); const result = await f.actor.considerMIRV();
      f.commands.push({ result, reserve: f.state.nukeReserveGold });
    });
  });
}
for (const scenario of ['direct','atom','unaffordable','hydro-spend-block','hydro-nation','hydro-heavy','probe-fallback','no-site','negative','zero','zero-hard','zero-hard-crack','salvo','salvo-no-plan','salvo-probe-fail','spend-block','no-silo','friendly','disabled']) {
  test('nuke planning parity: ' + scenario, async () => {
    await parity('NukeBehavior', async f => {
      const target = { id: () => 'target', type: () => 'Human', units: () => [] };
      f.player.units = () => scenario === 'no-silo' ? [] : [{}]; f.player.isOnSameTeam = () => scenario === 'friendly';
      f.actor.findBestNukeTarget = () => target; f.actor.attackBehavior = { shouldAttack: () => true };
      f.actor.isHydroNation = ['hydro-nation','hydro-heavy'].includes(scenario); f.actor.isUnderHeavyAttack = () => scenario === 'hydro-heavy';
      f.game.config = () => ({ isUnitDisabled: type => scenario === 'disabled' || scenario === 'atom' && type === UNIT.HydrogenBomb,
        nukeMagnitudes: () => ({ outer: 10 }), gameConfig: () => ({ gameMode: 'FFA' }) });
      f.actor.getPerceivedNukeCost = async type => { f.commands.push({ kind: 'perceived', type }); return scenario === 'unaffordable' || ['hydro-nation','hydro-heavy'].includes(scenario) && type === UNIT.HydrogenBomb ? 1000n : 10n; };
      f.player.gold = () => 100n;
      let spendChecks = 0;
      f.actor.nukeSpendAllowed = () => { spendChecks++; return !(scenario === 'hydro-spend-block' && spendChecks === 1 || scenario === 'spend-block' && spendChecks > 1); };
      f.actor.cost = async type => { f.commands.push({ kind: 'cost', type }); return 10n; };
      f.context.NUKE_STRUCTURES_TYPES = []; f.context.boundingBoxTiles = () => [];
      f.context.randTerritoryTileArray = () => scenario === 'no-site' ? [] : [1,2];
      f.context.currentDifficulty = () => scenario.startsWith('zero-hard') ? 'Hard' : 'Impossible';
      f.game.ensureBorderTiles = async () => {};
      f.actor.removeOldNukeEvents = () => {};
      f.actor.isValidNukeTile = () => true; f.actor.nukeSpawn = () => 4;
      f.state.settings.nukeDensityFirst = true; f.state.settings.samCrack = scenario === 'zero-hard-crack';
      f.actor.chooseNukeArc = () => ({ intercepted: scenario.startsWith('salvo'), arcUp: false, upgradeSafe: true });
      f.actor.nukeTileScore = tile => scenario === 'negative' ? -1 : scenario.startsWith('zero') ? 0 : 10 - tile;
      f.actor.probeCanBuildNuke = async (tile,type) => { f.commands.push({ kind: 'probe', tile, type }); return !(scenario === 'probe-fallback' && tile === 1 || scenario === 'salvo-probe-fail'); };
      f.actor.planSaturationSalvoFor = async tile => { f.commands.push({ kind: 'plan-salvo', tile }); return scenario === 'salvo-no-plan' ? null : { bombsToFire: 2, waitTicksPerBomb: [0,4], arcUpPerBomb: [false,true] }; };
      f.actor.sendNuke = async (tile,type,t,wait=0,saturation=false,arc=true) => f.commands.push({ kind: 'send', tile,type,wait,saturation,arc });
      f.actor.maybeDestroyEnemySam = async () => f.commands.push({ kind: 'sam' });
      f.context.salvoPace = async (index,count) => f.commands.push({ kind: 'pace', index,count });
      f.attach(); assert.equal(await f.actor.maybeSendNuke(), undefined);
    });
  });
}

test('nuclear arc policy wait prevents simulation and resets next call',()=>{
  const base=createLegacyStrategy(),policy={id:'hold-arc',version:'1',decide(s,cs){
    return s.domain==='nuke-arc'?{selectedId:'$wait',reason:'Hold arc'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});
  f.actor.isTrajectoryInterceptableBySam=()=>{f.commands.push({probe:true});return false;};
  f.attach();f.runtime.select(policy.id);
  assert.equal(f.actor.chooseNukeArc(1,2).stopped,true);assert.equal(f.commands.length,0);
  f.runtime.select('legacy-v1');assert.equal(f.actor.chooseNukeArc(1,2).arcUp,true);
  assert.equal(f.commands.length,1);
});
test('nuclear arc policy can choose down before up',()=>{
  const base=createLegacyStrategy(),policy={id:'down-arc',version:'1',decide(s,cs){
    return s.domain==='nuke-arc'?{selectedId:'down',reason:'Down first'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});f.state.settings.nukeArcRotate=true;
  f.actor.canSetNukeArc=()=>true;f.actor.isTrajectoryInterceptableBySam=(a,b,c,up=true)=>{f.commands.push({up});return false;};
  f.attach();f.runtime.select(policy.id);assert.equal(f.actor.chooseNukeArc(1,2).arcUp,false);
  assert.deepEqual(f.commands,[{up:false}]);
});
for(const rotate of [false,true])for(const margin of [false,true])for(let mask=0;mask<16;mask++)
  test(`nuclear arc lazy parity rotate=${rotate} margin=${margin} mask=${mask}`,async()=>{
    await parity('NukeBehavior',f=>{
      f.state.settings.nukeArcRotate=rotate;f.state.settings.samUpgradeMargin=margin;
      f.actor.canSetNukeArc=()=>{f.commands.push({read:'arc-support'});return true;};
      f.actor.isTrajectoryInterceptableBySam=(from,to,ignored,up=true,extra=0)=>{
        f.commands.push({from,to,ignored:[...ignored],up,extra});
        return Boolean(mask&(1<<((extra?0:2)+(up?0:1))));
      };
      f.attach();f.commands.push({result:f.actor.chooseNukeArc(1,2,new Set(['sam']))});
    });
  });
for(const margin of [false,true])test(`nuclear arc excludes down when unsupported margin=${margin}`,async()=>{
  await parity('NukeBehavior',f=>{
    f.state.settings.nukeArcRotate=true;f.state.settings.samUpgradeMargin=margin;
    f.actor.canSetNukeArc=()=>false;
    f.actor.isTrajectoryInterceptableBySam=(from,to,ignored,up=true,extra=0)=>{f.commands.push({up,extra});return true;};
    f.attach();f.commands.push({result:f.actor.chooseNukeArc(1,2)});
  });
});
function setupArcSalvo(f){
  const silo={tile:()=>3,level:()=>2,missileTimerQueue:()=>[],isUnderConstruction:()=>false};
  f.player.units=type=>type===UNIT.MissileSilo?[silo]:[];
  f.actor.findEnemySamsCoveringTile=()=>[];f.actor.cost=async()=>10n;
  f.context.nukeArcSpeed=()=>1;
  f.context.UniversalPathFinding={Parabola:()=>({findPath:()=>{f.commands.push({flight:true});return [1,2];}})};
  f.actor.isTrajectoryInterceptableBySam=()=>{f.commands.push({probe:true});return false;};
  f.game.config=()=>({isUnitDisabled:()=>false,SAMCooldown:()=>20});
  f.game.manhattanDist=()=>1;f.actor.nukeSpendAllowed=()=>true;
}
for(const fault of ['wait','error','invalid','null'])for(const path of ['salvo','sam','upgrade'])
  test(`nuclear arc ${fault} stops ${path} without fallback`,async()=>{
    const base=createLegacyStrategy(),policy={id:'stop-arc',version:'1',decide(s,cs){
      if(s.domain==='nuke-arc'){
        if(fault==='error')throw Error('arc policy');
        return {selectedId:fault==='wait'?'$wait':fault==='null'?null:'missing',reason:'Stop arc'};
      }return base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupArcSalvo(f);
    f.actor.sendNuke=async()=>f.commands.push({send:true});
    f.actor._upgradeSiloReady=async()=>f.commands.push({upgrade:true});
    f.attach();f.runtime.select(policy.id);
    if(path==='salvo'){
      await f.runtime.planNuke(f.actor,[{tile:2,value:10,interceptable:true},{tile:4,value:9}],{weapon:UNIT.AtomBomb,target:{}});
    }else if(path==='sam'){
      await f.runtime.planSamClear(f.actor,{},[{tile:()=>2,level:()=>1},{tile:()=>4,level:()=>2}],{cost:10n,silos:f.player.units(UNIT.MissileSilo)});
    }else await f.actor.maybeUpgradeHelpfulSilo({targetTile:2,totalBombs:1,coveringSamIds:new Set()},123);
    assert.equal(f.commands.length,0);
    const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
    const records=f.runtime.inspect().records,failed=fault==='error'||fault==='invalid';
    assert.equal(records.filter(r=>r.kind==='strike-target-result'&&r.domain==='nuke-arc').length,1);
    assert.equal(records.filter(r=>r.kind==='strategy-error').length,failed?1:0);
    assert.equal(ds.filter(r=>r.snapshot.domain==='nuke-arc').length,failed?0:1);
    assert.equal(ds.some(r=>['nuke-action','sam-upgrade','strike-silo'].includes(r.snapshot.domain)),false);
    const arc=ds.find(r=>r.snapshot.domain==='nuke-arc');
    if(arc)assert.equal(arc.snapshot.parentDecisionId,path==='upgrade'?123:ds[0].decisionId);
    f.runtime.select('legacy-v1');assert.equal((await f.actor.planSaturationSalvoFor(2)).ok,true);
  });
test('nuclear arc sampling wait aborts ordinary nuke pass before score or fallback',async()=>{
  const base=createLegacyStrategy(),policy={id:'sample-hold',version:'1',decide(s,cs){
    return s.domain==='nuke-arc'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupArcSalvo(f);
  const target={id:()=> 'enemy',type:()=> 'Human',units:()=>[]};
  f.actor.findBestNukeTarget=()=>target;f.actor.attackBehavior={shouldAttack:()=>true};f.player.isOnSameTeam=()=>false;
  f.actor.getPerceivedNukeCost=async()=>10n;
  f.game.config=()=>({isUnitDisabled:()=>false,nukeMagnitudes:()=>({outer:10}),gameConfig:()=>({gameMode:'FFA'})});
  f.game.ensureBorderTiles=async()=>{};f.actor.removeOldNukeEvents=()=>{};f.actor.isValidNukeTile=()=>true;
  f.actor.nukeSpawn=()=>3;f.state.settings.nukeDensityFirst=true;
  f.context.NUKE_STRUCTURES_TYPES=[];f.context.boundingBoxTiles=()=>[];f.context.randTerritoryTileArray=()=>[2,4];
  f.actor.nukeTileScore=()=>{f.commands.push({score:true});return 10;};
  f.actor.maybeDestroyEnemySam=async()=>f.commands.push({sam:true});
  f.attach();f.runtime.select(policy.id);await f.actor.maybeSendNuke();assert.equal(f.commands.length,0);
  assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='nuke-arc').length,1);
});
for(const scenario of ['clear','down','margin','intercepted','no-path','no-slots','unaffordable','spend-block'])
  test(`nuclear arc integration salvo parity: ${scenario}`,async()=>{
    await parity('NukeBehavior',f=>{
      setupArcSalvo(f);f.state.settings.nukeArcRotate=true;f.actor.canSetNukeArc=()=>true;
      f.state.settings.samUpgradeMargin=scenario==='margin';
      f.actor.isTrajectoryInterceptableBySam=(from,to,ignored,up=true,extra=0)=>{
        f.commands.push({probe:from,up,extra});return scenario==='intercepted'||scenario==='down'&&up||scenario==='margin'&&extra>0;
      };
      f.context.UniversalPathFinding={Parabola:()=>({findPath:()=>scenario==='no-path'?[]:[1,2]})};
      if(scenario==='no-slots')f.player.units=()=>[{tile:()=>3,level:()=>1,missileTimerQueue:()=>[0]}];
      if(scenario==='unaffordable')f.player.gold=()=>0n;
      if(scenario==='spend-block')f.actor.nukeSpendAllowed=()=>false;
      f.attach();const plan=f.actor.planSaturationSalvo(2,10n,f.player.units(UNIT.MissileSilo));
      f.commands.push({plan:{...plan,coveringSamIds:[...plan.coveringSamIds]}});
    });
  });
test('nuclear arc salvo planning stops after stale async cost before simulation',async()=>{
  let active=true;const f=fixture(instrumented,'NukeBehavior',{current:()=>active});setupArcSalvo(f);
  f.actor.cost=async()=>{active=false;return 10n;};f.attach();
  assert.equal((await f.actor.planSaturationSalvoFor(2)).stopped,true);assert.equal(f.commands.length,0);
});
test('nuclear arc stops on stale owner before and after trajectory measurement',()=>{
  let active=true;const f=fixture(instrumented,'NukeBehavior',{current:()=>active});
  f.actor.isTrajectoryInterceptableBySam=()=>{active=false;return false;};f.attach();
  assert.equal(f.actor.chooseNukeArc(1,2).stopped,true);
  f.actor.isTrajectoryInterceptableBySam=()=>{throw Error('stale simulation');};
  assert.equal(f.actor.chooseNukeArc(1,2).stopped,true);
});
test('nuclear arc trace preserves explicit ancestry and replay',()=>{
  const f=fixture(instrumented,'NukeBehavior');f.state.settings.nukeArcRotate=true;
  f.actor.canSetNukeArc=()=>true;f.actor.isTrajectoryInterceptableBySam=(a,b,c,up=true)=>up;f.attach();
  assert.equal(f.actor.chooseNukeArc(1,2,new Set(['ignored']),321).arcUp,false);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  assert.equal(ds.length,2);assert.ok(ds.every(r=>r.snapshot.parentDecisionId===321));
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
for(const domain of ['salvo-order','salvo-window','salvo-count','salvo-schedule'])
  test(`central ${domain} wait stops salvo and resets next call`,()=>{
    const base=createLegacyStrategy(),policy={id:'hold-salvo',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupArcSalvo(f);f.attach();f.runtime.select(policy.id);
    assert.equal(f.actor.planSaturationSalvo(2,10n,f.player.units(UNIT.MissileSilo)).stopped,true);
    f.runtime.select('legacy-v1');assert.equal(f.actor.planSaturationSalvo(2,10n,f.player.units(UNIT.MissileSilo)).ok,true);
  });
function setupSalvoMeasurements(f,scenario='normal'){
  setupArcSalvo(f);
  const silo=(tile,slots)=>({tile:()=>tile,level:()=>slots,missileTimerQueue:()=>[],isUnderConstruction:()=>false});
  const silos=scenario==='empty'?[]:scenario==='single'?[silo(1,2)]:[silo(1,2),silo(2,3),silo(3,1)];
  if(scenario==='zero-slots')silos[0].missileTimerQueue=()=>[0,0];
  if(scenario==='all-zero')for(const s of silos)s.missileTimerQueue=()=>Array(s.level()).fill(0);
  f.player.units=type=>type===UNIT.MissileSilo?silos:[];
  f.actor.findEnemySamsCoveringTile=()=>scenario==='sams'?[{id:()=> 's',level:()=>4}]:[];
  f.game.manhattanDist=tile=>scenario==='reversed'?4-tile:scenario==='ties'?1:tile;
  f.context.UniversalPathFinding={Parabola:()=>({findPath:from=>Array(scenario==='no-path'?0:
    scenario==='separate'?from*30:scenario==='boundary'?from*5:from+1).fill(0)})};
  f.actor.chooseNukeArc=tile=>({intercepted:scenario==='all-intercepted'||scenario==='prefix'&&tile===1,arcUp:tile!==2});
  if(scenario==='unaffordable')f.player.gold=()=>5n;
  if(scenario==='spend-block')f.actor.nukeSpendAllowed=()=>false;
  return silos;
}
for(const scenario of ['normal','single','empty','zero-slots','all-zero','no-path','all-intercepted','prefix','sams','separate','boundary','reversed','ties','unaffordable','spend-block'])
  test(`central salvo complete planning parity: ${scenario}`,async()=>{
    await parity('NukeBehavior',f=>{
      const silos=setupSalvoMeasurements(f,scenario);f.attach();
      const plan=f.actor.planSaturationSalvo(4,10n,silos);
      f.commands.push({plan:{...plan,coveringSamIds:[...plan.coveringSamIds]}});
    });
  });
for(const domain of ['salvo-order','salvo-window','salvo-count','salvo-schedule'])for(const fault of ['wait','error','invalid','null'])
  test(`central ${domain} ${fault} prevents site fallback and launches`,async()=>{
    const base=createLegacyStrategy(),policy={id:'stop-salvo',version:'1',decide(s,cs){
      if(s.domain===domain){if(fault==='error')throw Error('salvo policy');return {selectedId:fault==='wait'?'$wait':fault==='null'?null:'missing',reason:'Stop'};}
      return base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupSalvoMeasurements(f);
    f.actor.sendNuke=async()=>f.commands.push({launch:true});f.actor.maybeDestroyEnemySam=async()=>f.commands.push({sam:true});
    f.actor.probeCanBuildNuke=async tile=>{f.commands.push({site:tile});return true;};
    f.attach();f.runtime.select(policy.id);
    await f.runtime.planNuke(f.actor,[{tile:4,value:10,interceptable:true},{tile:5,value:9,interceptable:true}],{weapon:UNIT.AtomBomb,target:{}});
    assert.deepEqual(f.commands,[{site:4}]);
    assert.equal(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain==='nuke-action'),false);
  });
test('central salvo count can choose additional supported bombs',()=>{
  const base=createLegacyStrategy(),policy={id:'extra-bomb',version:'1',decide(s,cs){
    return s.domain==='salvo-count'?{selectedId:'count:2',reason:'Extra bomb'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});const silos=setupSalvoMeasurements(f,'single');
  f.attach();f.runtime.select(policy.id);const plan=f.actor.planSaturationSalvo(4,10n,silos);
  assert.equal(plan.ok,true);assert.equal(plan.bombsToFire,2);assert.deepEqual([...plan.waitTicksPerBomb],[0,5]);
});
test('central salvo window can choose later feasible arrivals and accounts for queue prefix',()=>{
  const base=createLegacyStrategy(),policy={id:'later-window',version:'1',decide(s,cs){
    return s.domain==='salvo-window'?{selectedId:cs.find(c=>c.firstFlight===90).id,reason:'Later window'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});const silos=setupSalvoMeasurements(f,'separate');
  f.attach();f.runtime.select(policy.id);const plan=f.actor.planSaturationSalvo(4,10n,silos);
  assert.equal(plan.ok,true);assert.equal(plan.bombsToFire,6);
  f.runtime.select('legacy-v1');assert.equal(f.actor.planSaturationSalvo(4,10n,silos).bombsToFire,3);
});
for(const domain of ['salvo-order','salvo-window','salvo-count','salvo-schedule'])
  test(`central ${domain} hold ends SAM scan without upgrade or launch`,async()=>{
    const base=createLegacyStrategy(),policy={id:'sam-salvo-hold',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});const silos=setupSalvoMeasurements(f);
    f.actor.sendNuke=async()=>f.commands.push({launch:true});f.actor.maybeUpgradeHelpfulSilo=async()=>f.commands.push({upgrade:true});
    f.attach();f.runtime.select(policy.id);
    await f.runtime.planSamClear(f.actor,{},[{tile:()=>4,level:()=>1},{tile:()=>5,level:()=>2}],{cost:10n,silos});
    assert.equal(f.commands.length,0);
    assert.equal(f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='sam-target').length,1);
  });
for(const holdTail of [false,true])test(`central salvo exposes complete long schedule holdTail=${holdTail}`,()=>{
  const base=createLegacyStrategy(),policy={id:'tail-schedule',version:'1',decide(s,cs){
    return holdTail&&s.domain==='salvo-schedule'&&s.strike.firstBomb>0
      ?{selectedId:'$wait',reason:'Hold tail'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupSalvoMeasurements(f);
  const silos=[{tile:()=>1,level:()=>100,missileTimerQueue:()=>[]},{tile:()=>2,level:()=>1,missileTimerQueue:()=>[]}];
  f.actor.chooseNukeArc=tile=>({intercepted:tile===1,arcUp:tile===1});
  f.attach();f.runtime.select(policy.id);const plan=f.actor.planSaturationSalvo(4,10n,silos);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='salvo-schedule');
  assert.equal(ds.length,2);
  const arcs=ds.flatMap(d=>d.candidates.find(c=>c.id==='staggered').arcUpPerBomb);
  assert.equal(arcs.length,101);assert.equal(arcs.at(-1),false);
  assert.equal(ds[1].snapshot.parentDecisionId,ds[0].decisionId);
  if(holdTail)assert.equal(plan.stopped,true);else {assert.equal(plan.bombsToFire,101);assert.deepEqual(plan.arcUpPerBomb,arcs);}
});
test('central salvo decision tree links parents and replays',()=>{
  const f=fixture(instrumented,'NukeBehavior');const silos=setupSalvoMeasurements(f);f.attach();
  assert.equal(f.actor.planSaturationSalvo(4,10n,silos,123).ok,true);
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  assert.deepEqual(ds.map(r=>r.snapshot.domain),['salvo-order','salvo-window','salvo-count','salvo-schedule']);
  assert.equal(ds[0].snapshot.parentDecisionId,123);
  for(let i=1;i<ds.length;i++)assert.equal(ds[i].snapshot.parentDecisionId,ds[i-1].decisionId);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
test('central salvo large window and count pools retain baseline with bounded candidates',()=>{
  const f=fixture(instrumented,'NukeBehavior');setupSalvoMeasurements(f);
  const silos=[{tile:()=>1,level:()=>120,missileTimerQueue:()=>[]}];f.attach();
  assert.equal(f.actor.planSaturationSalvo(4,10n,silos).bombsToFire,1);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.ok(ds.every(r=>r.candidates.length<=80));
  assert.equal(ds.find(r=>r.snapshot.domain==='salvo-window').snapshot.strike.windowCount,120);
  assert.equal(ds.find(r=>r.snapshot.domain==='salvo-count').snapshot.strike.capacity,120);
});
for(const domain of ['salvo-order','salvo-window','salvo-count','salvo-schedule'])
  test(`central ${domain} stale selection aborts plan`,()=>{
    let active=true;const base=createLegacyStrategy(),policy={id:'stale-salvo',version:'1',decide(s,cs){
      if(s.domain===domain)active=false;return base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy],current:()=>active});const silos=setupSalvoMeasurements(f);
    f.attach();f.runtime.select(policy.id);assert.equal(f.actor.planSaturationSalvo(4,10n,silos).stopped,true);
  });
for(const mode of ['allied','hostile','duel','majority'])test(`nuclear ancestry captures selected ${mode} player without changing return`,()=>{
  const f=fixture(instrumented,'NukeBehavior');const {first}=setupNukePlayerSearch(f,mode);f.attach();
  const selection={};assert.equal(f.actor.findBestNukeTarget(selection),first);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(selection.decisionId,ds.at(-1).decisionId);
});
test('nuclear ancestry keeps private provenance on distinct same-actor plans',()=>{
  const f=fixture(instrumented,'NukeBehavior');const silos=setupSalvoMeasurements(f);f.attach();
  const a=f.actor.planSaturationSalvo(4,10n,silos,123),b=f.actor.planSaturationSalvo(4,10n,silos,456);
  assert.equal(Object.hasOwn(a,'decisionId'),false);assert.equal(Object.hasOwn(b,'decisionId'),false);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain==='salvo-schedule');
  assert.equal(f.runtime.strikeDecisionId(a),ds[0].decisionId);assert.equal(f.runtime.strikeDecisionId(b),ds[1].decisionId);
});
for(const mode of ['density','crown','team'])test(`nuclear ancestry captures nested ${mode} ranking and clears lookup scope`,()=>{
  const f=fixture(instrumented,'NukeBehavior');const {first,second}=setupNukePlayerSearch(f,'hostile');
  f.player.allRelationsSorted=()=>[];f.player.team=()=> 'self';first.team=second.team=()=> 'enemy';
  first.units=second.units=()=>[{level:()=>10}];f.player.units=()=>[];
  f.actor.findHighDensityTarget=()=>mode==='density'?f.runtime.selectStrikePlayer(f.actor,'density'):null;
  f.actor.findFFACrownTarget=()=>mode==='crown'?f.runtime.selectStrikePlayer(f.actor,'crown'):null;
  f.actor.findStrongestTeamTarget=()=>mode==='team'?f.runtime.selectStrikePlayer(f.actor,'team'):null;
  first.numTilesOwned=()=>60;second.numTilesOwned=()=>10;
  if(mode==='crown')f.context.currentDifficulty=()=> 'Hard';
  const config=f.game.config();config.gameConfig=()=>({gameMode:mode==='team'?'Team':'FFA'});f.game.config=()=>config;
  f.attach();const selection={};assert.ok(f.actor.findBestNukeTarget(selection));
  let ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(selection.decisionId,ds.filter(r=>r.snapshot.domain==='nuke-player').at(-1).decisionId);
  f.runtime.selectStrikePlayer(f.actor,mode);ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(ds.at(-1).snapshot.parentDecisionId,undefined);
});
test('nuclear ancestry captures nested incoming attacker and resets scope',()=>{
  const f=fixture(instrumented,'NukeBehavior');const {first}=setupNukePlayerSearch(f,'hostile');
  f.player.type=()=> 'Human';
  const attacker=Object.create(fixtureClass(f,'AttackBehavior').prototype);Object.assign(attacker,{game:f.game,player:f.player});
  f.bot.attackBehavior=attacker;f.actor.attackBehavior=attacker;
  f.player.incomingAttacks=()=>[{attacker:()=>first,troops:()=>10}];f.attach();
  const selection={};assert.equal(f.actor.findBestNukeTarget(selection),first);
  let ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(selection.decisionId,ds.find(r=>r.snapshot.domain==='attack-target').decisionId);
  attacker.findIncomingAttackPlayer();ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  assert.equal(ds.at(-1).snapshot.parentDecisionId,undefined);
});
test('nuclear ancestry MIRV launch inherits ranked player decision',async()=>{
  const f=fixture(instrumented,'MirvBehavior');const target={id:()=> 'enemy',numTilesOwned:()=>10};
  f.actor.getValidMirvTargetPlayers=()=>[target];f.actor.isInboundMIRVFrom=()=>true;f.actor.wasRecentlyMirved=()=>false;
  f.actor.cost=async()=>10n;f.actor.maybeSendMIRV=async(t,parent)=>{f.commands.push({target:t.id(),parent});};
  f.player.units=()=>[{}];
  f.attach();await f.actor.considerMIRV();
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const ranking=ds.find(r=>r.snapshot.domain==='mirv-target');
  assert.equal(ranking.snapshot.parentDecisionId,ds.find(r=>r.snapshot.domain==='mirv-plan').decisionId);
  assert.equal(f.commands[0].parent,ranking.decisionId);
});
function setupNuclearDelivery(f,mode='direct'){
  setupArcSalvo(f);const {first}=setupNukePlayerSearch(f,'duel');
  first.units=()=>[];f.player.isOnSameTeam=()=>false;f.actor.attackBehavior.shouldAttack=()=>true;
  f.actor.getPerceivedNukeCost=async()=>10n;
  f.game.config=()=>({isUnitDisabled:()=>false,nukeMagnitudes:()=>({outer:10}),gameConfig:()=>({gameMode:'FFA'}),SAMCooldown:()=>20,maxTroops:()=>100});
  f.game.ensureBorderTiles=async()=>{};f.actor.removeOldNukeEvents=()=>{};
  f.context.NUKE_STRUCTURES_TYPES=[];f.context.boundingBoxTiles=()=>[];f.context.randTerritoryTileArray=()=>[4];
  f.actor.isValidNukeTile=()=>true;f.actor.nukeSpawn=()=>3;f.actor.nukeTileScore=()=>10;
  f.actor.isTrajectoryInterceptableBySam=(from,to,ignored)=>mode==='salvo'&&!ignored;
  f.state.settings.nukeDensityFirst=true;
  f.actor.recentlySentNukes=[];f.actor.atomBombsLaunched=0;f.actor.hydrogenBombsLaunched=0;
  f.actor.atomBombPerceivedCost=10n;f.actor.hydrogenBombPerceivedCost=10n;
  f.context.salvoPace=async()=>{};
  return first;
}
for(const mode of ['direct','salvo'])test(`nuclear ancestry generated ${mode} chains player through launch`,async()=>{
  const f=fixture(instrumented,'NukeBehavior');setupNuclearDelivery(f,mode);f.attach();await f.actor.maybeSendNuke();
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  const find=domain=>ds.find(r=>r.snapshot.domain===domain);
  const player=find('nuke-duel-player'),weapon=find('nuke-weapon'),arc=find('nuke-arc'),site=find('nuke-site'),action=find('nuke-action');
  assert.equal(weapon.snapshot.parentDecisionId,player.decisionId);assert.equal(arc.snapshot.parentDecisionId,weapon.decisionId);
  assert.equal(site.snapshot.parentDecisionId,weapon.decisionId);
  assert.ok(trace.records.some(r=>r.kind==='strike-link'&&r.decisionId===site.decisionId&&r.sourceDecisionId===arc.decisionId));
  if(mode==='salvo'){
    const order=find('salvo-order'),schedule=find('salvo-schedule');
    assert.equal(order.snapshot.parentDecisionId,site.decisionId);assert.equal(action.snapshot.parentDecisionId,schedule.decisionId);
  }else assert.equal(action.snapshot.parentDecisionId,site.decisionId);
  const command=ds.find(r=>r.candidates[0].kind.startsWith('build '));
  assert.equal(command.candidates[0].parentDecisionId,action.decisionId);assert.equal(f.state.stats.nukes,1);
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
test('nuclear ancestry SAM launch inherits approved schedule',async()=>{
  const f=fixture(instrumented,'NukeBehavior');setupNuclearDelivery(f,'salvo');f.attach();
  const sam={tile:()=>4,level:()=>1};
  await f.runtime.planSamClear(f.actor,{},[sam],{cost:10n,silos:f.player.units(UNIT.MissileSilo),parentDecisionId:123});
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const schedule=ds.find(r=>r.snapshot.domain==='salvo-schedule'),command=ds.find(r=>r.candidates[0].kind.startsWith('build '));
  assert.equal(command.candidates[0].parentDecisionId,schedule.decisionId);
});
test('nuclear ancestry collectors clear after empty target and held weapon',async()=>{
  const base=createLegacyStrategy(),policy={id:'hold-weapon',version:'1',decide(s,cs){
    return s.domain==='nuke-weapon'?{selectedId:'$wait',reason:'Hold'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupNuclearDelivery(f);f.attach();
  const selection={decisionId:999};f.game.players=()=>[];f.actor.findHighDensityTarget=()=>null;
  f.actor.findFFACrownTarget=()=>null;f.actor.findStrongestTeamTarget=()=>null;
  assert.equal(f.actor.findBestNukeTarget(selection),null);assert.equal(selection.decisionId,undefined);
  selection.decisionId=888;f.runtime.select(policy.id);
  assert.equal(await f.runtime.selectNukeWeapon(f.actor,{available:100n,hydroCost:10n,atomCost:10n},selection),null);
  assert.equal(selection.decisionId,undefined);
});
test('nuclear ancestry overlapping same actor and target keeps launch parents separate',async()=>{
  const f=fixture(instrumented,'NukeBehavior');setupNuclearDelivery(f);f.attach();
  f.actor.probeCanBuildNuke=async()=>true;
  const releases=[];f.player.buildables=(tile,types)=>new Promise(resolve=>releases.push(()=>resolve([{type:types[0],canBuild:true,cost:10n}])));
  const a=f.runtime.planNuke(f.actor,[{tile:4,value:10}],{target:{},weapon:UNIT.HydrogenBomb,parentDecisionId:111});
  const b=f.runtime.planNuke(f.actor,[{tile:4,value:10}],{target:{},weapon:UNIT.HydrogenBomb,parentDecisionId:222});
  for(let i=0;i<20&&releases.length<2;i++)await Promise.resolve();
  assert.equal(releases.length,2);releases[1]();await b;releases[0]();await a;
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
  const actions=ds.filter(r=>r.snapshot.domain==='nuke-action'),commands=ds.filter(r=>r.candidates[0].kind.startsWith('build '));
  assert.equal(commands.length,2);assert.equal(commands[0].candidates[0].parentDecisionId,actions[1].decisionId);
  assert.equal(commands[1].candidates[0].parentDecisionId,actions[0].decisionId);
  assert.equal(actions[1].snapshot.parentDecisionId,ds.find(r=>r.snapshot.domain==='nuke-site'&&r.snapshot.parentDecisionId===222).decisionId);
  assert.equal(actions[0].snapshot.parentDecisionId,ds.find(r=>r.snapshot.domain==='nuke-site'&&r.snapshot.parentDecisionId===111).decisionId);
});
test('nuclear ancestry overlapping generated passes preserve their selected player roots',async()=>{
  const f=fixture(instrumented,'NukeBehavior');setupNuclearDelivery(f);f.attach();f.actor.probeCanBuildNuke=async()=>true;
  const releases=[];f.player.buildables=(tile,types)=>new Promise(resolve=>releases.push(()=>resolve([{type:types[0],canBuild:true,cost:10n}])));
  const a=f.actor.maybeSendNuke(),b=f.actor.maybeSendNuke();
  for(let i=0;i<40&&releases.length<2;i++)await Promise.resolve();
  assert.equal(releases.length,2);releases[1]();await b;releases[0]();await a;
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'),byId=new Map(ds.map(d=>[d.decisionId,d]));
  const roots=ds.filter(d=>d.snapshot.domain==='nuke-duel-player');
  const commands=ds.filter(d=>d.candidates[0].kind.startsWith('build '));assert.equal(commands.length,2);
  const rootOf=command=>{
    let node=byId.get(command.candidates[0].parentDecisionId);
    while(node.snapshot.domain!=='nuke-duel-player')node=byId.get(node.snapshot.parentDecisionId);
    return node;
  };
  assert.equal(rootOf(commands[0]),roots[1]);assert.equal(rootOf(commands[1]),roots[0]);
});
function setupNukePlayerSearch(f,mode='allied') {
  const target=(id,smallID)=>({id:()=>id,smallID:()=>smallID,numTilesOwned:()=>10,type:()=> 'Nation'});
  const first=target('first',2),second=target('second',3),ally={id:()=> 'ally',targets:()=>[first,second]};
  f.game.players=()=>[f.player,first,second];f.game.numLandTiles=()=>100;f.game.numTilesWithFallout=()=>0;
  const config=f.game.config();config.gameConfig=()=>({gameMode:'FFA'});config.maxTroops=p=>p===f.player?100:100;
  f.game.config=()=>config;f.player.numTilesOwned=()=>1;f.player.isFriendly=()=>false;
  f.player.relation=()=>1;f.player.allies=()=>mode==='allied'?[ally]:[];
  f.player.allRelationsSorted=()=>mode==='hostile'?[{relation:-1,player:first},{relation:-1,player:second}]:[];
  f.actor.attackBehavior={findIncomingAttackPlayer:()=>null};
  f.actor.findHighDensityTarget=()=>null;f.actor.findFFACrownTarget=()=>{f.commands.push({search:'crown'});return null;};
  f.actor.findStrongestTeamTarget=()=>{f.commands.push({search:'team'});return null;};
  if(mode==='duel')f.game.players=()=>[f.player,first];
  if(mode==='majority')first.numTilesOwned=()=>60;
  return {first,second,ally};
}
for(const [domain,mode] of [['nuke-request-ally','allied'],['nuke-request-player','allied'],
  ['nuke-hostile-player','hostile'],['nuke-duel-player','duel'],['nuke-majority-player','majority']]) {
  test(`central ${domain} hold stops all later searches and resets next lookup`,()=>{
    const base=createLegacyStrategy(),policy={id:'hold-player-search',version:'1',decide(s,cs){
      return s.domain===domain?{selectedId:'$wait',reason:'hold player lookup'}:base.decide(s,cs);
    }};
    const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]}),{first}=setupNukePlayerSearch(f,mode);
    f.attach();f.runtime.select(policy.id);assert.equal(f.actor.findBestNukeTarget(),null);assert.equal(f.commands.length,0);
    assert.ok(f.runtime.inspect().records.some(r=>r.kind==='decision'&&r.snapshot.domain===domain));
    f.runtime.select('legacy-v1');assert.equal(f.actor.findBestNukeTarget(),first);
  });
}
for(const mode of ['allied','hostile'])test(`central nuclear ${mode} player policy can select second target`,()=>{
  const base=createLegacyStrategy(),domain=mode==='allied'?'nuke-request-player':'nuke-hostile-player';
  const policy={id:'second-nuke-player',version:'1',decide(s,cs){
    return s.domain===domain?{selectedId:cs[1].id,reason:'second player'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]}),{second}=setupNukePlayerSearch(f,mode);
  f.attach();f.runtime.select(policy.id);assert.equal(f.actor.findBestNukeTarget(),second);
});
test('nuclear ally-source policy can use a later ally request',()=>{
  const base=createLegacyStrategy(),policy={id:'second-nuke-ally',version:'1',decide(s,cs){
    return s.domain==='nuke-request-ally'?{selectedId:cs[1].id,reason:'later ally'}:base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]}),{second,ally}=setupNukePlayerSearch(f);
  f.player.allies=()=>[ally,{id:()=> 'other-ally',targets:()=>[second]}];f.attach();f.runtime.select(policy.id);
  assert.equal(f.actor.findBestNukeTarget(),second);
});
for(const mode of ['allied','hostile'])for(const fault of ['error','invalid','null'])test(`nuclear ${mode} player ${fault} stops fallback`,()=>{
  const base=createLegacyStrategy(),domain=mode==='allied'?'nuke-request-player':'nuke-hostile-player';
  const policy={id:'failed-player-search',version:'1',decide(s,cs){
    if(s.domain===domain){if(fault==='error')throw Error('player policy');return {selectedId:fault==='null'?null:'missing',reason:'invalid'};}
    return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy]});setupNukePlayerSearch(f,mode);
  f.attach();f.runtime.select(policy.id);assert.equal(f.actor.findBestNukeTarget(),null);assert.equal(f.commands.length,0);
  assert.equal(f.runtime.inspect().records.some(r=>r.kind==='strategy-error'),fault!=='null');
});
for(const scenario of ['empty-ally','low-relation','self','friendly','second-ally','hostile-friendly','hostile-other-relation','hostile-capacity','bot-request'])
  test(`nuclear player eligibility and lazy getter parity: ${scenario}`,async()=>{
    await parity('NukeBehavior',f=>{
      const mode=scenario.startsWith('hostile')?'hostile':'allied';const {first,second,ally}=setupNukePlayerSearch(f,mode);
      const targets=scenario==='empty-ally'?[]:scenario==='self'?[f.player,first]:[first,second];
      ally.targets=()=>{f.commands.push({read:'targets'});return targets;};
      f.player.relation=()=>{f.commands.push({read:'ally-relation'});return scenario==='low-relation'?0:1;};
      f.player.isFriendly=p=>{f.commands.push({read:'friendly',id:p.id()});return ['friendly','hostile-friendly'].includes(scenario)&&p===first;};
      if(scenario==='second-ally')f.player.allies=()=>[{targets:()=>[]},ally];
      if(scenario==='bot-request')first.type=()=> 'Bot';
      if(scenario==='hostile-other-relation')f.player.allRelationsSorted=()=>[{relation:0,player:first},{relation:-1,player:second}];
      if(scenario==='hostile-capacity')f.game.config().maxTroops=p=>p===f.player?100:p===first?50:51;
      f.attach();const result=f.actor.findBestNukeTarget();f.commands.push({target:result?.id()??null});
    });
  });
for(const mode of ['allied','hostile'])test(`nuclear ${mode} lookup does not evaluate later eligibility after first match`,()=>{
  const f=fixture(instrumented,'NukeBehavior'),{first,second}=setupNukePlayerSearch(f,mode);
  if(mode==='allied')second.smallID=()=>{throw Error('late requested predicate');};
  else f.game.config().maxTroops=p=>{if(p===second)throw Error('late hostile capacity');return 100;};
  f.attach();assert.equal(f.actor.findBestNukeTarget(),first);
});
for(const domain of ['nuke-request-ally','nuke-request-player','nuke-hostile-player'])test(`nuclear ${domain} scans beyond bounded window`,()=>{
  const f=fixture(instrumented,'NukeBehavior'),{first}=setupNukePlayerSearch(f,domain==='nuke-hostile-player'?'hostile':'allied');
  if(domain==='nuke-request-ally')f.player.allies=()=>[...Array.from({length:100},(_,i)=>({id:()=>`ally-${i}`,targets:()=>[]})),{targets:()=>[first]}];
  if(domain==='nuke-request-player')f.player.allies=()=>[{targets:()=>[...Array.from({length:100},()=>f.player),first]}];
  if(domain==='nuke-hostile-player')f.player.allRelationsSorted=()=>[...Array.from({length:100},()=>({relation:0,player:first})),{relation:-1,player:first}];
  f.attach();assert.equal(f.actor.findBestNukeTarget(),first);
  const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain===domain);
  assert.equal(ds.length,101);assert.ok(ds.every(d=>d.candidates.length<=80));
});
for(const mode of ['allied','hostile','duel','majority'])test(`nuclear ${mode} player ancestry and replay`,()=>{
  const f=fixture(instrumented,'NukeBehavior');setupNukePlayerSearch(f,mode);f.attach();f.actor.findBestNukeTarget();
  const trace=f.runtime.inspect(),ds=trace.records.filter(r=>r.kind==='decision');
  const domain=mode==='allied'?'nuke-request-player':`nuke-${mode}-player`,child=ds.find(d=>d.snapshot.domain===domain);
  const parent=ds.find(d=>d.decisionId===child.snapshot.parentDecisionId);
  assert.equal(parent.snapshot.domain,mode==='allied'?'nuke-request-ally':'nuke-target');
  if(mode==='allied')assert.equal(ds.find(d=>d.decisionId===parent.snapshot.parentDecisionId).snapshot.domain,'nuke-target');
  assert.ok(f.runtime.replay('legacy-v1',trace).every(r=>r.sameChoice));
});
test('nuclear player choice stops when owner becomes stale during selection',()=>{
  let current=true;const base=createLegacyStrategy(),policy={id:'stale-player-search',version:'1',decide(s,cs){
    if(s.domain==='nuke-request-player')current=false;return base.decide(s,cs);
  }};
  const f=fixture(instrumented,'NukeBehavior',{strategies:[policy],current:()=>current});setupNukePlayerSearch(f);
  f.attach();f.runtime.select(policy.id);assert.equal(f.actor.findBestNukeTarget(),null);assert.equal(f.commands.length,0);
});
for (const scenario of ['duel','incoming','density','majority','majority-boundary','allied','allied-low-relation','hostile','hostile-boundary','crown','team','none']) {
  test('nuke target search parity: ' + scenario, async () => {
    await parity('NukeBehavior', async f => {
      const enemy = { id: () => 'enemy', smallID: () => 2, numTilesOwned: () => scenario === 'majority' ? 51 : scenario === 'majority-boundary' ? 50 : 10 };
      const third = { id: () => 'third', smallID: () => 3, numTilesOwned: () => 1 };
      f.player.numTilesOwned = () => 1;
      f.game.players = () => scenario === 'duel' ? [f.player,enemy] : [f.player,enemy,third];
      f.game.numLandTiles = () => 100; f.game.numTilesWithFallout = () => 0;
      f.game.config = () => ({ gameConfig: () => ({ gameMode: 'FFA' }), maxTroops: p => p === f.player ? 100 : scenario === 'hostile-boundary' ? 50 : 51 });
      f.actor.attackBehavior = { findIncomingAttackPlayer: () => { f.commands.push({ search: 'incoming' }); return scenario === 'incoming' ? enemy : null; } };
      f.actor.findHighDensityTarget = () => { f.commands.push({ search: 'density' }); return scenario === 'density' ? enemy : null; };
      f.actor.findFFACrownTarget = () => { f.commands.push({ search: 'crown' }); return scenario === 'crown' ? enemy : null; };
      f.actor.findStrongestTeamTarget = () => { f.commands.push({ search: 'team' }); return scenario === 'team' ? enemy : null; };
      f.player.isFriendly = () => false;
      f.context.Relation.Friendly = 1;
      f.player.allies = () => scenario.startsWith('allied') ? [{ targets: () => [f.player,enemy] }] : [];
      f.player.relation = () => scenario === 'allied-low-relation' ? 0 : 1;
      f.player.allRelationsSorted = () => scenario.startsWith('hostile') ? [{ relation: -1, player: enemy }] : [];
      f.attach(); const result = f.actor.findBestNukeTarget(); f.commands.push({ target: result?.id() ?? null });
    });
  });
}
for (const scenario of ['first','fallback','upgrade','no-capacity','disabled','inflight','no-sam','no-silo','throws']) {
  test('SAM clearing parity: ' + scenario, async () => {
    await parity('NukeBehavior', async f => {
      f.game.config = () => ({ isUnitDisabled: () => scenario === 'disabled' });
      f.player.units = type => type === UNIT.AtomBomb ? (scenario === 'inflight' ? [{}] : []) : scenario === 'no-silo' ? [] : [{ isUnderConstruction: () => false }];
      f.actor.cost = async () => { f.commands.push({ kind: 'cost' }); return 10n; };
      const target = { units: () => scenario === 'no-sam' ? [] : [3,1,2].map(tile => ({ tile: () => tile, level: () => tile })) };
      f.actor.planSaturationSalvo = tile => {
        f.commands.push({ plan: tile }); if (scenario === 'throws') throw Error('plan');
        return { ok: scenario === 'first' || scenario === 'fallback' && tile === 2, needsMoreSilos: scenario !== 'no-capacity',
          coveringSamIds: new Set([tile]), totalBombs: tile+1, bombsToFire: 2, waitTicksPerBomb: [0,4], arcUpPerBomb: [false,true] };
      };
      f.actor.sendNuke = async (tile,type,target,delay,saturation,arc) => f.commands.push({ tile,type,delay,saturation,arc });
      f.actor.maybeUpgradeHelpfulSilo = async context => f.commands.push({ upgrade: context.targetTile, totalBombs: context.totalBombs });
      f.context.salvoPace = async (index,count) => f.commands.push({ pace: index,count });
      f.attach();
      if (scenario === 'throws') await assert.rejects(f.actor.maybeDestroyEnemySam(target), /plan/);
      else assert.equal(await f.actor.maybeDestroyEnemySam(target), undefined);
    });
  });
}
for (const scenario of ['coverage','tie','max-level','capacity','no-reachable','no-silo','no-quote','not-upgradeable','no-menu','build-throws']) {
  test('helpful silo upgrade parity: ' + scenario, async () => {
    await parity('NukeBehavior', async f => {
      const unit = (tile,level) => ({ tile: () => tile, level: () => level });
      f.context.MAX_NATION_SILO_UPGRADE_LEVEL = 5;
      f.player.units = type => type === UNIT.MissileSilo ? (scenario === 'no-silo' ? [] : [unit(1,scenario === 'max-level' ? 5 : 1),unit(2,1)]) : [unit(9,2)];
      f.actor.chooseNukeArc = () => ({ intercepted: scenario === 'no-reachable' });
      f.game.config = () => ({ samRange: () => 10 });
      f.game.euclideanDistSquared = tile => scenario === 'coverage' && tile === 1 ? 101 : 100;
      f.player.buildables = async tile => { f.commands.push({ probe: tile }); return scenario === 'no-quote' ? [] : [{ type: UNIT.MissileSilo, canUpgrade: scenario === 'not-upgradeable' ? false : tile }]; };
      if (scenario === 'no-menu') f.context.getBuildMenu = () => null;
      if (scenario === 'build-throws') f.menu.sendBuildOrUpgrade = () => { throw Error('build'); };
      f.attach(); const context = { targetTile: 4, coveringSamIds: new Set(), totalBombs: scenario === 'capacity' ? 11 : 5 };
      if (scenario === 'build-throws') await assert.rejects(f.actor.maybeUpgradeHelpfulSilo(context), /build/);
      else assert.equal(await f.actor.maybeUpgradeHelpfulSilo(context), undefined);
    });
  });
}

const strikeRankingCases = [
  ['counter','largest'],['counter','tie'],['counter','none'],['counter','null'],
  ['denial','individual'],['denial','team'],['denial','team-tie'],['denial','no-land'],['denial','null'],
  ['steamroll','gap'],['steamroll','minimum'],['steamroll','invalid-leader'],['steamroll','null'],
  ['win-fix','share-boundary'],['win-fix','topN'],['win-fix','dead'],['win-fix','null'],
  ['density','rank'],['density','tie'],['density','boundary'],['density','friendly'],['density','bot'],['density','few-levels'],
  ['crown','gap'],['crown','boundary'],['crown','self-leads'],['crown','friendly'],['crown','no-land'],
  ['team','rank'],['team','tie'],['team','own-leads'],['team','friendly'],['team','no-team']
];
for (const [mode,scenario] of strikeRankingCases) test('strike ranking parity: ' + mode + '/' + scenario, async () => {
  const mirv = ['counter','denial','steamroll','win-fix'].includes(mode);
  await parity(mirv ? 'MirvBehavior' : 'NukeBehavior', async f => {
    const make = (id,tiles,power,cities,team=null) => ({ id: () => id, smallID: () => id, numTilesOwned: () => tiles,
      team: () => team, type: () => scenario === 'bot' ? 'Bot' : 'Human', isAlive: () => scenario !== 'dead' || id !== 2,
      isPlayer: () => true, units: () => [{ level: () => scenario === 'few-levels' ? 4 : 10 }], power,cities });
    let a=make(2,40,10,10),b=make(3,50,20,8);
    if (mode === 'counter' && scenario === 'tie') b=make(3,40,20,8);
    if (mode === 'denial' && scenario.startsWith('team')) { a=make(2,30,10,10,'red'); b=make(3,scenario === 'team-tie' ? 30 : 40,20,8,'red'); }
    if (mode === 'steamroll' && scenario === 'minimum') { a=make(2,40,10,8);b=make(3,50,20,4); }
    if (mode === 'win-fix' && scenario === 'share-boundary') { a=make(2,35,10,10);b=make(3,30,20,8); }
    if (mode === 'density' && scenario === 'tie') b=make(3,40,20,8);
    if (mode === 'density' && scenario === 'boundary') { a=make(2,100,10,10);b=make(3,100,20,8); }
    if (mode === 'crown' && scenario === 'boundary') { a=make(2,20,10,10);b=make(3,15,20,8); }
    if (mode === 'team') { a=make(2,40,10,10,scenario === 'no-team' ? null : 'red');b=make(3,50,scenario === 'tie' ? 10 : 20,8,scenario === 'no-team' ? null : 'red'); }
    f.player.team = () => scenario === 'own-leads' ? 'own' : null;
    f.player.numTilesOwned = () => ['self-leads','own-leads'].includes(scenario) ? 100 : 10;
    f.player.isFriendly = p => scenario === 'friendly';
    f.game.players = () => [f.player,a,b];
    f.game.numLandTiles = () => scenario === 'no-land' ? 0 : 100; f.game.numTilesWithFallout = () => 0;
    f.game.config = () => ({ gameConfig: () => ({ gameMode: mode === 'team' ? 'Team' : 'FFA' }), maxTroops: p => p.power || 0 });
    f.actor.getValidMirvTargetPlayers = () => scenario === 'invalid-leader' ? [b] : [a,b];
    f.actor.isInboundMIRVFrom = () => scenario !== 'none'; f.actor.countCities = p => p.cities || 0;
    f.context.HIGH_DENSITY_NUKE_THRESHOLD = .1; f.context.MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE = 5; f.context.NUKE_STRUCTURES_TYPES = ['City'];
    f.state.settings.mirvTargetTopN = scenario === 'topN' ? 1 : 3;
    const methods = { counter: 'selectCounterMirvTarget', denial: 'selectVictoryDenialTarget', steamroll: 'selectSteamrollStopTarget', 'win-fix': 'selectWinFixMirvTarget', density: 'findHighDensityTarget', crown: 'findFFACrownTarget', team: 'findStrongestTeamTarget' };
    f.attach(); if (scenario === 'null') f.actor.player = null;
    if (scenario === 'null' && mode !== 'win-fix') assert.throws(() => f.actor[methods[mode]](),/not initialized/);
    else { const result=f.actor[methods[mode]](); f.commands.push({ target: result?.id() ?? null }); }
  });
});

test('two-team country gate replaces old city gate only after wilderness is cleared',()=>{
 let facts={frontline:false,borderKnown:true,wilderness:true};
 const f=fixture(instrumented,'AttackBehavior',{twoTeamOpening:{observe:()=>facts},
   strategies:[require('../src/brain/adaptive-strategy')(createLegacyStrategy())]});
 f.attach();f.runtime.select('adaptive-v1');
 f.actor.openingSnapshot=()=>({applies:true,over:false,built:false,invaders:new Set(),allyInvaders:new Set(),openLand:false});
 const enemy={isPlayer:()=>true,isDisconnected:()=>false,type:()=> 'Human',smallID:()=>2};
 assert.equal(f.actor.openingVetoes(enemy),true);
 facts={...facts,wilderness:false};assert.equal(f.actor.openingVetoes(enemy),false);
 f.state.settings.phasedOpening=false;facts={...facts,wilderness:true};
 assert.equal(f.actor.openingVetoes(enemy),true);
 f.game.hasOwner=()=>true;f.game.ownerID=()=>2;f.game.playerBySmallID=()=>enemy;
 assert.equal(f.actor.openingVetoesTile(50),true);
 f.runtime.select('legacy-v1');assert.equal(f.actor.openingVetoes(enemy),false);
});

test('two-team opening uses new physical builds through the native affordability path and clears forceNew afterward',async()=>{
 let facts={frontline:false,borderKnown:true,wilderness:false,ports:1,cities:1,factories:0,sams:0,portTarget:2,cityTarget:1,factoryTarget:0,samEnabled:true};
 const f=fixture(instrumented,'StructureBehavior',{twoTeamOpening:{observe:()=>facts},
   strategies:[require('../src/brain/adaptive-strategy')(createLegacyStrategy())]});
 const calls=[];
 Object.assign(f.actor,{placementsCount:1,getPerceivedCost:()=>100n,ownedLevels:()=>1,samTargetLevels:()=>1,
   shouldBuildStructure:()=>true,hasHighStartingGold:()=>false,isHighNationDensity:()=>false,
   getTotalStructureDensity:()=>100,maybeUpgradeStructure:async()=>{calls.push('upgrade');return true;},
   _placeNewStructure:async type=>{calls.push('new:'+type);return true;}});
 f.attach();f.runtime.select('adaptive-v1');
 await f.runtime.planStructures(f.actor,{cityLevels:1,cityDisabled:false,sharedWater:true});
 assert.deepEqual(calls,['new:'+UNIT.Port]);
 await f.actor.maybeSpawnStructure(UNIT.Port);assert.deepEqual(calls,['new:'+UNIT.Port,'upgrade']);
 calls.length=0;f.player.gold=()=>0n;
 assert.equal(await f.runtime.planStructures(f.actor,{cityLevels:1,cityDisabled:false,sharedWater:true}),false);
 assert.deepEqual(calls,[]);
 f.player.gold=()=>1000000n;f.actor._placeNewStructure=async()=>{throw Error('placement rejected');};
 await assert.rejects(f.runtime.planStructures(f.actor,{cityLevels:1,cityDisabled:false,sharedWater:true}),/placement rejected/);
 await f.actor.maybeSpawnStructure(UNIT.Port);assert.deepEqual(calls,['upgrade']);
});

test('native spawn selection uses measured team pool and respects companion override and team bounds',()=>{
 const geo=require('../src/brain/team-geography')({units:UNIT,botType:'Bot',teamMode:'Team'});
 const f=fixture(instrumented,'NationBot',{teamGeography:geo,strategies:[require('../src/brain/adaptive-strategy')(createLegacyStrategy())]});
 setupSpawn(f,{smart:true,spots:[{x:50,y:50},{x:90,y:90}]});
 f.player.team=()=> 'A';f.player.type=()=> 'Human';f.player.hasSpawned=()=>false;
 const enemy={smallID:()=>2,id:()=> 'enemy',type:()=> 'Human',team:()=> 'B',hasSpawned:()=>true,nameLocation:()=>({x:95,y:95})};
 f.game.players=()=>[f.player,enemy];f.game.isWater=()=>false;f.game.hasFallout=()=>false;
 f.game.neighbors=t=>[[f.game.x(t)+1,f.game.y(t)],[f.game.x(t)-1,f.game.y(t)],
 [f.game.x(t),f.game.y(t)+1],[f.game.x(t),f.game.y(t)-1]].filter(([x,y])=>f.game.isValidCoord(x,y)).map(([x,y])=>f.game.ref(x,y));
 const config=f.game.config();config.gameConfig=()=>({gameMode:'Team'});
 f.game.__src={teamSpawnArea:()=>({x:20,y:20,width:50,height:50})};
 f.attach();f.runtime.select('adaptive-v1');const tile=f.actor.pickSpawnCenter();
 assert.ok(f.game.x(tile)>=20&&f.game.x(tile)<70&&f.game.y(tile)>=20&&f.game.y(tile)<70);
 const decision=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='team-spawn-site');assert.ok(decision);
 assert.ok(decision.candidates.length<=80);assert.ok(f.runtime.replay('adaptive-v1',f.runtime.inspect()).every(r=>r.sameChoice));
 f.context.companionSpawnCenter=()=>1234;assert.equal(f.actor.pickSpawnCenter(),1234);
});
test('runtime island deployment builds through the central build gateway and logs the reserved economy',async()=>{
 const grid=require('./fixtures/team-geography-game').fixture();
 const geo=require('../src/brain/team-geography')({units:UNIT,botType:'Bot',teamMode:'Team'});
 const f=fixture(instrumented,'WarshipBehavior',{teamGeography:geo,strategies:[require('../src/brain/adaptive-strategy')(createLegacyStrategy())]});
 Object.assign(f.game,grid.game);Object.assign(f.player,grid.self);
 const cfg=f.game.config();cfg.isUnitDisabled=()=>false;f.game.config=()=>cfg;
 grid.add('Port',grid.ref(13,12));grid.add('Port',grid.ref(26,12),grid.enemy);
 f.bot.structureBehavior={getPerceivedCost:()=>100n};f.actor.cost=()=>100n;
 f.actor.buildableWarship=async()=>({type:UNIT.Warship,canBuild:true,cost:100n});
 f.attach();f.runtime.select('adaptive-v1');
 assert.equal(await f.actor.maybeSpawnWarship(),true);assert.equal(f.commands.length,1);assert.equal(f.commands[0].kind,'build');
 const decision=f.runtime.inspect().records.find(r=>r.kind==='decision'&&r.snapshot.domain==='warship-deployment');
 assert.equal(decision.selectedId,'deploy:island');assert.equal(decision.snapshot.teamNaval.reserve,'100');
 assert.ok(f.runtime.replay('adaptive-v1',f.runtime.inspect()).every(r=>r.sameChoice));
});

function nativeEmbargoFixture(options={}){
 const legacy=createLegacyStrategy(),adaptive=require('../src/brain/adaptive-strategy')(legacy);
 const f=fixture(instrumented,'NationBot',{...options,strategies:[options.strategy||adaptive]});
 const targets=setupEmbargo(f,{team:true,relation:0,targetStations:10});
 targets[0].isAlive=()=>true;f.attach();f.runtime.select('adaptive-v1');return {f,targets};
}
test('adaptive team embargo uses one native all-enemies command regardless of trade advantage',()=>{
 const {f}=nativeEmbargoFixture();f.actor.handleEmbargoesToHostileNations();
 assert.deepEqual(f.commands.map(c=>c.kind),['embargoAll']);assert.deepEqual(f.commands[0].args,['start']);
 f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,1);
 f.setTick(1000);f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,2);
});
test('native team embargo excludes allies, teammates, Bots and dead players',()=>{
 for(const mode of ['allied','teammate','bot','dead','active']){
  const {f,targets}=nativeEmbargoFixture();
  if(mode==='allied')f.player.isAlliedWith=()=>true;
  if(mode==='teammate')f.player.isOnSameTeam=()=>true;
  if(mode==='bot')targets[0].type=()=> 'Bot';
  if(mode==='dead')targets[0].isAlive=()=>false;
  if(mode==='active')f.player.hasEmbargoAgainst=()=>true;
  f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,0,mode);
 }
});
test('native team embargo throws if native constructor is missing',()=>{
 const {f}=nativeEmbargoFixture();delete f.context.discoverCtors().embargoAll;
 assert.throws(()=>f.actor.handleEmbargoesToHostileNations(),/embargo.all.*unavailable/i);
});
test('failed native embargo emission can retry without a successful-submission cooldown',()=>{
 const {f}=nativeEmbargoFixture({emitReturn:false});f.actor.handleEmbargoesToHostileNations();f.actor.handleEmbargoesToHostileNations();
 assert.equal(f.commands.length,2);
});

test('confirmed native embargo stays quiet and alliance changes trigger a fresh embargo',()=>{
 const {f}=nativeEmbargoFixture();let embargoed=false,allied=false;
 f.player.hasEmbargoAgainst=()=>embargoed;f.player.isAlliedWith=()=>allied;
 f.actor.handleEmbargoesToHostileNations();embargoed=true;f.setTick(1000);
 f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,1);
 embargoed=false;allied=true;f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,1);
 allied=false;f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,2);
});
test('central embargo action hold prevents native submission and releases next pass',()=>{
 const adaptive=require('../src/brain/adaptive-strategy')(createLegacyStrategy());let hold=true;
 const {f}=nativeEmbargoFixture({strategy:{...adaptive,decide(s,c){return hold&&s.domain==='embargo-action'?{selectedId:'$wait',reason:'hold embargo'}:adaptive.decide(s,c);}}});
 f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,0);
 hold=false;f.actor.handleEmbargoesToHostileNations();assert.equal(f.commands.length,1);
 const decisions=f.runtime.inspect().records.filter(r=>r.kind==='decision');
 const command=decisions.find(d=>d.candidates.some(c=>c.kind==='embargoAll'));
 assert.ok(command.candidates[0].parentDecisionId);
});

for(const emitReturn of [true,false])test(`hotspot moves use the native central gateway and confirm only submission: ${emitReturn}`,()=>{
 const assignments=[],adaptive=require('../src/brain/adaptive-strategy')(createLegacyStrategy());
 const f=fixture(instrumented,'WarshipBehavior',{emitReturn,strategies:[adaptive],warshipTradeHotspots:{
  rank:()=>[{key:'lane',tile:180,density:3,score:300,component:1,lastTraffic:100}],assign:(a,s,c)=>assignments.push(c)}});
 Object.assign(f.game,{manhattanDist:(a,b)=>Math.abs(a-b),getWaterComponent:()=>1});
 f.setTick(100);f.attach();f.runtime.select('adaptive-v1');
 const ship={id:()=>7,tile:()=>0},smart={cooldown:new Map()},context={ship,smart,health:100,maxHealth:100,
  retreatRatio:.75,evade:false,enemies:[],trades:[],home:50,hunt:true,patrol:{}};
 f.runtime.planWarshipCombat(f.actor,context);
 assert.deepEqual(f.commands.map(c=>c.kind),['moveWarship']);assert.equal(assignments.length,emitReturn?1:0);
 assert.equal(smart.cooldown.size,emitReturn?1:0);
 const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision');
 const area=ds.find(d=>d.snapshot.domain==='warship-hotspot'),move=ds.find(d=>d.candidates[0].kind==='moveWarship');
 assert.equal(move.candidates[0].parentDecisionId,area.decisionId);
});
test('recent dodge or defensive movement holds hotspot commands without losing safety phases',()=>{
 const adaptive=require('../src/brain/adaptive-strategy')(createLegacyStrategy());
 const f=fixture(instrumented,'WarshipBehavior',{strategies:[adaptive],warshipTradeHotspots:{rank:()=>assert.fail('recent dodge must hold hotspot lookup')}});
 Object.assign(f.game,{manhattanDist:(a,b)=>Math.abs(a-b),getWaterComponent:()=>1});
 f.setTick(100);f.attach();f.runtime.select('adaptive-v1');
 const smart={cooldown:new Map([[7,90]])};
 f.runtime.planWarshipCombat(f.actor,{ship:{id:()=>7,tile:()=>0},smart,health:100,maxHealth:100,
  retreatRatio:.75,evade:false,enemies:[],trades:[],home:50,hunt:true,patrol:{}});
 assert.equal(f.commands.length,0);
});
