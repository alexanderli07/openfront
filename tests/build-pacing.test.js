'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const createBuildPacing=require('../src/brain/build-pacing');

test('ordinary orders share one sampled 0–3 second delay until committed',()=>{
  let time=100,draws=0;
  const pacing=createBuildPacing({now:()=>time,random:()=>{draws++;return .5;}});
  const first=pacing.facts();assert.equal(first.allowed,false);assert.equal(first.delayMs,1500);assert.equal(first.scheduled,true);
  time=1599;assert.equal(pacing.facts().remainingMs,1);assert.equal(draws,1);
  time=1600;assert.equal(pacing.facts().allowed,true);assert.equal(draws,1);
  assert.equal(pacing.facts().allowed,true);pacing.commit();
  assert.equal(pacing.facts().allowed,false);assert.equal(draws,2);
});
test('zero may dispatch immediately and the upper endpoint is 3000ms',()=>{
  const instant=createBuildPacing({now:()=>0,random:()=>0});assert.equal(instant.facts().allowed,true);
  let time=0;const max=createBuildPacing({now:()=>time,random:()=>1});
  assert.equal(max.facts().delayMs,3000);time=2999;assert.equal(max.facts().allowed,false);
  time=3000;assert.equal(max.facts().allowed,true);
});
