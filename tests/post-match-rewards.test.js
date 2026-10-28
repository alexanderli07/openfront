'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPostMatchRewards}=require('../src/lobby/post-match-rewards');
const vm=require('node:vm');
const {buildSource}=require('../scripts/build');
function setup(){
  let time=0,enabled=true,clicks=0;
  const control={disable:false};
  const claim={querySelector:()=>control,click(){clicks++;}};
  const nodes={'[data-xp-claim]':claim};
  const panel={view:{kind:'calculating'},querySelector:s=>nodes[s]||null};
  const modal={isVisible:true,querySelector:()=>panel};
  const service=createPostMatchRewards({enabled:()=>enabled,modal:()=>modal,now:()=>time});
  return {service,panel,modal,nodes,control,get clicks(){return clicks;},time:v=>time=v,enable:v=>enabled=v};
}
test('disabled setting never claims or holds auto leave',()=>{const h=setup();h.enable(false);assert.equal(h.service.hold(),false);assert.equal(h.clicks,0);});
test('waits for native result then clicks Claim once while busy',()=>{
  const h=setup();assert.equal(h.service.hold(),true);assert.equal(h.clicks,0);
  h.panel.view={kind:'result'};assert.equal(h.service.hold(),true);assert.equal(h.clicks,1);
  h.control.disable=true;h.time(6000);h.service.hold();assert.equal(h.clicks,1);
  h.nodes['[data-xp-claimed]']={};assert.equal(h.service.hold(),false);
});
test('retries native claim at most twice and timeout releases navigation',()=>{
  const h=setup();h.panel.view={kind:'result'};h.service.hold();h.time(5000);h.service.hold();h.time(10000);h.service.hold();assert.equal(h.clicks,2);
  h.time(60000);assert.equal(h.service.hold(),false);assert.equal(h.clicks,2);
});
test('confirmed result without claimable rewards releases after render settles',()=>{
  const h=setup();delete h.nodes['[data-xp-claim]'];h.panel.view={kind:'result'};
  assert.equal(h.service.hold(),true);h.time(2000);assert.equal(h.service.hold(),false);
});
test('hidden result and disabled native control cannot be claimed',()=>{
  const h=setup();h.modal.isVisible=false;assert.equal(h.service.hold(),false);
  h.modal.isVisible=true;h.panel.view={kind:'result'};h.control.disable=true;h.service.hold();assert.equal(h.clicks,0);
});
test('stale claimed markup during a new native render does not skip new rewards',()=>{
  const h=setup();h.nodes['[data-xp-claimed]']={};h.panel.isUpdatePending=true;h.panel.view={kind:'result'};
  assert.equal(h.service.hold(),true);assert.equal(h.clicks,0);
  h.panel.isUpdatePending=false;delete h.nodes['[data-xp-claimed]'];h.service.hold();assert.equal(h.clicks,1);
});
test('another match reusing the modal can claim again after hidden interval',()=>{
  const h=setup();h.panel.view={kind:'result'};h.service.hold();h.nodes['[data-xp-claimed]']={};assert.equal(h.service.hold(),false);
  h.modal.isVisible=false;h.service.hold();delete h.nodes['[data-xp-claimed]'];h.modal.isVisible=true;
  assert.equal(h.service.hold(),true);assert.equal(h.clicks,2);
});
test('confirmed rewards arriving after a long provisional result are still claimed',()=>{
 const h=setup();h.panel.view={kind:'provisional'};assert.equal(h.service.hold(),true);
 h.time(70000);assert.equal(h.service.hold(),false);assert.equal(h.clicks,0);
 h.panel.view={kind:'result'};assert.equal(h.service.hold(),true);assert.equal(h.clicks,1);
});
test('a new result on the same visible modal resets previous completion state',()=>{
 const h=setup();h.panel.view={kind:'result'};h.nodes['[data-xp-claimed]']={};assert.equal(h.service.hold(),false);
 h.time(120000);h.panel.view={kind:'provisional'};delete h.nodes['[data-xp-claimed]'];assert.equal(h.service.hold(),true);
 h.panel.view={kind:'result'};assert.equal(h.service.hold(),true);assert.equal(h.clicks,1);
});
test('shipped auto-leave waits for claim coordinator then navigates',()=>{
  const source=buildSource().source;
  const start=source.indexOf('function checkAutoLeave(){');
  const end=source.indexOf('function syncAutoLeaveTimer()',start);
  let waiting=true;
  const window={location:{href:'/game/test'},__OFH_postMatchRewards:{hold:()=>waiting}};
  const context=vm.createContext({window,document:{querySelector:()=>({isVisible:true,isWin:true})},autoLeaveFired:false,autoLeaveOnTeamWin:true,autoLeaveOnLoss:false});
  vm.runInContext(source.slice(start,end),context);
  vm.runInContext('checkAutoLeave()',context);assert.equal(window.location.href,'/game/test');assert.equal(context.autoLeaveFired,false);
  waiting=false;vm.runInContext('checkAutoLeave()',context);assert.equal(window.location.href,'/');
});
test('shipped auto-join respects reward hold before joining',()=>{
  const source=buildSource().source,start=source.indexOf('function tryAutoJoin(){'),end=source.indexOf('function pollAutoJoinResume()',start);
  let checks=0;
  vm.runInNewContext(source.slice(start,end)+';tryAutoJoin();',{
    ofhPostMatchRewards:{hold:()=>true},resetPendingJoinIfExpired:()=>checks++
  });
  assert.equal(checks,0);
  assert.ok(source.includes('autoClaimPostMatchRewards:false'));
  assert.ok(source.includes('data-role="claim-rewards"'));
});
