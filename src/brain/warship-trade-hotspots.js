'use strict';

function createWarshipTradeHotspots({units:U,now=()=>performance.now()}) {
  const states=new WeakMap(),sampleLimit=512,reviewMs=30000,clearance=12;
  const raw=unit=>unit?.__src||unit;
  function state(actor){
    const game=actor.game,tick=game.ticks(),time=now();let s=states.get(actor.player);
    if(!s||s.game!==game||tick<s.lastTick||time<s.sampleAt){
      s={game,tick:-Infinity,sampleAt:-Infinity,samples:new Map(),anchors:new Map(),assignments:new Map(),vacancies:new Map(),geometry:new Map(),lastReplacementAt:-Infinity};states.set(actor.player,s);
    }
    s.lastTick=tick;
    const fleet=actor.player.units(U.Warship).filter(ship=>ship.isActive?.()!==false),ids=new Set(fleet.map(ship=>ship.id()));
    for(const [id,area] of s.assignments)if(!ids.has(id)){
      s.vacancies.set(area.key,{...area,lostAt:time,lostShipId:id});s.assignments.delete(id);
    }
    for(const [key,area] of s.vacancies)if(area.pending){
      const fresh=fleet.find(ship=>!area.pending.ids.has(ship.id())&&!s.assignments.has(ship.id())&&game.getWaterComponent(ship.tile())===area.component);
      if(fresh){s.assignments.set(fresh.id(),{...area,pending:undefined,reviewedAt:time});s.vacancies.delete(key);}
      else if(time-area.pending.at>=10000)delete area.pending;
    }
    while(s.vacancies.size>10)s.vacancies.delete(s.vacancies.keys().next().value);
    hazards(actor,s,tick);
    if(time-s.sampleAt<reviewMs)return s;
    s.tick=tick;s.sampleAt=time;
    const ports=new Map(game.units(U.Port).map(port=>[port.id(),port]));
    const trades=game.units(U.TradeShip),offset=trades.length?Math.floor(time/reviewMs)*sampleLimit%trades.length:0,seen=new Set();
    for(let i=0;i<Math.min(trades.length,sampleLimit);i++){
      const unit=trades[(offset+i)%trades.length];let id;
      try{
        id=unit.id();seen.add(id);const source=raw(unit),owner=unit.owner();
        // Browser UnitView exposes destination IDs, not the engine's targetUnit().
        const destination=source.targetUnit?.()?.owner?.()||ports.get(source.targetUnitId?.())?.owner();
        const protectionKnown=typeof source.isSafeFromPirates==='function';
        if(!unit.isActive()||!owner||owner.id()===actor.player.id()||actor.player.isFriendly(owner)||
          protectionKnown&&source.isSafeFromPirates()||!destination||
          destination.id()===actor.player.id()||actor.player.isFriendly(destination)){
          s.samples.delete(id);continue;
        }
        const tile=unit.tile(),component=game.getWaterComponent(tile);
        if(!openWater(game,s,tile)||component==null){s.samples.delete(id);continue;}
        s.samples.set(id,{tile,component,tick,time,protectionKnown});
      }catch{if(id!==undefined)s.samples.delete(id);}
    }
    for(const [id,p] of s.samples)if(time-p.time>40000||trades.length<=sampleLimit&&!seen.has(id))s.samples.delete(id);
    while(s.samples.size>sampleLimit)s.samples.delete(s.samples.keys().next().value);
    const areas=new Map();
    for(const p of s.samples.values()){
      const key=p.component+':'+Math.floor(game.x(p.tile)/80)+','+Math.floor(game.y(p.tile)/80);
      if(!areas.has(key))areas.set(key,{key,tile:s.anchors.get(key)??p.tile,component:p.component});
    }
    s.anchors=new Map([...areas].map(([key,a])=>[key,a.tile]));
    s.areas=[...areas.values()].map(area=>{
      let density=0,lastTraffic=-Infinity,protectionUnknown=0;
      for(const p of s.samples.values())if(p.component===area.component&&game.manhattanDist(p.tile,area.tile)<=100){
        density+=Math.max(0,1-(time-p.time)/40000);lastTraffic=Math.max(lastTraffic,p.tick);
        if(!p.protectionKnown)protectionUnknown++;
      }
      return {...area,density,lastTraffic,protectionUnknown,clearance,reviewedAt:time};
    }).filter(a=>a.density>=.25).sort((a,b)=>b.density-a.density).slice(0,128);
    return s;
  }
  function hazards(actor,s,tick){
    if(s.hazardTick===tick)return;
    s.hazardTick=tick;const game=actor.game;
    s.enemies=game.units(U.Warship).slice(0,128).filter(ship=>{
      try{return ship.isActive()&&!ship.isUnderConstruction()&&!actor.player.isFriendly(ship.owner())&&ship.owner().id()!==actor.player.id();}catch{return false;}
    });
    s.blasts=[];
    for(const unit of game.units(U.AtomBomb,U.HydrogenBomb,U.MIRVWarhead).slice(0,64))try{
      if(!unit.isActive())continue;const tile=unit.targetTile();if(tile==null)continue;
      const radius=actor.nukeOuterRadius(unit)+8;
      if(Number.isFinite(radius)&&radius>0)s.blasts.push({tile,radius});
    }catch{}
  }
  function unsafe(actor,s,tile){
    const game=actor.game;
    if(s.blasts.some(b=>Math.hypot(game.x(tile)-game.x(b.tile),game.y(tile)-game.y(b.tile))<=b.radius))return true;
    return s.enemies.some(ship=>game.getWaterComponent(ship.tile())===game.getWaterComponent(tile)&&game.manhattanDist(tile,ship.tile())<=130);
  }
  function openWater(game,s,tile){
    if(s.geometry.has(tile))return s.geometry.get(tile);
    let allowed=true;
    try{
      if(!game.isWater(tile))allowed=false;
      const x=game.x(tile),y=game.y(tile);
      for(let dx=-clearance;allowed&&dx<=clearance;dx++)for(let dy=-clearance;dy<=clearance;dy++){
        if(dx*dx+dy*dy>clearance*clearance)continue;
        if(!game.isValidCoord(x+dx,y+dy)||!game.isWater(game.ref(x+dx,y+dy))){allowed=false;break;}
      }
    }catch{allowed=false;}
    if(s.geometry.size>=4096)s.geometry.delete(s.geometry.keys().next().value);
    s.geometry.set(tile,allowed);return allowed;
  }
  function viable(actor,s,area){
    if(!openWater(actor.game,s,area.tile)||unsafe(actor,s,area.tile))return false;
    return [...s.samples.values()].some(p=>p.component===area.component&&actor.game.manhattanDist(p.tile,area.tile)<=100);
  }
  function posted(actor,ship){return state(actor).assignments.has(ship.id());}
  function rank(actor,ship){
    const s=state(actor),game=actor.game,time=now(),component=game.getWaterComponent(ship.tile());
    if(component==null||unsafe(actor,s,ship.tile()))return [];
    const previous=s.assignments.get(ship.id());
    if(previous&&openWater(game,s,previous.tile)&&!unsafe(actor,s,previous.tile)&&
      (time-previous.reviewedAt<reviewMs||viable(actor,s,previous)))
      return [{...previous,retained:true,distance:game.manhattanDist(ship.tile(),previous.tile),reviewed:time-previous.reviewedAt>=reviewMs,reviewedAt:time-previous.reviewedAt<reviewMs?previous.reviewedAt:time,
        reason:'Stay at the viable piracy post; review every30seconds'}];
    const vacant=[...s.vacancies.values()].filter(a=>!a.pending&&a.component===component&&viable(actor,s,a));
    const areas=vacant.length?vacant:s.areas;
    return areas.filter(a=>a.component===component).map(area=>{
      let occupancy=0;
      for(const [id,a] of s.assignments)if(id!==ship.id()&&a.component===component&&game.manhattanDist(a.tile,area.tile)<=120)occupancy++;
      const distance=game.manhattanDist(ship.tile(),area.tile);
      return {...area,clearance,reviewed:true,reviewedAt:time,retained:false,occupancy,distance,
        score:(area.density*100-Math.min(distance,1200)*.4)/(1+occupancy*1.5),
        reason:vacant.length?'Fill a vacant piracy post with an existing ship':'Post in open water with dense enemy trade'};
    }).filter(a=>(vacant.length||a.score>0)&&openWater(game,s,a.tile)&&!unsafe(actor,s,a.tile))
      .sort((a,b)=>b.score-a.score||a.distance-b.distance||a.key.localeCompare(b.key)).slice(0,79);
  }
  function replacement(actor){
    const s=state(actor),fleet=actor.player.units(U.Warship);
    if(fleet.length>=10||now()-s.lastReplacementAt<reviewMs)return null;
    return [...s.vacancies.values()].find(area=>!area.pending&&viable(actor,s,area)&&
      !fleet.some(ship=>!s.assignments.has(ship.id())&&actor.game.getWaterComponent(ship.tile())===area.component))||null;
  }
  function waitingReplacement(actor){
    const s=state(actor);return [...s.vacancies.values()].some(area=>area.pending||viable(actor,s,area));
  }
  function replacementSubmitted(actor,area){
    const s=state(actor),vacancy=s.vacancies.get(area.key);if(!vacancy)return;
    s.lastReplacementAt=now();vacancy.pending={at:now(),ids:new Set(actor.player.units(U.Warship).map(ship=>ship.id()))};
  }
  function assign(actor,ship,area){
    const s=state(actor),previous=s.assignments.get(ship.id());
    s.assignments.set(ship.id(),{...area,since:previous?.key===area.key?previous.since:actor.game.ticks()});
    s.vacancies.delete(area.key);
    return !previous||previous.key!==area.key||previous.tile!==area.tile;
  }
  function deployment(actor,ports,post=null){
    const s=state(actor),game=actor.game,entries=[];
    for(const port of ports.slice(0,79)){
      if(!port.isActive()||port.isUnderConstruction())continue;
      for(const tile of game.neighbors(port.tile())){
        if(!game.isWater(tile)||unsafe(actor,s,tile))continue;
        const component=game.getWaterComponent(tile);if(component==null)continue;
        const areas=(post?[post]:s.areas).filter(a=>a.component===component&&viable(actor,s,a));
        let best;
        for(const area of areas){
          const score=area.density*100-game.manhattanDist(tile,area.tile)*.4;
          if(!best||score>best.score)best={tile,portTile:port.tile(),hotspot:area.tile,
            density:area.density,postKey:area.key,score,reason:'Deploy from a usable port connected to productive trade traffic'};
        }
        if(best)entries.push(best);
      }
    }
    return entries.filter(e=>post||e.score>0).sort((a,b)=>b.score-a.score||a.portTile-b.portTile).slice(0,79);
  }
  return {rank,assign,deployment,posted,replacement,waitingReplacement,replacementSubmitted};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipTradeHotspots;
