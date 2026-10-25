'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const legacy=require('../src/brain/legacy-strategy')();
const adaptive=require('../src/brain/adaptive-strategy')(legacy);
const choose=(candidates,threshold=.8)=>adaptive.decide({domain:'donation-target',diplomacy:{threshold}},
  [...candidates.map(c=>({kind:'donation-target',eligible:true,...c})),
    {id:'skip',kind:'donation-target',skipDonation:true,eligible:true},{id:'$wait',kind:'wait',eligible:true}]);

test('adaptive donations skip needy rear allies and 65 percent or healthier front allies',()=>{
  for(const fill of [.65,.7,.79])assert.equal(choose([{id:'rear',fill:.1},{id:'front',fill,frontline:true}]).selectedId,'skip');
});
test('adaptive donations support combat or enemy-border teammates below 65 percent',()=>{
  for(const facts of [{frontline:true},{bordersEnemy:true}]){
    const result=choose([{id:'rear',fill:.1},{id:'front',fill:.64,...facts}]);
    assert.equal(result.selectedId,'front');assert.match(result.reason,/65|front/i);
  }
});
test('adaptive donations honor a lower configured cutoff and candidate eligibility',()=>{
  assert.equal(choose([{id:'front',fill:.62,frontline:true}],.6).selectedId,'skip');
  assert.equal(choose([{id:'front',fill:.59,bordersEnemy:true}],.6).selectedId,'front');
  assert.equal(choose([{id:'front',fill:.4,frontline:true,eligible:false}]).selectedId,'skip');
});
test('adaptive donations pick the lowest front-line fill and keep active-combat priority',()=>{
  assert.equal(choose([{id:'border1',fill:.6,bordersEnemy:true},{id:'border2',fill:.3,bordersEnemy:true}]).selectedId,'border2');
  assert.equal(choose([{id:'border',fill:.3,bordersEnemy:true},{id:'combat',fill:.5,frontline:true}]).selectedId,'combat');
});
