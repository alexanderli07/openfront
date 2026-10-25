'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname,'../src/brain/strike-ranking.js');
const create = fs.existsSync(file) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy');
function player(id,tiles,team=null,extra={}) {
  return { id: () => String(id), smallID: () => id, numTilesOwned: () => tiles, team: () => team,
    isPlayer: () => true, isAlive: () => true, type: () => 'Human', units: () => [{ level: () => 10 }], ...extra };
}
function fixture(players,options={}) {
  const self = player(0,1,options.team ?? null), records=[];
  self.isFriendly = p => p.friendly === true;
  const actor = { player: self, game: { players: () => [self,...players], numLandTiles: () => 100,
    numTilesWithFallout: () => 0, config: () => ({ gameConfig: () => ({ gameMode: options.mode || 'FFA' }), maxTroops: p => p.power ?? 10 }) },
    getValidMirvTargetPlayers: () => players, isInboundMIRVFrom: p => p.inbound !== false,
    countCities: p => p.cities ?? 0, victoryDenialTeamThreshold: .6, victoryDenialIndividualThreshold: .4,
    steamrollMinLeaderCities: 8, steamrollCityGapMultiplier: 1.15 };
  const rank = create({ settings: () => options.settings || {}, difficulty: () => 'Impossible',
    ffa: 'FFA', team: 'Team', botType: 'Bot', structureTypes: ['City'], densityThreshold: .1, minLevels: 5 });
  const hooks = { allowed: () => true, choose: (domain,candidates,facts) => {
    records.push({domain,candidates,facts}); return { ...(options.choose ? options.choose(candidates) : legacy().decide({domain},candidates)), decisionId: 1 };
  }, record: (kind,data) => records.push({kind,...data}) };
  return { actor,rank,hooks,records,run: mode => rank.select(actor,mode,hooks) };
}
test('strike ranking adapter exists',()=>assert.equal(typeof create,'function'));
test('counter uses largest inbound territory and first tie',()=>{
  const a=player(1,20),b=player(2,20),c=player(3,90,null,{inbound:false});
  const f=fixture([a,b,c]);assert.equal(f.run('counter').target,a);
});
test('win-fix excludes exact share boundary and limits top living players',()=>{
  const a=player(1,35),b=player(2,40),c=player(3,50,null,{isAlive:()=>false});
  const f=fixture([a,b,c],{settings:{mirvTargetTopN:1}});assert.equal(f.run('win-fix').target,b);
});
test('victory denial uses largest team representative and severity',()=>{
  const a=player(1,30,'red'),b=player(2,30,'red'),c=player(3,40);
  const f=fixture([a,b,c]);assert.equal(f.run('denial').target,a);
});
test('steamroll minimum is strict and gap comparison inclusive',()=>{
  const a=player(1,10,null,{cities:8}),b=player(2,10,null,{cities:4});
  const f=fixture([a,b]);assert.equal(f.run('steamroll').target,null);
  a.cities=10;f.actor.steamrollCityGapMultiplier=2.5;assert.equal(f.run('steamroll').target,a);
});
test('density threshold is strict and ties keep first',()=>{
  const a=player(1,100),b=player(2,50),c=player(3,50);
  const f=fixture([a,b,c]);assert.equal(f.run('density').target,b);
});
test('strongest-team power ties select last, without trying another team',()=>{
  const a=player(1,30,'red'),b=player(2,30,'red'),c=player(3,20,'blue');
  const f=fixture([a,b,c],{mode:'Team'});assert.equal(f.run('team').target,b);
  a.friendly=b.friendly=true;assert.equal(f.run('team').target,null);
});
test('bounded ranking retains winner beyond index 79 and lets policy select another',()=>{
  const ps=Array.from({length:100},(_,i)=>player(i+1,i+1)),f=fixture(ps);
  assert.equal(f.run('counter').target,ps[99]);assert.equal(f.records[0].candidates.length,80);
  const g=fixture(ps,{choose:cs=>({selectedId:cs[1].id,reason:'Second'})});assert.equal(g.run('counter').target,ps[98]);
});
test('nonempty wait stops parent, empty legacy ranking permits fallback',()=>{
  const f=fixture([player(1,10)],{choose:()=>({selectedId:'$wait',reason:'Hold'})});assert.equal(f.run('counter').stop,true);
  const g=fixture([]);assert.equal(g.run('counter').stop,false);
});

