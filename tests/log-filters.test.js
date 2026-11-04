'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildSource}=require('../scripts/build');
test('category buttons toggle back to all and keep one selected filter at most',()=>{
 const source=buildSource().source,start=source.indexOf('n.querySelectorAll(".ab-chip[data-filter]").forEach(f=>{');
 const end=source.indexOf(';makeDraggable(',start);assert.ok(start>=0&&end>start);
 const nodes=['spawn','combat','naval','build','nuke','diplo'].map(filter=>({dataset:{filter},on:false,
   addEventListener(_event,fn){this.click=fn;},classList:{}}));
 for(const node of nodes)node.classList.toggle=(_name,on)=>node.on=on;
 const state={logFilter:'all'};let renders=0;
 vm.runInNewContext(source.slice(start,end),{n:{querySelectorAll:()=>nodes},state,renderLog:()=>renders++});
 nodes[0].click();assert.equal(state.logFilter,'spawn');assert.equal(nodes.filter(n=>n.on).length,1);
 nodes[0].click();assert.equal(state.logFilter,'all');assert.equal(nodes.filter(n=>n.on).length,0);
 nodes[0].click();nodes[1].click();assert.equal(state.logFilter,'combat');assert.equal(nodes.filter(n=>n.on).length,1);
 assert.equal(renders,4);
});
test('log filter layout contains categories without a separate All button',()=>{
 assert.ok(!buildSource().source.includes('data-filter="all"'));
});
