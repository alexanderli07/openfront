'use strict';

function createOpeningExpansion(deps={}){
  const states=new WeakMap(),milestones=[4000,5000,6000,8000,10000,10000,10000];
  function room(actor){
    const g=actor.game,seen=new Set(),queue=[];
    const add=t=>{if(seen.size<1024&&!seen.has(t)&&g.isLand(t)&&!g.hasOwner(t)&&!g.hasFallout(t)){
      seen.add(t);queue.push(t);
    }};
    for(const t of actor.player.borderTiles()){
      for(const n of g.neighbors(t))add(n);
      if(seen.size>=1024)break;
    }
    for(let i=0;i<queue.length&&seen.size<1024;i++)for(const n of g.neighbors(queue[i]))add(n);
    return seen.size;
  }
  function run(actor,target,opening,hooks){
    let state=states.get(actor);
    if(!opening||!opening.borderKnown||opening.frontline)return undefined;
    // Border contact can disappear while combat or its sticky reserve window
    // remains active. Keep the original defense behavior for that interval.
    if(deps.settings?.().combatReserve!==false&&actor.underThreat?.())return undefined;
    if(!opening.wilderness){if(state?.started)state.finished=true;return undefined;}
    const tick=actor.game.ticks();
    if(!state||state.game!==actor.game||tick<state.observedTick){
      state={game:actor.game,started:false,stage:0,lastDispatch:-Infinity,next:10000};states.set(actor,state);
    }
    state.observedTick=tick;if(state.finished)return undefined;
    const troops=actor.player.troops(),capacity=actor.game.config().maxTroops(actor.player);
    const continuing=state.started&&state.stage>=milestones.length;
    const freeTiles=continuing?room(actor):null;
    const targetTroops=!state.started?capacity*.2:continuing?
      freeTiles>=512?Math.max(13000,state.next):10000:milestones[state.stage];
    const threshold=!state.started?targetTroops:Math.min(targetTroops,capacity*.8);
    const amount=Math.floor(troops*.2);
    const ready=Number.isFinite(capacity)&&capacity>0&&Number.isFinite(troops)&&troops>=threshold&&amount>=1&&tick-state.lastDispatch>=10;
    const facts={applies:true,stage:state.started?state.stage:'first',troops,capacity,threshold,amount,
      freeTiles,spaceLimit:1024,spacingTicks:10,lastDispatchTick:Number.isFinite(state.lastDispatch)?state.lastDispatch:null,ready};
    const candidates=[{id:'opening-expansion:original',kind:'opening-expansion',eligible:true,priority:0,
      reason:'Retain original reserve-based wilderness allocation'},
      {id:'opening-expansion:wave',kind:'opening-expansion',eligible:ready,adaptiveOnly:true,priority:1,amount,
        reason:`Send 20% after rebuilding to ${Math.ceil(threshold)} troops`},
      {id:'$wait',kind:'wait',eligible:true,reason:'Rebuild troops or wait for dispatch spacing'}];
    const decision=hooks.choose('opening-expansion',candidates,facts);
    if(decision.selectedId==='opening-expansion:original')return undefined;
    const record=(status,extra={})=>hooks.record('opening-expansion-result',{decisionId:decision.decisionId,tick,...facts,status,...extra});
    if(decision.selectedId!=='opening-expansion:wave'||!ready||!hooks.allowed()){
      record('held',{reason:decision.reason});hooks.hold();return {result:false};
    }
    const result=hooks.execute(decision.decisionId,()=>actor._landAttackReady(target,false,amount));
    if(result===true&&!hooks.wasDeclined()){
      if(!state.started){state.started=true;state.stage=0;while(state.stage<5&&milestones[state.stage]<=troops)state.stage++;}
      else if(state.stage<milestones.length)state.stage++;
      if(state.stage>=milestones.length){
        const space=freeTiles??room(actor);
        state.next=space>=512?Math.ceil(Math.max(10000,threshold)*1.25/1000)*1000:10000;
      }
      state.lastDispatch=tick;record('submitted');
    }else {record('not-submitted');if(hooks.wasDeclined())hooks.hold();}
    return {result:result===true&&!hooks.wasDeclined()};
  }
  function finishIfCleared(actor,opening){
    if(opening?.borderKnown&&!opening.wilderness){const state=states.get(actor);if(state?.started)state.finished=true;}
  }
  function resumeAfterCrossing(actor){const state=states.get(actor);if(state?.game===actor.game)state.finished=false;}
  return {run,finishIfCleared,resumeAfterCrossing};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createOpeningExpansion;
