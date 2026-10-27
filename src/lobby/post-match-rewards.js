'use strict';
// Use only the native post-match claim control; held/account rewards stay native.
function createPostMatchRewards({enabled,modal,now=()=>Date.now()}){
  let current=null,started=0,attempts=0,lastAttempt=-Infinity,settledAt=null,finished=false;
  function hold(){
    const screen=modal();
    if(!screen||screen.isVisible!==true){current=null;return false;}
    if(!enabled())return false;
    if(current!==screen){current=screen;started=now();attempts=0;lastAttempt=-Infinity;settledAt=null;finished=false;}
    if(finished)return false;
    if(now()-started>=60000){finished=true;console.warn('[ofh] Post-match reward wait timed out; continuing auto join.');return false;}
    const panel=screen.querySelector('game-xp-panel');
    const root=panel?.shadowRoot||panel;
    // Provisional XP has no server-confirmed rewards to claim.
    if(panel?.view?.kind!=='result'||panel.isUpdatePending===true){settledAt=null;return true;}
    if(root.querySelector('[data-xp-claimed]')){finished=true;return false;}
    const claim=root.querySelector('[data-xp-claim]');
    if(claim){
      settledAt=null;
      const button=claim.querySelector('o-button');
      if(!button||button.disable||button.disabled||root.querySelector('[data-xp-claim-spinner]'))return true;
      if(attempts<2&&now()-lastAttempt>=5000){
        attempts++;lastAttempt=now();
        try{claim.click();}catch(error){console.warn('[ofh] Post-match reward claim failed',error);}
      }
      return true;
    }
    // Lit can have received the result but not rendered it yet.
    if(settledAt===null)settledAt=now();
    if(now()-settledAt<2000)return true;
    finished=true;return false;
  }
  return {hold};
}
if(typeof module!=='undefined')module.exports={createPostMatchRewards};
