'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),create=require('../src/brain/spending-ledger');
test('concurrent purchases cannot spend the same surplus twice',()=>{
 const ledger=create(),r={tick:1,gold:4000000n,cost:1000000n,reserve:3000000n,key:'port1'};
 assert.equal(ledger.commit(r,()=>true),true);
 assert.equal(ledger.facts({...r,key:'port2'}).allowed,false);
 assert.equal(ledger.facts({...r,tick:2,gold:3000000n,key:'port2'}).allowed,false);
 assert.equal(ledger.facts({...r,tick:3,key:'port2'}).allowed,true);
});
test('reactive defense can spend its reserve but not funds promised to other purchases',()=>{
 const ledger=create(),r={tick:1,gold:4000000n,cost:1000000n,reserve:3000000n,key:'port'};
 ledger.commit(r,()=>true);
 assert.equal(ledger.facts({...r,cost:3000000n,reserve:0n,key:'sam'}).allowed,true);
 assert.equal(ledger.facts({...r,cost:3100000n,reserve:0n,key:'sam'}).allowed,false);
});
test('false and throwing purchases immediately release commitments',()=>{
 const ledger=create(),r={tick:1,gold:100n,cost:100n,key:'x'};
 assert.equal(ledger.commit(r,()=>false),false);assert.throws(()=>ledger.commit(r,()=>{throw Error('fail');}));
 assert.equal(ledger.facts(r).allowed,true);
});
