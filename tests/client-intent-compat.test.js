'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildSource}=require('../scripts/build');
const events=require('./fixtures/client-intents-2026-10-18');

test('generated constructor discovery matches current upstream attack, boat, donation and warship events',()=>{
  const source=buildSource().source;
  const start=source.indexOf('function discoverCtors('),end=source.indexOf('function emitIntent(',start);
  const ctors={};
  const discover=vm.runInNewContext(source.slice(start,end)+';discoverCtors',
    {_ctors:ctors,getListenersMap:bus=>bus.listeners});
  const bus={listeners:new Map(Object.values(events).reverse().map(Event=>[Event,[]]))};
  discover(bus);
  const expected={spawn:'SendSpawnIntentEvent',attack:'SendAttackIntentEvent',boat:'SendBoatAttackIntentEvent',
    moveWarship:'MoveWarshipIntentEvent',donateTroops:'SendDonateTroopsIntentEvent',embargo:'SendEmbargoIntentEvent',embargoAll:'SendEmbargoAllIntentEvent',
    emoji:'SendEmojiIntentEvent',target:'SendTargetPlayerIntentEvent'};
  for(const [key,name] of Object.entries(expected))assert.equal(ctors[key],events[name],key);
  assert.equal(discover(bus),ctors);
});

test('embargo-all discovery retries when its listener appears after other constructors were cached',()=>{
 const source=buildSource().source,start=source.indexOf('function discoverCtors('),end=source.indexOf('function emitIntent(',start);
 const ctors={},discover=vm.runInNewContext(source.slice(start,end)+';discoverCtors',{_ctors:ctors,getListenersMap:b=>b.listeners});
 const bus={listeners:new Map(Object.entries(events).filter(([name])=>name!=='SendEmbargoAllIntentEvent').map(([,ctor])=>[ctor,[]]))};
 discover(bus);assert.equal(ctors.embargoAll,undefined);
 bus.listeners.set(events.SendEmbargoAllIntentEvent,[]);discover(bus);
 assert.equal(ctors.embargoAll,events.SendEmbargoAllIntentEvent);
});
