'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const adaptive=require('../src/brain/adaptive-strategy')(require('../src/brain/legacy-strategy')());
const posture={ready:true,conserve:false},opening={borderKnown:true,frontline:false,wilderness:false};
test('safe rear sends 1 percent probes before a large beachhead reinforcement',()=>{
 const r=adaptive.decide({domain:'naval-action',teamOpening:opening,supportPosture:posture},[
  {id:'naval:surge',kind:'naval-action',eligible:true,priority:0},{id:'naval:enemy-probe',kind:'naval-action',eligible:true,priority:7}]);
 assert.equal(r.selectedId,'naval:enemy-probe');
});
test('safe rear donation runs before potentially slow opportunistic boat searches',()=>{
 const r=adaptive.decide({domain:'attack-sequence',teamOpening:opening,supportPosture:posture},[
  {id:'sequence:opportunistic-boat',kind:'attack-sequence',eligible:true,priority:2},
  {id:'sequence:donation',kind:'attack-sequence',eligible:true,priority:3}]);
 assert.equal(r.selectedId,'sequence:donation');
});

test('a remote-colony frontline does not suppress enemy probes when home remains safe',()=>{
 const r=adaptive.decide({domain:'naval-action',teamOpening:{...opening,frontline:true},supportPosture:posture},[
  {id:'naval:surge',kind:'naval-action',eligible:true,priority:0},
  {id:'naval:enemy-probe',kind:'naval-action',eligible:true,priority:7,adaptiveOnly:true}]);
 assert.equal(r.selectedId,'naval:enemy-probe');
});
