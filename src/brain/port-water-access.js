'use strict';
// A shared component/trade hint is not proof of access to open water. Verify
// an ocean witness, including rivers that connect to it, before spending.
function createPortWaterAccess({perCall=512,perTick=2048,maxTiles=16384}={}){
  const states=new WeakMap();
  function assess(game,tile){
    const deny=reason=>({allowed:false,reason});
    try{
      if(!game.isLand(tile))return deny('Port must occupy a land shore');
      const water=game.neighbors(tile).filter(t=>game.isWater(t));
      if(!water.length)return deny('Port has no adjacent water');
      const tick=game.ticks();let state=states.get(game);
      if(!state||tick<state.tick){state={tick,spent:0,components:new Map()};states.set(game,state);}
      if(tick!==state.tick){state.tick=tick;state.spent=0;}
      let enclosed=true;
      for(const start of water){
        if(game.isOcean(start))return {allowed:true,reason:'Port has direct open-sea access'};
        const id=game.getWaterComponent?.(start);
        if(id===undefined||id===null){enclosed=false;continue;}
        let r=state.components.get(id);
        if(r?.witness!==undefined){
          if(game.isWater(r.witness)&&game.isOcean(r.witness)&&game.getWaterComponent(r.witness)===id)
            return {allowed:true,reason:'Port water component connects to open sea',component:id};
          state.components.delete(id);r=null;
        }
        if(r&&(r.closed||r.truncated)&&tick-r.created>=40){state.components.delete(id);r=null;}
        if(!r){
          if(state.components.size>=64){
            // Preserve unfinished flood progress across opening coast scans.
            // Cheap completed lakes can be rediscovered without starvation.
            const entries=[...state.components];
            const victim=entries.find(([,v])=>v.closed)||entries.find(([,v])=>v.truncated)||
              entries.find(([,v])=>v.witness!==undefined);
            if(!victim){enclosed=false;continue;}
            state.components.delete(victim[0]);
          }
          r={queue:[start],head:0,seen:new Set([start]),created:tick,closed:false,truncated:false};
          state.components.set(id,r);
        }
        if(r.closed)continue;
        let work=0;
        while(r.head<r.queue.length&&work<perCall&&state.spent<perTick){
          const current=r.queue[r.head++];work++;state.spent++;
          if(game.isOcean(current)){
            r.witness=current;r.queue=[];r.seen.clear();
            return {allowed:true,reason:'Port water component connects to open sea',component:id};
          }
          for(const n of game.neighbors(current))if(game.isWater(n)&&game.getWaterComponent(n)===id&&!r.seen.has(n)){
            if(r.seen.size>=maxTiles){r.truncated=true;continue;}
            r.seen.add(n);r.queue.push(n);
          }
        }
        if(r.head===r.queue.length&&!r.truncated){r.closed=true;r.queue=[];r.seen.clear();}
        if(!r.closed)enclosed=false;
      }
      return deny(enclosed?'Enclosed water component: no open-sea connection':'Open-sea connection not yet proven');
    }catch{return deny('Water topology unavailable: refuse unverified port');}
  }
  return {assess};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createPortWaterAccess;
