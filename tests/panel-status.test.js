'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const status=require('../src/ui/panel-status'),{buildSource}=require('../scripts/build');
test('off always wins; enabled panels wait until connected',()=>{
 assert.equal(status(false,false),'off');assert.equal(status(false,true),'off');
 assert.equal(status(true,false),'waiting');assert.equal(status(true,true),'connected');
});
test('Auto-Bot indicator responds to both enablement and the actual connection',()=>{
 const source=buildSource().source,dot={dataset:{},style:{}},state={settings:{enabled:false}};
 let connected=true;
 const context=vm.createContext({state,PANEL_ID:'bot',tr:x=>x,
  window:{__OFH_panelIndicatorStatus:status,__OFH_gameConnectionStatus:{connected:()=>connected}},
  document:{getElementById:()=>({querySelector:()=>dot})},getGame:()=>({}),gameType:()=> 'Public'});
 const a=source.indexOf('function refreshGateBanner(){'),b=source.indexOf('function fmt(',a);
 vm.runInContext(source.slice(a,b),context);
 const refresh=()=>vm.runInContext('refreshGateBanner()',context);
 refresh();assert.equal(dot.dataset.panelStatus,'off');
 state.settings.enabled=true;refresh();assert.equal(dot.dataset.panelStatus,'connected');
 connected=false;refresh();assert.equal(dot.dataset.panelStatus,'waiting');
 state.settings.enabled=false;refresh();assert.equal(dot.dataset.panelStatus,'off');
});
