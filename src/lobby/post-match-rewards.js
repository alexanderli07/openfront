'use strict';
// Use native claim controls; the game retains its held-reward restrictions.
function createPostMatchRewards({enabled,modal,accountPanels=()=>[],canClaimAccount=()=>true,now=()=>Date.now()}){
  let current=null,started=0,attempts=0,lastAttempt=-Infinity,settledAt=null,finished=false,lastView=null,phase='idle';
  const accountBatches=new Map();
  let accountInfo=null;
  function holdAccount(){
    accountInfo=null;
    if(!enabled()||!canClaimAccount())return false;
    const candidates=[];
    for(const panel of Array.from(accountPanels()).slice(0,16)){
      if(panel.isConnected===false||!Array.isArray(panel.rewards)||!panel.rewards.length)continue;
      const ids=panel.rewards.map(reward=>reward?.id);
      if(ids.length>256||ids.some(id=>typeof id!=='string'||!id))continue;
      candidates.push({panel,key:JSON.stringify(ids.sort())});
    }
    // Keep retry state only for batches still rendered. This stays bounded by
    // the panel limit without exhausting claims during long auto-join sessions.
    const present=new Set(candidates.map(candidate=>candidate.key));
    for(const key of accountBatches.keys())if(!present.has(key))accountBatches.delete(key);
    for(const {panel,key} of candidates){
      const root=panel.shadowRoot||panel;
      const button=root.querySelector('o-button[translationkey="account_modal.claim_all"]')||
        root.querySelector('o-button[translationkey="account_modal.claim"]');
      // Held rewards have no native Claim control. Never infer one from text.
      if(!button)continue;
      let batch=accountBatches.get(key);
      if(!batch){
        batch={started:now(),attempts:0,lastAttempt:-Infinity,finished:false,phase:'account-rendering'};
        accountBatches.set(key,batch);
      }
      accountInfo=batch;
      if(now()-batch.started>=60000){batch.finished=true;batch.phase='account-timed-out';continue;}
      if(panel.isUpdatePending||panel.claiming||button.disable||button.disabled||button.querySelector('button')?.disabled){
        batch.phase='account-claiming';return true;
      }
      if(batch.attempts<2&&now()-batch.lastAttempt>=5000){
        batch.attempts++;batch.lastAttempt=now();
        try{button.click();}catch(error){console.warn('[ofh] Account reward claim failed',error);}
      }
      batch.phase=batch.attempts>=2?'account-waiting-after-retry':'account-waiting-for-confirmation';
      return true;
    }
    return false;
  }
  function hold(){
    const screen=modal();
    if(!screen||screen.isVisible!==true){current=null;phase='hidden';return holdAccount();}
    accountInfo=null;
    if(!enabled()){current=null;phase='disabled';return false;}
    if(current!==screen){current=screen;started=now();attempts=0;lastAttempt=-Infinity;settledAt=null;finished=false;lastView=null;}
    const panel=screen.querySelector('game-xp-panel');
    const root=panel?.shadowRoot||panel;
    const view=panel?.view;
    if(view!==lastView){
      if(view?.kind==='result'||lastView?.kind==='result'){
        attempts=0;lastAttempt=-Infinity;settledAt=null;finished=false;
        started=now();
      }
      lastView=view;
    }
    if(finished)return false;
    const waiting=reason=>{phase=now()-started>=60000?'timed-out':reason;return phase!=='timed-out';};
    // Provisional XP has no server-confirmed rewards to claim.
    if(view?.kind!=='result'||panel.isUpdatePending===true){settledAt=null;return waiting(view?.kind||'loading');}
    if(root.querySelector('[data-xp-claimed]')){finished=true;phase='claimed';return false;}
    const claim=root.querySelector('[data-xp-claim]');
    if(claim){
      settledAt=null;
      const button=claim.querySelector('o-button');
      if(!button||button.disable||button.disabled||root.querySelector('[data-xp-claim-spinner]'))return waiting('claiming');
      if(attempts<2&&now()-lastAttempt>=5000){
        attempts++;lastAttempt=now();
        try{claim.click();phase='claim-submitted';console.info('[ofh] Post-match reward Claim submitted',attempts);}catch(error){console.warn('[ofh] Post-match reward claim failed',error);}
      }
      return waiting(attempts>=2?'waiting-after-retry':'waiting-for-confirmation');
    }
    // Lit can have received the result but not rendered it yet.
    if(settledAt===null)settledAt=now();
    if(now()-settledAt<2000)return waiting('rendering');
    finished=true;phase='no-claimable-rewards';return false;
  }
  return {hold,inspect:()=>accountInfo?
    {surface:'account',phase:accountInfo.phase,attempts:accountInfo.attempts,finished:accountInfo.finished}:
    {surface:current?'match':'none',phase,attempts,view:lastView?.kind,finished}};
}
if(typeof module!=='undefined')module.exports={createPostMatchRewards};
