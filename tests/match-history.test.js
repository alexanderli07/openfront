'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const summaryPath='../src/brain/match-summary';
const fs=require('node:fs');
const createSummary=fs.existsSync(require('node:path').join(__dirname,summaryPath+'.js'))?require(summaryPath):null;

test('compact history retains early actions through full-game getter noise',()=>{
  assert.equal(typeof createSummary,'function');
  const h=createSummary({metadata:{gameId:'game',playerId:'self'},segment:'a'});
  h.observe({kind:'decision',seq:1,decisionId:1,snapshot:{tick:10,self:{gold:'100',troops:1000,tiles:20}},
    selectedId:'build',reason:'Protect ports',candidates:[{id:'build',kind:'build',arguments:['SAM Launcher',42]}]});
  h.observe({kind:'dispatch',seq:2,decisionId:1,tick:10,status:'submitted'});
  for(let i=0;i<50000;i++)h.observe({kind:'rule-result',seq:i+3,tick:11+i,rule:'getPerceivedCost',result:'100'});
  const result=h.export();
  assert.equal(result.events.length,1);assert.equal(result.events[0].action,'build');
  assert.equal(result.events[0].reason,'Protect ports');
  assert.ok(JSON.stringify(result).length<2000);
});

test('repeated holds aggregate count and duration without copying candidates',()=>{
  const h=createSummary({segment:'a'});
  for(let i=1;i<=1000;i++)h.observe({kind:'decision',seq:i,decisionId:i,snapshot:{tick:i,domain:'structure-plan'},
    selectedId:'$wait',reason:'Save for SAM',candidates:[{id:'$wait',kind:'wait'}]});
  const result=h.export();assert.equal(result.holds.length,1);
  assert.equal(result.holds[0].count,1000);assert.equal(result.holds[0].firstTick,1);assert.equal(result.holds[0].lastTick,1000);
  assert.equal(result.events.length,1);assert.ok(!JSON.stringify(result).includes('"candidates":'));
});

test('infrastructure changes preserve locations as deltas and repeated errors are compact',()=>{
  const h=createSummary({segment:'a'});
  h.observe({kind:'infrastructure-change',seq:1,tick:1,structures:[{id:1,type:'City',tile:42,level:1,building:true}]});
  h.observe({kind:'infrastructure-change',seq:2,tick:2,structures:[{id:1,type:'City',tile:42,level:2,building:false}]});
  h.observe({kind:'infrastructure-change',seq:3,tick:3,structures:[]});
  for(let i=0;i<1000;i++)h.observe({kind:'rule-result',seq:4+i,tick:4+i,error:'API missing',module:'build',rule:'cost'});
  const result=h.export();assert.equal(result.events.length,4);
  assert.equal(result.events[2].removed[0].tile,42);assert.equal(result.events[3].count,1000);
});

test('failed command summaries retain their action, arguments and outcome',()=>{
  const h=createSummary({segment:'failed'});
  h.observe({kind:'decision',seq:1,decisionId:1,snapshot:{tick:1},selectedId:'city',reason:'Build city',
    candidates:[{id:'city',kind:'build',arguments:['City',42]}]});
  h.observe({kind:'dispatch',seq:2,decisionId:1,tick:1,status:'threw',error:'denied'});
  const result=h.export();assert.equal(result.events[0].kind,'command');assert.equal(result.events[0].action,'build');
  assert.equal(result.events[0].status,'threw');assert.equal(result.events[0].error,'denied');
  assert.deepEqual(result.events[0].arguments,['City',42]);
});

test('SAM preparation preserves its mode and target while repeated saving checks stay compact',()=>{
 const h=createSummary({segment:'sam'});
 for(let tick=1;tick<=1000;tick++)h.observe({kind:'reactive-sam-result',seq:tick,tick,status:'held',
  reason:'Save for SAM preparation',assessments:[{unitId:1,mode:'planned',targetLevel:3,reason:'salvo-capacity'}]});
 h.observe({kind:'reactive-sam-result',seq:1001,tick:1001,status:'selected',reason:'Prepare SAM to level 3',
  assessments:[{unitId:1,mode:'planned',targetLevel:3,reason:'salvo-capacity',protectedReserve:'3000000'}]});
 const r=h.export();assert.equal(r.holds.length,1);assert.equal(r.holds[0].count,1000);
 assert.equal(r.events.length,1);assert.equal(r.events[0].kind,'sam-defense');
 assert.equal(r.events[0].assessments[0].targetLevel,3);assert.equal(r.events[0].assessments[0].mode,'planned');
});

test('compact history keeps submitted crossings and confirmed river landings',()=>{
 const h=createSummary({segment:'river'});
 h.observe({kind:'wilderness-crossing-result',seq:1,tick:100,status:'submitted',tile:42,crossingSteps:3,room:64});
 h.observe({kind:'wilderness-crossing-result',seq:2,tick:105,status:'landed',tile:42,reason:'Resume land expansion'});
 const r=h.export();assert.equal(r.events.length,2);
 assert.deepEqual(r.events.map(e=>e.status),['submitted','landed']);assert.equal(r.events[0].crossingSteps,3);
});
