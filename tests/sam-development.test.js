'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/sam-development');
function fixture(){
 const model=create();const sam={id:1,tile:0,level:1,queue:[],active:true,building:false,own:true};
 const observation={tick:100,sams:[sam],structures:[{id:10,tile:50,type:'Port'}],threats:[]};
 const options={economy:{stage:'reserve',reserve:3000000n},range:l=>150-480/(l+5),distanceSquared:(a,b)=>(a-b)**2};
 return {model,sam,observation,options,assess:()=>model.assess(observation,options)};
}
test('mature economy prepares level two and saves a bounded next-upgrade budget',()=>{
 const f=fixture(),r=f.assess();assert.equal(r.candidates[0].targetLevel,2);assert.equal(r.savings,3000000n);
});
test('shared economy assessment prepares later levels before a salvo occurs',()=>{
 const f=fixture();f.sam.level=2;f.options.economy.development={samTargetLevel:3,income:6,cities:5};
 const r=f.assess();assert.equal(r.candidates[0].targetLevel,3);assert.equal(r.savings,3000000n);
 assert.equal(r.candidates[0].reason,'economic-development');
});
test('completed-building assessment can defer level two while economy is still building',()=>{
 const f=fixture();f.options.economy.development={samTargetLevel:1};assert.equal(f.assess().candidates.length,0);
});
test('opening economy and replacement construction retain their original purchase order',()=>{
 for(const stage of ['initial-economy','first-sam','development']){
  const f=fixture();f.options.economy.stage=stage;assert.deepEqual(f.assess().candidates,[]);assert.equal(f.assess().savings,0n);
 }
});
test('exposed buildings do not trigger extra levels or hold upgrade savings',()=>{
 const f=fixture();f.observation.structures.push({id:11,tile:95,type:'City'});
 assert.equal(f.assess().candidates[0].targetLevel,2);
 f.sam.level=2;assert.equal(f.assess().candidates.length,0);assert.equal(f.assess().savings,0n);
});
test('allied geometry counts and unreachable buildings do not cause endless upgrades',()=>{
 const f=fixture();f.sam.level=2;f.observation.structures.push({id:11,tile:100,type:'City'},{id:12,tile:1000,type:'City'});
 f.observation.sams.push({...f.sam,id:2,tile:100,own:false});assert.equal(f.assess().candidates.length,0);
});
test('observed triple salvo raises preparation to three slots and survives the end of flight',()=>{
 const f=fixture();f.sam.level=2;f.observation.threats=[1,2,3].map(id=>({id,threatensSelf:true}));
 assert.equal(f.assess().candidates[0].targetLevel,3);
 f.observation.threats=[];f.observation.tick=110;assert.equal(f.assess().candidates[0].targetLevel,3);
 f.observation.tick=1901;assert.equal(f.assess().candidates.length,0);
});
test('salvo preparation is bounded, and unrelated strikes do not raise the capacity target',()=>{
 const f=fixture();f.observation.threats=Array.from({length:30},(_,id)=>({id,threatensSelf:true}));
 assert.equal(f.assess().candidates[0].targetLevel,8);
 const g=fixture();g.sam.level=2;g.observation.threats=[{id:1,threatensSelf:false}];assert.equal(g.assess().candidates.length,0);
});
test('unknown queue or active range ramp holds a planned purchase without releasing savings',()=>{
 for(const patch of [{queue:null},{level:2,upgradeStartTick:90,upgradeDuration:45}]){
  const f=fixture();Object.assign(f.sam,patch);
  if(patch.level)f.observation.threats=[1,2,3].map(id=>({id,threatensSelf:true}));
  const r=f.assess();assert.equal(r.candidates.length,0);assert.equal(r.savings,3000000n);
 }
});
test('manual upgrades satisfy the target and tick rewind clears salvo memory',()=>{
 const f=fixture();f.observation.threats=[1,2,3].map(id=>({id,threatensSelf:true}));f.assess();
 f.sam.level=3;assert.equal(f.assess().candidates.length,0);
 f.sam.level=2;f.observation.tick=1;f.observation.threats=[];assert.equal(f.assess().candidates.length,0);
});
