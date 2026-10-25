'use strict';

function createWarshipSafetyPlanner(deps) {
  const wait={id:'$wait',kind:'wait',reason:'Hold safety action'};
  const safeId=unit=>{try{return unit.id?.();}catch{return undefined;}};
  function choose(hooks,domain,entries,facts) {
    const candidates=entries.slice(0,79).map((e,priority)=>({...e,id:`${domain}:${priority}`,kind:domain,priority,eligible:true}));
    const decision=hooks.choose(domain,[...candidates,wait],facts);
    const index=candidates.findIndex(c=>c.id===decision.selectedId);
    const selected=index<0||!hooks.allowed()?null:entries[index];
    hooks.record(`${domain}-result`,{decisionId:decision.decisionId,status:!hooks.allowed()?'stopped':selected?'selected':'wait',
      tile:selected?.tile,reason:decision.reason});
    return {selected,decisionId:decision.decisionId,error:decision.selectedId===null};
  }
  function home(actor,ship,hooks) {
    if(!hooks.allowed())return {tile:null,held:true};
    const entries=[],self=actor.player.smallID();
    for(const port of actor.game.units(deps.portType)||[]) {
      try {
        const owner=port.owner();
        if(!port.isActive()||port.isUnderConstruction()||!owner)continue;
        const own=owner.smallID()===self;
        const team=!own&&typeof owner.isOnSameTeam==='function'&&owner.isOnSameTeam(actor.player);
        if(own||team)entries.push({port,own,team});
      }catch{}
    }
    let winner=0,best=Infinity;
    for(const [index,entry] of entries.entries()) {
      entry.tile=entry.port.tile();entry.distance=actor.game.manhattanDist(ship.tile(),entry.tile);entry.index=index;
      if(entry.distance<best){best=entry.distance;winner=index;}
    }
    entries.sort((a,b)=>(a.index===winner?-1:b.index===winner?1:0)||a.distance-b.distance||a.index-b.index);
    const selection=choose(hooks,'warship-home',entries.map(e=>({tile:e.tile,distance:e.distance,
      portIndex:e.index,unitId:safeId(e.port),own:e.own,team:e.team,reason:'Nearest active own or same-team port, preserving first ties'})),
      {shipId:safeId(ship),ports:entries.length});
    if(!selection.selected)return {tile:null,held:entries.length>0||selection.error||!hooks.allowed(),decisionId:selection.decisionId};
    const entry=entries.find(e=>e.index===selection.selected.portIndex);
    return hooks.execute(selection.decisionId,()=>{
      const portTile=entry.port.tile(),tiles=[];
      for(const tile of actor.game.neighbors(portTile)) {
        let water;
        if(!tiles.length)water=actor.game.isWater(tile);
        else {try{water=actor.game.isWater(tile);}catch{continue;}}
        if(water)tiles.push({tile,reason:'Water next to chosen home port, in original neighbor order'});
      }
      if(!tiles.length)tiles.push({tile:portTile,reason:'Original dry-port fallback'});
      const result=choose(hooks,'warship-home-tile',tiles,{portTile});
      return {tile:result.selected?.tile??null,held:!result.selected,decisionId:result.decisionId};
    });
  }
  function escape(actor,x,y,zones,eta,hooks) {
    if(!hooks.allowed())return null;
    const threats=zones.map((zone,index)=>({zone,index,distance:(x-zone.tx)**2+(y-zone.ty)**2}));
    threats.sort((a,b)=>a.distance-b.distance||a.index-b.index);
    const entries=threats.filter(e=>e.distance<Infinity);
    const threat=choose(hooks,'warship-nuke-threat',entries.map(e=>({tx:e.zone.tx,ty:e.zone.ty,radius:e.zone.radius,
      distance:e.distance,index:e.index,reason:'Nearest blast center, preserving first ties'})),{x,y,zones:zones.length});
    if(!threat.selected)return null;
    return hooks.execute(threat.decisionId,()=>{
      const zone=zones[threat.selected.index],settings=deps.settings();
      const buffer=settings.warshipNukeDodgeBuffer||20;
      const samples=Math.max(1,settings.warshipNukeDodgeSamples||8),rings=Math.max(1,settings.warshipNukeDodgeRings||3);
      let angle=Math.atan2(y-zone.ty,x-zone.tx);if(!Number.isFinite(angle))angle=0;
      const sites=[];let bestEta=-Infinity,bestDistance=Infinity,winner=-1;
      for(let ring=1;ring<=rings;ring++) {
        const radius=zone.radius+buffer*ring;
        for(let sample=0;sample<samples;sample++) {
          const offset=Math.ceil(sample/2),sign=sample%2===0?1:-1;
          const direction=angle+sign*offset*(Math.PI/4);
          const tx=Math.round(zone.tx+Math.cos(direction)*radius),ty=Math.round(zone.ty+Math.sin(direction)*radius);
          if(!actor.game.isValidCoord(tx,ty))continue;
          const tile=actor.game.ref(tx,ty);if(!actor.game.isWater(tile))continue;
          const safety=eta(tx,ty),distance=Math.abs(tx-x)+Math.abs(ty-y),index=sites.length;
          if(safety>bestEta||safety===bestEta&&distance<bestDistance){bestEta=safety;bestDistance=distance;winner=index;}
          sites.push({tile,eta:safety,distance,ring,sample,index,reason:'Highest blast ETA then shortest travel, preserving sample ties'});
        }
      }
      const ranked=sites.filter(e=>winner>=0&&(e.eta>-Infinity||e.eta===-Infinity&&e.distance<Infinity));
      ranked.sort((a,b)=>(a.index===winner?-1:b.index===winner?1:0)||b.eta-a.eta||a.distance-b.distance||a.index-b.index);
      const result=choose(hooks,'warship-nuke-escape',ranked,{x,y,samples,rings,probes:sites.length,candidateLimit:79});
      if(!result.selected)return null;
      hooks.remember?.(result.decisionId);
      return {tile:result.selected.tile,eta:result.selected.eta};
    });
  }
  function dodge(actor,ships,context,hooks) {
    const {tick,zones,eta,smart}=context;
    for(const ship of ships) {
      if(!hooks.allowed())return;
      try {
        const tile=ship.tile(),x=actor.game.x(tile),y=actor.game.y(tile),currentEta=eta(x,y);
        if(currentEta===Infinity)continue;
        const choice=choose(hooks,'warship-nuke-dodge',[{tile,unitId:safeId(ship),currentEta,
          reason:'Ship is inside a blast zone; search for safer water'}],{tick});
        if(!choice.selected)continue;
        hooks.execute(choice.decisionId,()=>{
          const result=hooks.escape(x,y,zones,eta);
          const escape=result.selection;
          if(escape===null)return;
          if(escape.eta<=currentEta){hooks.record('warship-nuke-dodge-result',{decisionId:choice.decisionId,status:'not-safer'});return;}
          const patrol=ship.warshipState().patrolTile;
          if(patrol!==undefined&&eta(actor.game.x(patrol),actor.game.y(patrol))>=escape.eta)return;
          if(!hooks.allowed())return;
          const moved=hooks.execute(result.decisionId,()=>actor._dodgeWarshipReady(ship,escape,tick,smart));
          hooks.record('warship-nuke-dodge-result',{decisionId:choice.decisionId,status:hooks.wasDeclined?.()?'declined':moved?'move-attempted':'not-moved',tile:escape.tile});
        });
      }catch(error){hooks.record('warship-nuke-dodge-result',{status:'threw',error:String(error?.message||error)});}
    }
  }
  return {home,escape,dodge};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipSafetyPlanner;