function runtimeFixture(policy) {
  const f=fixture([player(1,60),player(2,20)]),calls=[];
  const state={settings:{winFixes:true},nukeReserveGold:7n};
  f.actor.player.gold=()=>100n;f.actor.game.myPlayer=()=>f.actor.player;f.actor.game.ticks=()=>100;
  Object.assign(f.actor,{teamHasWon:()=>false,wasRecentlyMirved:()=>false,
    maybeSendMIRV:async p=>calls.push(['send',p]),attackBehavior:{findIncomingAttackPlayer:()=>null}});
  const runtime=require('../src/brain/runtime')({createEngine:require('../src/brain/engine'),createLegacyStrategy:legacy,
    strikeRanking:f.rank,strikePlanner:require('../src/brain/strike-planner')({state}),
    strikeTargetPlanner:require('../src/brain/strike-target-planner')({difficulty:()=> 'Impossible',ffa:'FFA',friendly:1,hostile:-1}),
    enabled:()=>true,isCurrent:()=>true,isPublic:()=>false,settings:()=>state.settings,strategies:policy?[policy]:[]});
  for(const [method,mode] of Object.entries({selectWinFixMirvTarget:'win-fix',selectCounterMirvTarget:'counter',selectVictoryDenialTarget:'denial',selectSteamrollStopTarget:'steamroll',findHighDensityTarget:'density',findFFACrownTarget:'crown',findStrongestTeamTarget:'team'})) {
    f.actor[method]=()=>runtime.selectStrikePlayer(f.actor,mode);
  }
  const bot={mg:f.actor.game,mirvBehavior:f.actor};runtime.attach(bot);runtime.attachBehaviors(bot);
  if(policy)runtime.select(policy.id);
  return {...f,runtime,state,calls};
}
for(const domain of ['mirv-target','nuke-player'])for(const throws of [false,true]) {
  test(`nested ${domain} ${throws?'error':'wait'} stops purpose and restores next pass`,async()=>{
    const base=legacy(),f=runtimeFixture({id:'hold',version:'1',decide(s,cs){
      if(s.domain!==domain)return base.decide(s,cs);
      if(throws)throw Error('policy');return {selectedId:'$wait',reason:'Hold ranking'};
    }});
    const run=()=>domain==='mirv-target'?f.runtime.planMirv(f.actor,10n):f.runtime.selectNukeTarget(f.actor);
    assert.equal(await run(),domain==='mirv-target'?false:null);
    assert.deepEqual(f.calls,[]);assert.equal(f.state.nukeReserveGold,7n);
    assert.equal(f.runtime.inspect().records.some(r=>r.kind==='strategy-error'),throws);
    f.runtime.select('legacy-v1');assert.ok(await run());
    const mode=domain==='mirv-target'?'win-fix':'density';f.runtime.selectStrikePlayer(f.actor,mode);
    const ds=f.runtime.inspect().records.filter(r=>r.kind==='decision'&&r.snapshot.domain===domain);
    assert.ok(ds.some(d=>d.snapshot.parentDecisionId!==undefined));assert.equal(ds.at(-1).snapshot.parentDecisionId,undefined);
    const trace=f.runtime.inspect();trace.records=trace.records.filter(r=>r.kind!=='decision'||r.strategy.id==='legacy-v1');
    const replay=f.runtime.replay('legacy-v1',trace);assert.ok(replay.length);assert.ok(replay.every(r=>r.sameChoice));
  });
}
test('exception in nested ranking restores standalone parent context',async()=>{
  const f=runtimeFixture(),original=f.actor.getValidMirvTargetPlayers;
  f.actor.getValidMirvTargetPlayers=()=>{throw Error('ranking read');};
  await assert.rejects(f.runtime.planMirv(f.actor,10n),/ranking read/);
  f.actor.getValidMirvTargetPlayers=original;assert.ok(f.runtime.selectStrikePlayer(f.actor,'win-fix'));
  const last=f.runtime.inspect().records.filter(r=>r.kind==='decision').at(-1);assert.equal(last.snapshot.parentDecisionId,undefined);
});
