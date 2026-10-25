'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createCommandGuard = require('../src/brain/command-guard');
const send = (guard, kind, key, tick, extra = {}) => guard.dispatch({kind, key, tick, emit: () => true, ...extra});

test('separate boat paths cannot emit to a pending destination twice', () => {
  const guard = createCommandGuard();
  assert.equal(send(guard, 'boat', 115, 10).emitted, true);
  assert.deepEqual(send(guard, 'boat', 115, 10), {emitted:false, reason:'pending', hold:'operational'});
  assert.equal(send(guard, 'boat', 115, 49).emitted, false);
  assert.equal(send(guard, 'boat', 116, 10).emitted, true);
});

test('donations deduplicate a recipient for one tick regardless of amount', () => {
  const guard = createCommandGuard();
  assert.equal(send(guard, 'donation', 'ally', 10).emitted, true);
  assert.equal(send(guard, 'donation', 'ally', 10).reason, 'same-tick');
  assert.equal(send(guard, 'donation', 'other', 10).emitted, true);
  assert.equal(send(guard, 'donation', 'ally', 11).emitted, true);
});

test('unacknowledged boats gain a bounded increasing cooldown after reservation expiry', () => {
  const guard = createCommandGuard({pendingTicks:4, retryBaseTicks:3, retryMaxTicks:6});
  assert.equal(send(guard, 'boat', 115, 0).emitted, true);
  assert.equal(send(guard, 'boat', 115, 4).reason, 'retry-cooldown');
  assert.equal(send(guard, 'boat', 115, 6).emitted, false);
  assert.equal(send(guard, 'boat', 115, 7).emitted, true);
  assert.equal(send(guard, 'boat', 115, 16).emitted, false);
  assert.equal(send(guard, 'boat', 115, 17).emitted, true);
  assert.equal(send(guard, 'boat', 115, 26).emitted, false);
  assert.equal(send(guard, 'boat', 115, 27).emitted, true);
});

test('acknowledgment resets failure history but retains same tick suppression', () => {
  const guard = createCommandGuard({pendingTicks:4, retryBaseTicks:3, retryMaxTicks:6});
  send(guard, 'boat', 1, 0);
  send(guard, 'boat', 1, 7);
  guard.acknowledge(1, 7);
  assert.equal(send(guard, 'boat', 1, 7).reason, 'same-tick');
  assert.equal(send(guard, 'boat', 1, 8).emitted, true);
  assert.equal(send(guard, 'boat', 1, 15).emitted, true);
});

test('false and throwing emitters immediately release their reservations', () => {
  const guard = createCommandGuard();
  for (const kind of ['boat','donation']) {
    assert.equal(send(guard, kind, 1, 0, {emit:()=>false}).reason, 'emit-rejected');
    assert.throws(()=>send(guard, kind, 1, 0, {emit:()=>{throw new Error('failed');}}), /failed/);
    assert.equal(send(guard, kind, 1, 0).emitted, true);
  }
});

test('reservation exists before emitter runs, preventing reentrant duplicate dispatch', () => {
  const guard = createCommandGuard();
  let calls=0;
  send(guard, 'boat', 1, 0, {emit:()=>{ calls++; assert.equal(send(guard,'boat',1,0).emitted,false); return true; }});
  assert.equal(calls,1);
});

test('manual commands bypass automatic operational holds while explicit policy holds remain visible', () => {
  const guard = createCommandGuard();
  send(guard,'boat',1,0);
  assert.equal(send(guard,'boat',1,0,{manual:true}).emitted,true);
  assert.deepEqual(send(guard,'boat',2,0,{policyHold:true}), {emitted:false,reason:'policy-hold',hold:'policy'});
});

test('active own ship destinations block automatic dispatch without creating a retry failure', () => {
  const guard = createCommandGuard();
  assert.equal(send(guard,'boat',1,0,{activeBoatDestinations:new Set([1])}).reason,'active-destination');
  assert.equal(send(guard,'boat',1,1).emitted,true);
});

test('controllers are independent and rewind and reset clear old game state', () => {
  const first=createCommandGuard(), second=createCommandGuard();
  send(first,'boat',1,10);
  assert.equal(send(first,'boat',1,10).emitted,false);
  assert.equal(send(second,'boat',1,10).emitted,true);
  assert.equal(send(first,'boat',1,0).emitted,true);
  first.reset();
  assert.equal(send(first,'boat',1,0).emitted,true);
});

test('bounded state never evicts a live reservation and later reclaims stale records', () => {
  const guard = createCommandGuard({maxEntries:2, pendingTicks:2, retryBaseTicks:2, retryMaxTicks:2, retentionTicks:4});
  send(guard,'boat',1,0); send(guard,'boat',2,0);
  assert.equal(send(guard,'boat',3,0).reason,'capacity');
  assert.equal(send(guard,'boat',1,0).reason,'pending');
  assert.equal(send(guard,'boat',3,5).emitted,true);
});
