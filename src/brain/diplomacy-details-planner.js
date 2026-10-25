'use strict';
function createDiplomacyDetailsPlanner(deps) {
  const wait={id:'$wait',kind:'wait',reason:'Hold diplomacy action'};
  const id=target=>{try{return target.id?.()??target.smallID?.();}catch{return undefined;}};
  function choose(hooks,domain,entries,facts) {
    const cs=entries.slice(0,79).map((e,priority)=>({...e,id:`${domain}:${priority}`,kind:domain,priority,
      eligible:e.eligible!==false}));
    const decision=hooks.choose(domain,[...cs,wait],facts);
    const index=cs.findIndex(c=>c.id===decision.selectedId&&c.eligible);
    if(index<0||!hooks.allowed()) {
      if(entries.some(e=>e.eligible!==false)||decision.selectedId===null)hooks.hold();
      hooks.record(`${domain}-result`,{decisionId:decision.decisionId,status:'wait',reason:decision.reason});
      return {index:-1,decisionId:decision.decisionId};
    }
    return {index,decisionId:decision.decisionId};
  }
  function donate(actor,targets,hooks) {
    if(!hooks.allowed())return false;
    const posture=hooks.supportPosture?.();
    if(posture&&(!(posture.donationReady??posture.ready)||posture.conserve)){
      hooks.record('donation-amount-result',{status:'home-conservation',reason:posture.donationHoldReason||posture.reason});return false;
    }
    const settings=deps.settings();
    const ordered=targets.map(teammate=>{
      const capacity=actor.game.config().maxTroops(teammate);
      return {teammate,troopPercentage:teammate.troops()/Math.max(capacity,1)};
    })
      .sort((a,b)=>a.troopPercentage-b.troopPercentage);
    const threshold=settings.winFixes?settings.donateNeedThreshold??.8:1;
    const entries=ordered.filter(e=>e.teammate.isAlive()&&e.teammate.smallID()!==actor.player.smallID()&&e.troopPercentage<threshold)
      .map(entry=>{let frontline=false;try{frontline=entry.teammate.incomingAttacks().length>0||entry.teammate.outgoingAttacks().length>0;}catch{}
        let bordersEnemy=false;
        if(!frontline)try{bordersEnemy=entry.teammate.nearby().some(neighbor=>neighbor.isPlayer()&&neighbor.isAlive()&&
          !entry.teammate.isFriendly(neighbor)&&entry.teammate.sharesBorderWith(neighbor));}catch{}
        return {entry,frontline,bordersEnemy};});
    entries.sort((a,b)=>a.frontline!==b.frontline?(a.frontline?-1:1):a.entry.troopPercentage-b.entry.troopPercentage);
    // Keep the legacy winner visible, then expose qualified front-line allies
    // before filling the bounded window with remaining recipients.
    const cutoff=Math.min(.65,threshold),first=entries[0];
    const preferred=entries.filter(e=>e!==first&&(e.frontline||e.bordersEnemy)&&e.entry.troopPercentage<cutoff);
    const preferredSet=new Set(preferred);
    const visible=[...(first?[first]:[]),...preferred,...entries.filter(e=>e!==first&&!preferredSet.has(e))].slice(0,78);
    const target=choose(hooks,'donation-target',[...visible.map(e=>({targetId:id(e.entry.teammate),fill:e.entry.troopPercentage,
      frontline:e.frontline,bordersEnemy:e.bordersEnemy,
      reason:`Combat=${e.frontline}, enemy border=${e.bordersEnemy}; lowest troop fill within priority`})),
      {skipDonation:true,reason:'Keep troops and continue the attack pass without donating'}],
      {threshold,targets:entries.length,visibleTargets:visible.length});
    if(target.index<0){if(!entries.length)deps.debug('[Donate] skip: no teammate below the need threshold (all allies healthy)');return false;}
    if(target.index===visible.length){hooks.record('donation-target-result',{decisionId:target.decisionId,status:'skipped',reason:'Policy kept troops'});return false;}
    const selected=visible[target.index];
    deps.debug('[Donate] picked ally at '+Math.round(selected.entry.troopPercentage*100)+'% '+(selected.frontline?'(FRONTLINE — in combat)':selected.bordersEnemy?'(FRONTLINE — enemy border)':'(rear)'));
    return hooks.execute(target.decisionId,()=>{
      const capacity=actor.game.config().maxTroops(actor.player);
      const keep=posture?posture.keepFraction:settings.winFixes?Math.max(actor.effectiveReserveRatio(),settings.donateKeepFrac||.45):actor.reserveRatio;
      const reserve=capacity*keep;
      const room=posture?Math.max(0,actor.game.config().maxTroops(selected.entry.teammate)*cutoff-selected.entry.teammate.troops()):Infinity;
      const excess=posture?Math.floor(Math.min(actor.player.troops()-reserve,room)):actor.player.troops()-reserve;
      const minimumExcess=posture?Math.min(Math.max(1,capacity*.01),room):settings.winFixes?capacity*(settings.donateMinExcessFrac||.05):1;
      if(excess<minimumExcess){
        deps.debug('[Donate] skip: not enough above the keep line',{troops:Math.round(actor.player.troops()),keep:Math.round(reserve),needExcess:Math.round(minimumExcess)});
        hooks.record('donation-amount-result',{status:'insufficient-excess',excess,minimumExcess});return false;
      }
      const fraction=settings.donateMinDonatePct||.2,minimum=posture?Math.ceil(minimumExcess):actor.player.troops()*fraction;
      if(excess<minimum){
        deps.debug('[Donate] skip: donation too small (minDonatePct)',{available:Math.round(excess),minChunk:Math.round(minimum),pct:Math.round(fraction*100)+'%'});
        hooks.record('donation-amount-result',{status:'below-minimum-chunk',excess,minimum});return false;
      }
      const amounts=[{amount:excess,reason:'Original full excess over reserve'},
        {amount:excess/2,eligible:Number.isFinite(excess/2)&&excess/2>0&&excess/2>=minimum,reason:'Donate half excess within original minimum chunk'},
        {amount:minimum,eligible:Number.isFinite(minimum)&&minimum>0&&minimum<=excess,reason:'Donate original minimum chunk'}];
      const choice=choose(hooks,'donation-amount',amounts,{capacity,keep,reserve,minimumExcess,minimum});
      if(choice.index<0)return false;
      const result=hooks.execute(choice.decisionId,()=>actor._donateReady(selected.entry.teammate,amounts[choice.index].amount));
      if(hooks.wasDeclined()){hooks.hold();return false;}
      hooks.record('donation-amount-result',{decisionId:choice.decisionId,status:result===false?'not-submitted':'attempt-completed',amount:amounts[choice.index].amount});
      return result;
    });
  }
  function outreach(actor,targets,hooks) {
    let remaining=targets.map((target,index)=>({target,index}));
    while(remaining.length&&hooks.allowed()) {
      const visible=remaining.slice(0,79);
      const choice=choose(hooks,'outreach-target',visible.map(e=>({targetId:id(e.target),targetIndex:e.index,
        reason:'Evaluate outgoing request at original loop position'})),{remaining:remaining.length,candidateLimit:79});
      if(choice.index<0)return;
      const selected=visible[choice.index];remaining=remaining.filter(e=>e!==selected);
      hooks.execute(choice.decisionId,()=>actor._outgoingAllianceCandidate(selected.target));
      if(hooks.wasDeclined()||hooks.allianceStopped()){hooks.hold();return;}
      hooks.record('outreach-target-result',{decisionId:choice.decisionId,status:'evaluated',targetIndex:selected.index});
    }
  }
  function far(actor,targets,now,ctors,hooks) {
    if(!hooks.allowed())return;
    const winner=actor.random.randElement(targets);
    const entries=[winner,...targets.filter(target=>target!==winner)].slice(0,79);
    const choice=choose(hooks,'far-outreach-target',entries.map(target=>({targetId:id(target),reason:'Original random eligible far nation, then alternatives'})),
      {targets:targets.length,candidateLimit:79});
    if(choice.index<0)return;
    hooks.execute(choice.decisionId,()=>actor._farOutreachReady(entries[choice.index],now,ctors));
    if(hooks.wasDeclined())hooks.hold();
    hooks.record('far-outreach-target-result',{decisionId:choice.decisionId,status:hooks.wasDeclined()?'declined':'evaluated'});
  }
  return {donate,outreach,far};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createDiplomacyDetailsPlanner;
