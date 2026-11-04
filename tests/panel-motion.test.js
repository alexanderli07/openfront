'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/ui/panel-motion');
function fixture(reduced=false){
 const animations=[],events=[];
 const node={animate(frames,options){let resolve,reject;const finished=new Promise((a,b)=>{resolve=a;reject=b;});
   const animation={finished,resolve,cancel:()=>reject(Error('cancelled'))};animations.push(animation);return animation;}};
 return {motion:create({reduced:()=>reduced}),node,animations,events};
}
test('opening applies immediately and closing waits for the exit animation',async()=>{
 const f=fixture();f.motion.disclose(f.node,true,()=>f.events.push('open'));assert.deepEqual(f.events,['open']);
 f.motion.disclose(f.node,false,()=>f.events.push('close'));assert.deepEqual(f.events,['open']);
 f.animations[1].resolve();await Promise.resolve();assert.deepEqual(f.events,['open','close']);
});
test('reopening cancels a pending close without later hiding the section',async()=>{
 const f=fixture();f.motion.disclose(f.node,false,()=>f.events.push('close'));
 f.motion.disclose(f.node,true,()=>f.events.push('open'));await Promise.resolve();
 assert.deepEqual(f.events,['open']);f.animations[1].resolve();await Promise.resolve();assert.deepEqual(f.events,['open']);
});
test('reduced motion and missing animation support perform changes immediately',()=>{
 const f=fixture(true);f.motion.disclose(f.node,false,()=>f.events.push('close'));
 assert.deepEqual(f.events,['close']);assert.equal(f.animations.length,0);
 f.motion.disclose({},true,()=>f.events.push('open'));assert.deepEqual(f.events,['close','open']);
});
