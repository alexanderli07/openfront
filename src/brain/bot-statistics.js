'use strict';
// UI counters describe submitted automated commands, not server acceptance.
function createBotStatistics({units:U,onUpdate=()=>{}}){
  let identity=null,source=null,lastTick=null,scopes=new WeakMap();
  let counts={spawns:0,attacks:0,builds:0,nukes:0};
  const nuclear=new Set([U.AtomBomb,U.HydrogenBomb,U.MIRV,U.MIRVWarhead].filter(Boolean));
  function observe(game,player,entry,scope=game){
    const native=game.__src||game;
    const gameId=typeof native.gameID==='function'?native.gameID():null;
    const key=JSON.stringify([gameId,player.id()]),tick=game.ticks();
    if(identity!==key||gameId==null&&source!==native||lastTick!==null&&tick<lastTick){
      counts={spawns:0,attacks:0,builds:0,nukes:0};scopes=new WeakMap();identity=key;source=native;
    }
    lastTick=tick;
    let state=scopes.get(scope);
    if(!state){state={decisions:new Map()};scopes.set(scope,state);}
    if(entry.kind==='decision'){
      const command=entry.candidates?.find(candidate=>candidate.id===entry.selectedId);
      if(command){
        state.decisions.set(entry.decisionId,command);
        if(state.decisions.size>1024)state.decisions.delete(state.decisions.keys().next().value);
      }
    }
    if(entry.kind==='dispatch'&&entry.status!=='pending'){
      const command=state.decisions.get(entry.decisionId);state.decisions.delete(entry.decisionId);
      if(command&&entry.status==='submitted'){
        const kind=command.kind,type=command.arguments?.[0]?.type;
        if(kind==='spawn')counts.spawns=1;
        else if(kind==='attack'||kind==='boat')counts.attacks++;
        else if(kind==='upgrade'||kind?.startsWith('build ')){
          if(nuclear.has(type))counts.nukes++;else counts.builds++;
        }
      }
    }
    onUpdate({...counts});
  }
  return {observe,snapshot:()=>({...counts}),displayTroops:raw=>Number(raw)/10};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createBotStatistics;
