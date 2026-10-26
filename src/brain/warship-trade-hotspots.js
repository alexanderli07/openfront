'use strict';

function createWarshipTradeHotspots({units:U}) {
  const states=new WeakMap(),sampleLimit=512,historyTicks=400,graceTicks=300;
  const raw=unit=>unit?.__src||unit;
  function state(actor){
    const game=actor.game,tick=game.ticks();let s=states.get(actor.player);
    if(!s||s.game!==game||tick<s.tick){s={game,tick:-Infinity,samples:new Map(),anchors:new Map(),assignments:new Map()};states.set(actor.player,s);}
    hazards(actor,s,tick);
    if(tick-s.tick<20)return s;
    s.tick=tick;
    const ports=new Map(game.units(U.Port).map(port=>[port.id(),port]));
    const trades=game.units(U.TradeShip),offset=trades.length?Math.floor(tick/20)*sampleLimit%trades.length:0;
    for(let i=0;i<Math.min(trades.length,sampleLimit);i++){
      const unit=trades[(offset+i)%trades.length];let id;
      try{
        id=unit.id();const source=raw(unit),owner=unit.owner();
        // Browser UnitView exposes destination IDs, not the engine's targetUnit().
        const destination=source.targetUnit?.()?.owner?.()||ports.get(source.targetUnitId?.())?.owner();
        const protectionKnown=typeof source.isSafeFromPirates==='function';
        if(!unit.isActive()||!owner||owner.id()===actor.player.id()||actor.player.isFriendly(owner)||
          protectionKnown&&source.isSafeFromPirates()||!destination||
          destination.id()===actor.player.id()||actor.player.isFriendly(destination)){
          s.samples.delete(id);continue;
        }
        const tile=unit.tile(),component=game.getWaterComponent(tile);
        if(!game.isWater(tile)||component==null){s.samples.delete(id);continue;}
        s.samples.set(id,{tile,component,tick,protectionKnown});
      }catch{if(id!==undefined)s.samples.delete(id);}
    }
    for(const [id,p] of s.samples)if(tick-p.tick>historyTicks)s.samples.delete(id);
    while(s.samples.size>sampleLimit)s.samples.delete(s.samples.keys().next().value);
    const fleet=actor.player.units(U.Warship),ids=new Set(fleet.map(ship=>ship.id()));
    for(const id of s.assignments.keys())if(!ids.has(id))s.assignments.delete(id);
    const areas=new Map();
    for(const p of s.samples.values()){
      const key=p.component+':'+Math.floor(game.x(p.tile)/80)+','+Math.floor(game.y(p.tile)/80);
      if(!areas.has(key))areas.set(key,{key,tile:s.anchors.get(key)??p.tile,component:p.component});
    }
    s.anchors=new Map([...areas].map(([key,a])=>[key,a.tile]));
    s.areas=[...areas.values()].map(area=>{
      let density=0,lastTraffic=-Infinity,protectionUnknown=0;
      for(const p of s.samples.values())if(p.component===area.component&&game.manhattanDist(p.tile,area.tile)<=100){
        density+=Math.max(0,1-(tick-p.tick)/historyTicks);lastTraffic=Math.max(lastTraffic,p.tick);
        if(!p.protectionKnown)protectionUnknown++;
      }
      return {...area,density,lastTraffic,protectionUnknown};
    }).filter(a=>a.density>=.25&&tick-a.lastTraffic<=graceTicks).sort((a,b)=>b.density-a.density).slice(0,128);
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
  function rank(actor,ship){
    const s=state(actor),game=actor.game,tick=game.ticks(),component=game.getWaterComponent(ship.tile());
    if(component==null||unsafe(actor,s,ship.tile()))return [];
    const previous=s.assignments.get(ship.id());
    const areas=[...s.areas];
    if(previous&&!areas.some(a=>a.key===previous.key)){
      let density=0,lastTraffic=previous.lastTraffic;
      for(const p of s.samples.values())if(p.component===previous.component&&game.manhattanDist(p.tile,previous.tile)<=100){
        density+=Math.max(0,1-(tick-p.tick)/historyTicks);lastTraffic=Math.max(lastTraffic,p.tick);
      }
      if(tick-lastTraffic<=graceTicks)areas.push({...previous,density:Math.max(density,previous.density*.5),lastTraffic});
    }
    const candidates=areas.filter(a=>a.component===component).map(area=>{
      const retained=previous?.key===area.key,tile=retained?previous.tile:area.tile;
      let occupancy=0;
      for(const [id,a] of s.assignments)if(id!==ship.id()&&a.component===component&&tick-a.lastTraffic<=graceTicks&&game.manhattanDist(a.tile,tile)<=120)occupancy++;
      const distance=game.manhattanDist(ship.tile(),tile);
      return {...area,tile,retained,occupancy,distance,score:(area.density*100-Math.min(distance,1200)*.08)/(1+occupancy*1.5),
        reason:retained?'Keep the established productive trade area':'Patrol dense capturable trade traffic'};
    }).filter(a=>a.score>0&&game.isWater(a.tile)&&!unsafe(actor,s,a.tile));
    candidates.sort((a,b)=>b.score-a.score||a.distance-b.distance||a.key.localeCompare(b.key));
    const retained=candidates.find(a=>a.retained);
    if(retained&&(tick-previous.since<300||candidates[0].score<retained.score*1.6)){
      candidates.splice(candidates.indexOf(retained),1);candidates.unshift(retained);
    }
    return candidates.slice(0,79);
  }
  function assign(actor,ship,area){
    const s=state(actor),previous=s.assignments.get(ship.id());
    s.assignments.set(ship.id(),{...area,since:previous?.key===area.key?previous.since:actor.game.ticks()});
    return !previous||previous.key!==area.key||previous.tile!==area.tile;
  }
  function deployment(actor,ports){
    const s=state(actor),game=actor.game,entries=[];
    for(const port of ports.slice(0,79)){
      if(!port.isActive()||port.isUnderConstruction())continue;
      for(const tile of game.neighbors(port.tile())){
        if(!game.isWater(tile)||unsafe(actor,s,tile))continue;
        const component=game.getWaterComponent(tile);if(component==null)continue;
        const areas=s.areas.filter(a=>a.component===component&&!unsafe(actor,s,a.tile));
        let best;
        for(const area of areas){
          const score=area.density*100-game.manhattanDist(tile,area.tile)*.08;
          if(!best||score>best.score)best={tile,portTile:port.tile(),hotspot:area.tile,
            density:area.density,score,reason:'Deploy from a usable port connected to productive trade traffic'};
        }
        if(best)entries.push(best);
      }
    }
    return entries.filter(e=>e.score>0).sort((a,b)=>b.score-a.score||a.portTile-b.portTile).slice(0,79);
  }
  return {rank,assign,deployment};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipTradeHotspots;
