'use strict';
function createAttackAllocationPlanner(deps) {
  function choose(hooks,domain,entries,facts) {
    const candidates=entries.map((entry,priority)=>({...entry,id:`${domain}:${priority}`,kind:domain,
      priority,eligible:entry.eligible!==false}));
    const decision=hooks.choose(domain,[...candidates,{id:'$wait',kind:'wait',reason:'Hold attack allocation'}],facts);
    const index=candidates.findIndex(c=>c.id===decision.selectedId&&c.eligible);
    if(index<0||!hooks.allowed()) {hooks.hold();return null;}
    return {entry:entries[index],decisionId:decision.decisionId};
  }
  function bot(actor,target,available,hooks) {
    if(!hooks.allowed())return 0;
    const easy=deps.difficulty()===deps.easy,enemy=easy?null:target.troops();
    let amount=easy?available:enemy*4;
    if(!easy&&amount>available)amount=available<enemy*2?0:available;
    const floor=easy?1:enemy*2;
    const choice=choose(hooks,'bot-allocation',[
      {amount,reason:'Original difficulty and two-to-four-times defender formula'},
      {amount:amount*.75,eligible:amount*.75>=floor&&amount*.75>=1,reason:'Smaller viable bot force'},
      {amount:Math.min(amount,floor),eligible:floor>=1&&floor<=amount,reason:'Two-times defender force'}
    ],{enemy,available,easy,budget:actor.botAttackTroopsSent});
    if(!choice)return 0;
    hooks.setBotMinimum(floor);
    actor.botAttackTroopsSent+=choice.entry.amount;
    hooks.record('bot-allocation-result',{decisionId:choice.decisionId,amount:choice.entry.amount});
    return choice.entry.amount;
  }
  function amounts(hooks,domain,amount,minimum,facts,execute,alternativeMinimum=minimum) {
    if(amount<1||amount<minimum) {
      hooks.record(`${domain}-result`,{status:'insufficient-force',amount,minimum});return false;
    }
    const choice=choose(hooks,domain,[1,.75,.5].map((fraction,index)=>({amount:amount*fraction,
      eligible:index===0||amount*fraction>=Math.max(1,minimum,alternativeMinimum),
      reason:index===0?'Original available attack force':'Smaller force within original minimum'})),facts);
    if(!choice)return false;
    const result=hooks.execute(choice.decisionId,()=>execute(choice.entry.amount));
    if(hooks.wasDeclined())hooks.hold();
    hooks.record(`${domain}-result`,{decisionId:choice.decisionId,amount:choice.entry.amount,
      status:hooks.wasDeclined()?'declined':'attempt-completed'});
    return result;
  }
  function land(actor,target,counter,hooks) {
    if(!hooks.allowed())return false;
    const {capacity,ratio}=actor._landReserveFacts(target,counter);
    const reserve=choose(hooks,'land-reserve',[
      {ratio,reason:'Original opening, neighbor, threat and counter reserve'},
      {ratio:Math.max(ratio,.5),eligible:Number.isFinite(ratio)&&ratio<.5,reason:'Keep at least half capacity'},
      {ratio:Math.max(ratio,.7),eligible:Number.isFinite(ratio)&&ratio<.7,reason:'Keep at least seventy percent capacity'}
    ],{capacity,counter,originalRatio:ratio});
    if(!reserve)return false;
    return hooks.execute(reserve.decisionId,()=>{
      const settings=deps.settings();
      const isBot=target.isPlayer()&&target.type()===deps.botType&&actor.player.type()!==deps.botType;
      let amount=isBot?actor.calculateBotAttackTroops(target,actor.player.troops()-capacity*reserve.entry.ratio-actor.botAttackTroopsSent):
        actor.player.troops()-capacity*reserve.entry.ratio;
      if(!hooks.allowed())return false;
      if(counter&&settings.combatReserve){const keep=settings.counterKeepFrac??.45;
        if(keep>0&&keep<1)amount=Math.min(amount,actor.player.troops()*(1-keep));}
      const minimum=settings.minAttackForce&&!counter&&target.isPlayer()&&target.type()!==deps.botType?
        capacity*(settings.minAttackFrac??.12):0;
      return amounts(hooks,'land-allocation',amount,minimum,{capacity,counter,reserve:reserve.entry.ratio,isBot},
        amount=>actor._landAttackReady(target,counter,amount),isBot?hooks.minimumBotForce():minimum);
    });
  }
  function forced(actor,target,hooks) {
    if(!hooks.allowed())return;
    // The original forced path has no minimum-force gate and returns undefined.
    const amount=actor.player.troops()/2;
    const choice=choose(hooks,'forced-allocation',[1,.75,.5].map(fraction=>({amount:amount*fraction,
      reason:fraction===1?'Original half-army forced attack':'Smaller forced attack'})),{troops:amount*2});
    if(!choice)return;
    hooks.execute(choice.decisionId,()=>actor._forcedAttackReady(target,choice.entry.amount));
    if(hooks.wasDeclined())hooks.hold();
  }
  return {land,forced,bot};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createAttackAllocationPlanner;
