'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSource}=require('../scripts/build');
const source=buildSource().source;

// Exercise the real generated API factory, including its cached config proxy.
function api(rawConfig){
  const start=source.indexOf('function createGameApi('),end=source.indexOf('class EmojiBehavior{',start);
  assert.ok(start>=0&&end>start);
  const context={};
  // The compatibility helper lives with the other hoisted brain declarations.
  const helperStart=source.indexOf('function createGameConfigAdapter(');
  if(helperStart>=0){const helperEnd=source.indexOf('// END GAME CONFIG COMPAT',helperStart);
    vm.runInNewContext(source.slice(helperStart,helperEnd),context);}
  const create=vm.runInNewContext(source.slice(start,end)+';createGameApi',context);
  return create({config:()=>rawConfig}).game;
}

test('generated config restores missing startingGold from the match setting',()=>{
  const config=api({gameConfig:()=>({startingGold:5000000})}).config();
  assert.equal(config.startingGold({playerType:'Human'}),5000000n);
});

test('generated config distinguishes ordinary, zero and high starting gold',()=>{
  for(const [value,expected] of [[undefined,0n],[0,0n],[1000000,1000000n],[25000000,25000000n]]){
    const game=api({gameConfig:()=>({startingGold:value})});
    assert.equal(game.config().startingGold({}),expected);
    assert.equal(game.config(),game.config());
  }
});

test('native startingGold and config methods keep their receiver and arguments',()=>{
  const info={playerType:'Nation'},raw={gold:8000000n,gameConfig:()=>({startingGold:0}),
    startingGold(player){assert.equal(this,raw);assert.equal(player,info);return this.gold;},
    maxTroops(player){assert.equal(this,raw);return player.limit;}};
  const cfg=api(raw).config();
  assert.equal(cfg.startingGold(info),8000000n);
  assert.equal(cfg.maxTroops({__src:{limit:123}}),123);
});

test('scalar startingGold is accepted without changing other config properties',()=>{
  const raw={startingGold:6000000n,gameConfig:()=>({startingGold:0}),marker:42};
  const cfg=api(raw).config();assert.equal(cfg.startingGold({}),6000000n);assert.equal(cfg.marker,42);
  assert.equal(raw.startingGold,6000000n);
});

test('invalid starting gold fails explicitly instead of selecting a different opening',()=>{
  for(const value of [-1,NaN,Infinity,1.5,'5000000',{},Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>api({gameConfig:()=>({startingGold:value})}).config().startingGold({}),/starting gold/i);
  }
});

test('the real structure opening check works with a browser config lacking startingGold()',()=>{
  const start=source.indexOf('hasHighStartingGold(){'),end=source.indexOf('isHighNationDensity(){',start);
  assert.ok(start>=0&&end>start);
  const make=vm.runInNewContext('class Opening{'+source.slice(start,end)+'};Opening',
    {HIGH_STARTING_GOLD_THRESHOLD:3000000n});
  for(const [amount,expected] of [[0,false],[1000000,false],[3000000,true],[5000000,true]]){
    const actor=new make();actor._hasHighStartingGold=null;actor.game=api({gameConfig:()=>({startingGold:amount})});
    actor.player={type:()=> 'Human',gold:()=>99999999n,isLobbyCreator:()=>false};
    assert.equal(actor.hasHighStartingGold(),expected);
  }
});

test('current browser config exposes engine-only ship and placement rules through the adapter',()=>{
  const cfg=api({gameConfig:()=>({}),isUnitDisabled:type=>type==='disabled'}).config();
  const expected={boatMaxNumber:3,trainStationMinRange:15,minDistanceBetweenPlayers:30,
    defaultSamRange:70,defaultNukeTargetableRange:150,warshipTargettingRange:130,
    warshipShellAttackRate:20,warshipRetreatHealthPercent:75,warshipVeterancyShellDamageBonus:20};
  for(const [name,value] of Object.entries(expected))assert.equal(cfg[name](),value,name);
  assert.equal(api({isUnitDisabled:type=>type==='Transport'}).config().boatMaxNumber(),0);
});

test('nuclear travel estimates use current engine speed for each weapon',()=>{
  const cfg=api({gameConfig:()=>({})}).config();
  for(const [weapon,speed] of [['Atom Bomb',10],['Hydrogen Bomb',10],['MIRV',15],['MIRV Warhead',22]])assert.equal(cfg.nukeSpeed(weapon),speed);
  assert.throws(()=>cfg.nukeSpeed('unknown'),/nuke type/i);
});

test('native ship rules retain their receiver and arguments instead of using compatibility constants',()=>{
  const raw={boatMaxNumber(){assert.equal(this,raw);return 5;},
    nukeSpeed(type){assert.equal(this,raw);return type==='MIRV'?19:11;},
    warshipTargettingRange(){assert.equal(this,raw);return 200;}};
  const cfg=api(raw).config();assert.equal(cfg.boatMaxNumber(),5);assert.equal(cfg.nukeSpeed('MIRV'),19);assert.equal(cfg.warshipTargettingRange(),200);
});

test('starting gold honors current engine tribe and host-cheat rules',()=>{
  const cfg=api({gameConfig:()=>({startingGold:1000000,hostCheats:{startingGold:5000000}})}).config();
  assert.equal(cfg.startingGold({playerType:'HUMAN',isLobbyCreator:true}),6000000n);
  assert.equal(cfg.startingGold({playerType:'HUMAN',isLobbyCreator:false}),1000000n);
  assert.equal(cfg.startingGold({playerType:'BOT',isLobbyCreator:true}),0n);
});

test('browser config restores water-nuke and gold-multiplier match modifiers',()=>{
  const cfg=api({gameConfig:()=>({waterNukes:true,goldMultiplier:2})}).config();
  assert.equal(cfg.waterNukes(),true);assert.equal(cfg.goldMultiplier(),2);
  const ordinary=api({gameConfig:()=>({})}).config();
  assert.equal(ordinary.waterNukes(),false);assert.equal(ordinary.goldMultiplier(),1);
});
