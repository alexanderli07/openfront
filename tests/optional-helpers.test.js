'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSource}=require('../scripts/build');

function bridge(setter){
  const source=buildSource().source;
  const start=source.indexOf('window.addEventListener("message",n=>{if(n.source!==window){return}const e=n.data;if(!e||e.source!==EXTENSION_SOURCE){return}');
  assert.ok(start>=0);
  const stop=source.indexOf('if(e.type==="SHOW_BUILD_TIMERS")',start);
  const warnings=[];
  let listener;
  const window={addEventListener:(_type,fn)=>listener=fn};
  const context={window,EXTENSION_SOURCE:'test',console:{warn:message=>warnings.push(message)}};
  if(setter)context.setAntiAfkEnabled=setter;
  // Include the guard state immediately before the shipped message listener.
  const state=source.slice(Math.max(0,start-100),start).match(/let ofhAntiAfkUnavailableWarned=false;$/)?.[0]||'';
  vm.runInNewContext(state+source.slice(start,stop)+'});',context);
  return {warnings,send:enabled=>listener({source:window,data:{source:'test',type:'SET_ANTI_AFK',payload:{enabled}}})};
}

test('missing anti-AFK helper never throws on repeated settings synchronization',()=>{
  const h=bridge();
  assert.doesNotThrow(()=>{h.send(false);h.send(true);h.send(true);h.send(false);});
  assert.equal(h.warnings.length,1);
  assert.match(h.warnings[0],/unavailable/i);
});

test('available anti-AFK helper still receives both enabled and disabled settings',()=>{
  const calls=[],h=bridge(enabled=>calls.push(enabled));
  h.send(true);h.send(false);
  assert.deepEqual(calls,[true,false]);
  assert.deepEqual(h.warnings,[]);
});
