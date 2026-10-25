'use strict';

// This receives sanitized engine records. It never supplies policy inputs.
function createMatchSummary(options={}) {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const segment=options.segment||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata=clone(options.metadata||{}),events=[],holds=new Map(),plans=new Map(),errors=new Map(),decisions=new Map();
  const counts=Object.create(null);let tick=0,firstTick=null,firstState=null,lastState=null,structures=new Map(),restored=false,firstInfrastructure=null;
  const versions=new Set(metadata.helperVersion?[metadata.helperVersion]:[]);
  const usefulDomains=new Set(['reactive-sam-upgrade','opening-expansion','structure-plan','attack-plan','naval-action','warship-combat','donation-target','spawn-action','mirv-plan','nuke-action']);
  const state=s=>s?.self?{tick:s.tick,gold:s.self.gold,troops:s.self.troops,tiles:s.self.tiles,units:s.self.units}:null;
  function aggregate(map,key,details){
    let row=map.get(key);
    if(!row){row={key,...details,count:0,firstTick:tick,lastTick:tick};map.set(key,row);}
    row.count++;row.lastTick=tick;return row;
  }
  function observe(e){
    const observedTick=e.snapshot?.tick??e.tick;
    if(Number.isFinite(observedTick)){tick=observedTick;if(firstTick===null)firstTick=tick;}
    counts[e.kind]=(counts[e.kind]||0)+1;
    if(e.kind==='observation'||e.kind==='decision'){
      const s=state(e.snapshot);if(s){lastState=s;if(!firstState)firstState=s;}
    }
    const add=details=>events.push({id:`${segment}:${e.seq}`,tick,...details});
    if(e.kind!=='dispatch'&&(e.error||/error/.test(e.kind))){
      const reason=String(e.error||e.reason||e.kind).slice(0,400);
      const key=[e.kind,e.module,e.rule,reason].join('|');
      let row=errors.get(key);
      if(!row){row={id:`${segment}:${e.seq}`,key,tick,kind:'error',source:e.module||e.kind,rule:e.rule,reason,count:0,lastTick:tick};errors.set(key,row);events.push(row);}
      row.count++;row.lastTick=tick;return;
    }
    if(e.kind==='decision'){
      const c=e.candidates?.find(c=>c.id===e.selectedId),domain=e.snapshot?.domain;
      const choice={action:c?.kind,arguments:c?.arguments,source:c?.source,reason:String(e.reason||'').slice(0,350),domain,
        purpose:c?.purpose,unitType:c?.unitType,parent:e.snapshot?.parentDecisionId??c?.parentDecisionId};
      decisions.set(e.decisionId,choice);if(decisions.size>1024)decisions.delete(decisions.keys().next().value);
      if(!usefulDomains.has(domain))return;
      const key=[domain,c?.kind,c?.purpose,c?.unitType,e.selectedId==='$wait'?'wait':'act',choice.reason].join('|');
      const table=e.selectedId==='$wait'||e.selectedId===null?holds:plans;
      const row=aggregate(table,key,{domain,purpose:c?.purpose,unitType:c?.unitType,reason:choice.reason});
      if(row.count===1)add({kind:table===holds?'hold':'plan',domain,purpose:c?.purpose,unitType:c?.unitType,reason:choice.reason});
      return;
    }
    if(e.kind==='dispatch'){
      const c=decisions.get(e.decisionId)||{},parent=decisions.get(c.parent);
      if(c.action==='moveWarship')return; // Movement spam remains in the detailed trace and totals.
      add({kind:'command',action:c.action||'unknown',status:e.status,arguments:c.arguments,
        source:c.source,reason:c.reason,error:e.error,plan:parent?.purpose||parent?.unitType||parent?.reason});return;
    }
    if(e.kind==='infrastructure-change'){
      if(!firstInfrastructure)firstInfrastructure={id:`${segment}:${e.seq}`,tick,structures:e.structures||[],partial:e.totalStructures>80};
      const next=new Map((e.structures||[]).map(s=>[s.id,s]));
      const changed=[...next].filter(([id,s])=>JSON.stringify(s)!==JSON.stringify(structures.get(id))).map(([,s])=>s);
      const removed=e.totalStructures>80?[]:[...structures].filter(([id])=>!next.has(id)).map(([,s])=>s);
      if(changed.length||removed.length)add({kind:'infrastructure',changed,removed,partial:e.totalStructures>80||undefined});
      structures=next;return;
    }
    if(/^transport-reservation-/.test(e.kind))add({kind:e.kind,tile:e.tile,age:e.age});
    if(e.kind==='support-posture')add({kind:'support-posture',conserve:e.conserve,ready:e.ready,reason:e.reason,anchor:e.anchor});
    if(e.kind==='wilderness-crossing-result'){
      if(e.status==='submitted'||e.status==='landed')add({kind:e.kind,status:e.status,tile:e.tile,
        crossingSteps:e.crossingSteps,room:e.room,reason:e.reason});
      else aggregate(holds,[e.kind,e.status,e.reason].join('|'),{domain:e.kind,status:e.status,reason:e.reason});
    }
    if(e.kind==='reactive-sam-result'){
      if(e.status==='selected')add({kind:'sam-defense',assessments:e.assessments,reason:e.reason});
      else aggregate(holds,['reactive-sam',...(e.assessments||[]).map(a=>a.reason)].join('|'),
        {domain:'reactive-sam',reason:e.reason});
    }
    if(e.kind==='command-operational-hold')aggregate(holds,[e.kind,e.reason,e.destination,e.recipient].join('|'),
      {domain:e.kind,reason:e.reason,destination:e.destination,recipient:e.recipient});
    if(['donation-amount-result','naval-action-result','landing-probe','attack-sequence-result'].includes(e.kind)&&
        ['held','skipped','insufficient-excess','below-minimum-chunk','home-conservation','unreachable','not-submitted'].includes(e.status)){
      aggregate(holds,[e.kind,e.status,e.purpose,e.reason].join('|'),{domain:e.kind,status:e.status,purpose:e.purpose,reason:e.reason});
    }
  }
  function restore(saved){
    if(restored||!saved||saved.schemaVersion!==1||saved.type!=='openfront-match-summary')return;
    restored=true;
    const prior=clone(saved);
    let pending=events.splice(0);
    if(firstInfrastructure){
      const before=new Map((prior.finalStructures||[]).map(s=>[s.id,s]));
      const next=new Map(firstInfrastructure.structures.map(s=>[s.id,s]));
      const changed=[...next].filter(([id,s])=>JSON.stringify(s)!==JSON.stringify(before.get(id))).map(([,s])=>s);
      const removed=firstInfrastructure.partial?[]:[...before].filter(([id])=>!next.has(id)).map(([,s])=>s);
      pending=pending.filter(row=>row.id!==firstInfrastructure.id);
      if(changed.length||removed.length)pending.unshift({id:firstInfrastructure.id,tick:firstInfrastructure.tick,
        kind:'infrastructure',changed,removed,partial:firstInfrastructure.partial||undefined});
    }
    const errorRows=new Map();
    for(const rows of [prior.events,pending])for(const row of rows){
      if(row.kind==='error'&&errorRows.has(row.key)){
        const first=errorRows.get(row.key);first.count+=row.count;first.lastTick=Math.max(first.lastTick,row.lastTick);
      }else{events.push(row);if(row.kind==='error')errorRows.set(row.key,row);}
    }
    for(const [key,value] of Object.entries(prior.counts||{}))counts[key]=(counts[key]||0)+value;
    for(const [table,rows] of [[holds,prior.holds],[plans,prior.plans]])for(const row of rows||[]){
      const current=table.get(row.key);
      table.set(row.key,current?{...row,count:row.count+current.count,lastTick:Math.max(row.lastTick,current.lastTick)}:row);
    }
    tick=Math.max(tick,prior.lastTick||0);firstTick=prior.firstTick??firstTick;firstState=prior.firstState||firstState;lastState=lastState||prior.lastState;
    if(!firstInfrastructure&&prior.finalStructures)structures=new Map(prior.finalStructures.map(s=>[s.id,s]));
    for(const version of prior.helperVersions||[prior.metadata?.helperVersion])if(version)versions.add(version);
    // Reconnect repeat-error rows to the restored event objects.
    errors.clear();for(const row of events)if(row.kind==='error')errors.set(row.key,row);
  }
  function exportSummary(){return clone({schemaVersion:1,type:'openfront-match-summary',metadata,helperVersions:[...versions],firstTick,lastTick:tick,
    firstState,lastState,counts,events,holds:[...holds.values()],plans:[...plans.values()],finalStructures:[...structures.values()],
    note:'Commands report client submission, not server acceptance. Holds/plans aggregate repeated checks; detailed candidates are in the separate trace.'});}
  function identify(identity){
    if(!identity?.gameId||!identity.playerId)throw Error('Match identity is incomplete');
    if(metadata.gameId&&metadata.gameId!==identity.gameId||metadata.playerId&&metadata.playerId!==identity.playerId)
      throw Error('Cannot merge different match/player identities');
    metadata.gameId=identity.gameId;metadata.playerId=identity.playerId;
  }
  return {observe,restore,identify,export:exportSummary};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createMatchSummary;
