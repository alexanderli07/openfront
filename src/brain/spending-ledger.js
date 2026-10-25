'use strict';
function createSpendingLedger(){
  let lastGold=null,lastTick=null;const pending=[];
  function reconcile(tick,gold){
    if(lastTick!==null&&tick<lastTick){pending.length=0;lastGold=null;}
    if(lastGold!==null&&gold<lastGold){
      let paid=lastGold-gold;
      for(const row of pending){const amount=paid<row.remaining?paid:row.remaining;row.remaining-=amount;paid-=amount;if(!paid)break;}
    }
    for(let i=pending.length-1;i>=0;i--)if(!pending[i].remaining||tick-pending[i].tick>=40)pending.splice(i,1);
    lastGold=gold;lastTick=tick;
  }
  function facts({tick,gold,cost,reserve=0n,key}){
    const exact=v=>typeof v==='bigint'&&v>=0n;
    if(!exact(gold)||!exact(cost)||!exact(reserve))return {allowed:false,reason:'Actual nonnegative quote required'};
    reconcile(tick,gold);
    const pendingCost=pending.reduce((sum,row)=>sum+row.remaining,0n);
    const duplicate=pending.some(row=>row.key===key);
    return {allowed:!duplicate&&gold>=reserve+pendingCost+cost,gold,cost,reserve,pendingCost,
      reason:duplicate?'Purchase already awaiting confirmation':'Preserve SAM reserve and pending purchase commitments'};
  }
  function commit(request,emit){
    if(!facts(request).allowed)return false;
    const row={key:request.key,tick:request.tick,remaining:request.cost};pending.push(row);
    const release=()=>{const index=pending.indexOf(row);if(index>=0)pending.splice(index,1);};
    try{const result=emit();if(result===false)release();else if(result?.then)Promise.resolve(result).then(value=>{if(value===false)release();},release);return result;}
    catch(error){release();throw error;}
  }
  return {facts,commit};
}
if (typeof module !== 'undefined' && module.exports) module.exports=createSpendingLedger;
