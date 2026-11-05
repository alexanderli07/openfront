'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPostMatchRewards}=require('../src/lobby/post-match-rewards');
const {buildSource}=require('../scripts/build');
const vm=require('node:vm');

function setup(){
  let time=0,enabled=true,allowed=true,clicks=0;
  const button={disable:false,disabled:false,querySelector:()=>({disabled:false}),click(){clicks++;}};
  // Native RewardsPanel exposes rewards and renders translationKey controls.
  const panel={isConnected:true,rewards:[{id:'level-1'},{id:'win-1'}],claiming:false,
    querySelector:selector=>selector==='o-button[translationkey="account_modal.claim_all"]'?button:null};
  const panels=[panel];
  const service=createPostMatchRewards({enabled:()=>enabled,modal:()=>null,
    accountPanels:()=>panels,canClaimAccount:()=>allowed,now:()=>time});
  return {panel,panels,button,service,get clicks(){return clicks;},time:v=>time=v,enable:v=>enabled=v,allow:v=>allowed=v};
}

test('account Claim All works while the match result modal is hidden',()=>{
  const h=setup();assert.equal(h.service.hold(),true);assert.equal(h.clicks,1);
  assert.equal(h.service.inspect().surface,'account');
  assert.equal(h.service.inspect().attempts,1);
});
test('disabled setting or an occupied game never claims account rewards',()=>{
  const h=setup();h.enable(false);assert.equal(h.service.hold(),false);
  h.enable(true);h.allow(false);assert.equal(h.service.hold(),false);assert.equal(h.clicks,0);
});
test('native in-flight state blocks stale enabled markup and duplicate panels',()=>{
  const h=setup();h.panels.push({...h.panel});h.panel.claiming=true;
  assert.equal(h.service.hold(),true);assert.equal(h.clicks,0);
  h.panel.claiming=false;h.service.hold();assert.equal(h.clicks,1);
  h.time(1000);h.service.hold();assert.equal(h.clicks,1);
});
test('native disabled control is respected',()=>{
  const h=setup();h.button.disable=true;assert.equal(h.service.hold(),true);assert.equal(h.clicks,0);
});
test('account claim retries twice maximum and releases navigation at timeout',()=>{
  const h=setup();h.service.hold();h.time(5000);h.service.hold();h.time(10000);h.service.hold();
  assert.equal(h.clicks,2);h.time(60000);assert.equal(h.service.hold(),false);
  h.time(120000);assert.equal(h.service.hold(),false);assert.equal(h.clicks,2);
});
test('removing claimed rewards releases navigation and new rewards can claim',()=>{
  const h=setup();h.service.hold();h.panel.rewards=[];
  assert.equal(h.service.hold(),false);assert.equal(h.clicks,1);
  h.panel.rewards=[{id:'next-win'}];assert.equal(h.service.hold(),true);assert.equal(h.clicks,2);
});
test('completed batches do not exhaust claims on a long-running auto-join session',()=>{
  const h=setup();
  for(let i=0;i<70;i++){
    h.panel.rewards=[{id:'win-'+i}];assert.equal(h.service.hold(),true);
    h.panel.rewards=[];assert.equal(h.service.hold(),false);
  }
  assert.equal(h.clicks,70);
});
test('held-only rewards with no native control never claim or block navigation',()=>{
  const h=setup();h.panel.rewards=[{id:'held',held:'trust'}];h.panel.querySelector=()=>null;
  assert.equal(h.service.hold(),false);assert.equal(h.clicks,0);
});
test('single native Claim works without Claim All and skips disconnected panels',()=>{
  const h=setup();h.panel.rewards=[{id:'one'}];
  h.panel.querySelector=selector=>selector==='o-button[translationkey="account_modal.claim"]'?h.button:null;
  h.panel.isConnected=false;assert.equal(h.service.hold(),false);
  h.panel.isConnected=true;assert.equal(h.service.hold(),true);assert.equal(h.clicks,1);
});

test('shipped account discovery uses native rewards panels and occupancy gate',()=>{
  const source=buildSource().source,start=source.indexOf('const ofhPostMatchRewards=createPostMatchRewards(');
  const end=source.indexOf('window.__UIK_postMatchRewards=',start);
  assert.ok(start>=0&&end>start);
  let occupied=false,options;
  const panels=[{}];
  vm.runInNewContext(source.slice(start,end),{
    createPostMatchRewards:value=>{options=value;},settings:{autoClaimPostMatchRewards:true},
    document:{querySelectorAll:selector=>selector==='rewards-panel'?panels:[]},isOccupied:()=>occupied
  });
  assert.equal(options.enabled(),true);assert.equal(options.accountPanels(),panels);
  assert.equal(options.canClaimAccount(),true);occupied=true;assert.equal(options.canClaimAccount(),false);
});
