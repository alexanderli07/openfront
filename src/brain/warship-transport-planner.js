'use strict';

function createWarshipTransportPlanner(deps) {
  const tickets=new WeakMap();
  const outgoingTickets={transport:new WeakMap(),trade:new WeakMap()};
  const wait={id:'$wait',kind:'wait',reason:'Stop ship responses'};
  function choose(hooks,domain,entries,facts={}){
    const candidates=entries.map((entry,priority)=>({kind:domain,priority,eligible:true,...entry}));
    const decision=hooks.choose(domain,[...candidates,wait],facts);
    const selected=candidates.find(c=>c.id===decision.selectedId&&c.eligible);
    const report=(status,details={})=>hooks.record('warship-transport-response-result',{
      domain,decisionId:decision.decisionId,selectedId:selected?.id,status,...details});
    if(!selected){report('stopped',{reason:decision.reason});hooks.hold();}
    return {selected,decision,report};
  }
  function incoming(actor,hooks){
    if(!hooks.allowed())return;
    actor.game.units(deps.transportType).filter(ship=>{
      const target=ship.targetTile();
      return target&&ship.isActive()&&!ship.transportShipState()?.isRetreating&&
        actor.game.ownerID(target)===actor.player?.smallID()&&ship.owner().smallID()!==actor.player?.smallID();
    }).forEach(ship=>actor.trackedIncomingTransportShips.add(ship.id()));
    const indexed=actor.indexById(actor.game.units(deps.transportType));
    let pending=tickets.get(actor);if(!pending){pending=new Map();tickets.set(actor,pending);}
    const remaining=Array.from(actor.trackedIncomingTransportShips,(unitId,index)=>({unitId,index}));
    while(remaining.length&&hooks.allowed()){
      const target=choose(hooks,'warship-transport-target',remaining.slice(0,79).map(e=>({
        id:`transport:${e.index}`,inputIndex:e.index,unitId:e.unitId,readiness:'unchecked',reason:'Original tracked transport order'})),
        {remaining:remaining.length});
      if(!target.selected||!hooks.allowed())return;
      const entry=remaining.find(e=>e.index===target.selected.inputIndex);remaining.splice(remaining.indexOf(entry),1);
      const ship=indexed.get(entry.unitId),tile=ship!==undefined?ship.targetTile():undefined;
      let action;
      if(ship===undefined||!ship.isActive()||tile===undefined||ship.transportShipState()?.isRetreating)action='forget';
      else if(actor.dealtWithTransportShip.has(entry.unitId))action='keep-handled';
      else if(actor.game.manhattanDist(ship.tile(),tile)<20)action='mark-close';
      else if(ship.owner().isAlliedWith(actor.player))action='keep-allied';
      else if(actor.game.hasUnitNearby(tile,90,deps.warshipType,actor.player.id(),true)||
        actor.player.units(deps.warshipType).filter(warship=>{
          const patrol=warship.warshipState().patrolTile;
          return patrol!==undefined&&actor.game.manhattanDist(tile,patrol)<90;
        }).length>0)action='mark-covered';
      else action='retaliate';
      const response=choose(hooks,'warship-transport-response',[
        {id:action,reason:`Original incoming transport response: ${action}`},
        ...(action.startsWith('keep')?[]:[{id:'defer',reason:'Leave tracked threat unchanged for a later pass'}])
      ],{parentDecisionId:target.decision.decisionId,unitId:entry.unitId,targetTile:tile});
      if(!response.selected||!hooks.allowed())return;
      if(response.selected.id==='defer'||action.startsWith('keep')){response.report('kept');continue;}
      if(action==='forget'){
        actor.trackedIncomingTransportShips.delete(entry.unitId);actor.dealtWithTransportShip.delete(entry.unitId);pending.delete(entry.unitId);
        response.report('forgotten');continue;
      }
      if(action!=='retaliate'){
        pending.set(entry.unitId,{});actor.dealtWithTransportShip.add(entry.unitId);response.report('handled');continue;
      }
      hooks.clearSpawn();
      const spawn=hooks.execute(response.decision.decisionId,()=>actor.warshipSpawnTile(tile,30));
      if(!hooks.allowed())return;
      if(spawn===null){response.report('no-spawn');continue;}
      const ticket={};pending.set(entry.unitId,ticket);let held=false;
      const onDecline=()=>{
        held=true;
        if(pending.get(entry.unitId)===ticket){
          pending.delete(entry.unitId);actor.dealtWithTransportShip.delete(entry.unitId);
          response.report('declined',{unitId:entry.unitId});
        }
      };
      hooks.execute(hooks.spawnParent()??response.decision.decisionId,()=>actor.maybeRetaliateWithWarship(spawn,ship.owner(),'transport',onDecline));
      if(held){hooks.hold();return;}
      if(!hooks.allowed())return;
      actor.dealtWithTransportShip.add(entry.unitId);response.report('retaliation-requested',{unitId:entry.unitId});return;
    }
  }
  function outgoing(actor,mode,hooks){
    if(!hooks.allowed())return;
    const type=mode==='trade'?deps.tradeType:deps.transportType;
    if(mode==='transport'&&actor.game.config().isUnitDisabled(type))return;
    const tracked=mode==='trade'?actor.trackedTradeShips:actor.trackedTransportShips;
    let pending=outgoingTickets[mode].get(actor);if(!pending){pending=new Map();outgoingTickets[mode].set(actor,pending);}
    actor.player.units(type).forEach(ship=>{const unitId=ship.id();tracked.add(unitId);pending.delete(unitId);});
    const indexed=actor.indexById(actor.game.units(type));
    const remaining=Array.from(tracked,(unitId,index)=>({unitId,index}));
    while(remaining.length&&hooks.allowed()){
      const target=choose(hooks,`warship-${mode}-outgoing-target`,remaining.slice(0,79).map(entry=>({
        id:`ship:${entry.index}`,inputIndex:entry.index,unitId:entry.unitId,readiness:'unchecked',reason:'Original tracked ship order'
      })),{remaining:remaining.length});
      if(!target.selected||!hooks.allowed())return;
      const entry=remaining.find(e=>e.index===target.selected.inputIndex);remaining.splice(remaining.indexOf(entry),1);
      const ship=indexed.get(entry.unitId);let action;
      if(mode==='transport'){
        const active=ship!==undefined&&ship.isActive();
        if(active)action='keep';
        else if(ship!==undefined&&typeof ship.wasDestroyedByEnemy==='function'&&typeof ship.destroyer==='function'&&ship.wasDestroyedByEnemy()&&ship.destroyer()!==undefined)action='retaliate-forget';
        else action='forget';
      }else{
        if(ship===undefined||!ship.isActive())action='forget';
        else action=ship.owner().id()!==actor.player.id()?'retaliate-forget':'keep';
      }
      const response=choose(hooks,`warship-${mode}-outgoing-response`,[
        {id:action,reason:`Original outgoing ${mode} response: ${action}`},
        ...(action==='keep'?[]:[{id:'defer',reason:'Leave this tracked ship for a later pass'}])
      ],{parentDecisionId:target.decision.decisionId,unitId:entry.unitId});
      if(!response.selected||!hooks.allowed())return;
      if(response.selected.id==='defer'||action==='keep'){pending.delete(entry.unitId);response.report('kept');continue;}
      const ticket={};pending.set(entry.unitId,ticket);
      if(action==='forget'){tracked.delete(entry.unitId);response.report('forgotten');continue;}
      let held=false;
      const onDecline=()=>{
        held=true;
        if(pending.get(entry.unitId)===ticket){pending.delete(entry.unitId);tracked.add(entry.unitId);response.report('declined',{unitId:entry.unitId});}
      };
      hooks.execute(response.decision.decisionId,()=>actor.maybeRetaliateWithWarship(ship.tile(),mode==='trade'?ship.owner():ship.destroyer(),mode,onDecline));
      if(held){hooks.hold();return;}
      if(!hooks.allowed())return;
      tracked.delete(entry.unitId);response.report('retaliation-requested',{unitId:entry.unitId});
    }
  }
  function tracking(actor,hooks){
    const remaining=['transport','trade','incoming'];
    while(remaining.length&&hooks.allowed()){
      const phase=choose(hooks,'warship-tracking',remaining.map(mode=>({id:mode,reason:`Original ${mode} tracking phase`})));
      if(!phase.selected||!hooks.allowed())return;
      const mode=phase.selected.id;remaining.splice(remaining.indexOf(mode),1);
      hooks.execute(phase.decision.decisionId,()=>{
        if(mode==='transport')actor.trackTransportShipsAndRetaliate();
        else if(mode==='trade')actor.trackTradeShipsAndRetaliate();
        else actor.trackIncomingTransportsAndRetaliate();
      });
      phase.report(hooks.allowed()?'completed':'stopped');
    }
  }
  return {incoming,outgoing,tracking};
}

if(typeof module!=='undefined'&&module.exports)module.exports=createWarshipTransportPlanner;
