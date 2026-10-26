'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),file='../src/brain/warship-trade-hotspots';
const create=fs.existsSync(require('node:path').join(__dirname,file+'.js'))?require(file):null;
function fixture(){
 let tick=100,traffic=[],enemies=[],nukes=[],ports=[];
 const self={id:()=>1,isFriendly:p=>p.id()===1||p.id()===2,units:()=>fleet};
 const hostile={id:()=>3},friend={id:()=>2};
 const ship=(id,tile)=>({id:()=>id,tile:()=>tile,isActive:()=>true,isUnderConstruction:()=>false});
 const fleet=[ship(1,0),ship(2,0)];
 const game={ticks:()=>tick,x:t=>t,y:()=>0,isWater:t=>t!==200,getWaterComponent:t=>t>=1000?2:1,
  manhattanDist:(a,b)=>Math.abs(a-b),neighbors:t=>[t-1,t+1],
  units:(...types)=>types.includes('TradeShip')?traffic:types.includes('Warship')?enemies:types.includes('Port')?ports:nukes};
 const actor={game,player:self,nukeOuterRadius:()=>50};
 const trade=(id,tile,opts={})=>({id:()=>id,tile:()=>tile,isActive:()=>true,
  owner:()=>opts.friendly?friend:hostile,isSafeFromPirates:()=>!!opts.safe,
  targetUnit:()=>({owner:()=>opts.ownDestination?self:hostile})});
 const observer=create?.({units:{Port:'Port',TradeShip:'TradeShip',Warship:'Warship',AtomBomb:'Atom',HydrogenBomb:'Hydro',MIRVWarhead:'Mirv'}});
 return {observer,actor,fleet,trade,ship,setTraffic:v=>traffic=v,setEnemies:v=>enemies=v,setNukes:v=>nukes=v,
  setPorts:v=>ports=v,next:(n=20)=>tick+=n,rank:(s=fleet[0])=>observer.rank(actor,s)};
}
test('hotspot observer exists',()=>assert.equal(typeof create,'function'));
test('dense traffic outranks a nearby lone ship and never picks a land centroid',()=>{
 const f=fixture();f.setTraffic([f.trade(1,10),f.trade(2,190),f.trade(3,210),f.trade(4,215),f.trade(5,220)]);
 const best=f.rank()[0];assert.ok(best.tile>=190);assert.notEqual(best.tile,200);assert.ok(best.density>=4);
});
test('traffic filters protected and friendly ships and disconnected water',()=>{
 const f=fixture();f.setTraffic([f.trade(1,30,{friendly:true}),f.trade(2,40,{safe:true}),f.trade(3,50,{ownDestination:true}),f.trade(4,1100)]);
 assert.deepEqual(f.rank(),[]);
});
test('fixed assignment survives moving traffic, then expires after the lane dries up',()=>{
 const f=fixture();f.setTraffic([f.trade(1,160),f.trade(2,170)]);
 const chosen=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],chosen);
 f.next();f.setTraffic([f.trade(1,180),f.trade(2,185)]);assert.equal(f.rank()[0].tile,chosen.tile);
 f.setTraffic([]);f.next(200);assert.equal(f.rank()[0].tile,chosen.tile);
 f.next(700);assert.deepEqual(f.rank(),[]);
});
test('assignments spread ships across similarly productive separated areas',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180),f.trade(2,185),f.trade(3,190),f.trade(4,450),f.trade(5,455),f.trade(6,460)]);
 const first=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],first);
 const second=f.rank(f.fleet[1])[0];assert.ok(Math.abs(first.tile-second.tile)>100);
});
test('dangerous enemy fleets and incoming nuclear blast zones exclude hotspots',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180),f.trade(2,185)]);
 f.setEnemies([{...f.ship(9,185),owner:()=>({id:()=>3})}]);assert.deepEqual(f.rank(),[]);
 f.setEnemies([]);f.next();f.setNukes([{isActive:()=>true,targetTile:()=>180}]);assert.deepEqual(f.rank(),[]);
});
test('deployment chooses adjacent water in the productive reachable component',()=>{
 const f=fixture();f.setTraffic([f.trade(1,1500),f.trade(2,1510)]);
 const ports=[f.ship(7,10),f.ship(8,1300)];const candidates=f.observer.deployment(f.actor,ports);
 assert.equal(candidates[0].portTile,1300);assert.ok(candidates[0].tile>=1000);
});
test('assignments reset when the game clock rewinds',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);f.observer.assign(f.actor,f.fleet[0],f.rank()[0]);
 f.setTraffic([]);f.next(-90);assert.deepEqual(f.rank(),[]);
});
test('assignment stays fixed across traffic grid boundaries',()=>{
 const f=fixture();f.setTraffic([f.trade(1,155),f.trade(2,150)]);
 const chosen=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],chosen);
 f.next();f.setTraffic([f.trade(1,165),f.trade(2,170)]);assert.equal(f.rank()[0].tile,chosen.tile);
});
test('new nuclear hazards are observed before the traffic sampling interval elapses',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);assert.ok(f.rank().length);
 f.next(1);f.setNukes([{isActive:()=>true,targetTile:()=>180}]);assert.deepEqual(f.rank(),[]);
});
test('current browser UnitView destination IDs work without engine-only piracy getters',()=>{
 const f=fixture(),hostile={id:()=>3};
 f.setPorts([{id:()=>70,owner:()=>hostile},{id:()=>71,owner:()=>f.actor.player}]);
 const currentView=(id,target)=>({id:()=>id,tile:()=>180,isActive:()=>true,owner:()=>hostile,
  __src:{targetUnitId:()=>target}});
 f.setTraffic([currentView(1,70),currentView(2,71)]);
 const area=f.rank()[0];assert.equal(area.density,1);assert.equal(area.protectionUnknown,1);
});
test('a better area must wait out the minimum assignment period before switching',()=>{
 const f=fixture(),original=[f.trade(1,180),f.trade(2,185)];f.setTraffic(original);
 const chosen=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],chosen);
 f.setTraffic([...original,...Array.from({length:8},(_,i)=>f.trade(10+i,450+i))]);
 f.next();assert.equal(f.rank()[0].tile,chosen.tile);
 f.next(300);assert.ok(f.rank()[0].tile>=450);
});
test('a ship inside an incoming blast zone cannot receive a trade-area command',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);
 f.setNukes([{isActive:()=>true,targetTile:()=>0}]);assert.deepEqual(f.rank(),[]);
});
