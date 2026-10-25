'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/wilderness-crossing');
function fixture(width=2){
 let tick=100,checks=0;const own=new Set(),fallout=new Set();
 const ref=(x,y)=>y*50+x;
 for(let y=0;y<20;y++)for(let x=0;x<10;x++)own.add(ref(x,y));
 const game={ticks:()=>tick,isLand:t=>t%50<10||t%50>=10+width,isWater:t=>t%50>=10&&t%50<10+width,
  isShore:t=>t%50===9||t%50===10+width,hasOwner:t=>own.has(t),ownerID:t=>own.has(t)?1:0,hasFallout:t=>fallout.has(t),
  neighbors:t=>{checks++;const x=t%50,y=Math.floor(t/50);return [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]
   .filter(([a,b])=>a>=0&&b>=0&&a<50&&b<20).map(([a,b])=>ref(a,b));}};
 const player={smallID:()=>1,borderTiles:()=>new Set(Array.from({length:20},(_,y)=>ref(9,y)))};
 const actor={game,player};
 return {game,actor,own,fallout,ref,sites:()=>create().sites(actor),checks:()=>checks,next:()=>tick++};
}
test('finds a neutral opposite bank over a narrow river with room to expand',()=>{
 const f=fixture(),sites=f.sites();assert.ok(sites.length);assert.ok(sites.every(s=>s.tile%50===12));
 assert.equal(sites[0].crossingSteps,3);assert.ok(sites[0].room>=8);
});
test('wide water and owned or fallout shores are not nearby wilderness crossings',()=>{
 assert.equal(fixture(16).sites().length,0);
 for(const mode of ['owned','fallout']){
  const f=fixture();for(let y=0;y<20;y++)for(let x=12;x<50;x++)(mode==='owned'?f.own:f.fallout).add(f.ref(x,y));
  assert.equal(f.sites().length,0);
 }
});
test('neutral coast already touching our same-bank land is not a river destination',()=>{
 const f=fixture();f.own.delete(f.ref(9,10));const sites=f.sites();
 assert.ok(sites.every(s=>s.tile%50>=12));
});
test('one-tile neutral scraps are skipped and scanning stays bounded',()=>{
 const f=fixture();f.game.isLand=t=>t%50<10||t===f.ref(12,10);f.game.isWater=t=>!f.game.isLand(t);
 f.game.isShore=t=>t%50===9||t===f.ref(12,10);
 assert.equal(f.sites().length,0);assert.ok(f.checks()<21000);
});
