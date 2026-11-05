'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {buildSource}=require('../scripts/build');

test('Auto-Bot disclosure arrows track the saved state without changing their labels',()=>{
 const source=buildSource().source;
 const state={settings:{featsOpen:true,statusOpen:true}};
 const nodes=Object.fromEntries(['feats-toggle','feats','status-toggle','status-wrap'].map(key=>[key,{
  dataset:{},textContent:key,classList:{toggle(){}},addEventListener(event,fn){this.click=fn;}
 }]));
 const context=vm.createContext({state,n:{querySelector:selector=>nodes[selector.match(/"(.*?)"/)[1]]},
  saveSettings(){},ofhPanelMotion:{disclose(node,open,apply){apply();}}});
 const wire=source.indexOf('function wirePanel(');
 for(const [start,end] of [['const e=n.querySelector(\'[data-role="feats-toggle"]\')','document.querySelectorAll(".ab-tip")'],
  ['const u=n.querySelector(\'[data-role="status-toggle"]\')','n.querySelectorAll("[data-struct]")']]){
  const a=source.indexOf(start,wire),b=source.indexOf(end,a);
  vm.runInContext(source.slice(a,b),context);
 }
 for(const [role,key] of [['feats-toggle','featsOpen'],['status-toggle','statusOpen']]){
  const node=nodes[role];node.click();assert.equal(state.settings[key],false);assert.equal(node.dataset.open,'false');
  node.click();assert.equal(state.settings[key],true);assert.equal(node.dataset.open,'true');
  assert.equal(node.textContent,role,'label is never replaced with an inline arrow');
 }
});

test('every panel style installer ships the same shared theme, independent of opening order',()=>{
 const source=buildSource().source,css=fs.readFileSync(require.resolve('../src/ui/shared-panels.css'),'utf8');
 for(const [start,end,call,constants] of [
  ['function ensureQuickPanelStyles(){','var _panelAnimTimers=','ensureQuickPanelStyles()', {QUICK_PANEL_ID:'openfront-helper-quick-panel',QUICK_PANEL_STYLE_ID:'quick-style'}],
  ['function ensureFloatingAutoJoinStyles(){','function formatAutoJoinDuration(','ensureFloatingAutoJoinStyles()', {FLOATING_AUTOJOIN_PANEL_ID:'openfront-helper-floating-autojoin-panel',FLOATING_AUTOJOIN_STYLE_ID:'join-style'}],
  ['function ensureStyles(){','const FEAT_TIP=','ensureStyles()', {PANEL_ID:'openfront-helper-auto-bot-panel',STYLE_ID:'bot-style'}]
 ]){
  const nodes=new Map();const document={getElementById:id=>nodes.get(id),createElement:()=>({}),head:{appendChild:n=>nodes.set(n.id,n)}};
  const context=vm.createContext({...constants,document,OFH_PANEL_HEIGHT_PX:420});
  const a=source.indexOf(start),b=source.indexOf(end,a);
  vm.runInContext(source.slice(a,b)+';'+call,context);
  assert.equal(nodes.size,1);
  assert.ok([...nodes.values()][0].textContent.endsWith(css));
  vm.runInContext(call,context);assert.equal(nodes.size,1,'installer remains idempotent');
 }
 assert.ok(source.includes('e.id=D,e.textContent=de+'+JSON.stringify('\n'+css)),'settings dialog also installs shared styles');
});

test('Helper close/open integration respects reduced motion and keeps the panel reusable',()=>{
 const source=buildSource().source,events=[];
 const node={style:{},dataset:{visible:'true'}};
 const context=vm.createContext({window:{matchMedia:()=>({matches:true})},quickPanelEnabled:true,
  _qpInTransition:false,_renderActiveTab:()=>events.push('render'),_themeFromSettings:()=>{},_placePanel:()=>{},
  _notifySettingChanged:(key,value)=>events.push([key,value])});
 const a=source.indexOf('function createHelperPanelMotion('),b=source.indexOf('window.addEventListener("ofh-toggle-quick-panel"',a);
 vm.runInContext(source.slice(a,b),context);
 context.node=node;
 vm.runInContext('_animateClose(node)',context);
 assert.equal(node.dataset.visible,'false');assert.equal(node.style.display,'none');
 assert.deepEqual(events,[['showQuickPanel',false]]);
 vm.runInContext('_animateOpen(node)',context);
 assert.equal(node.dataset.visible,'true');assert.equal(node.style.display,'flex');
 assert.equal(context._qpInTransition,false);assert.equal(events.at(-1),'render');
});
