'use strict';

// A pacing deadline, not a queued order. Callers must plan again before sending.
function createBuildPacing({now=()=>performance.now(),random=Math.random}={}){
  let pending=null;
  function facts(){
    const time=now(),scheduled=pending===null;
    if(scheduled){
      const draw=random();
      if(!Number.isFinite(draw))throw new Error('Invalid build delay randomness');
      const delayMs=Math.floor(Math.min(1,Math.max(0,draw))*3000);
      pending={delayMs,due:time+delayMs};
    }
    const remainingMs=Math.max(0,pending.due-time);
    return {allowed:remainingMs===0,scheduled,delayMs:pending.delayMs,remainingMs,
      reason:remainingMs?'Waiting for ordinary building delay':'Ordinary building delay complete'};
  }
  return {facts,commit:()=>{pending=null;}};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createBuildPacing;
