'use strict';

// Preparation is a spending priority, not a claim that an incoming nuke can
// already be intercepted. Emergency prediction remains a separate decision.
function createSamDevelopment(){
  let peak=0,peakTick=-Infinity,lastTick=-Infinity;
  function assess(observation,{economy}){
    const result={candidates:[],savings:0n,blocked:[],salvoTarget:0};
    const tick=observation.tick;
    if(!Number.isFinite(tick)||observation.reason)return result;
    if(tick<lastTick||tick-peakTick>1800)peak=0;
    lastTick=tick;
    const count=new Set((observation.threats||[]).filter(t=>t.threatensSelf||t.threatensSamArea).map(t=>t.id)).size;
    if(count&&count>=peak){peak=Math.min(count,8);peakTick=tick;}
    result.salvoTarget=peak;
    if(economy?.stage!=='reserve')return result;
    const live=(observation.sams||[]).filter(s=>s.active===true&&s.building===false&&
      Number.isInteger(s.level)&&s.level>0&&s.tile!=null);
    const own=live.filter(s=>s.own===true);
    const ramping=s=>Number.isFinite(s.upgradeStartTick)&&tick<s.upgradeStartTick+(s.upgradeDuration??45);
    // Focus preparation on one existing launcher; remote building locations
    // neither raise its target nor create additional SAM purchase goals.
    const primary=[...own].sort((a,b)=>b.level-a.level||a.id-b.id)[0];
    for(const sam of primary?[primary]:[]){
      const economyTarget=economy.development?.samTargetLevel??2;
      const targetLevel=Math.max(economyTarget,peak);
      if(targetLevel<=sam.level)continue;
      result.savings=3000000n;
      const reason=peak>economyTarget?'salvo-capacity':economy.development?'economic-development':'developed-economy';
      if(ramping(sam)||!Array.isArray(sam.queue)||!sam.queue.every(Number.isFinite)){
        result.blocked.push({unitId:sam.id,targetLevel,reason:ramping(sam)?'upgrade-in-progress':'uncertain-sam-state'});continue;
      }
      result.candidates.push({unitId:sam.id,targetLevel,currentLevel:sam.level,reason,
        salvoTarget:peak,development:economy.development,canDefend:false,mode:'planned'});
    }
    return result;
  }
  return {assess};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createSamDevelopment;
