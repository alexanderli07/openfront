'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path').join(__dirname,'../src/brain/donation-value.js');
const assess=fs.existsSync(path)?require(path):()=>({});
const base={troops:200,capacity:1000,availableTroops:300,fillLimit:.65,
  incomingTroops:0,incomingCount:0,incomingKnown:true,outgoingTroops:0,outgoingCount:0,outgoingKnown:true,
  outgoingTargetTroops:0,outgoingTargetsKnown:true,bordersEnemy:false};
test('a donation that closes an imminent defense gap beats lower-fill idle and hopeless allies',()=>{
  const hold=assess({...base,incomingTroops:400,incomingCount:1});
  const doomed=assess({...base,troops:50,incomingTroops:3000,incomingCount:1});
  const idle=assess({...base,troops:10});
  assert.equal(hold.donationRole,'defense');assert.equal(hold.defenseGap,240);
  assert.equal(hold.canHoldAfterDonation,true);assert.ok(hold.donationValue>0);
  assert.equal(doomed.hopeless,true);assert.equal(doomed.donationValue,0);assert.equal(idle.donationValue,0);
});
test('known outgoing attack gets useful advance support without subtracting committed armies twice',()=>{
  const advance=assess({...base,outgoingCount:1,outgoingTroops:350,outgoingTargetTroops:500});
  assert.equal(advance.donationRole,'advance');assert.equal(advance.outgoingGap,200);
  assert.equal(advance.expectedDonation,300);assert.ok(advance.donationValue>assess({...base,bordersEnemy:true}).donationValue);
});
test('an advance short of defender strength outranks an already overwhelming attack',()=>{
  const stalled=assess({...base,outgoingCount:1,outgoingTroops:350,outgoingTargetTroops:500});
  const overwhelming=assess({...base,outgoingCount:1,outgoingTroops:2000,outgoingTargetTroops:100});
  assert.ok(stalled.donationValue>overwhelming.donationValue);
});
test('unknown attack sizes retain useful combat support and report low confidence',()=>{
  for(const fields of [{incomingCount:1,incomingKnown:false},{outgoingCount:1,outgoingKnown:false,outgoingTargetsKnown:false}]){
    const result=assess({...base,...fields});assert.ok(result.donationValue>0);
    assert.equal(result.donationConfidence,'low');assert.equal(result.hopeless,false);
  }
});
test('partial telemetry never labels a recipient hopeless',()=>{
  const result=assess({...base,incomingTroops:3000,incomingCount:2,incomingKnown:false});
  assert.equal(result.hopeless,false);assert.ok(result.donationValue>0);
});
test('donation room and donor reserve budget constrain predicted benefit',()=>{
  const result=assess({...base,troops:640,availableTroops:500,bordersEnemy:true});
  assert.equal(result.expectedDonation,10);
  assert.equal(assess({...base,availableTroops:0,incomingCount:1,incomingKnown:false}).donationValue,0);
});
