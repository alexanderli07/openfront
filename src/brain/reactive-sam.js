'use strict';

// Pure, conservative prediction over a reconciled client snapshot. The caller
// supplies hostile strikes only and verifies trajectory progress against live
// position/motion plans: the engine's nukeState index can be stale on the client.
function createReactiveSam({range, distance, distanceSquared, cooldown=90,
  upgradeDuration=45, missileSpeed=12, latencyTicks=2}) {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const integer = value => Number.isInteger(value) && value >= 0;
  const operational = sam => sam.active === true && sam.building === false;
  const validSam = sam => sam && integer(sam.level) && sam.level > 0 &&
    sam.tile !== undefined && sam.tile !== null && Array.isArray(sam.queue) && sam.queue.every(finite);
  const ramping = (sam,tick) => finite(sam.upgradeStartTick) &&
    tick < sam.upgradeStartTick + (sam.upgradeDuration ?? upgradeDuration);
  function radius(sam,tick) {
    if (!finite(sam.upgradeStartTick)) return range(sam.level);
    const duration = sam.upgradeDuration ?? upgradeDuration;
    if (!finite(sam.upgradeStartRange) || !integer(sam.upgradeTargetLevel) ||
        sam.upgradeTargetLevel < 1 || !finite(duration) || duration <= 0) return NaN;
    const progress = Math.max(0,Math.min(1,(tick-sam.upgradeStartTick)/duration));
    return sam.upgradeStartRange + (range(sam.upgradeTargetLevel)-sam.upgradeStartRange)*progress;
  }
  function validThreat(threat) {
    return !threat.ambiguous && Array.isArray(threat.trajectory) && threat.trajectory.length>=2 &&
      integer(threat.index) && threat.index < threat.trajectory.length-1 && integer(threat.waitTicks) &&
      threat.trajectory.every(point => point && point.tile !== undefined && point.tile !== null &&
        typeof point.targetable === 'boolean');
  }
  // A level is a missile slot. Upgrading appends a cooling slot, rather than
  // increasing ready ammunition. Expired queue entries are ready at launch.
  function readyAt(sam,tick) {
    return sam.level-(sam.reservedSlots||0) > sam.queue.filter(launch => launch+cooldown>tick).length;
  }
  function intercept(sam,threat,tick,minLaunch) {
    if (!operational(sam) || !validSam(sam)) return null;
    const path=threat.trajectory, last=path.length-1;
    const check=(flightIndex,coverageTile,coverageTick,kind) => {
      const point=path[flightIndex];
      if (!point.targetable) return null;
      const flightTicks=Math.ceil(distance(sam.tile,point.tile)/missileSpeed);
      const interceptionTick=tick+flightIndex-threat.index+threat.waitTicks;
      const launchTick=interceptionTick-flightTicks;
      const effectiveRange=radius(sam,coverageTick);
      const squared=distanceSquared(sam.tile,coverageTile);
      if (!finite(flightTicks) || flightTicks<0 || !finite(squared) || squared<0 ||
          !finite(effectiveRange) || effectiveRange<0 || launchTick<minLaunch ||
          squared>effectiveRange*effectiveRange || !readyAt(sam,launchTick)) return null;
      return {samId:sam.id,launchTick,interceptionTick,flightTicks,effectiveRange,
        interceptionTile:point.tile,coverageTile,kind};
    };
    for (let i=threat.index;i<last;i++) {
      const arrival=tick+i-threat.index+threat.waitTicks;
      const result=check(i,path[i].tile,arrival,'flight');
      if (result) return result;
    }
    // Native SAM also allows a preshot at the penultimate flight tile when
    // the final detonation tile is within the future defensive radius.
    if (path[last].targetable) {
      return check(last-1,path[last].tile,tick+last-threat.index+threat.waitTicks,'impact');
    }
    return null;
  }
  function assess({tick, threats=[], sams=[], candidates=[]}) {
    const relevant=threats.filter(threat => threat.threatensSelf === true||threat.threatensSamArea===true);
    const unassigned=relevant.filter(threat => !threat.existingInterceptor);
    const targetIds=relevant.map(threat => threat.id);
    const complete=sams.filter(operational);
    const uncertain=unassigned.some(threat => !validThreat(threat));
    const invalidSam=complete.some(sam => !validSam(sam) || !finite(radius(sam,tick)));
    const baseline = !uncertain && !invalidSam && finite(tick) ? unassigned.map(threat => ({
      id:threat.id, interception:complete.map(sam => intercept(sam,threat,tick,tick)).find(Boolean)
    })) : [];
    return candidates.map(candidate => {
      const result={unitId:candidate.unitId,cost:candidate.cost,canDefend:false,
        reason:'no-relevant-threat',targetIds,threatCount:relevant.length,
        unassignedThreatCount:unassigned.length};
      const skip=(reason,facts={}) => Object.assign(result,{reason},facts);
      if (!relevant.length) return result;
      if (!unassigned.length) return skip('already-intercepted');
      if (!finite(tick) || uncertain) return skip('uncertain-trajectory');
      const sam=sams.find(item => item.id===candidate.unitId);
      if (!sam || !operational(sam) || !validSam(sam)) return skip('sam-unavailable');
      if (ramping(sam,tick)) return skip('upgrade-in-progress');
      if (invalidSam) return skip('uncertain-sam-state');
      if (baseline.length && baseline.every(entry => entry.interception)) {
        // Independent geometry is not proof of shared ammunition for a salvo.
        if(unassigned.length!==1)return skip('competing-threats');
        return skip('already-covered',{baselineSamId:baseline[0].interception.samId});
      }
      const upgradeTick=tick+latencyTicks;
      const startRange=radius(sam,upgradeTick), targetRange=range(sam.level+1);
      if (!finite(startRange) || !finite(targetRange) || targetRange<=startRange) {
        return skip('upgrade-cannot-intercept');
      }
      const upgraded={...sam,level:sam.level+1,queue:[...sam.queue,upgradeTick],
        upgradeStartTick:upgradeTick,upgradeStartRange:startRange,
        upgradeTargetLevel:sam.level+1,upgradeDuration};
      const targets=unassigned.filter(threat=>!baseline.find(entry=>entry.id===threat.id)?.interception)
        .sort((a,b)=>Number(b.isHydrogen===true)-Number(a.isHydrogen===true));
      let selected=null,competingCount=0;
      for(const threat of targets){
        // Reserve one entire slot for EVERY other potentially reachable strike.
        // This pessimistic budget avoids relying on native priority or reusing
        // ammunition. It proves protection for this target, not the whole salvo.
        const others=threats.filter(other=>other!==threat&&!other.existingInterceptor);
        if(others.some(other=>!validThreat(other))){competingCount++;continue;}
        const competitors=others.filter(other=>other.trajectory.slice(other.index).some(point=>{
          if(!point.targetable)return false;
          const squared=distanceSquared(sam.tile,point.tile);
          return !finite(squared)||squared<0||squared<=targetRange*targetRange;
        }));
        competingCount=Math.max(competingCount,competitors.length);
        const interception=intercept({...upgraded,reservedSlots:competitors.length},threat,tick,upgradeTick);
        if(interception){selected={threat,interception,competitors:competitors.length};break;}
      }
      if (!selected) return skip(competingCount?'competing-threats':'upgrade-cannot-intercept',{
        upgradeTick,upgradeCompleteTick:upgradeTick+upgradeDuration,startRange,targetRange});
      const {threat,interception,competitors}=selected;
      return Object.assign(result,{canDefend:true,reason:'upgrade-enables-interception',
        targetIds:[threat.id],threatType:threat.type,competingThreatCount:competitors,baselineCovered:false,upgradeTick,
        upgradeCompleteTick:upgradeTick+upgradeDuration,newSlotReadyTick:upgradeTick+cooldown,
        startRange,targetRange,...interception});
    });
  }
  return {assess};
}

if (typeof module !== 'undefined' && module.exports) module.exports=createReactiveSam;
