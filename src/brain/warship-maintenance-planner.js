'use strict';

function createWarshipMaintenancePlanner(deps) {
  const phases=['tracking','dodge','patrol','combat'];
  const methods={tracking:'trackShipsAndRetaliate',dodge:'dodgeNukes',patrol:'smartWarshipPatrol',combat:'smartWarshipCombat'};
  function run(bot, tick, hooks) {
    const remaining=[...phases],completed=[];
    let smartChecked=false,smartEnabled=false;
    while(remaining.length){
      if(!hooks.allowed())return {stopped:true,completed};
      const candidates=remaining.map((id,priority)=>({id,kind:'warship-maintenance',priority,eligible:true,
        readiness:'unchecked',reason:`Original early maintenance phase: ${id}`}));
      const decision=hooks.choose([...candidates,{id:'$wait',kind:'wait',reason:'Stop this maintenance pass'}],{tick});
      const selected=candidates.find(c=>c.id===decision.selectedId);
      const report=(status,details={})=>hooks.record('warship-maintenance-result',{
        decisionId:decision.decisionId,phase:selected?.id,status,...details});
      if(!selected||!hooks.allowed()){report('stopped',{reason:decision.reason});return {stopped:true,completed};}
      remaining.splice(remaining.indexOf(selected.id),1);
      let enabled;
      if(selected.id==='tracking')enabled=deps.settings().warshipAutoSpawn!==false;
      else{
        // The original winFixes block is entered once. Preserve that decision
        // even if a dodge/patrol callback changes settings during the pass.
        if(!smartChecked){smartChecked=true;smartEnabled=Boolean(deps.settings().winFixes);}
        enabled=smartEnabled&&(selected.id!=='dodge'||deps.settings().warshipNukeDodge!==false);
      }
      if(!enabled){report('skipped');continue;}
      try{hooks.execute(decision.decisionId,()=>bot.warshipBehavior[methods[selected.id]]());}
      catch(error){report('threw',{error:String(error?.message||error)});throw error;}
      if(!hooks.allowed()){report('stopped');return {stopped:true,completed};}
      completed.push(selected.id);report('completed');
    }
    return {stopped:false,completed};
  }
  return {run};
}

if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipMaintenancePlanner;
