'use strict';
function createSocialPlanner(){
  const cooldownTokens=new WeakMap();
  const phases=['checkOverwhelmedByAttacks','checkVerySmallAttack','congratulateWinner','brag','charmAllies','annoyTraitors','findRat','greetNearbyPlayers'];
  const wait={id:'$wait',kind:'wait',reason:'Hold social action'};
  function choose(hooks,domain,candidates,facts={}){
    const decision=hooks.choose(domain,[...candidates,wait],facts),selected=hooks.allowed()?candidates.find(c=>c.id===decision.selectedId):undefined;
    if(!selected)hooks.hold();
    hooks.record('social-result',{domain,decisionId:decision.decisionId,selectedId:selected?.id,status:selected?'selected':'stopped'});
    return {decision,selected};
  }
  function casual(actor,hooks){
    if(actor.gameOver)return;
    const remaining=[...phases];
    while(remaining.length&&hooks.allowed()){
      const choice=choose(hooks,'social-phase',remaining.map((method,priority)=>({id:method,kind:'social-phase',priority,eligible:true,readiness:'unchecked',reason:'Original casual social order'})));
      if(!choice.selected||!hooks.allowed())return;
      const method=choice.selected.id;remaining.splice(remaining.indexOf(method),1);
      hooks.execute(choice.decision.decisionId,()=>actor[method]());
    }
  }
  function recipient(actor,pool,mode,hooks){
    if(!hooks.allowed()||!pool.length)return null;
    const sample=mode==='winner'?pool[0]:actor.random.randElement(pool);
    const originalIndex=pool.indexOf(sample);
    const indices=pool.map((_,index)=>index);if(originalIndex>=0){indices.splice(originalIndex,1);indices.unshift(originalIndex);}
    for(let offset=0;offset<indices.length;offset+=78){
      const candidates=indices.slice(offset,offset+78).map((index,priority)=>({id:`recipient:${index}`,kind:'social-recipient',priority:offset+priority,inputIndex:index,eligible:true,originalSample:index===originalIndex,reason:'Original sampled or ranked recipient'}));
      if(offset+78<indices.length)candidates.push({id:'$next',kind:'next-window',priority:indices.length,reason:'Inspect later recipients'});
      const choice=choose(hooks,'social-recipient',candidates,{mode,total:pool.length,offset});
      if(!choice.selected||!hooks.allowed())return null;
      if(choice.selected.id==='$next')continue;
      hooks.remember(choice.decision.decisionId);return pool[choice.selected.inputIndex];
    }
    return null;
  }
  function smallAttacks(actor,attacks,troops,deps,hooks){
    const remaining=attacks.map((attack,index)=>({attack,index}));
    while(remaining.length&&hooks.allowed()){
      const choice=choose(hooks,'social-small-attack-target',remaining.slice(0,79).map(entry=>({id:`attack:${entry.index}`,kind:'social-small-attack-target',inputIndex:entry.index,eligible:true,priority:entry.index,readiness:'unchecked',reason:'Original incoming attack order'})));
      if(!choice.selected||!hooks.allowed())return;
      const index=remaining.findIndex(e=>e.index===choice.selected.inputIndex),entry=remaining.splice(index,1)[0];
      const target=entry.attack.attacker();if(target.type()!==deps.human)continue;
      if(entry.attack.troops()<troops*.1)hooks.execute(choice.decision.decisionId,()=>{
        const sample=actor.random.chance(2)?deps.confused:deps.bored,selected=pool([deps.confused,deps.bored],sample,'small-attack',hooks);
        if(selected!==null)actor.maybeSendEmoji(target,selected);
      });
    }
  }
  function permission(actor,target,mark,deps,hooks){
    if(!hooks.allowed()){hooks.hold();return false;}
    let allowed=true,key,previous,had=false;
    if(target!==deps.all){
      if(actor.player.type()===deps.bot)allowed=false;
      else if(target.type()!==deps.human)allowed=false;
      else if(mark){key=target.smallID();had=actor.lastEmojiSent.has(key);previous=actor.lastEmojiSent.get(key);if(actor.game.ticks()-(previous??-300)<=300)allowed=false;}
    }
    const action=allowed?'allow':'reject',choice=choose(hooks,'social-cooldown',[{id:action,kind:'social-cooldown',eligible:true,priority:0,mark:allowed&&mark&&target!==deps.all,reason:'Original emoji eligibility and cooldown'}],{mark,allowed});
    if(!choice.selected||!hooks.allowed()||!allowed)return false;
    if(mark&&target!==deps.all){
      const stamp=actor.game.ticks();actor.lastEmojiSent.set(key,stamp);
      let tokens=cooldownTokens.get(actor);if(!tokens){tokens=new Map();cooldownTokens.set(actor,tokens);}
      const token={};tokens.set(key,token);
      hooks.undo(()=>{if(tokens.get(key)!==token||actor.lastEmojiSent.get(key)!==stamp)return;tokens.delete(key);if(had)actor.lastEmojiSent.set(key,previous);else actor.lastEmojiSent.delete(key);});
    }
    return true;
  }
  function message(actor,pool,hooks){
    if(!hooks.allowed()){hooks.hold();return;}
    const sample=actor.random.randElement(pool),values=Array.from(pool),index=values.indexOf(sample);
    const entries=values.map((value,inputIndex)=>({value,inputIndex}));
    if(index>=0)entries.unshift(...entries.splice(index,1));else entries.unshift({value:sample,inputIndex:-1});
    for(let offset=0;offset<entries.length;offset+=78){
      const candidates=entries.slice(offset,offset+78).map((entry,priority)=>({id:`message:${entry.inputIndex}`,kind:'social-message',value:entry.value,priority:offset+priority,eligible:true,reason:'Original emoji sample first'}));
      if(offset+78<entries.length)candidates.push({id:'$next',kind:'next-window',reason:'Inspect later messages'});
      const choice=choose(hooks,'social-message',candidates,{total:entries.length,offset});
      if(!choice.selected||!hooks.allowed())return;
      if(choice.selected.id==='$next')continue;
      return choice.selected.value;
    }
  }
  function pool(pools,sample,mode,hooks){
    const index=pools.indexOf(sample),choice=choose(hooks,'social-message-pool',pools.map((_,inputIndex)=>({id:`pool:${inputIndex}`,kind:'social-message-pool',priority:inputIndex===index?0:inputIndex+1,inputIndex,eligible:true,reason:'Original chance-selected message pool'})),{mode});
    return choice.selected&&hooks.allowed()?pools[choice.selected.inputIndex]:null;
  }
  function request(actor,target,emoji,attack,deps,hooks){
    if(!actor.shouldSendEmoji(target)||!hooks.allowed())return;
    if(!attack)return actor.sendEmoji(target,emoji);
    const neutral=actor.player.relation(target)>=deps.neutral,send=actor.random.chance(neutral?2:4);
    const choice=choose(hooks,'social-attack-message',[
      {id:'send',kind:'social-attack-message',eligible:send,priority:0,reason:'Original attack emoji chance permits sending'},
      {id:'skip',kind:'social-attack-message',eligible:true,priority:1,reason:'Original attack emoji chance failed or defer sending'}
    ].filter(c=>c.eligible),{neutral,send});
    if(choice.selected?.id==='send'&&hooks.allowed())return hooks.execute(choice.decision.decisionId,()=>actor.sendEmoji(target,neutral?deps.aggressive:deps.attack));
  }
  function winnerMark(actor,hooks){
    const choice=choose(hooks,'social-winner-response',[{id:'mark',kind:'social-winner-response',priority:0,eligible:true,reason:'Winner observed; mark game over'}]);
    if(!choice.selected||!hooks.allowed())return false;
    const previous=actor.gameOver;actor.gameOver=true;hooks.undo(()=>{actor.gameOver=previous;});return true;
  }
  function reaction(actor,run,hooks){
    const choice=choose(hooks,'social-reaction',[{id:'observe',kind:'social-reaction',eligible:true,priority:0,reason:'Original MIRV social reaction'}]);
    if(choice.selected&&hooks.allowed())return hooks.execute(choice.decision.decisionId,run);
  }
  return {casual,recipient,smallAttacks,permission,message,pool,request,winnerMark,reaction};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createSocialPlanner;
