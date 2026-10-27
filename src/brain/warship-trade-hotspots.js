'use strict';

function createWarshipTradeHotspots({units:U,now=()=>performance.now(),minTraffic=3}) {
  const states=new WeakMap(),sampleLimit=512,reviewMs=30000,clearance=12,teamRange=1440;
  const raw=unit=>unit?.__src||unit;
  function state(actor){
    const game=actor.game,tick=game.ticks(),time=now();let s=states.get(actor.player);
    if(!s||s.game!==game||tick<s.lastTick||time<s.sampleAt){
      s={game,tick:-Infinity,sampleAt:-Infinity,samples:new Map(),anchors:new Map(),assignments:new Map(),defenseAssignments:new Map(),vacancies:new Map(),geometry:new Map(),lastReplacementAt:-Infinity};states.set(actor.player,s);
    }
    s.lastTick=tick;
    const fleet=actor.player.units(U.Warship).filter(ship=>ship.isActive?.()!==false),ids=new Set(fleet.map(ship=>ship.id()));
    for(const id of s.defenseAssignments.keys())if(!ids.has(id))s.defenseAssignments.delete(id);
    for(const [id,area] of s.assignments)if(!ids.has(id)){
      s.vacancies.set(area.key,{...area,lostAt:time,lostShipId:id});s.assignments.delete(id);
    }
    while(s.vacancies.size>10)s.vacancies.delete(s.vacancies.keys().next().value);
    hazards(actor,s,tick);
    for(const [key,area] of s.vacancies)if(!locality(actor,s,area.tile).allowed)s.vacancies.delete(key);
    for(const [key,area] of s.vacancies)if(area.pending){
      const fresh=fleet.find(ship=>!area.pending.ids.has(ship.id())&&!s.assignments.has(ship.id())&&game.getWaterComponent(ship.tile())===area.component);
      if(fresh){s.assignments.set(fresh.id(),{...area,pending:undefined,reviewedAt:time});s.vacancies.delete(key);}
      else if(time-area.pending.at>=10000)delete area.pending;
    }
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
        if(!openWater(game,s,tile)||component==null||!locality(actor,s,tile).allowed){s.samples.delete(id);continue;}
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
    }).filter(a=>a.density>=minTraffic&&locality(actor,s,a.tile).allowed).sort((a,b)=>b.density-a.density).slice(0,128);
    return s;
  }
  function hazards(actor,s,tick){
    if(s.hazardTick===tick)return;
    s.hazardTick=tick;const game=actor.game;
    s.support=new Map();s.routes=new Map();s.coasts=[];
    const own=actor.player;
    const team=p=>p.id()===own.id()||own.isOnSameTeam?.(p)===true||own.team?.()!=null&&own.team()===p.team?.();
    s.team=team;
    const roster=game.players?.()||[own];
    s.teamIds=new Set(roster.filter(team).map(p=>p.smallID?.()).filter(id=>id!=null));
    s.enemyIds=new Set(roster.filter(p=>!team(p)&&!own.isFriendly(p)).map(p=>p.smallID?.()).filter(id=>id!=null));
    const ports=new Map([...own.units(U.Port),...game.units(U.Port)].map(port=>[port.id(),port]));
    for(const port of [...ports.values()].slice(0,512))try{
      if(!port.isActive()||port.isUnderConstruction())continue;
      const owner=port.owner(),tile=port.tile(),friendly=team(owner);
      if(!friendly&&own.isFriendly(owner))continue;
      const water=[...game.neighbors(tile)].filter(t=>game.isWater(t));
      if(game.isWater(tile))water.push(tile);
      s.coasts.push({tile,owner:owner.id(),team:friendly,own:owner.id()===own.id(),water,
        components:new Set(water.map(t=>game.getWaterComponent(t)).filter(c=>c!=null))});
    }catch{}
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
  function locality(actor,s,tile){
    if(s.support.has(tile))return s.support.get(tile);
    const game=actor.game,component=game.getWaterComponent(tile);let teamDistance=Infinity,enemyDistance=Infinity,teamTile;
    for(const coast of s.coasts)if(coast.components.has(component)){
      const distance=game.manhattanDist(tile,coast.tile);
      if(coast.team&&distance<teamDistance){teamDistance=distance;teamTile=coast.tile;}else if(!coast.team)enemyDistance=Math.min(enemyDistance,distance);
    }
    // Ports give exact support anchors. Bound land probes to240points per queried tile.
    if(game.isLand&&game.hasOwner&&game.ownerID&&s.teamIds.size){
      const x=game.x(tile),y=game.y(tile);
      for(const radius of [16,32,48,64,96,128,160,240,320,400,480,720,960,1200,1440])for(let i=0;i<16;i++){
        const px=Math.round(x+Math.cos(i*Math.PI/8)*radius),py=Math.round(y+Math.sin(i*Math.PI/8)*radius);
        if(!game.isValidCoord(px,py))continue;const point=game.ref(px,py);
        if(!game.isLand(point)||!game.hasOwner(point))continue;
        const owner=game.ownerID(point),distance=Math.abs(px-x)+Math.abs(py-y);
        if(s.teamIds.has(owner)&&distance<teamDistance){teamDistance=distance;teamTile=point;}
        else if(s.enemyIds.has(owner))enemyDistance=Math.min(enemyDistance,distance);
      }
    }
    const facts={teamDistance,enemyDistance,teamTile,teamRange,
      allowed:component!=null&&teamDistance<=teamRange&&!(enemyDistance<=100&&enemyDistance<=teamDistance+24)};
    if(s.support.size>=1024)s.support.delete(s.support.keys().next().value);
    s.support.set(tile,facts);return facts;
  }
  function localRoute(actor,s,start,end){
    const game=actor.game,key=[game.x(start),game.y(start),game.x(end),game.y(end)].join(':');if(s.routes.has(key))return s.routes.get(key);
    const x=game.x(start),y=game.y(start),dx=game.x(end)-x,dy=game.y(end)-y;
    const steps=Math.max(Math.abs(dx),Math.abs(dy)),checks=Math.min(steps,511);let allowed=true,lastSupport=-Infinity;
    for(let i=0;i<=checks;i++){
      const fraction=checks?i/checks:0,progress=steps*fraction;
      const px=Math.round(x+dx*fraction),py=Math.round(y+dy*fraction);
      if(!game.isValidCoord(px,py)){allowed=false;break;}const tile=game.ref(px,py);
      if(!game.isWater(tile)){allowed=false;break;}
      if(progress-lastSupport>=16||i===checks){
        if(!locality(actor,s,tile).allowed){allowed=false;break;}lastSupport=progress;
      }
    }
    if(s.routes.size>=1024)s.routes.delete(s.routes.keys().next().value);
    s.routes.set(key,allowed);return allowed;
  }
  function launchable(actor,s,area){
    return s.coasts.some(c=>c.own&&c.components.has(area.component)&&
      c.water.some(tile=>actor.game.getWaterComponent(tile)===area.component&&!unsafe(actor,s,tile)&&localRoute(actor,s,tile,area.tile)));
  }
  function coastalDefense(actor,ship){
    const s=state(actor),game=actor.game,time=now(),component=game.getWaterComponent(ship.tile());
    if(component==null||unsafe(actor,s,ship.tile()))return null;
    const valid=tile=>game.isWater(tile)&&game.getWaterComponent(tile)===component&&locality(actor,s,tile).allowed&&
      !unsafe(actor,s,tile)&&!s.coasts.some(c=>c.team&&game.manhattanDist(c.tile,tile)<16);
    const support=locality(actor,s,ship.tile());
    const previous=s.defenseAssignments.get(ship.id());
    if(previous&&valid(previous.tile)&&(!support.allowed||localRoute(actor,s,ship.tile(),previous.tile)))return {...previous,retained:true,
      reviewed:time-previous.reviewedAt>=reviewMs,reviewedAt:time-previous.reviewedAt>=reviewMs?time:previous.reviewedAt};
    const seeds=s.coasts.filter(c=>c.team&&c.components.has(component)).map(c=>({tile:c.tile,water:c.water}));
    if(support.teamTile!=null)seeds.push({tile:support.teamTile,water:game.neighbors(support.teamTile).filter(t=>game.isWater(t))});
    const border=actor.player.borderTiles?.();
    if(border&&typeof border[Symbol.iterator]==='function'){
      const stride=Math.max(1,Math.ceil((border.size||border.length||128)/128));let index=0;
      for(const tile of border){if(index++%stride)continue;
        const water=game.neighbors(tile).filter(t=>game.isWater(t)&&game.getWaterComponent(t)===component);
        if(water.length)seeds.push({tile,water});
        if(index>=stride*128)break;
      }
    }
    seeds.sort((a,b)=>game.manhattanDist(ship.tile(),a.tile)-game.manhattanDist(ship.tile(),b.tile));
    const candidates=[];
    for(const coast of seeds.slice(0,8))for(const radius of [24,40,64])for(let i=0;i<16;i++){
      const x=Math.round(game.x(coast.tile)+Math.cos(i*Math.PI/8)*radius),y=Math.round(game.y(coast.tile)+Math.sin(i*Math.PI/8)*radius);
      if(!game.isValidCoord(x,y))continue;const tile=game.ref(x,y);
      if(support.allowed&&!localRoute(actor,s,ship.tile(),tile))continue;
      if(!valid(tile)||game.neighbors(tile).filter(t=>game.isWater(t)).length<2)continue;
      if(!coast.water.some(start=>game.getWaterComponent(start)===component&&localRoute(actor,s,start,tile)))continue;
      const local=locality(actor,s,tile),distance=game.manhattanDist(ship.tile(),tile);
      const occupied=[...s.defenseAssignments].filter(([id,a])=>id!==ship.id()&&game.manhattanDist(tile,a.tile)<48).length;
      const score=-Math.abs(local.teamDistance-40)*2-distance*.1-occupied*40-
        (Number.isFinite(local.enemyDistance)?local.enemyDistance*.005:0);
      candidates.push({tile,coastTile:coast.tile,component,teamDistance:local.teamDistance,score,reviewedAt:time,
        reason:'Watch supported team coastline when no piracy post qualifies'});
    }
    candidates.sort((a,b)=>b.score-a.score);return candidates[0]||null;
  }
  function defending(actor,ship){return state(actor).defenseAssignments.has(ship.id());}
  function coastalAssigned(actor,ship,area){
    const s=state(actor),previous=s.defenseAssignments.get(ship.id());
    s.defenseAssignments.set(ship.id(),area);s.assignments.delete(ship.id());
    return !previous||previous.tile!==area.tile;
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
    if(!openWater(actor.game,s,area.tile)||unsafe(actor,s,area.tile)||!locality(actor,s,area.tile).allowed)return false;
    return [...s.samples.values()].filter(p=>p.component===area.component&&actor.game.manhattanDist(p.tile,area.tile)<=100).length>=minTraffic;
  }
  function posted(actor,ship){return state(actor).assignments.has(ship.id());}
  function rank(actor,ship){
    const s=state(actor),game=actor.game,time=now(),component=game.getWaterComponent(ship.tile());
    if(component==null||unsafe(actor,s,ship.tile()))return [];
    const previous=s.assignments.get(ship.id());
    if(previous&&locality(actor,s,previous.tile).allowed&&localRoute(actor,s,ship.tile(),previous.tile)&&openWater(game,s,previous.tile)&&!unsafe(actor,s,previous.tile)&&
      (time-previous.reviewedAt<reviewMs||viable(actor,s,previous)))
      return [{...previous,...locality(actor,s,previous.tile),retained:true,distance:game.manhattanDist(ship.tile(),previous.tile),reviewed:time-previous.reviewedAt>=reviewMs,reviewedAt:time-previous.reviewedAt<reviewMs?previous.reviewedAt:time,
        reason:'Stay at the viable piracy post; review every30seconds'}];
    const vacant=[...s.vacancies.values()].filter(a=>!a.pending&&a.component===component&&viable(actor,s,a)&&localRoute(actor,s,ship.tile(),a.tile));
    const areas=vacant.length?vacant:s.areas;
    return areas.filter(a=>a.component===component).map(area=>{
      let occupancy=0;
      for(const [id,a] of s.assignments)if(id!==ship.id()&&a.component===component&&game.manhattanDist(a.tile,area.tile)<=120)occupancy++;
      const distance=game.manhattanDist(ship.tile(),area.tile);
      return {...area,...locality(actor,s,area.tile),clearance,reviewed:true,reviewedAt:time,retained:false,occupancy,distance,
        score:area.density*100/((1+distance/teamRange)*(1+occupancy*1.5)),
        reason:vacant.length?'Fill a vacant piracy post with an existing ship':'Post in open water with dense enemy trade'};
    }).filter(a=>a.allowed&&(vacant.length||a.score>0)&&localRoute(actor,s,ship.tile(),a.tile)&&openWater(game,s,a.tile)&&!unsafe(actor,s,a.tile))
      .sort((a,b)=>b.score-a.score||a.distance-b.distance||a.key.localeCompare(b.key)).slice(0,79);
  }
  function replacement(actor){
    const s=state(actor),fleet=actor.player.units(U.Warship);
    if(fleet.length>=10||now()-s.lastReplacementAt<reviewMs)return null;
    return [...s.vacancies.values()].find(area=>!area.pending&&viable(actor,s,area)&&launchable(actor,s,area)&&
      !fleet.some(ship=>!s.assignments.has(ship.id())&&actor.game.getWaterComponent(ship.tile())===area.component&&localRoute(actor,s,ship.tile(),area.tile)))||null;
  }
  function waitingReplacement(actor){
    const s=state(actor);return [...s.vacancies.values()].some(area=>viable(actor,s,area)&&launchable(actor,s,area));
  }
  function replacementSubmitted(actor,area){
    const s=state(actor),vacancy=s.vacancies.get(area.key);if(!vacancy)return;
    s.lastReplacementAt=now();vacancy.pending={at:now(),ids:new Set(actor.player.units(U.Warship).map(ship=>ship.id()))};
  }
  function assign(actor,ship,area){
    const s=state(actor),previous=s.assignments.get(ship.id());
    s.assignments.set(ship.id(),{...area,since:previous?.key===area.key?previous.since:actor.game.ticks()});
    s.vacancies.delete(area.key);s.defenseAssignments.delete(ship.id());
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
          const score=area.density*100/(1+game.manhattanDist(tile,area.tile)/teamRange);
          if((!best||score>best.score)&&localRoute(actor,s,tile,area.tile))best={tile,portTile:port.tile(),hotspot:area.tile,
            density:area.density,postKey:area.key,score,reason:'Deploy from a usable port connected to productive trade traffic'};
        }
        if(best)entries.push(best);
      }
    }
    return entries.filter(e=>post||e.score>0).sort((a,b)=>b.score-a.score||a.portTile-b.portTile).slice(0,79);
  }
  return {rank,assign,deployment,posted,replacement,waitingReplacement,replacementSubmitted,coastalDefense,coastalAssigned,defending};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipTradeHotspots;
