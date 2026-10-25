'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/support-posture');
function fixture(){
 const U={SAMLauncher:'SAM',City:'City',Port:'Port',TransportShip:'Transport'};
 let tick=100;const owners=new Map(),boats=[],attacks=[];
 const self={smallID:()=>1,isFriendly:p=>p.smallID()===1,units:()=>[sam],borderTiles:()=>[100100,900900],incomingAttacks:()=>attacks};
 const enemy={smallID:()=>2,isPlayer:()=>true,isAlive:()=>true,type:()=> 'Human'};
 const sam={id:()=>1,tile:()=>100100,isActive:()=>true};
 const game={ticks:()=>tick,config:()=>({gameConfig:()=>({gameMode:'Team'})}),
  x:t=>t%1000,y:t=>Math.floor(t/1000),ref:(x,y)=>y*1000+x,isValidCoord:(x,y)=>x>=0&&y>=0&&x<1000&&y<1000,
  isLand:()=>true,hasOwner:t=>owners.has(t),ownerID:t=>owners.get(t),playerBySmallID:id=>id===1?self:enemy,
  neighbors:t=>[t-1,t+1,t-1000,t+1000],units:()=>boats,manhattanDist:(a,b)=>Math.abs(a%1000-b%1000)+Math.abs(Math.floor(a/1000)-Math.floor(b/1000))};
 const opening={borderKnown:true,wilderness:false},model=create({units:U,botType:'BOT',teamMode:'Team'});
 return {game,self,sam,enemy,owners,boats,attacks,opening,next:(n=1)=>tick+=n,observe:()=>model.observe(game,self,opening)};
}
test('safe home supports donations/probes after wilderness without waiting for buildings',()=>{
 const f=fixture(),p=f.observe();assert.equal(p.ready,true);assert.equal(p.conserve,false);assert.equal(p.keepFraction,.25);
});

test('games outside the two-team opening observer retain their existing support rules',()=>{
 const f=fixture();assert.equal(create({units:{},botType:'BOT',teamMode:'Team'}).observe(f.game,f.self,null),null);
});
test('nearby enemy land conserves while a distant colony border does not',()=>{
 const f=fixture();f.owners.set(100124,2);assert.equal(f.observe().conserve,true);
 const g=fixture();g.owners.set(900901,2);assert.equal(g.observe().conserve,false);
});
test('adjacent enemy mainland land is checked even between proximity samples',()=>{
 const f=fixture();f.owners.set(100101,2);assert.equal(f.observe().conserve,true);
});
test('hostile incoming attacks pause support with a short recovery window',()=>{
 const f=fixture();f.attacks.push({attacker:()=>f.enemy});assert.equal(f.observe().conserve,true);
 f.attacks.length=0;f.next();assert.equal(f.observe().conserve,true);
 f.next(50);assert.equal(f.observe().conserve,false);
});
test('approaching enemy transport conserves but a remote crossing does not',()=>{
 const f=fixture();f.boats.push({isActive:()=>true,owner:()=>f.enemy,tile:()=>100150,targetTile:()=>100100});
 assert.equal(f.observe().conserve,true);
 const g=fixture();g.boats.push({isActive:()=>true,owner:()=>g.enemy,tile:()=>100500,targetTile:()=>100100});
 assert.equal(g.observe().conserve,false);
});
test('wilderness opening keeps support gated and unknown geometry conserves',()=>{
 const f=fixture();f.opening.wilderness=true;assert.equal(f.observe().ready,false);
 const g=fixture();g.self.borderTiles=()=>[];g.sam.tile=()=>null;assert.equal(g.observe().conserve,true);
});
