'use strict';
function createAllianceEventPlanner(deps){
  const queuedParents=new WeakMap();
  function select(hooks,domain,entries,facts){
    const candidates=entries.map((entry,priority)=>({kind:domain,eligible:true,priority,...entry}));
    const choice=hooks.choose(domain,[...candidates,{id:'$wait',kind:'wait',reason:'Stop alliance event pass'}],facts);
    const selected=candidates.find(c=>c.id===choice.selectedId);
    hooks.record('alliance-event-result',{domain,decisionId:choice.decisionId,selectedId:selected?.id,status:selected?'selected':'stopped'});
    if(!selected)hooks.hold();return {choice,selected};
  }
  function run(actor,mode,hooks){
    if(!hooks.allowed())return mode==='collect'?[]:undefined;
    if(mode!=='collect'&&mode!=='bots'&&actor.game.config().disableAlliances())return;
    let spawning=false;
    if(mode==='collect')try{spawning=actor.game.inSpawnPhase()===true;}catch(error){}
    const input=mode==='requests'?actor.incomingAllianceRequests():deps.collect(),output=[];
    const remaining=input.map((event,index)=>({event,index}));
    while(remaining.length&&hooks.allowed()){
      const target=select(hooks,'alliance-event-target',remaining.slice(0,79).map(e=>({id:`event:${e.index}`,inputIndex:e.index,sourceDecisionId:queuedParents.get(e.event),readiness:'unchecked',reason:'Original event order'})),{mode,remaining:remaining.length});
      if(!target.selected||!hooks.allowed())break;
      const index=remaining.findIndex(e=>e.index===target.selected.inputIndex),event=remaining.splice(index,1)[0].event;
      if(mode==='bots'){
        try{
          const player=actor.resolveEventPlayer(event),action=player&&actor.isRegularBot(player)?'mark-bot':'ignore';
          const response=select(hooks,'alliance-event-response',[{id:action,reason:'Original bot-event ignore rule'},...(action==='ignore'?[]:[{id:'defer',reason:'Leave event unmarked'}])],{mode,parentDecisionId:target.choice.decisionId});
          if(!response.selected||!hooks.allowed())break;
          if(response.selected.id==='mark-bot')hooks.execute(response.choice.decisionId,()=>actor._markAllianceEvent(event));
        }catch(error){}
        continue;
      }
      let action='ignore',player,buttons,created,assumedSpawn=false,button,ruleParent;
      if(mode==='requests'){
        player=event.requestor();
        if(player&&actor.isRegularBot(player)||deps.veto(player)||event.createdAt()<=actor.game.config().numSpawnPhaseTurns()+1)action='reject';
        else{
          const accepted=hooks.execute(target.choice.decisionId,()=>actor.getAllianceDecision(player,true,'incoming'));
          if(hooks.allianceStopped()){hooks.hold();break;}action=accepted?'accept':'reject';ruleParent=hooks.ruleParent('incoming');
        }
      }else{
        const type=Number(event?.type),types=mode==='collect'?deps.requestTypes():deps.renewTypes();
        if(types.has(type)&&!deps.isActioned(event)){
          buttons=Array.isArray(event.buttons)?event.buttons:[];
          if(buttons.length){player=actor.resolveEventPlayer(event);
            if(player&&player.isPlayer&&player.isPlayer()){
              if(mode==='collect'){
                const value=Number(event?.createdAt);
                if(Number.isFinite(value))created=value;
                else if(spawning){created=0;assumedSpawn=true;}
                else try{created=actor.game.ticks();}catch(error){created=actor.game.config().numSpawnPhaseTurns()+2;}
                action='queue';
              }else if(!deps.veto(player)){
                const accepted=hooks.execute(target.choice.decisionId,()=>actor.getAllianceDecision(player,true,'renewal'));
                if(hooks.allianceStopped()){hooks.hold();break;}
                if(accepted){button=deps.pick(buttons,'btn',1);if(button)action='renew';ruleParent=hooks.ruleParent('renewal');}
              }
            }
          }
        }
      }
      const response=select(hooks,'alliance-event-response',[{id:action,reason:`Original ${mode} event response`},...(action==='ignore'?[]:[{id:'defer',reason:'Leave event unchanged'}])],{mode,parentDecisionId:ruleParent??target.choice.decisionId});
      if(!response.selected||!hooks.allowed())break;
      const selected=response.selected.id;
      if(selected==='queue'){
        const request=hooks.execute(response.choice.decisionId,()=>actor._makeIncomingAllianceRequest(event,buttons,player,created,assumedSpawn));queuedParents.set(request,response.choice.decisionId);output.push(request);
      }else if(selected==='accept'||selected==='reject')hooks.execute(response.choice.decisionId,()=>{hooks.link('incoming',response.choice.decisionId);event[selected]();});
      else if(selected==='renew')hooks.execute(response.choice.decisionId,()=>{hooks.link('renewal',response.choice.decisionId);actor._renewAllianceEvent(event,button,player);});
      if(hooks.wasDeclined()){hooks.hold();break;}
    }
    return mode==='collect'?(hooks.allowed()?output:[]):undefined;
  }
  function action(actor,kind,execute,hooks,request){
    const sourceDecisionId=queuedParents.get(request);
    const choice=select(hooks,'alliance-event-action',[{id:kind,reason:'Selected event callback'}, {id:'defer',reason:'Leave callback unchanged'}],{action:kind,sourceDecisionId,parentDecisionId:hooks.parent()??sourceDecisionId});
    if(!choice.selected||!hooks.allowed()||choice.selected.id==='defer')return;
    return hooks.execute(choice.choice.decisionId,()=>{hooks.link(kind==='renew'?'renewal':'incoming',choice.choice.decisionId);return execute();});
  }
  return {run,action};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createAllianceEventPlanner;
