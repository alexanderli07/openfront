'use strict';

function createBoatPlanner(deps) {
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Hold this boat action' };
  function enemyProbeSites(actor) {
    const game=actor.game,player=actor.player,components=new Set();
    const waterComponents=tile=>game.neighbors(tile).filter(t=>game.isWater(t))
      .map(t=>game.getWaterComponent(t)).filter(component=>component!==null&&component!==undefined);
    let origin=null;
    for(const tile of player.borderTiles())if(game.isLand(tile)&&game.isShore(tile)){
      for(const component of waterComponents(tile)){
        components.add(component);if(origin===null)origin=tile;
      }
    }
    if(origin===null)return [];
    const center=actor.getPlayerCenter(player)||{x:game.x(origin),y:game.y(origin)};
    const groups=[];
    for(const enemy of game.players()){
      if(!enemy.isPlayer()||!enemy.isAlive()||enemy.smallID()===player.smallID()||player.isFriendly(enemy))continue;
      const best=[];
      // Border tiles already delimit ownership. Keep only a small set of
      // coastal alternatives per enemy, instead of sending its inland label.
      for(const tile of enemy.borderTiles()){
        if(!game.isLand(tile)||!game.isShore(tile)||game.ownerID(tile)!==enemy.smallID()||
            !waterComponents(tile).some(component=>components.has(component)))continue;
        const dx=game.x(tile)-center.x,dy=game.y(tile)-center.y;
        best.push({tile,dist:dx*dx+dy*dy,ownerId:enemy.id()});
        best.sort((a,b)=>a.dist-b.dist||a.tile-b.tile);
        if(best.length>4)best.pop();
      }
      if(best.length)groups.push(best);
    }
    groups.sort((a,b)=>a[0].dist-b[0].dist);
    const sites=[];
    // Try each enemy's nearest usable coast before second alternatives.
    for(let index=0;index<4;index++)for(const group of groups)if(group[index])sites.push(group[index]);
    return sites;
  }
  function origin(actor, shore, hooks) {
    if (!hooks.allowed() || !shore.length) return null;
    const original = actor.random.randElement(shore);
    const ordered = [original, ...shore.filter(tile => tile !== original)];
    const candidates = ordered.slice(0,79).map((tile,priority) => ({ id:`origin:${priority}`, kind:'boat-origin',
      tile, priority, eligible:true, reason: priority===0 ? 'Original randomly sampled shore' : 'Alternate supplied shore' }));
    const choice=hooks.choose('boat-origin',[...candidates,wait],{shoreTiles:shore.length});
    const selected=candidates.find(c=>c.id===choice.selectedId);
    hooks.record('boat-detail-result',{domain:'boat-origin',decisionId:choice.decisionId,
      status:selected && hooks.allowed()?'selected':'stopped',tile:selected?.tile??null});
    if(!selected || !hooks.allowed())return null;
    hooks.remember(selected.tile,choice.decisionId,'origin');
    return selected.tile;
  }
  async function destination(actor,sites,context,hooks) {
    let remaining=sites.map((site,priority)=>({id:`boat-site:${priority}`,kind:'boat-destination',priority,
      eligible:true,tile:site.tile,ownerId:site.ownerId??null,owned:!!site.owned,fallout:!!site.fallout,
      distanceSquared:site.dist??null,reason:`Original ${context.mode} site order; probe after selection`}))
      .filter(c=>context.mode!=='nearby'||c.priority<context.cap);
    const failedOwners=new Set();
    while(remaining.length && hooks.allowed()) {
      const visible=remaining.slice(0,79);
      const choice=hooks.choose('boat-destination',[...visible,wait],{...context,remainingSites:remaining.length});
      const selected=visible.find(c=>c.id===choice.selectedId);
      const report=status=>hooks.record('boat-detail-result',{domain:'boat-destination',decisionId:choice.decisionId,
        mode:context.mode,tile:selected?.tile??null,status});
      if(!selected||!hooks.allowed()){report('stopped');return null;}
      remaining=remaining.filter(c=>c!==selected);
      if(context.mode==='nearby'&&actor.boatTargetTaken(selected.tile)){report('already-targeted');continue;}
      if(selected.ownerId!==null&&failedOwners.has(selected.ownerId)){report('owner-unreachable');continue;}
      try {
        const reachable=await hooks.probe(choice.decisionId,selected.tile);
        if(!hooks.allowed()){report('stopped');return null;}
        if(reachable===false){
          if(selected.ownerId!==null)failedOwners.add(selected.ownerId);
          report('unreachable');continue;
        }
        hooks.remember(selected.tile,choice.decisionId,'destination');report('reachable');return selected.tile;
      } catch(error){report('threw');throw error;}
    }
    return null;
  }
  function allocation(actor,context,hooks) {
    if(!hooks.allowed())return null;
    const available=actor.player.troops(),settings=deps.state.settings;
    const exactProbe=context.mode==='probe-1pct'||context.mode==='river-1pct';
    const fraction=exactProbe ? .01 : context.mode==='surge' ? settings.boatSurgeFrac||.25 :
      context.mode==='tactical'&&!settings.winFixes ? .2 : settings.boatProbeFrac||.01;
    const minimum=exactProbe||context.mode==='surge'||context.mode==='tactical'&&!settings.winFixes?0:settings.boatProbeMinTroops||8000;
    const original=exactProbe ? Math.floor(available*fraction) : context.mode==='surge' ? available*fraction :
      context.mode==='tactical'&&!settings.winFixes ? available/5 : Math.max(available*fraction,minimum);
    const candidates=[['original',original],['half',Math.min(available,original/2)],['double',Math.min(available,original*2)]]
      .map(([mode,troops],priority)=>({id:`boat:${mode}`,kind:'boat-allocation',priority,
        eligible:priority===0&&!exactProbe || Number.isFinite(troops)&&(exactProbe?troops>=1:troops>0)&&troops<=available,
        mode,launchMode:context.mode,tile:context.tile,troops,availableTroops:available,fraction,minimum,
        reason:priority===0?'Original boat troop formula':`Alternate ${mode} allocation within available troops`}));
    const choice=hooks.choose('boat-allocation',[...candidates,wait],{...context,availableTroops:available});
    const selected=candidates.find(c=>c.id===choice.selectedId&&c.eligible);
    if(!selected||!hooks.allowed()){
      hooks.record('boat-detail-result',{domain:'boat-allocation',decisionId:choice.decisionId,status:'stopped'});return null;
    }
    hooks.record('boat-detail-result',{domain:'boat-allocation',decisionId:choice.decisionId,status:'selected',
      tile:context.tile,troops:selected.troops});
    return {troops:selected.troops,decisionId:choice.decisionId};
  }
  function crater(actor,hits,hooks){
    let remaining=[...hits].reverse().filter(hit=>hit.tile!=null).map((hit,priority)=>({
      id:`crater:${priority}`,kind:'boat-destination',priority,eligible:true,readiness:'unchecked',
      tile:hit.tile,hitAt:hit.at??0,reason:'Original newest-first recent MIRV landing target; ownership checked after selection'
    }));
    while(remaining.length&&hooks.allowed()){
      const visible=remaining.slice(0,79),choice=hooks.choose('boat-destination',[...visible,wait],{mode:'crater',remainingSites:remaining.length});
      const selected=visible.find(c=>c.id===choice.selectedId);
      if(!selected||!hooks.allowed())return null;
      remaining=remaining.filter(c=>c!==selected);
      if(actor.game.ownerID(selected.tile)===actor.player.smallID())continue;
      hooks.remember(selected.tile,choice.decisionId,'destination');
      hooks.record('boat-detail-result',{domain:'boat-destination',decisionId:choice.decisionId,mode:'crater',tile:selected.tile,status:'selected'});
      return selected.tile;
    }
    return null;
  }
  async function tactical(actor,shore,enemies,hooks) {
    const start=origin(actor,shore,hooks);
    if(start===null||!hooks.allowed())return false;
    let remaining=['free','enemy'].map((mode,priority)=>({id:`boat-search:${mode}`,kind:'boat-search',mode,
      priority,eligible:true,reason:'Original free-before-enemy random boat search'}));
    while(remaining.length&&hooks.allowed()) {
      const choice=hooks.choose('boat-search',[...remaining,wait],{origin:start,enemyCount:enemies.length});
      const selected=remaining.find(c=>c.id===choice.selectedId);
      if(!selected||!hooks.allowed()){
        hooks.record('boat-detail-result',{domain:'boat-search',decisionId:choice.decisionId,status:'stopped'});return false;
      }
      let tile;
      try {tile=await hooks.execute(choice.decisionId,()=>actor.findRandomBoatTarget(start,enemies,selected.mode==='free'));}
      catch(error){hooks.record('boat-detail-result',{domain:'boat-search',decisionId:choice.decisionId,status:'threw'});throw error;}
      if(!hooks.allowed()){
        hooks.record('boat-detail-result',{domain:'boat-search',decisionId:choice.decisionId,status:'stopped',tile});return false;
      }
      hooks.record('boat-detail-result',{domain:'boat-search',decisionId:choice.decisionId,status:tile===null?'no-site':'found',tile});
      if(tile!==null){
        const amount=allocation(actor,{tile,mode:'tactical'},hooks);
        if(!amount||!hooks.allowed())return false;
        const sent=hooks.launch(amount.decisionId,tile,amount.troops);
        hooks.record('boat-detail-result',{domain:'boat-allocation',decisionId:amount.decisionId,
          status:'launch-result',tile,troops:amount.troops,submitted:!!sent});
        return sent;
      }
      remaining=remaining.filter(c=>c!==selected);
    }
    return false;
  }
  return {enemyProbeSites,origin,destination,crater,allocation,tactical};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createBoatPlanner;
