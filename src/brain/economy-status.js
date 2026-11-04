'use strict';
// Read-only presentation of observed income and central purchase decisions.
function createEconomyStatus(){
  let identity=null,source=null,lastTick=null,samples=[],purchase=null;
  const structures=new Set(['City','Port','Factory','SAM Launcher','Missile Silo','Defense Post']);
  const number=value=>{if(value===null||value===undefined||value==='')return null;try{const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}catch{return null;}};
  function sync(game,player){
    if(!game||!player)return null;
    const native=game.__src||game,id=native.gameID?.(),key=JSON.stringify([id??null,player.id()]),tick=game.ticks();
    if(!Number.isFinite(tick))return null;
    if(identity!==key||id==null&&source!==native||lastTick!==null&&tick<lastTick){samples=[];purchase=null;identity=key;source=native;}
    lastTick=tick;return tick;
  }
  function observe(game,player,entry,scope=game){
    const tick=sync(game,player);if(tick===null)return;
    if(entry.kind==='dispatch'){
      if(entry.status==='submitted'&&purchase?.scope===scope&&purchase.decisionId===entry.decisionId)purchase=null;
      return;
    }
    if(entry.kind!=='decision')return;
    const selected=entry.candidates?.find(c=>c.id===entry.selectedId);
    const remember=(target,cost,reserve,estimated)=>{
      purchase={target,cost:number(cost),reserve:number(reserve)??0,estimated,tick,scope,decisionId:entry.decisionId};
    };
    const domain=entry.snapshot?.domain;
    if(domain==='structure-plan'){
      const facts=entry.snapshot.defenseEconomy;
      const plans=(entry.candidates||[]).filter(c=>c.kind==='structure-plan'&&c.eligible!==false);
      const candidate=selected?.kind==='structure-plan'?selected:
        plans.find(c=>facts?.requiredType&&c.unitType===facts.requiredType)||
        plans.find(c=>c.id==='structure:sam-development')||
        plans.filter(c=>c.affordable===false).sort((a,b)=>a.priority-b.priority)[0];
      if(candidate){
        const upgrade=candidate.action==='sam-upgrade';
        remember(candidate.unitType+(upgrade?' upgrade':''),candidate.perceivedCost,
          upgrade?facts?.emergencyReserve:facts?.stage==='first-sam'?0:facts?.reserve,true);
      }else if(facts?.waitingForSam)remember('SAM constructing',null,0,true);
      else purchase=null;
      return;
    }
    if(domain)return;
    const command=(entry.candidates||[]).find(c=>structures.has(c.arguments?.[0]?.type)&&
      (c.kind==='upgrade'||c.kind.startsWith('build ')));
    const quote=command?.arguments?.[0];
    if(!quote)return;
    const upgrade=typeof quote.canUpgrade==='number';
    remember(quote.type+(upgrade?' upgrade':''),upgrade?(quote.upgradeCosts?.[0]??quote.cost):quote.cost,
      command.spending?.reserve,false);
  }
  function view(game,player,{enabled,buildEnabled,format}){
    let tick;
    try{tick=sync(game,player);}catch{return {income:null,purchase:'Next purchase: —',detail:''};}
    if(tick===null)return {income:null,purchase:'Next purchase: —',detail:''};
    const native=player.__src||player;let earned=null;
    try{if(typeof native.goldEarned==='function')earned=number(native.goldEarned());}catch{}
    let income=null;
    if(earned===null)samples=[];
    else{
      if(samples.length&&earned<samples.at(-1).earned)samples=[];
      if(samples.at(-1)?.tick!==tick)samples.push({tick,earned});
      while(samples.length>1&&samples[0].tick<tick-600)samples.shift();
      const first=samples[0],last=samples.at(-1),span=last.tick-first.tick;
      if(span>=10)income=(last.earned-first.earned)/span*600;
    }
    const paused=!enabled?'Paused':!buildEnabled?'Building off':null;
    if(paused)return {income,purchase:'Next purchase: '+paused,detail:''};
    if(!purchase||tick-purchase.tick>100)return {income,purchase:'Next purchase: Evaluating',detail:''};
    const {target,cost,reserve,estimated}=purchase,gold=number(player.gold());
    if(cost===null||gold===null)return {income,purchase:'Next purchase: '+target,detail:'Awaiting a verified price'};
    const goal=cost+reserve;
    return {income,purchase:`${gold<goal?'Saving':'Next'}: ${target} · ${format(gold)} / ${format(goal)}`,
      detail:`${estimated?'Planner estimate':'Latest build quote'}; purchase ${format(cost)}${reserve?`, keeps ${format(reserve)} reserve`:''}.`};
  }
  return {observe,view};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createEconomyStatus;
