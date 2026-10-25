'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/port-water-access');
function fixture(){
 let tick=100,reads=0;const edges=new Map([[1,[0,2]],[2,[1,3]],[3,[2,4]],[4,[3]]]);const sea=new Set();
 const game={ticks:()=>tick,isLand:t=>t===0,isWater:t=>t>0,isOcean:t=>sea.has(t),
  neighbors:t=>{reads++;return t===0?[1]:edges.get(t)||[];},getWaterComponent:()=>7};
 return {game,sea,edges,reads:()=>reads,next:(n=1)=>tick+=n};
}
test('rejects an enclosed lake even if it is a buildable shore',()=>{
 const f=fixture(),r=create().assess(f.game,0);assert.equal(r.allowed,false);assert.match(r.reason,/enclosed/i);
});
test('direct open sea and a river connected to it are valid port water',()=>{
 for(const witness of [1,4]){const f=fixture();f.sea.add(witness);assert.equal(create().assess(f.game,0).allowed,true);}
});
test('unknown topology never authorises a port',()=>{
 const f=fixture();delete f.game.getWaterComponent;
 assert.equal(create().assess(f.game,0).allowed,false);
});
test('incremental exploration holds until an ocean witness is actually found',()=>{
 const f=fixture(),access=create({perCall:1,perTick:1});f.sea.add(4);
 assert.equal(access.assess(f.game,0).allowed,false);
 for(let i=0;i<4;i++){f.next();access.assess(f.game,0);}
 assert.equal(access.assess(f.game,0).allowed,true);
});
test('closed component cache refreshes after a waterway opens',()=>{
 const f=fixture(),access=create();assert.equal(access.assess(f.game,0).allowed,false);
 f.sea.add(4);f.next(41);assert.equal(access.assess(f.game,0).allowed,true);
});

test('many lake components cannot evict an unfinished river search forever',()=>{
 let tick=0;const game={ticks:()=>tick,isLand:t=>t<=0,isWater:t=>t>0,isOcean:t=>t===4001,
  getWaterComponent:t=>t<=4001?7:t,
  neighbors:t=>t===0?[1]:t<0?[5000-t]:t>4001?[]:[...(t>1?[t-1]:[]),...(t<4001?[t+1]:[])]};
 const access=create();
 for(let i=0;i<20;i++){access.assess(game,0);for(let lake=1;lake<=65;lake++)access.assess(game,-lake);tick++;}
 assert.equal(access.assess(game,0).allowed,true);
});
