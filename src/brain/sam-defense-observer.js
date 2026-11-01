'use strict';

// Observe public client state without trusting the engine-only trajectory
// index: motion-plan movement need not emit an updated nukeState each tick.
function createSamDefenseObserver({units:U}) {
  const raw = value => value?.__src || value;
  const call=(value,key,...args) => {
    try { return typeof value?.[key] === 'function' ? value[key](...args) : undefined; }
    catch { return undefined; }
  };
  const read=(unit,key) => call(unit,key) ?? call(raw(unit),key);
  const finite=value => typeof value==='number' && Number.isFinite(value);
  const nuclear=new Set([U.AtomBomb,U.HydrogenBomb,U.MIRVWarhead].filter(Boolean));
  const structures=new Set([U.City,U.Port,U.Factory,U.MissileSilo,U.DefensePost,U.SAMLauncher].filter(Boolean));
  const observedTypes=[...new Set([...nuclear,...structures,U.SAMMissile].filter(Boolean))];
  function observe(game,player) {
    const nuclearCapability={scannedSilos:0,hostileSilos:0,operationalSilos:0,buildingSilos:0,
      unknownSilos:0,unknownReadinessSilos:0,capacity:0,readySlots:0,coolingSlots:0,
      strongestEnemyCapacity:0,strongestEnemyReadySlots:0,preparationTarget:0,
      truncated:false,confidence:'unknown',reason:'Public silo snapshot unavailable'};
    const tick=call(game,'ticks'), observation={tick,threats:[],sams:[],ownSams:[],structures:[],nuclearCapability};
    if (call(raw(game),'isCatchingUp') === true) return {...observation,reason:'catching-up'};
    let units;
    try { units=game.units(...observedTypes); }
    catch { return {...observation,reason:'snapshot-unavailable'}; }
    if (!Array.isArray(units) || !finite(tick)) return {...observation,reason:'snapshot-unavailable'};
    const selfId=call(player,'smallID');
    const ownerOf=unit => call(unit,'owner'); // Keep owner objects in the wrapper's identity domain.
    const own=unit => selfId!==undefined && call(ownerOf(unit),'smallID')===selfId;
    const friendly=unit => own(unit) || call(player,'isFriendly',ownerOf(unit))===true;
    const active=unit => read(unit,'isActive')===true;
    // A bounded public-infrastructure sample is preparation evidence only:
    // available launch slots do not establish affordability, target or intent.
    // Use the strongest single enemy rather than adding unrelated countries'
    // potential salvos into a runaway capacity goal. Distance is not a reliable
    // safety boundary for nuclear weapons.
    const enemies=new Map();
    for(const unit of units){
      if(read(unit,'type')!==U.MissileSilo)continue;
      if(nuclearCapability.scannedSilos>=128){nuclearCapability.truncated=true;break;}
      nuclearCapability.scannedSilos++;
      if(own(unit))continue;
      const owner=ownerOf(unit),ownerId=call(owner,'smallID');
      const relationship=call(player,'isFriendly',owner);
      if(relationship===true)continue;
      if(selfId===undefined||ownerId===undefined||ownerId===null||relationship!==false){
        nuclearCapability.unknownSilos++;continue;
      }
      const activeState=call(raw(unit),'isActive');
      if(activeState===false)continue;
      if(activeState!==true){nuclearCapability.unknownSilos++;continue;}
      nuclearCapability.hostileSilos++;
      const building=call(raw(unit),'isUnderConstruction'),level=call(raw(unit),'level');
      if(building===true){nuclearCapability.buildingSilos++;continue;}
      if(building!==false||!Number.isSafeInteger(level)||level<=0){
        nuclearCapability.unknownSilos++;continue;
      }
      nuclearCapability.operationalSilos++;
      nuclearCapability.capacity+=level;
      // Do not trust wrapper defaults (an absent queue may be wrapped as []).
      const queue=call(raw(unit),'missileTimerQueue');
      const known=Array.isArray(queue)&&queue.length<=level&&queue.every(finite);
      const ready=known?level-queue.length:0;
      if(known){nuclearCapability.readySlots+=ready;nuclearCapability.coolingSlots+=queue.length;}
      else nuclearCapability.unknownReadinessSilos++;
      const enemy=enemies.get(ownerId)||{capacity:0,ready:0};
      enemy.capacity+=level;enemy.ready+=ready;enemies.set(ownerId,enemy);
      nuclearCapability.strongestEnemyCapacity=Math.max(nuclearCapability.strongestEnemyCapacity,enemy.capacity);
      nuclearCapability.strongestEnemyReadySlots=Math.max(nuclearCapability.strongestEnemyReadySlots,enemy.ready);
    }
    nuclearCapability.confidence=nuclearCapability.truncated||nuclearCapability.unknownSilos||
      nuclearCapability.unknownReadinessSilos?'partial':'observed';
    nuclearCapability.preparationTarget=nuclearCapability.strongestEnemyReadySlots>=3?3:
      nuclearCapability.operationalSilos>0?2:0;
    nuclearCapability.reason=nuclearCapability.operationalSilos>0?
      'Public hostile silo capacity; launch slots are not enemy funds or attack intent':
      'No confirmed operational hostile silo in public sample';
    const ownStructures=units.filter(unit => structures.has(read(unit,'type')) && own(unit) && active(unit));
    observation.structures=ownStructures.filter(unit=>[U.City,U.Port,U.Factory,U.MissileSilo].includes(read(unit,'type')))
      .map(unit=>({id:read(unit,'id'),type:read(unit,'type'),tile:read(unit,'tile')}));
    const ownDefense=units.filter(unit=>read(unit,'type')===U.SAMLauncher&&own(unit)&&active(unit)&&
      read(unit,'isUnderConstruction')===false);
    // Native targetedBySAM is global, including third-party interceptors.
    const interceptors=new Set(units.filter(unit => read(unit,'type')===U.SAMMissile && active(unit))
      .map(unit => call(raw(unit),'targetUnitId')).filter(id=>id!==undefined && id!==null));
    for (const unit of units) {
      const type=read(unit,'type');
      if (type===U.SAMLauncher && friendly(unit)) {
        const native=raw(unit), state=native?.state || {};
        const queue=call(native,'missileTimerQueue');
        const activeState=read(unit,'isActive'), building=read(unit,'isUnderConstruction');
        // Unknown operational state stays potentially operational, with an
        // invalid queue, so the predictor blocks spending instead of silently
        // dropping a possibly ready friendly launcher from baseline coverage.
        const known=typeof activeState==='boolean' && typeof building==='boolean';
        observation.sams.push({id:read(unit,'id'),tile:read(unit,'tile'),level:read(unit,'level'),
          active:activeState ?? true,building:building ?? false,own:own(unit),
          queue:known && Array.isArray(queue) ? [...queue] : null,
          ...(state.samUpgradeStartTick!==null && state.samUpgradeStartTick!==undefined ? {
            upgradeStartTick:state.samUpgradeStartTick,upgradeStartRange:state.samUpgradeStartRange,
            upgradeTargetLevel:state.samUpgradeTargetLevel,upgradeDuration:state.samUpgradeDuration
          } : {})});
        if (own(unit) && activeState===true) observation.ownSams.push(unit);
      }
      if (!nuclear.has(type) || !active(unit) || friendly(unit)) continue;
      // An unknown owner cannot establish a hostile incoming strike.
      if (call(ownerOf(unit),'smallID')===undefined) continue;
      const native=raw(unit), state=call(native,'nukeState') || {};
      const trajectory=Array.isArray(state.trajectory) ? state.trajectory : [];
      const currentTile=read(unit,'tile'), matches=[];
      for (let i=0;i<trajectory.length;i++) if (trajectory[i]?.tile===currentTile) matches.push(i);
      // Positive native waitTicks may also be stale. Without a verified motion
      // schedule do not turn it into extra time in which an upgrade can work.
      const waitKnown=Number.isInteger(state.waitTicks) && state.waitTicks===0;
      const target=call(native,'targetTile') ?? call(unit,'targetTile') ?? trajectory.at(-1)?.tile;
      let threatensSelf=target!==undefined && selfId!==undefined && call(game,'ownerID',target)===selfId;
      if (!threatensSelf && target!==undefined) {
        const config=call(game,'config'), magnitude=call(config,'nukeMagnitudes',type);
        const outer=magnitude?.outer;
        if (finite(outer) && outer>0) threatensSelf=ownStructures.some(structure => {
          const squared=call(game,'euclideanDistSquared',target,read(structure,'tile'));
          return finite(squared) && squared>=0 && squared<outer*outer;
        });
      }
      const threatensSamArea=target!==undefined&&ownDefense.some(sam=>{
        const level=read(sam,'level'),radius=call(call(game,'config'),'samRange',level+1);
        const squared=call(game,'euclideanDistSquared',target,read(sam,'tile'));
        return Number.isInteger(level)&&level>0&&finite(radius)&&radius>0&&finite(squared)&&squared>=0&&squared<=radius*radius;
      });
      observation.threats.push({id:read(unit,'id'),type,isHydrogen:type===U.HydrogenBomb,trajectory,index:matches.length===1?matches[0]:null,
        waitTicks:0,ambiguous:matches.length!==1 || !waitKnown,
        existingInterceptor:interceptors.has(read(unit,'id')),threatensSelf,threatensSamArea});
    }
    return observation;
  }
  return {observe};
}

if (typeof module !== 'undefined' && module.exports) module.exports=createSamDefenseObserver;
