'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const create=fs.existsSync(path.join(__dirname,'../src/brain/opening-expansion.js'))?require('../src/brain/opening-expansion'):null;
const legacy=require('../src/brain/legacy-strategy')(),adaptive=require('../src/brain/adaptive-strategy')(legacy);
function fixture(options={}){
 let troops=0,tick=1;const sends=[],records=[];
 const actor={player:{troops:()=>troops,borderTiles:()=>new Set([0])},game:{ticks:()=>tick,
   config:()=>({maxTroops:()=>options.capacity||20000}),neighbors:t=>[t+1].filter(n=>n<=(options.space??1000)),
   isLand:()=>true,hasOwner:()=>false,hasFallout:()=>false}};
 const opening={borderKnown:true,wilderness:true,frontline:false};
 const hooks={allowed:()=>true,hold(){},wasDeclined:()=>false,execute:(_id,run)=>run(),record:(kind,r)=>records.push({kind,...r}),
   choose:(domain,cs,facts)=>({...adaptive.decide({domain,openingExpansion:facts},cs),decisionId:records.length+1})};
 actor._landAttackReady=(_target,_counter,amount)=>{sends.push(amount);return options.sent!==false;};
 const planner=create&&create();
 return {actor,opening,hooks,sends,records,planner,
   run:(n,at)=>{troops=n;if(at!==undefined)tick=at;return planner.run(actor,{},opening,hooks);}};
}
test('early expansion sends 20% before the old reserve and follows rebuild checkpoints',()=>{
 assert.equal(typeof create,'function');const f=fixture();
 assert.equal(f.run(3999).result,false);assert.equal(f.run(4000,2).result,true);assert.equal(f.sends[0],800);
 assert.equal(f.run(4000,3).result,false);
 // The first 20%-capacity wave also satisfies a coincident 4k checkpoint.
 assert.equal(f.run(4999,12).result,false);assert.equal(f.run(5000,13).result,true);
 assert.equal(f.run(6000,23).result,true);assert.equal(f.run(8000,33).result,true);
 assert.equal(f.run(10000,43).result,true);assert.equal(f.run(10000,53).result,true);assert.equal(f.run(10000,63).result,true);
 assert.deepEqual(f.sends,[800,1000,1200,1600,2000,2000,2000]);
});
test('a smaller initial capacity triggers the first wave at 20% then rebuilds to 4k',()=>{
 const f=fixture({capacity:10000});assert.equal(f.run(2000).result,true);
 assert.equal(f.run(3999,11).result,false);assert.equal(f.run(4000,12).result,true);
});
test('failed dispatch does not consume a checkpoint or start its spacing cooldown',()=>{
 const f=fixture({sent:false});f.run(4000,1);f.run(4000,2);assert.deepEqual(f.sends,[800,800]);
});
test('frontline and exhausted wilderness keep the original allocation',()=>{
 const f=fixture();f.opening.frontline=true;assert.equal(f.run(5000),undefined);
 f.opening.frontline=false;f.opening.wilderness=false;assert.equal(f.run(5000),undefined);
});

test('outgoing combat and sticky threat reserves keep the original allocation after border contact ends',()=>{
 const f=fixture();f.actor.underThreat=()=>true;
 assert.equal(f.run(5000),undefined);assert.equal(f.sends.length,0);
 f.actor.underThreat=()=>false;assert.equal(f.run(5000,2).result,true);
});
test('after repeated 10k waves crowded starts hold 10k while open starts rebuild higher',()=>{
 for(const space of [100,1000]){
   const f=fixture({space});for(const [i,n] of [4000,5000,6000,8000,10000,10000,10000].entries())f.run(n,1+i*10);
   assert.equal(f.run(10000,71).result,space===100);
   if(space===1000)assert.equal(f.run(13000,72).result,true);
 }
});

test('cleared opening does not restart early waves when wilderness reappears later',()=>{
 const f=fixture();f.run(4000);f.opening.wilderness=false;f.planner.finishIfCleared(f.actor,f.opening);
 f.opening.wilderness=true;assert.equal(f.run(10000,100),undefined);
});

test('a confirmed river landing resumes the existing expansion schedule',()=>{
 const f=fixture();f.run(4000);f.opening.wilderness=false;f.planner.finishIfCleared(f.actor,f.opening);
 f.planner.resumeAfterCrossing(f.actor);f.opening.wilderness=true;
 assert.equal(f.run(5000,100).result,true);
});

test('legacy and policy holds do not consume adaptive checkpoints',()=>{
 const f=fixture(),choose=f.hooks.choose;
 f.hooks.choose=(domain,cs)=>({...legacy.decide({domain},cs),decisionId:1});
 assert.equal(f.run(4000),undefined);assert.equal(f.sends.length,0);
 f.hooks.choose=()=>({selectedId:'$wait',reason:'policy hold',decisionId:2});
 assert.equal(f.run(4000,2).result,false);assert.equal(f.sends.length,0);
 f.hooks.choose=choose;assert.equal(f.run(4000,3).result,true);assert.deepEqual(f.sends,[800]);
});
