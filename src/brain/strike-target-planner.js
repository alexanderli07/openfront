'use strict';

function createStrikeTargetPlanner(deps) {
  const wait = { id: '$wait', kind: 'wait', reason: 'Hold strike' };
  function choose(hooks, domain, entries, facts = {}) {
    const candidates = entries.map((entry, priority) => ({ kind: domain, priority, eligible: true, ...entry }));
    const decision = hooks.choose(domain, [...candidates, wait], facts);
    const selected = candidates.find(c => c.id === decision.selectedId && c.eligible);
    const report = (status, details = {}) => hooks.record('strike-target-result', { domain,
      decisionId: decision.decisionId, selectedId: selected?.id, status, ...details });
    if (!selected) report('wait', { reason: decision.reason });
    return { selected, decision, report };
  }
  const playerId = player => { try { return player?.id?.() ?? null; } catch { return null; } };
  const linked = (hooks,result,decisionId) => hooks.link ? hooks.link(result,decisionId) : result;
  function salvo(actor, context, hooks) {
    const stopped = () => ({ ok: false, stopped: true });
    if (!hooks.allowed()) return stopped();
    const measured = actor._measureSalvoSilos(context.targetTile, context.silos, context.parentDecisionId);
    if (measured.stopped || !hooks.allowed()) return stopped();
    const { silos, coveringSamIds, requiredBase } = measured;
    silos.sort((a,b) => actor.game.manhattanDist(a.silo.tile(),context.targetTile)-actor.game.manhattanDist(b.silo.tile(),context.targetTile));
    const order = choose(hooks,'salvo-order',[{id:'game-queue',
      siloCount:silos.length,slots:silos.map(s=>s.slots),
      reason:'Nearest-silo launch queue with original first ties; game controls launch origin'}],
      {parentDecisionId:context.parentDecisionId,targetTile:context.targetTile});
    if (!order.selected || !hooks.allowed()) return stopped();
    order.report('order-selected');
    const slots = [];
    for (const silo of silos) for (let i=0;i<silo.slots;i++) slots.push({
      flightTicks:silo.flightTicks,interceptable:silo.interceptable,arcUp:silo.arcUp!==false});
    const halfCooldown=Math.floor(actor.game.config().SAMCooldown()/2);
    const totalBombs=requiredBase+Math.floor(requiredBase/5);
    const failure=needsMoreSilos=>({ok:false,needsMoreSilos,coveringSamIds,totalBombs});
    const clear=[];
    for(let i=0;i<slots.length;i++)if(!slots[i].interceptable)clear.push({index:i,flightTicks:slots[i].flightTicks});
    if(clear.length<totalBombs)return failure(true);
    clear.sort((a,b)=>a.flightTicks-b.flightTicks);
    const windows=[];
    for(let start=0;start<clear.length;start++){
      let end=start;while(end<clear.length&&clear[end].flightTicks-clear[start].flightTicks<=halfCooldown)end++;
      if(end-start>=totalBombs)windows.push({start,end,count:end-start});
    }
    if(!windows.length)return failure(true);
    windows.sort((a,b)=>b.count-a.count||a.start-b.start);
    const window=choose(hooks,'salvo-window',windows.slice(0,79).map(w=>({
      id:`window:${w.start}`,start:w.start,count:w.count,firstFlight:clear[w.start].flightTicks,
      lastFlight:clear[w.end-1].flightTicks,reason:'Largest arrival cluster within half SAM cooldown; preserve first tie'})),
      {parentDecisionId:order.decision.decisionId,totalBombs,halfCooldown,windowCount:windows.length});
    if(!window.selected||!hooks.allowed())return stopped();
    const chosenWindow=windows.find(w=>w.start===window.selected.start);
    window.report('window-selected');
    const counts=[];
    for(let count=totalBombs;count<=chosenWindow.count&&counts.length<79;count++)counts.push({
      id:`count:${count}`,count,reason:'At least required SAM saturation; baseline uses minimum bomb count'});
    const count=choose(hooks,'salvo-count',counts,{parentDecisionId:window.decision.decisionId,
      totalBombs,capacity:chosenWindow.count});
    if(!count.selected||!hooks.allowed())return stopped();
    count.report('count-selected',{count:count.selected.count});
    const selectedSlots=clear.slice(chosenWindow.start,chosenWindow.end).sort((a,b)=>a.index-b.index).slice(0,count.selected.count);
    const selectedIndices=new Set(selectedSlots.map(s=>s.index));
    const bombsToFire=selectedSlots[selectedSlots.length-1].index+1;
    const firstArrival=Math.min(...selectedSlots.map(s=>s.flightTicks));
    const spacing=Math.max(1,Math.floor(halfCooldown/count.selected.count));
    const waitTicksPerBomb=[],arcUpPerBomb=[];let selectedIndex=0;
    for(let i=0;i<bombsToFire;i++){
      arcUpPerBomb.push(slots[i].arcUp!==false);
      if(selectedIndices.has(i)){
        waitTicksPerBomb.push(Math.max(0,firstArrival+selectedIndex*spacing-slots[i].flightTicks));selectedIndex++;
      }else waitTicksPerBomb.push(0);
    }
    // Approve all schedule chunks before returning anything executable. Engine
    // telemetry caps arrays at 80; each chunk keeps the entire tail visible.
    let schedule,parentDecisionId=count.decision.decisionId;
    for(let firstBomb=0;firstBomb<bombsToFire;firstBomb+=79){
      schedule=choose(hooks,'salvo-schedule',[{id:'staggered',bombsToFire,
        waitTicksPerBomb:waitTicksPerBomb.slice(firstBomb,firstBomb+79),
        arcUpPerBomb:arcUpPerBomb.slice(firstBomb,firstBomb+79),
        reason:'Original queue prefix and staggered waits; approve every chunk before execution'}],
        {parentDecisionId,firstBomb,spacing,selectedBombs:count.selected.count});
      if(!schedule.selected||!hooks.allowed())return stopped();
      schedule.report('chunk-approved',{firstBomb});parentDecisionId=schedule.decision.decisionId;
    }
    const cost=context.cost*BigInt(bombsToFire);
    if(actor.player.gold()<cost){schedule.report('unaffordable',{cost});return failure(false);}
    if(!actor.nukeSpendAllowed(cost)){schedule.report('spend-blocked',{cost});return failure(false);}
    if(!hooks.allowed()){schedule.report('stopped');return stopped();}
    schedule.report('schedule-selected',{cost});
    return linked(hooks,{ok:true,bombsToFire,waitTicksPerBomb,arcUpPerBomb,coveringSamIds,totalBombs},schedule.decision.decisionId);
  }
  function arc(actor, context, hooks) {
    const stopped = () => ({ intercepted: true, arcUp: true, upgradeSafe: false, stopped: true });
    if (!hooks.allowed()) return stopped();
    const settings = deps.settings();
    const rotate = Boolean(settings.nukeArcRotate) && actor.canSetNukeArc();
    const margin = Boolean(settings.samUpgradeMargin);
    let lastDecisionId;
    for (const extraLevels of margin ? [1, 0] : [0]) {
      const remaining = rotate ? ['up', 'down'] : ['up'];
      while (remaining.length) {
        if (!hooks.allowed()) return stopped();
        const { selected, decision, report } = choose(hooks, 'nuke-arc', remaining.map(id => ({
          id, arcUp: id === 'up', readiness: 'unchecked',
          reason: 'Original up-first trajectory probes; upgrade margin before normal SAM levels'
        })), { parentDecisionId: context.parentDecisionId, fromTile: context.fromTile,
          targetTile: context.targetTile, extraLevels, rotate,
          ignoredSamIds: context.ignoredSamIds ? Array.from(context.ignoredSamIds) : [] });
        if (!selected || !hooks.allowed()) return stopped();
        lastDecisionId=decision.decisionId;
        remaining.splice(remaining.indexOf(selected.id), 1);
        const intercepted = extraLevels === 1
          ? actor.isTrajectoryInterceptableBySam(context.fromTile, context.targetTile, context.ignoredSamIds, selected.arcUp, 1)
          : actor.isTrajectoryInterceptableBySam(context.fromTile, context.targetTile, context.ignoredSamIds, selected.arcUp);
        if (!hooks.allowed()) { report('stopped'); return stopped(); }
        report(intercepted ? 'intercepted' : 'arc-selected', { arcUp: selected.arcUp, extraLevels });
        if (!intercepted) return linked(hooks,{ intercepted: false, arcUp: selected.arcUp, upgradeSafe: extraLevels === 1 || !margin },decision.decisionId);
      }
    }
    return linked(hooks,{ intercepted: true, arcUp: true, upgradeSafe: false },lastDecisionId);
  }
  function search(hooks,domain,inputs,facts,check) {
    let remaining=Array.from(inputs,(input,index)=>({input,index}));
    while(remaining.length&&hooks.allowed()) {
      const visible=remaining.slice(0,79);
      const {selected,decision,report}=choose(hooks,domain,visible.map(entry=>({
        id:`${domain}:${entry.index}`,inputIndex:entry.index,targetId:playerId(domain==='nuke-hostile-player'?entry.input.player:entry.input),
        ...(domain==='nuke-hostile-player'?{relation:entry.input.relation}:{}),
        readiness:'unchecked',reason:'Original input order; evaluate eligibility only after selection'
      })),{...facts,remaining:remaining.length,candidateLimit:79});
      if(!selected||!hooks.allowed())return {target:null,stopped:true};
      const entry=visible.find(e=>e.index===selected.inputIndex);remaining=remaining.filter(e=>e!==entry);
      const result=check(entry.input,decision.decisionId);
      if(result.stopped||!hooks.allowed()){report('stopped');return {target:null,stopped:true};}
      if(result.target){report('target-selected',{targetId:playerId(result.target)});
        return {target:result.target,stopped:false,decisionId:result.decisionId??decision.decisionId};}
      report('ineligible',{reason:result.reason});
    }
    return {target:null,stopped:!hooks.allowed()};
  }
  function single(hooks,domain,player,parentDecisionId,facts={}) {
    const {selected,decision,report}=choose(hooks,domain,[{id:`${domain}:0`,targetId:playerId(player),
      reason:'Original qualifying sole opponent or majority leader'}],{...facts,parentDecisionId});
    if(!selected||!hooks.allowed())return {target:null,stopped:true};
    report('target-selected',{targetId:playerId(player)});
    return {target:player,stopped:false,decisionId:decision.decisionId};
  }
  function requested(actor,hooks,parentDecisionId) {
    return search(hooks,'nuke-request-ally',actor.player.allies(),{parentDecisionId},(ally,allyDecisionId)=>{
      if(ally.targets().length===0)return {target:null,reason:'Ally has no requested targets'};
      if(actor.player.relation(ally)<deps.friendly)return {target:null,reason:'Ally relation below original Friendly threshold'};
      return search(hooks,'nuke-request-player',ally.targets(),{parentDecisionId:allyDecisionId},player=>{
        if(player.smallID()===actor.player.smallID())return {target:null,reason:'Requested player is self'};
        if(actor.player.isFriendly(player))return {target:null,reason:'Requested player is friendly'};
        return {target:player};
      });
    });
  }
  function hostile(actor,hooks,parentDecisionId) {
    const ownMax=actor.game.config().maxTroops(actor.player);
    return search(hooks,'nuke-hostile-player',actor.player.allRelationsSorted(),{parentDecisionId,ownMax},relation=>{
      if(relation.relation!==deps.hostile)return {target:null,reason:'Relation is not exactly Hostile'};
      if(actor.player.isFriendly(relation.player))return {target:null,reason:'Hostile relation player is friendly'};
      if(ownMax>=actor.game.config().maxTroops(relation.player)*2)return {target:null,reason:'Own capacity is at least twice target capacity'};
      return {target:relation.player};
    });
  }
  function target(actor, hooks) {
    const remaining = ['duel', 'incoming', 'density', 'majority', 'allied-target', 'hostile', 'crown', 'team'];
    while (remaining.length) {
      if (!hooks.allowed()) return null;
      const { selected, decision, report } = choose(hooks, 'nuke-target', remaining.map(id => ({ id,
        readiness: 'unchecked', reason: `Original target search: ${id}` })));
      if (!selected) return null;
      remaining.splice(remaining.indexOf(selected.id), 1);
      let result = null;
      let rankingStopped = false;
      let targetDecisionId;
      const rank = read => {
        const lookup = hooks.lookup ? hooks.lookup(decision.decisionId,read) : { target: read(), stopped: false };
        rankingStopped = lookup.stopped; targetDecisionId=lookup.decisionId; return lookup.target;
      };
      switch (selected.id) {
        case 'duel': {
          const difficulty = deps.difficulty();
          if ((difficulty === 'Hard' || difficulty === 'Impossible') && actor.game.players().length === 2) {
            result = actor.game.players().find(p => p.smallID() !== actor.player.smallID());
            if(result){const lookup=single(hooks,'nuke-duel-player',result,decision.decisionId);
              result=lookup.target;rankingStopped=lookup.stopped;targetDecisionId=lookup.decisionId;}
          }
          break;
        }
        case 'incoming': {
          const response = hooks.incoming(decision.decisionId);
          if (response.stopped) { report('stopped', { reason: 'Incoming target policy stopped lookup' }); return null; }
          result = response.target; targetDecisionId=response.decisionId; break;
        }
        case 'density': result = rank(() => actor.findHighDensityTarget()); break;
        case 'majority': {
          const difficulty = deps.difficulty(), mode = actor.game.config().gameConfig().gameMode;
          if (difficulty === 'Impossible' && mode === deps.ffa) {
            const land = actor.game.numLandTiles() - actor.game.numTilesWithFallout();
            if (land > 0) {
              const leader = actor.game.players().slice().sort((a,b) => b.numTilesOwned()-a.numTilesOwned())[0];
              if (leader && leader.smallID() !== actor.player.smallID() && !actor.player.isFriendly(leader) && leader.numTilesOwned()/land > .5) {
                const lookup=single(hooks,'nuke-majority-player',leader,decision.decisionId,{land});
                result=lookup.target;rankingStopped=lookup.stopped;targetDecisionId=lookup.decisionId;
              }
            }
          }
          break;
        }
        case 'allied-target': {
          const lookup=requested(actor,hooks,decision.decisionId);result=lookup.target;rankingStopped=lookup.stopped;targetDecisionId=lookup.decisionId;
          break;
        }
        case 'hostile': {
          const lookup=hostile(actor,hooks,decision.decisionId);result=lookup.target;rankingStopped=lookup.stopped;targetDecisionId=lookup.decisionId;
          break;
        }
        case 'crown': result = rank(() => actor.findFFACrownTarget()); break;
        case 'team': result = rank(() => actor.findStrongestTeamTarget()); break;
      }
      if (rankingStopped) { report('stopped', { reason: 'Target ranking policy stopped lookup' }); return null; }
      if (!hooks.allowed()) { report('stopped'); return null; }
      if (selected.id === 'density' ? result !== null : Boolean(result)) {
        let targetId = null; try { targetId = result?.id?.() ?? null; } catch {}
        report('target-selected', { targetId }); hooks.selected?.(targetDecisionId ?? decision.decisionId); return result;
      }
      report('unfulfilled');
    }
    return null;
  }

  async function sam(actor, target, sams, context, hooks) {
    const remaining = sams.map((sam,index) => ({ sam, id: `sam:${index}` }));
    let upgrade = null;
    while (remaining.length) {
      if (!hooks.allowed()) return;
      const { selected, decision, report } = choose(hooks, 'sam-target', remaining.slice(0,79).map(entry => ({
        id: entry.id, tile: entry.sam.tile(), level: entry.sam.level(), reason: 'Original ascending SAM level; plan unchecked'
      })), { parentDecisionId: context.parentDecisionId, cost: context.cost });
      if (!selected) return;
      remaining.splice(remaining.findIndex(entry => entry.id === selected.id),1);
      let plan;
      try { plan = actor.planSaturationSalvo(selected.tile,context.cost,context.silos,decision.decisionId); }
      catch (error) { report('threw', { error: String(error?.message || error) }); throw error; }
      if (plan.stopped) { report('stopped'); return; }
      if (!plan.ok) {
        if (plan.needsMoreSilos) upgrade ??= { targetTile: selected.tile, coveringSamIds: plan.coveringSamIds, totalBombs: plan.totalBombs };
        report('unfulfilled', { needsMoreSilos: Boolean(plan.needsMoreSilos), totalBombs: plan.totalBombs }); continue;
      }
      for (let index=0; index<plan.bombsToFire; index++) {
        if (!hooks.allowed()) { report('stopped'); return; }
        await actor.sendNuke(selected.tile,deps.units.AtomBomb,target,plan.waitTicksPerBomb[index],true,plan.arcUpPerBomb ? plan.arcUpPerBomb[index] !== false : true,hooks.parent?.(plan) ?? decision.decisionId);
        if (!hooks.allowed()) { report('stopped'); return; }
        await deps.salvoPace(index,plan.bombsToFire);
      }
      if (!hooks.allowed()) { report('stopped'); return; }
      deps.samMessage(plan.bombsToFire); report('salvo-attempted', { attempts: plan.bombsToFire }); return;
    }
    if (!upgrade || !hooks.allowed()) return;
    const { selected, decision, report } = choose(hooks,'sam-upgrade',[{ id: 'upgrade', tile: upgrade.targetTile,
      totalBombs: upgrade.totalBombs, reason: 'First SAM plan requiring more silo capacity' }], { parentDecisionId: context.parentDecisionId });
    if (!selected || !hooks.allowed()) return;
    await actor.maybeUpgradeHelpfulSilo(upgrade,decision.decisionId);
    if (!hooks.allowed()) { report('stopped'); return; }
    report('upgrade-attempted');
  }

  async function upgrade(actor, context, hooks) {
    if (!hooks.allowed()) return;
    const silos = actor.player.units(deps.units.MissileSilo);
    if (silos.length === 0) return;
    const reachable = [];
    for (const silo of silos) {
      const trajectory = actor.chooseNukeArc(silo.tile(),context.targetTile,context.coveringSamIds,context.parentDecisionId);
      if (trajectory.stopped || !hooks.allowed()) return;
      if (!trajectory.intercepted) reachable.push(silo);
    }
    if (reachable.length === 0 || reachable.length*deps.maxSiloLevel < context.totalBombs) return;
    const sams = actor.player.units(deps.units.SAMLauncher), entries = [];
    for (const silo of reachable) {
      if (silo.level() >= deps.maxSiloLevel) continue;
      let score = 0;
      for (const sam of sams) {
        const range = actor.game.config().samRange(sam.level());
        if (actor.game.euclideanDistSquared(silo.tile(),sam.tile()) <= range*range) score += sam.level();
      }
      entries.push({ silo, score, index: entries.length });
    }
    entries.sort((a,b) => b.score-a.score || a.index-b.index);
    const { selected, decision, report } = choose(hooks,'strike-silo',entries.slice(0,79).map(entry => ({
      id: `silo:${entry.index}`, tile: entry.silo.tile(), coverage: entry.score, eligible: entry.score > -1,
      reason: 'Highest friendly-SAM coverage; preserve first tie'
    })), { parentDecisionId: context.parentDecisionId, targetTile: context.targetTile, totalBombs: context.totalBombs });
    if (!selected || !hooks.allowed()) return;
    const entry = entries.find(entry => `silo:${entry.index}` === selected.id);
    await actor._upgradeSiloReady(entry.silo,decision.decisionId);
    if (!hooks.allowed()) { report('stopped'); return; }
    report('upgrade-attempted');
  }
  return { target, sam, upgrade, arc, salvo };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStrikeTargetPlanner;
