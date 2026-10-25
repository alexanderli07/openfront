'use strict';
function createWarshipThreatPlanner(deps) {
  function select(actor,mode,input,hooks){
    if(!hooks.allowed())return null;
    const entries=[];let winner=null;
    if(mode==='invasion'){
      const own=actor.player.smallID();let nearest=Infinity;
      for(const ship of actor.game.units(deps.transportType))try{
        if(!ship.isActive())continue;
        const target=ship.targetTile();if(target==null)continue;
        if(ship.transportShipState&&ship.transportShipState()?.isRetreating)continue;
        if(actor.game.ownerID(target)!==own||ship.owner().smallID()===own||ship.owner().isAlliedWith(actor.player))continue;
        const distance=actor.game.manhattanDist(ship.tile(),target);if(distance<20)continue;
        if(actor.game.hasUnitNearby(target,90,deps.warshipType,actor.player.id(),true))continue;
        if(distance<Infinity){
          const entry={ship,distance,score:distance};
          if(distance<nearest){nearest=distance;entry.tile=ship.tile();winner=entry;}
          entries.push(entry);
        }
      }catch(error){}
      if(winner===null||winner.tile===null)return null;
      entries.sort((a,b)=>a===b?0:a===winner?-1:b===winner?1:a.score-b.score);
    }else if(mode==='loss'){
      const minimum=deps.settings().warshipLossZoneMin||2,radius=deps.settings().warshipLossZoneRadius||35;
      if(input.length<minimum)return null;
      let bestCount=0;
      for(const center of input){
        let x=0,y=0,count=0;
        for(const point of input)if(Math.abs(center.x-point.x)+Math.abs(center.y-point.y)<=radius){x+=point.x;y+=point.y;count++;}
        if(!(count>=minimum&&count>0))continue;
        x=Math.round(x/count);y=Math.round(y/count);
        const entry={x,y,count,score:-count};
        if(count>bestCount){
          if(!actor.game.isValidCoord(x,y))continue;
          const tile=actor.game.ref(x,y);if(!actor.game.isWater(tile))continue;
          entry.tile=tile;bestCount=count;winner=entry;
        }
        entries.push(entry);
      }
      if(winner===null||winner.tile===null)return null;
      entries.sort((a,b)=>a===b?0:a===winner?-1:b===winner?1:a.score-b.score);
    }else if(mode==='trade'){
      if(input.length){const point=input[input.length-1];if(actor.game.isValidCoord(point.x,point.y)){
        const tile=actor.game.ref(point.x,point.y);if(actor.game.isWater(tile))entries.push({tile});
      }}
    }else throw new Error(`Unknown warship threat source: ${mode}`);
    if(!entries.length)return null;
    let offset=0;
    while(offset<entries.length){
      if(!hooks.allowed())return null;
      const candidates=entries.slice(offset,offset+78).map((entry,index)=>({
        tile:entry.tile,x:entry.x,y:entry.y,distance:entry.distance,count:entry.count,readiness:Object.hasOwn(entry,'tile')?'measured':'unchecked',id:`source:${offset+index}`,kind:`warship-${mode}-source`,priority:offset+index,
        eligible:true,reason:`Original ${mode} source ranking`
      }));
      if(offset+78<entries.length)candidates.push({id:'$next',kind:'next-window',priority:entries.length,eligible:true,reason:'Examine later source candidates'});
      const choice=hooks.choose(`warship-${mode}-source`,[...candidates,{id:'$wait',kind:'wait',reason:'Hold threat-source lookup'}],{total:entries.length,offset});
      const selected=candidates.find(c=>c.id===choice.selectedId);
      hooks.record('warship-threat-source-result',{domain:`warship-${mode}-source`,decisionId:choice.decisionId,
        selectedId:selected?.id,tile:selected?.tile,status:selected?.id==='$next'?'next-window':selected?'selected':'stopped'});
      if(!selected){hooks.hold();return null;}
      if(!hooks.allowed())return null;
      if(selected.id==='$next'){offset+=78;continue;}
      const index=Number(selected.id.slice(7)),entry=entries[index];let tile=entry.tile;
      if(!Object.hasOwn(entry,'tile')){
        if(mode==='invasion'){try{tile=entry.ship.tile();}catch(error){entries.splice(index,1);continue;}}
        else{
          if(!actor.game.isValidCoord(entry.x,entry.y)){entries.splice(index,1);continue;}
          tile=actor.game.ref(entry.x,entry.y);if(!actor.game.isWater(tile)){entries.splice(index,1);continue;}
        }
      }
      hooks.remember(mode,tile,choice.decisionId);
      return mode==='invasion'?{tile,kind:'invasion'}:tile;
    }
    return null;
  }
  return {select};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipThreatPlanner;
