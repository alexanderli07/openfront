'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/bot-statistics');
const {buildSource}=require('../scripts/build');
const vm=require('node:vm');
function fixture(){
 let tick=1,gameId='a';const player={id:()=> 'self'},game={gameID:()=>gameId,ticks:()=>tick};
 const stats=create({units:{AtomBomb:'Atom Bomb',HydrogenBomb:'Hydrogen Bomb',MIRV:'MIRV'}});
 const observe=e=>stats.observe(game,player,e);
 const command=(id,kind,args=[],status='submitted')=>{
  observe({kind:'decision',decisionId:id,selectedId:'c',candidates:[{id:'c',kind,arguments:args}]});
  observe({kind:'dispatch',decisionId:id,status});
 };
 return {stats,observe,command,nextGame:()=>gameId='b',tick:v=>tick=v};
}
test('troop display converts internal units without changing decision values',()=>{
 const f=fixture();assert.equal(f.stats.displayTroops(1440000),144000);
});
test('counts only submitted bot commands and separates nuclear launches from builds',()=>{
 const f=fixture();
 f.command(1,'spawn');f.command(2,'spawn');f.command(3,'attack');f.command(4,'boat');
 f.command(5,'build City',[{type:'City',canBuild:10}]);f.command(6,'upgrade',[{type:'City',canUpgrade:7}]);
 f.command(7,'build Warship',[{type:'Warship'}]);f.command(8,'build Atom Bomb',[{type:'Atom Bomb'}]);
 f.command(9,'build Hydrogen Bomb',[{type:'Hydrogen Bomb'}]);f.command(10,'build MIRV',[{type:'MIRV'}]);
 f.command(11,'donateTroops');f.command(12,'moveWarship');f.command(13,'attack',[],'not-submitted');
 assert.deepEqual(f.stats.snapshot(),{spawns:1,attacks:2,builds:3,nukes:3});
});
test('pending and rejected builds do not increment; a settled success counts once',()=>{
 const f=fixture();f.command(1,'build City',[{type:'City'}],'pending');
 assert.equal(f.stats.snapshot().builds,0);
 f.observe({kind:'dispatch',decisionId:1,status:'submitted'});f.observe({kind:'dispatch',decisionId:1,status:'submitted'});
 f.command(2,'build City',[{type:'City'}],'rejected');assert.equal(f.stats.snapshot().builds,1);
});
test('new match and tick rewind reset counters; old completion cannot leak into next game',()=>{
 const f=fixture();f.command(1,'attack');f.nextGame();f.observe({kind:'session'});
 assert.equal(f.stats.snapshot().attacks,0);f.observe({kind:'dispatch',decisionId:1,status:'submitted'});
 assert.equal(f.stats.snapshot().attacks,0);f.command(2,'attack');f.tick(50);f.observe({kind:'observation'});
 f.tick(1);f.observe({kind:'observation'});assert.equal(f.stats.snapshot().attacks,0);
});
test('shipped panel converts troops only at display and reads central submission counts',()=>{
 const {source}=buildSource();
 assert.ok(source.includes('String(ofhBotStatistics.snapshot().attacks)')); 
 assert.ok(source.includes('observeStatistics:(bot,entry,scope)=>ofhBotStatistics.observe'));
 const start=source.indexOf('function fmt('),end=source.indexOf('function watcher()',start);
 const nodes=new Map();
 const panel={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}};
 const state={live:{troops:1440000,gold:1400000,tiles:100},stats:{spawns:1,attacks:2,builds:3,nukes:4}};
 vm.runInNewContext(source.slice(start,end)+';renderStatus();',{
   document:{getElementById:()=>panel},PANEL_ID:'test',state,ofhBotStatistics:create({units:{}})
 });
 assert.equal(nodes.get('[data-role="s-troops"]').textContent,'144.0k');
 assert.equal(nodes.get('[data-role="s-gold"]').textContent,'1.4M');
 assert.equal(state.live.troops,1440000);
 assert.equal(nodes.get('[data-role="c-attacks"]').textContent,'0');
});
test('watcher refreshes live resources even while automation is disabled',()=>{
 const {source}=buildSource(),start=source.indexOf('function watcher(){'),end=source.indexOf('if(state.tickInFlight',start);
 const calls=[],player={isPlayer:()=>true},game={myPlayer:()=>player};
 vm.runInNewContext(source.slice(start,end)+'};watcher();',{
   buildPanel:()=>{},refreshGateBanner:()=>{},getGame:()=>game,
   updateLive:(g,p)=>calls.push([g,p]),state:{settings:{enabled:false},status:''},
   setStatus:()=>{},tr:s=>s,renderStatus:()=>{}
 });
 assert.deepEqual(calls,[[game,player]]);
});
