'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),file='../src/brain/warship-trade-hotspots';
const create=fs.existsSync(require('node:path').join(__dirname,file+'.js'))?require(file):null;
function fixture(options={}){
 let clock=10000,tick=100,traffic=[],enemies=[],nukes=[],ports=[];
 const self={id:()=>1,smallID:()=>1,isOnSameTeam:p=>p.id()===1||p.id()===2,isFriendly:p=>p.id()===1||p.id()===2,units:type=>type==='Port'?homePorts:fleet};
 const hostile={id:()=>3},friend={id:()=>2};
 const ship=(id,tile)=>({id:()=>id,tile:()=>tile,isActive:()=>true,isUnderConstruction:()=>false});
 const fleet=[ship(1,0),ship(2,300)];
 let homePorts=[0,300,1300].map((tile,id)=>({...ship(100+id,tile),owner:()=>self}));
 const game={ticks:()=>tick,x:t=>typeof t==='object'?t.x:t,y:t=>typeof t==='object'?t.y:0,ref:(x,y)=>({x,y}),isValidCoord:()=>true,isWater:()=>true,getWaterComponent:t=>(t?.x??t)>=1000?2:1,
  manhattanDist:(a,b)=>Math.abs((a?.x??a)-(b?.x??b))+Math.abs((a?.y??0)-(b?.y??0)),neighbors:t=>[t-1,t+1],
  players:()=>[self],units:(...types)=>types.includes('TradeShip')?traffic:types.includes('Warship')?enemies:types.includes('Port')?ports:nukes};
 const actor={game,player:self,nukeOuterRadius:()=>50};
 const trade=(id,tile,opts={})=>({id:()=>id,tile:()=>tile,isActive:()=>true,
  owner:()=>opts.friendly?friend:hostile,isSafeFromPirates:()=>!!opts.safe,
  targetUnit:()=>({owner:()=>opts.ownDestination?self:hostile})});
 const observer=create?.({minTraffic:options.useProductionThreshold?undefined:options.minTraffic??1,now:()=>clock,units:{Port:'Port',TradeShip:'TradeShip',Warship:'Warship',AtomBomb:'Atom',HydrogenBomb:'Hydro',MIRVWarhead:'Mirv'}});
 return {observer,actor,fleet,trade,ship,setTraffic:v=>traffic=v,setEnemies:v=>enemies=v,setNukes:v=>nukes=v,
  setPorts:v=>ports=v,setHomePorts:v=>homePorts=v,advanceMs:n=>clock+=n,next:(n=20)=>{tick+=n;clock+=n*100;},rank:(s=fleet[0])=>observer.rank(actor,s)};
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
 const f=fixture();f.setHomePorts([{...f.ship(100,1400),owner:()=>f.actor.player}]);f.setTraffic([f.trade(1,1500),f.trade(2,1510)]);
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
test('a viable post stays assigned even when another area scores much higher',()=>{
 const f=fixture(),original=[f.trade(1,180),f.trade(2,185)];f.setTraffic(original);
 const chosen=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],chosen);
 f.setTraffic([...original,...Array.from({length:8},(_,i)=>f.trade(10+i,450+i))]);
 f.next();assert.equal(f.rank()[0].tile,chosen.tile);
 f.next(300);assert.equal(f.rank()[0].tile,chosen.tile);
});
test('a ship inside an incoming blast zone cannot receive a trade-area command',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);
 f.setNukes([{isActive:()=>true,targetTile:()=>0}]);assert.deepEqual(f.rank(),[]);
});

test('narrow rivers do not contribute traffic or qualify as piracy posts',()=>{
 const f=fixture();f.actor.game.isWater=t=>f.actor.game.x(t)>=300||Math.abs(f.actor.game.y(t))<=2;
 f.setTraffic([...Array.from({length:10},(_,i)=>f.trade(i,180+i)),f.trade(20,450),f.trade(21,460)]);
 const area=f.rank(f.fleet[1])[0];assert.ok(area.tile>=450);assert.equal(area.density,2);assert.equal(area.clearance,12);
});
test('post viability uses30seconds of wall time even if game ticks race ahead',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);const area=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],area);
 f.setTraffic([]);f.next(1);assert.equal(f.rank()[0].tile,area.tile);
 f.advanceMs(30000);assert.deepEqual(f.rank(),[]);
});
test('destroyed ships leave a replaceable post that survives waiting for money',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);const area=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],area);
 f.fleet.splice(0);assert.equal(f.observer.replacement(f.actor).tile,area.tile);
 f.next(400);assert.equal(f.observer.replacement(f.actor).tile,area.tile);
});
test('replacement submission waits for confirmation and binds the new ship to the same post',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);const area=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],area);
 f.fleet.splice(0);const replacement=f.observer.replacement(f.actor);f.observer.replacementSubmitted(f.actor,replacement);
 assert.equal(f.observer.replacement(f.actor),null);
 const fresh=f.ship(9,10);f.fleet.push(fresh);assert.equal(f.rank(fresh)[0].tile,area.tile);
 assert.equal(f.observer.replacement(f.actor),null);
});
test('an unassigned ship can fill a vacant post without buying another',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);const area=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],area);
 f.fleet.splice(0,1);assert.equal(f.observer.replacement(f.actor),null);
 assert.equal(f.rank(f.fleet[0])[0].tile,area.tile);
});
test('a remote old post cannot request replacement or trap an idle ship',()=>{
 const f=fixture();f.setHomePorts([{...f.ship(100,0),owner:()=>f.actor.player}]);f.setTraffic([f.trade(1,600)]);
 const old={key:'old',tile:600,component:1,density:10,reviewedAt:10000};
 f.observer.assign(f.actor,f.fleet[0],old);f.fleet.splice(0);
 assert.equal(f.observer.replacement(f.actor),null);assert.equal(f.observer.waitingReplacement(f.actor),false);
 const idle=f.ship(9,0);f.fleet.push(idle);assert.deepEqual(f.rank(idle),[]);
});
test('unconfirmed replacement expires and can retry without forgetting the post',()=>{
 const f=fixture();f.setTraffic([f.trade(1,180)]);const area=f.rank()[0];f.observer.assign(f.actor,f.fleet[0],area);
 f.fleet.splice(0);f.observer.replacementSubmitted(f.actor,f.observer.replacement(f.actor));
 f.advanceMs(11000);assert.equal(f.observer.replacement(f.actor),null);
 f.advanceMs(20000);assert.equal(f.observer.replacement(f.actor).tile,area.tile);
});

