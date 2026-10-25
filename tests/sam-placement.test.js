'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/sam-placement');
const U={Port:'Port',City:'City',SAMLauncher:'SAM'};
function fixture(){
 const units=[];const ref=(x,y)=>y*100+x;
 const game={x:t=>t%100,y:t=>Math.floor(t/100),ref,isValidCoord:(x,y)=>x>=0&&x<100&&y>=0&&y<100,
 isLand:()=>true,ownerID:()=>1,hasFallout:()=>false,euclideanDistSquared:(a,b)=>(a%100-b%100)**2+(Math.floor(a/100)-Math.floor(b/100))**2,
 config:()=>({samRange:()=>10})};
 const player={smallID:()=>1,units:type=>units.filter(u=>u.type()===type)};
 const add=(type,x,y,extra={})=>{const unit={type:()=>type,tile:()=>ref(x,y),isActive:()=>true,isUnderConstruction:()=>false,level:()=>1,...extra};units.push(unit);return unit;};
 return {actor:{game,player},ref,add,planner:create({units:U})};
}
test('coastal SAM measurements anchor to ports even when a city would increase total coverage',()=>{
 const f=fixture();f.add(U.Port,10,10);f.add(U.City,70,70);
 const plan=f.planner.prepare(f.actor);assert.equal(plan.anchorKind,'Port');
 assert.ok(plan.metrics(f.ref(12,10)).samAnchorDistance<plan.metrics(f.ref(68,70)).samAnchorDistance);
 assert.ok(plan.tiles.length>0);assert.ok(plan.tiles.every(t=>f.actor.game.ownerID(t)===1));
});
test('factory SAMs anchor to physical cities including those under construction',()=>{
 const f=fixture();f.add(U.City,30,30,{isUnderConstruction:()=>true});
 const plan=f.planner.prepare(f.actor);assert.equal(plan.anchorKind,'City');assert.equal(plan.metrics(f.ref(32,30)).samAnchorDistance,2);
});
test('later SAMs favor less protected ports; unfinished SAMs do not count as protection',()=>{
 const f=fixture();f.add(U.Port,10,10);f.add(U.Port,60,10);f.add(U.SAMLauncher,10,10);
 let plan=f.planner.prepare(f.actor);assert.equal(plan.metrics(f.ref(11,10)).samAnchorTile,f.ref(60,10));
 f.add(U.SAMLauncher,60,10,{isUnderConstruction:()=>true});plan=f.planner.prepare(f.actor);
 assert.equal(plan.metrics(f.ref(61,10)).samAnchorTile,f.ref(60,10));assert.equal(plan.metrics(f.ref(61,10)).samAnchorProtection,0);
});
test('SAM samples exclude foreign/water/fallout tiles and are bounded',()=>{
 const f=fixture();for(let i=0;i<30;i++)f.add(U.City,10+i,20);
 f.actor.game.ownerID=t=>t%2?2:1;f.actor.game.isLand=t=>t%3!==0;f.actor.game.hasFallout=t=>t%5===0;
 const plan=f.planner.prepare(f.actor);assert.ok(plan.tiles.length<=160);assert.ok(plan.tiles.every(t=>t%2===0&&t%3!==0&&t%5!==0));
});

test('factory mode ignores ports on water that is not used for the economy',()=>{
 const f=fixture();f.add(U.Port,10,10);f.add(U.City,70,70);
 const plan=f.planner.prepare(f.actor,'factory');assert.equal(plan.anchorKind,'City');
 assert.equal(plan.metrics(f.ref(71,70)).samAnchorDistance,1);
});

test('no priority economy buildings retains the ordinary SAM candidate pool',()=>{
 const f=fixture();const plan=f.planner.prepare(f.actor);assert.equal(plan.anchorKind,null);assert.deepEqual(plan.tiles,[]);assert.deepEqual(plan.metrics(0),{});
});
