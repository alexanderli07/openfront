'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/economy-status');
function fixture(){
 let tick=0,earned=1000,gold=4800000n,gameId='a';
 const player={id:()=> 'self',gold:()=>gold,goldEarned:()=>earned};
 const game={ticks:()=>tick,gameID:()=>gameId};
 const status=create(),format=n=>Number(n)>=1e6?(Number(n)/1e6).toFixed(1)+'M':String(n);
 return {status,game,player,set:v=>{tick=v.tick??tick;earned=v.earned??earned;gold=v.gold??gold;gameId=v.gameId??gameId;},
   view:()=>status.view(game,player,{enabled:true,buildEnabled:true,format}),observe:e=>status.observe(game,player,e)};
}
test('gross income uses native earned gold and ignores expenditure',()=>{
 const f=fixture();assert.equal(f.view().income,null);
 f.set({tick:100,earned:11000,gold:100n});assert.equal(f.view().income,60000);
 f.set({tick:200,earned:21000,gold:50n});assert.equal(f.view().income,60000);
});
test('new matches, rewinds, missing data and pauses do not invent income',()=>{
 const f=fixture();f.view();f.set({tick:10,earned:2000});assert.equal(f.view().income,60000);
 f.set({gameId:'b'});assert.equal(f.view().income,null);
 f.set({tick:1});assert.equal(f.view().income,null);
 f.player.goldEarned=undefined;assert.equal(f.view().income,null);
});
test('planned SAM savings show upgrade plus emergency reserve using live balance',()=>{
 const f=fixture();f.observe({kind:'decision',decisionId:1,selectedId:'$wait',snapshot:{domain:'structure-plan',defenseEconomy:{
   reserve:'6000000',emergencyReserve:'3000000'}},candidates:[
   {id:'structure:sam-development',kind:'structure-plan',unitType:'SAM Launcher',action:'sam-upgrade',eligible:true,
    affordable:false,perceivedCost:'3000000',targetLevel:3},{id:'$wait',kind:'wait'}]});
 const v=f.view();assert.match(v.purchase,/SAM.*upgrade/i);assert.match(v.purchase,/4.8M \/ 6.0M/);assert.match(v.purchase,/Saving/);
 f.set({gold:6100000n});assert.match(f.view().purchase,/Next/);
});
test('initial economy target keeps only its actual protected reserve',()=>{
 const f=fixture();f.set({gold:500000n});f.observe({kind:'decision',decisionId:1,selectedId:'$wait',snapshot:{domain:'structure-plan',
   defenseEconomy:{requiredType:'Port',reserve:'0'}},candidates:[{id:'required',kind:'structure-plan',unitType:'Port',eligible:true,perceivedCost:'1000000',affordable:false}]});
 assert.match(f.view().purchase,/Port.*500000 \/ 1.0M/);
});
test('actual build quote replaces estimate and success clears the target',()=>{
 const f=fixture();f.observe({kind:'decision',decisionId:2,selectedId:'c',snapshot:{},candidates:[{
   id:'c',kind:'build Port',arguments:[{type:'Port',cost:'1200000',canBuild:12}],spending:{reserve:'3000000',allowed:false}}]});
 assert.match(f.view().purchase,/Port.*4.8M \/ 4.2M/);
 f.observe({kind:'dispatch',decisionId:2,status:'submitted'});assert.equal(f.view().purchase,'Next purchase: Evaluating');
});
test('disabled automation and disabled building do not advertise active saving',()=>{
 const f=fixture();assert.equal(f.status.view(f.game,f.player,{enabled:false,buildEnabled:true,format:String}).purchase,'Next purchase: Paused');
 assert.equal(f.status.view(f.game,f.player,{enabled:true,buildEnabled:false,format:String}).purchase,'Next purchase: Building off');
});
test('a blocked build retains its real quote while waiting for money or pacing',()=>{
 const f=fixture();f.observe({kind:'decision',decisionId:2,selectedId:'$wait',snapshot:{},candidates:[{
   id:'c',kind:'build Port',arguments:[{type:'Port',cost:'1200000',canBuild:12}],eligible:false,
   spending:{reserve:'3000000',allowed:false}},{id:'$wait',kind:'wait'}]});
 assert.match(f.view().purchase,/Port.*4.8M \/ 4.2M/);
});
test('construction has no invented zero price and stale targets expire',()=>{
 const f=fixture();f.observe({kind:'decision',decisionId:1,selectedId:'$wait',snapshot:{domain:'structure-plan',defenseEconomy:{waitingForSam:true}},candidates:[]});
 assert.equal(f.view().purchase,'Next purchase: SAM constructing');f.set({tick:101});
 assert.equal(f.view().purchase,'Next purchase: Evaluating');
});