test('very dense remote enemy traffic cannot beat a useful local post',()=>{
 const f=fixture({minTraffic:3});f.setHomePorts([{...f.ship(100,0),owner:()=>f.actor.player}]);
 f.setTraffic([f.trade(1,100),f.trade(2,110),f.trade(3,120),...Array.from({length:30},(_,i)=>f.trade(10+i,600+i))]);
 const area=f.rank()[0];assert.ok(area.tile<160);assert.ok(area.teamDistance<=160);assert.ok(area.distance<=240);
});
test('piracy waits when nearby eligible trade is too sparse',()=>{
 const f=fixture({useProductionThreshold:true});f.setTraffic([f.trade(1,100),f.trade(2,110)]);assert.deepEqual(f.rank(),[]);
});
test('teammate support qualifies but nearby enemy coastline rejects a post',()=>{
 const f=fixture({minTraffic:3});f.setHomePorts([]);const friend={id:()=>2},enemy={id:()=>3};
 f.setPorts([{...f.ship(70,90),owner:()=>friend}]);
 f.setTraffic([f.trade(1,140),f.trade(2,145),f.trade(3,150)]);assert.ok(f.rank().length);
 f.setPorts([{...f.ship(70,90),owner:()=>friend},{...f.ship(71,155),owner:()=>enemy}]);f.next(1);
 assert.deepEqual(f.rank(),[]);
});
test('captured support invalidates a retained post before its30second traffic review',()=>{
 const f=fixture();let owner=f.actor.player;
 f.setHomePorts([{...f.ship(70,90),owner:()=>owner}]);f.setTraffic([f.trade(1,140)]);
 f.observer.assign(f.actor,f.fleet[0],f.rank()[0]);owner={id:()=>3};f.next(1);assert.deepEqual(f.rank(),[]);
});
test('a supported post cannot be assigned or replaced from a faraway ship or port',()=>{
 const f=fixture(),friend={id:()=>2};f.setHomePorts([{...f.ship(70,0),owner:()=>f.actor.player}]);
 f.setPorts([{...f.ship(71,600),owner:()=>friend}]);f.setTraffic([f.trade(1,620)]);
 assert.deepEqual(f.rank(),[]);
 const post={key:'old',tile:620,component:1,density:10,reviewedAt:10000};
 assert.deepEqual(f.observer.deployment(f.actor,[f.ship(70,0)],post),[]);
});
test('unsupported warships receive a safe return toward their team',()=>{
 const f=fixture();f.setHomePorts([{...f.ship(70,0),owner:()=>f.actor.player}]);
 const far=f.ship(9,600);const tile=f.observer.returnToTeam(f.actor,far);
 assert.ok(tile!=null);assert.ok(Math.abs(tile)<10);
});
test('a distant vacancy cannot hide useful nearby traffic',()=>{
 const f=fixture({minTraffic:3}),friend={id:()=>2};
 f.setHomePorts([{...f.ship(70,0),owner:()=>f.actor.player}]);f.setPorts([{...f.ship(71,600),owner:()=>friend}]);
 f.setTraffic([f.trade(1,100),f.trade(2,110),f.trade(3,120),f.trade(4,620),f.trade(5,625),f.trade(6,630)]);
 const remote=f.ship(9,610);f.fleet.push(remote);f.observer.assign(f.actor,remote,f.rank(remote)[0]);f.fleet.pop();
 assert.equal(f.rank()[0].tile,100);
});
test('nearby-looking posts behind land do not request a detour',()=>{
 const f=fixture({minTraffic:3});f.setHomePorts([{...f.ship(70,0),owner:()=>f.actor.player}]);
 f.actor.game.isWater=t=>f.actor.game.x(t)!==50;
 f.setTraffic([f.trade(1,100),f.trade(2,110),f.trade(3,120)]);assert.deepEqual(f.rank(),[]);
});
test('team-owned coast supports local piracy even without ports; enemy-owned coast does not',()=>{
 const f=fixture({minTraffic:3}),game=f.actor.game,enemy={id:()=>3,smallID:()=>3};f.setHomePorts([]);
 game.players=()=>[f.actor.player,enemy];game.isLand=t=>game.x(t)<=0||game.x(t)>=180;
 game.isWater=t=>!game.isLand(t);game.hasOwner=t=>game.isLand(t);game.ownerID=t=>game.x(t)<=0?1:3;
 f.fleet[0]=f.ship(1,50);f.setTraffic([f.trade(1,70),f.trade(2,72),f.trade(3,75),
  ...Array.from({length:10},(_,i)=>f.trade(10+i,100+i))]);
 const area=f.rank()[0];assert.ok(area.tile<100);assert.equal(area.density,3);
});
