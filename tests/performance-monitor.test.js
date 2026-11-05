'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/ui/performance-monitor');
test('disabled profiling has no clock work and preserves command results',()=>{
 let reads=0;const monitor=create({now:()=>++reads}),result=Promise.resolve(true);
 assert.equal(monitor.measure('work',()=>result),result);assert.equal(reads,0);assert.deepEqual(monitor.report().metrics,[]);
});
test('timings aggregate with bounded names, including throws, without changing exceptions',()=>{
 let clock=0;const monitor=create({now:()=>clock,maxMetrics:2});monitor.start();
 monitor.measure('scan',()=>{clock+=3;});monitor.measure('scan',()=>{clock+=5;});
 const error=Error('original');assert.throws(()=>monitor.measure('command',()=>{clock+=2;throw error;}),e=>e===error);
 monitor.measure('extra',()=>{clock++;});const report=monitor.stop();
 assert.equal(report.metrics.length,2);assert.deepEqual(report.metrics[0],{name:'scan',calls:2,totalMs:8,maxMs:5,averageMs:4});
 assert.equal(monitor.active(),false);
});
test('a broken profiling clock cannot interrupt execution',()=>{
 const monitor=create({now:()=>{throw Error('clock');}});monitor.start();
 assert.equal(monitor.measure('work',()=>42),42);assert.deepEqual(monitor.report().metrics,[]);
});
