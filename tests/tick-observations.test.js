'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/brain/tick-observations');
test('unit summaries are scanned once per tick across many decisions and rebuilt on rewind',()=>{
 const cache=create();let tick=1,reads=0;
 const game={ticks:()=>tick},player={units:()=>{reads++;return [{type:()=> 'Port',level:()=>2,isUnderConstruction:()=>false}];}};
 for(let i=0;i<100;i++)assert.equal(cache.units(game,player).counts.Port.levels,2);
 assert.equal(reads,1);tick=2;cache.units(game,player);tick=1;cache.units(game,player);assert.equal(reads,3);
 assert.deepEqual(cache.diagnostics(),{hits:99,scans:3,invalidations:0});
});
test('command invalidation, changing players/games and immutable summaries prevent stale counts',()=>{
 const cache=create(),game={ticks:()=>1};let level=1;
 const player={units:()=>[{type:()=> 'City',level:()=>level,isUnderConstruction:()=>false}]};
 const first=cache.units(game,player);level=2;cache.invalidate(game,player);
 assert.equal(cache.units(game,player).counts.City.levels,2);assert.equal(first.counts.City.levels,1);
 assert.throws(()=>{first.counts.City.levels=9;},TypeError);
 assert.equal(cache.units({ticks:()=>1},player).counts.City.levels,2);
 assert.equal(cache.units(game,{units:()=>[]}).counts.City,undefined);
});
