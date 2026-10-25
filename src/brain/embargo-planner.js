'use strict';
function createEmbargoPlanner() {
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
  function run(actor,targets,context,hooks) {
    const relations=context.mode==='relations';
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
