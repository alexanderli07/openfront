'use strict';
function createEmbargoPlanner() {
  const submissions=new WeakMap();
  const wait={id:'$wait',kind:'wait',reason:'Hold remaining embargo responses'};
  function choose(hooks,domain,entries,facts) {
    const candidates=entries.slice(0,79).map((entry,priority)=>({...entry,id:`${domain}:${priority}`,kind:domain,
      priority,eligible:entry.eligible!==false}));
    const decision=hooks.choose(domain,[...candidates,wait],facts);
    const index=candidates.findIndex(c=>c.id===decision.selectedId&&c.eligible);
    if(index<0||!hooks.allowed()) {
      hooks.hold();hooks.record('embargo-result',{domain,decisionId:decision.decisionId,status:'stopped'});return null;
    }
    return {...entries[index],decisionId:decision.decisionId};
  }
  function allEnemies(actor,targets,context,hooks){
    if(!hooks.allowed())return;
    const player=actor.player,game=actor.mg;
    const missing=targets.filter(target=>target.id()!==player.id()&&target.isAlive()&&
      target.type()!==hooks.botType&&!player.isOnSameTeam(target)&&!player.isAlliedWith(target)&&
      !player.hasEmbargoAgainst(target));
    const tick=game.ticks(),previous=submissions.get(actor);
    const configured=game.config().embargoAllCooldown?.();
    const cooldown=Number.isFinite(configured)&&configured>0?configured:100;
    const pending=previous?.game===game&&tick>=previous.tick&&tick-previous.tick<cooldown;
    if(!missing.length||pending){
      hooks.record('embargo-result',{domain:'embargo-action',status:'kept',allEnemies:true,
        reason:missing.length?'Await native embargo confirmation/cooldown':'All eligible enemies already embargoed',missing:missing.length});return;
    }
    const choice=choose(hooks,'embargo-action',[{action:'start',allEnemies:true,
      reason:'Stop trading with all enemies using the native team action'}],{...context,missing:missing.length});
    if(!choice)return;
    const result=hooks.execute(choice.decisionId,()=>hooks.sendAll());
    if(result===true)submissions.set(actor,{game,tick});
    if(hooks.wasDeclined())hooks.hold();
    hooks.record('embargo-result',{domain:'embargo-action',decisionId:choice.decisionId,allEnemies:true,
      action:'start',status:result===true?'submitted':'not-submitted',missing:missing.length});
  }
  function run(actor,targets,context,hooks) {
    const relations=context.mode==='relations';
    if(!relations&&context.nativeAll)return allEnemies(actor,targets,context,hooks);
    const targetDomain=relations?'embargo-relation-target':'embargo-target';
    const actionDomain=relations?'embargo-relation-response':'embargo-action';
    let remaining=targets.map((target,index)=>({target,index}));
    while(remaining.length&&hooks.allowed()) {
      const visible=remaining.slice(0,79);
      const selected=choose(hooks,targetDomain,visible.map(entry=>({index:entry.index,
        targetId:(()=>{try{return entry.target.id();}catch{return undefined;}})(),reason:'Original nonself player iteration order'})),
        {...context,remaining:remaining.length,candidateLimit:79});
      if(!selected)return;
      const entry=visible.find(e=>e.index===selected.index);remaining=remaining.filter(e=>e!==entry);
      hooks.execute(selected.decisionId,()=>{
        const proposed=(relations?actor._embargoRelationAction(entry.target):
          actor._embargoAction(entry.target,context.hard,context.team))??'keep';
        const actions=relations?['penalty','restore','keep']:['start','stop','keep'];
        const ordered=[proposed,...actions.filter(action=>action!==proposed)];
        const choice=choose(hooks,actionDomain,ordered.map(action=>({action,
          eligible:action==='keep'||action===proposed,
          ...(relations?{delta:action==='penalty'?-20:action==='restore'?20:0}:{}),
          reason:action===proposed?'Original lazy embargo rule result':action==='keep'?'Leave current state unchanged':'Original rule does not permit this response'})),
          {...context,targetIndex:entry.index,proposed});
        if(!choice)return;
        if(choice.action==='keep'){
          hooks.record('embargo-result',{domain:actionDomain,decisionId:choice.decisionId,targetIndex:entry.index,status:'kept'});return;
        }
        const result=hooks.execute(choice.decisionId,()=>relations?actor._embargoRelationReady(entry.target,choice.action):
          choice.action==='start'?actor.addEmbargo(entry.target,false):actor.stopEmbargo(entry.target));
        if(hooks.wasDeclined())hooks.hold();
        hooks.record('embargo-result',{domain:actionDomain,decisionId:choice.decisionId,targetIndex:entry.index,
          action:choice.action,status:hooks.stopped()?'stopped':'attempt-completed',result});
      });
    }
  }
  return {run};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createEmbargoPlanner;
