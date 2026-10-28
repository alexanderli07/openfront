'use strict';
// Use only the native post-match claim control; held/account rewards stay native.
function createPostMatchRewards({enabled,modal,now=()=>Date.now()}){
  let current=null,started=0,attempts=0,lastAttempt=-Infinity,settledAt=null,finished=false,lastView=null,phase='idle';
  function hold(){
    const screen=modal();
    if(!screen||screen.isVisible!==true){current=null;phase='hidden';return false;}
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
  return {hold,inspect:()=>({phase,attempts,view:lastView?.kind,finished})};
}
if(typeof module!=='undefined')module.exports={createPostMatchRewards};
