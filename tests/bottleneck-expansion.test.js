'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const createLanding=require('../src/brain/naval-landing-planner');
const adaptive=require('../src/brain/adaptive-strategy')(require('../src/brain/legacy-strategy')());
const sites=[{tile:10,dist:4,room:12,crossingSteps:2,opportunityScore:80},
 {tile:20,dist:9,room:20,crossingSteps:3,opportunityScore:95},
 {tile:30,dist:16,room:200,crossingSteps:4,entranceWidth:1,bottleneck:true,opportunityScore:179}];
function run(mode='river',reachable=true){
 const probes=[],choices=[];
 const result=createLanding().run({boatTargetTaken:()=>false},sites,{mode,probeCap:2},{allowed:()=>true,
   choose:(candidates,facts)=>{const choice=adaptive.decide({domain:'naval-landing',navalLanding:facts},candidates);choices.push({choice,candidates});return choice;},
   probe:async(_id,tile)=>{probes.push(tile);return reachable;},record:()=>{},diagnostics:()=>{}});
 return {result,probes,choices};
}
test('central river landing ranks useful pockets before spending its probe budget',async()=>{
 const f=run();assert.equal(await f.result,30);assert.deepEqual(f.probes,[30]);
 const candidate=f.choices[0].candidates.find(c=>c.tile===30);assert.equal(candidate.room,200);assert.equal(candidate.bottleneck,true);
});
test('failed river lookups still spend at most two actual probes',async()=>{
 const f=run('river',false);assert.equal(await f.result,null);assert.deepEqual(f.probes,[30,20]);
});
test('ordinary distant landing keeps nearest-first capped behavior',async()=>{
 const f=run('distant');assert.equal(await f.result,10);assert.deepEqual(f.probes,[10]);
});
