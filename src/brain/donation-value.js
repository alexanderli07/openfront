'use strict';
// Troop pressure is a ranking estimate, not a combat simulation. In particular,
// outbound armies have already left the recipient's troop balance.
function assessDonationValue(input) {
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const number=value=>finite(value)?value:0;
  const troops=number(input.troops),capacity=number(input.capacity);
  const room=Math.max(0,capacity*Math.max(0,Math.min(.65,number(input.fillLimit??.65)))-troops);
  const expectedDonation=Math.floor(Math.min(room,number(input.availableTroops)));
  const incomingTroops=number(input.incomingTroops),outgoingTroops=number(input.outgoingTroops);
  const incomingKnown=input.incomingKnown===true,outgoingKnown=input.outgoingKnown===true;
  const incomingCount=number(input.incomingCount),outgoingCount=number(input.outgoingCount);
  const defenseGap=Math.max(0,incomingTroops*11/10-troops);
  const outgoingGap=Math.max(0,number(input.outgoingTargetTroops)*11/10-outgoingTroops);
  const canHoldAfterDonation=incomingKnown&&incomingTroops>0&&troops+expectedDonation>=incomingTroops*11/10;
  // Require a large, fully observed mismatch before calling an ally hopeless.
  // Unknown sizes or truncated lists must never become evidence of futility.
  const hopeless=incomingKnown&&incomingCount>0&&incomingTroops>2*(troops+expectedDonation);
  let donationRole='idle',donationValue=0;
  if(incomingCount>0){
    donationRole='defense';
    donationValue=hopeless?0:!incomingKnown?70:canHoldAfterDonation&&defenseGap>0?
      110+40*Math.min(1,expectedDonation/Math.max(defenseGap,1)):
      defenseGap>0?65+25*Math.min(1,expectedDonation/defenseGap):25;
  }else if(outgoingCount>0){
    donationRole='advance';
    donationValue=outgoingKnown&&input.outgoingTargetsKnown===true?
      outgoingGap>0?40+25*Math.min(1,expectedDonation/outgoingGap):30:45;
  }else if(input.bordersEnemy===true){donationRole='frontline-support';donationValue=20;}
  if(!expectedDonation)donationValue=0;
  const donationConfidence=!finite(input.troops)||!finite(input.capacity)||!incomingKnown||!outgoingKnown||
    (outgoingCount>0&&input.outgoingTargetsKnown!==true)?'low':incomingCount>0||outgoingCount>0?'medium':'low';
  return {donationValue,donationRole,donationConfidence,expectedDonation,incomingTroops,outgoingTroops,
    incomingCount,outgoingCount,incomingKnown,outgoingKnown,outgoingTargetTroops:number(input.outgoingTargetTroops),
    defenseGap,outgoingGap,canHoldAfterDonation,hopeless};
}
if(typeof module!=='undefined'&&module.exports)module.exports=assessDonationValue;
