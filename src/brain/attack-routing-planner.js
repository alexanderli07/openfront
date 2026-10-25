'use strict';
function createAttackRoutingPlanner(deps) {
  const wait={id:'$wait',kind:'wait',reason:'Hold attack routing'};
  function choose(hooks,domain,entries,facts,parent) {
    const candidates=entries.slice(0,79).map((entry,priority)=>({...entry,id:`${domain}:${priority}`,kind:domain,
      priority,eligible:entry.eligible!==false}));
    const decision=hooks.choose(domain,[...candidates,wait],facts,parent);
    const index=candidates.findIndex(c=>c.id===decision.selectedId&&c.eligible);
    if(index<0||!hooks.allowed()){
      hooks.hold();hooks.record('attack-routing-result',{domain,decisionId:decision.decisionId,status:'stopped'});return null;
    }
    return {...entries[index],decisionId:decision.decisionId};
  }
  async function route(actor,target,counter,hooks) {
    if(!hooks.allowed())return false;
    const player=target.isPlayer(),border=player?actor.player.sharesBorderWith(target):actor.hasLandBorderWithTerraNullius();
    const land={route:'land',eligible:!!border,reason:'Land route requires original border predicate'};
    const boat={route:player?'targeted-boat':'nearby-boat',reason:'Boat route; original feature and reachability gates run after selection'};
    const selected=choose(hooks,'attack-route',border?[land,boat]:[boat,land],{player,border,counter});
    if(!selected)return false;
    const result=await hooks.execute(selected.decisionId,()=>selected.route==='land'?
      (player?actor.sendLandAttack(target,counter):actor.sendLandAttack(target)):
      selected.route==='targeted-boat'?actor.sendBoatAttack(target):actor.sendBoatAttackToNearbyTerraNullius());
    hooks.record('attack-routing-result',{domain:'attack-route',decisionId:selected.decisionId,route:selected.route,
      status:hooks.stopped()?'stopped':'attempt-completed',result});
    return result;
  }
  async function targeted(actor,target,hooks) {
    let budget,quoted=false;
    try {
      if(!hooks.allowed())return false;
      await actor.game.ensureBorderTiles(target);
      if(!hooks.allowed())return false;
      const own=Array.from(actor.player.borderTiles()).filter(tile=>actor.game.isShore(tile));
      const shores=Array.from(target.borderTiles()).filter(tile=>actor.game.isShore(tile));
      const original=deps.closestTwoTiles(actor.game,own,shores);
      if(original===null){hooks.record('attack-routing-result',{domain:'targeted-boat-site',status:'no-shore'});return false;}
      const entries=[{tile:original.y,sourceShore:original.x,reason:'Original closestTwoTiles destination'},
        ...[...new Set(shores)].filter(tile=>tile!==original.y).slice(0,78).map(tile=>({tile,
          reason:'Alternative supplied target shore; transport service chooses actual spawn'}))];
      const site=choose(hooks,'targeted-boat-site',entries,{ownShoreCount:own.length,targetShoreCount:shores.length,candidateLimit:79});
      if(!site)return false;
      const reachable=await hooks.probe(site.tile);
      hooks.record('attack-routing-result',{domain:'targeted-boat-site',decisionId:site.decisionId,tile:site.tile,
        status:!hooks.allowed()?'stopped':reachable===false?'unreachable':'reachable'});
      if(!hooks.allowed()||reachable===false)return false;
      return hooks.execute(site.decisionId,()=>{
        budget=actor.botAttackTroopsSent;quoted=true;
        const settings=deps.settings();let amount,minimum=1;
        if(settings.winFixes){minimum=settings.boatProbeMinTroops||8000;
          amount=Math.max(actor.player.troops()*(settings.boatProbeFrac||.01),minimum);
        }else if(target.type()===deps.botType){
          amount=actor.calculateBotAttackTroops(target,actor.player.troops()/5);minimum=hooks.minimumBotForce();
        }else amount=actor.player.troops()/5;
        if(!hooks.allowed())return false;
        if(amount<1){hooks.record('attack-routing-result',{domain:'targeted-boat-allocation',status:'insufficient-force',amount});return false;}
        const available=actor.player.troops();
        const allocation=choose(hooks,'targeted-boat-allocation',[1,.75,.5].map((fraction,index)=>({troops:amount*fraction,
          eligible:index===0||Number.isFinite(amount*fraction)&&amount*fraction>=Math.max(1,minimum)&&amount*fraction<=available,
          reason:index===0?'Original targeted boat troop formula':'Smaller targeted force within army and viability floor'})),
          {tile:site.tile,available,minimum,winFixes:!!settings.winFixes},site.decisionId);
        if(!allocation)return false;
        const result=hooks.execute(allocation.decisionId,()=>actor._targetedBoatReady(target,{y:site.tile},allocation.troops));
        if(hooks.wasDeclined())hooks.hold();
        hooks.record('attack-routing-result',{domain:'targeted-boat-allocation',decisionId:allocation.decisionId,tile:site.tile,
          troops:allocation.troops,status:hooks.stopped()?'stopped':'attempt-completed',result});
        return result;
      });
    }finally{if(quoted&&hooks.stopped())actor.botAttackTroopsSent=budget;}
  }
  async function free(actor,tiles,hooks) {
    let remaining=tiles.map((tile,index)=>({tile,index,reason:'Original nearby free-land probe order'}));
    while(remaining.length&&hooks.allowed()) {
      const site=choose(hooks,'free-boat-site',remaining,{remaining:remaining.length});
      if(!site)return false;
      remaining=remaining.filter(entry=>entry.index!==site.index);
      const reachable=await hooks.probe(site.tile);
      hooks.record('attack-routing-result',{domain:'free-boat-site',decisionId:site.decisionId,tile:site.tile,
        status:!hooks.allowed()?'stopped':reachable===false?'unreachable':'reachable'});
      if(!hooks.allowed())return false;
      if(reachable===false)continue;
      const settings=deps.settings(),available=actor.player.troops(),minimum=settings.winFixes?settings.boatProbeMinTroops||8000:1;
      const amount=settings.winFixes?Math.max(available*(settings.boatProbeFrac||.01),minimum):available/5;
      if(amount<1)return false;
      const allocation=choose(hooks,'free-boat-allocation',[1,.75,.5].map((fraction,index)=>({troops:amount*fraction,
        eligible:index===0||Number.isFinite(amount*fraction)&&amount*fraction>=Math.max(1,minimum)&&amount*fraction<=available,
        reason:index===0?'Original free-land boat amount':'Smaller viable free-land force'})),{tile:site.tile,available,minimum},site.decisionId);
      if(!allocation)return false;
      const result=hooks.execute(allocation.decisionId,()=>actor._freeBoatReady(site.tile,allocation.troops));
      if(hooks.wasDeclined())hooks.hold();
      hooks.record('attack-routing-result',{domain:'free-boat-allocation',decisionId:allocation.decisionId,
        tile:site.tile,troops:allocation.troops,status:hooks.stopped()?'stopped':'attempt-completed',result});
      return result;
    }
    return false;
  }
  return {route,targeted,free};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createAttackRoutingPlanner;
