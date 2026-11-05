'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {ensurePanelThemeStyle,startBackgroundHousekeeping,PANEL_THEME_SELECTOR}=require('../src/ui/background-work');
const {optimizeBackgroundWork}=require('../scripts/background-work');

function fakeDocument(){
 const nodes=new Map();let appends=0;
 return {nodes,get appends(){return appends},getElementById:id=>nodes.get(id),
  createElement:tag=>({tagName:tag.toUpperCase()}),
  head:{appendChild(node){nodes.set(node.id,node);appends++}}};
}
test('theme installation has no scans, timers, inline writes or observer on repeated settings/rainbow events',()=>{
 const doc=fakeDocument();
 const style=ensurePanelThemeStyle(doc);
 for(let i=0;i<100;i++)assert.equal(ensurePanelThemeStyle(doc),style);
 assert.equal(doc.appends,1);
 assert.match(style.textContent,/background:var\(--oh-panel-bg, rgba\(12,18,20,0\.92\)\)!important/);
 assert.match(style.textContent,/border-color:var\(--oh-panel-border, rgba\(148,163,184,0\.34\)\)!important/);
 doc.nodes.delete(style.id);ensurePanelThemeStyle(doc);assert.equal(doc.appends,2);
});
test('CSS cascade covers current and future helper ids with inherited custom-panel exceptions',()=>{
 assert.ok(PANEL_THEME_SELECTOR.startsWith('[id^="openfront-helper-"]'));
 for(const tag of ['style','canvas','svg'])assert.ok(PANEL_THEME_SELECTOR.includes(':not('+tag+')'));
 for(const fragment of ['-layer','-styles','-range','atom-macro','-overlay','-launcher'])
  assert.ok(PANEL_THEME_SELECTOR.includes(':not([id*="'+fragment+'"])'));
 // No static id allowlist: future panels, replacements and ID changes are
 // matched by the browser cascade without notifying JS or touching inline CSS.
 assert.equal((PANEL_THEME_SELECTOR.match(/id\^=/g)||[]).length,1);
});
test('one shared one-second clock preserves every task even hidden and isolates thrown tasks',()=>{
 let tick,stopped,starts=0;const calls=[],errors=[];
 const clock={setInterval(fn,ms){starts++;tick=fn;assert.equal(ms,1000);return 19},clearInterval(id){stopped=id}};
 const control=startBackgroundHousekeeping([
  ()=>calls.push('rewards'),()=>{calls.push('expiry');throw Error('expired')},()=>calls.push('resume')
 ],{...clock,onError:error=>errors.push(error.message)});
 assert.equal(starts,1);assert.deepEqual(calls,[]);
 tick();tick();assert.deepEqual(calls,['rewards','expiry','resume','rewards','expiry','resume']);
 assert.deepEqual(errors,['expired','expired']);control.stop();assert.equal(stopped,19);
});
test('integration changes only theme loop and three housekeeping registrations; anchors fail loudly',()=>{
 const baseline=fs.readFileSync('vendor/openfront-helper-1.84.0.user.js','utf8');
 const rewards='window.setInterval(()=>ofhPostMatchRewards.hold(),1000);';
 const fixture=baseline.replace('function tryAutoJoin(){',rewards+'function tryAutoJoin(){');
 const result=optimizeBackgroundWork(fixture);
 assert.ok(!result.includes('setInterval(function(){_applyThemeToAllPanels()},2e3)'));
 assert.ok(!result.includes(rewards));
 assert.ok(result.includes('const ofhHousekeepingTasks=[()=>ofhPostMatchRewards.hold()]'));
 assert.ok(result.includes('ofhHousekeepingTasks.push(resetPendingJoinIfExpired,pollAutoJoinResume)'));
 assert.ok(result.includes('function _themeFromSettings()'));
 assert.ok(result.includes('function pollAutoJoinResume()'));
 new vm.Script(result);
 assert.throws(()=>optimizeBackgroundWork(fixture.replace('window.setInterval(pollAutoJoinResume,1e3)','window.setInterval(pollAutoJoinResume,2000)')),/Background work anchor changed/);
 assert.throws(()=>optimizeBackgroundWork(result),/Background work anchor changed/);
});
test('reward housekeeping starts before async init and continues if lobby startup fails',async()=>{
 const baseline=fs.readFileSync('vendor/openfront-helper-1.84.0.user.js','utf8');
 const theme=baseline.slice(baseline.indexOf('var _lastPanelTheme="";'),baseline.indexOf('function ensureQuickPanelStyles(){'));
 const fixture=theme+'window.setInterval(()=>ofhPostMatchRewards.hold(),1000);'+
  'async function initialize(){await startup();window.setInterval(resetPendingJoinIfExpired,1e3);window.setInterval(pollAutoJoinResume,1e3)}';
 for(const succeed of [false,true]){
  let tick,starts=0,resolve,reject;const calls=[];
  const startup=new Promise((a,b)=>{resolve=a;reject=b});
  const context={ofhPostMatchRewards:{hold:()=>calls.push('reward')},
   resetPendingJoinIfExpired:()=>calls.push('expiry'),pollAutoJoinResume:()=>calls.push('resume'),startup:()=>startup,
   window:{setInterval(fn,ms){assert.equal(ms,1000);starts++;tick=fn;return 1},clearInterval(){}}};
  vm.createContext(context);vm.runInContext(optimizeBackgroundWork(fixture),context);
  assert.equal(starts,1);tick();assert.deepEqual(calls,['reward']);
  const initialization=context.initialize();tick();assert.deepEqual(calls,['reward','reward']);
  if(succeed){resolve();await initialization;}else{reject(Error('settings unavailable'));await assert.rejects(initialization,/settings unavailable/);}
  calls.length=0;tick();assert.deepEqual(calls,succeed?['reward','expiry','resume']:['reward']);
  assert.equal(starts,1);
 }
});
test('native pending expiry and occupied/grace/disabled resume controls retain behavior on the shared clock',()=>{
 const baseline=fs.readFileSync('vendor/openfront-helper-1.84.0.user.js','utf8');
 function method(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))}
 const native=method(baseline,'function resetPendingJoinIfExpired(){','function isInActiveGame(){')+
  method(baseline,'function pollAutoJoinResume(){','function handleBridgeMessage(');
 const patched=optimizeBackgroundWork(baseline.replace('function tryAutoJoin(){','window.setInterval(()=>ofhPostMatchRewards.hold(),1000);function tryAutoJoin(){'));
 assert.ok(patched.includes(method(baseline,'function resetPendingJoinIfExpired(){','function isInActiveGame(){')));
 assert.ok(patched.includes(method(baseline,'function pollAutoJoinResume(){','function handleBridgeMessage(')));
 for(const scenario of [
  {occupied:true,grace:false,enabled:true,expired:false},
  {occupied:false,grace:true,enabled:true,expired:false},
  {occupied:false,grace:false,enabled:false,expired:true},
  {occupied:false,grace:false,enabled:true,expired:true}
 ]){
  function context(){
   const calls=[];
   const ctx={...scenario,calls,wasOccupied:true,pendingJoin:{startedAt:scenario.expired?0:9900},JOIN_ATTEMPT_TIMEOUT_MS:1000,
    Date:{now:()=>10000},settings:{enabled:scenario.enabled,keepAutoJoinAfterMatch:true},
    STORAGE_KEY:'settings',isOccupied:()=>scenario.occupied,noteOccupancy:()=>scenario.occupied,recentlyOccupied:()=>scenario.grace,
    chrome:{storage:{local:{set:()=>{calls.push('save');return {catch(){}}}}}},
    resetLobbyForecastTracking:()=>calls.push('forecast'),tryAutoJoin:()=>calls.push('try'),
    hold:()=>calls.push('hold')};
   vm.createContext(ctx);vm.runInContext(native,ctx);return ctx;
  }
  const separate=context(),shared=context();
  separate.hold();separate.resetPendingJoinIfExpired();separate.pollAutoJoinResume();
  let tick;startBackgroundHousekeeping([shared.hold,shared.resetPendingJoinIfExpired,shared.pollAutoJoinResume],{setInterval:fn=>{tick=fn},clearInterval(){}});tick();
  assert.deepEqual(shared.calls,separate.calls);
  assert.equal(shared.pendingJoin===null,separate.pendingJoin===null);
  assert.equal(shared.wasOccupied,separate.wasOccupied);
  assert.equal(shared.settings.searchStartedAt,separate.settings.searchStartedAt);
 }
});
