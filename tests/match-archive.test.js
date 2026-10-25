'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const create=fs.existsSync(path.join(__dirname,'../src/brain/match-archive.js'))?require('../src/brain/match-archive'):null;
const summary=require('../src/brain/match-summary');
const metadata={gameId:'game',playerId:'self'};
function fixture(){const rows=new Map();return {rows,store:{load:async id=>rows.get(id),save:async r=>rows.set(r.id,structuredClone(r)),latest:async()=>[...rows.values()].at(-1)}};}
const options=f=>({store:f.store,createSummary:summary,setInterval:()=>1,clearInterval:()=>{}});
const event=(seq,tick,tile)=>({kind:'infrastructure-change',seq,tick,structures:[{id:1,type:'City',tile,level:1}]});

test('refresh restores a match and merges events received before restore completes',async()=>{
  assert.equal(typeof create,'function');const f=fixture(),a=create(options(f));
  const first=a.start(metadata);first.observe(event(1,1,42));await first.flush();await first.close();
  const b=create(options(f)),second=b.start(metadata);second.observe(event(1,50,43));
  await second.flush();const result=await b.exportSummary();
  assert.deepEqual(result.events.map(e=>e.changed[0].tile),[42,43]);
  assert.equal(result.firstTick,1);assert.equal(result.lastTick,50);
});

test('replacing a bot flushes old events before restoring its match',async()=>{
  const f=fixture(),a=create(options(f)),first=a.start(metadata);
  first.observe(event(1,1,42));const second=a.start(metadata);second.observe(event(1,2,43));
  await second.flush();assert.equal((await a.exportSummary()).events.length,2);
});

test('failed restore cannot overwrite an existing stored match and memory exports still work',async()=>{
  let writes=0;const a=create({createSummary:summary,setInterval:()=>1,clearInterval:()=>{},
    store:{load:async()=>{throw Error('storage unavailable');},save:async()=>writes++}});
  const h=a.start(metadata);h.observe(event(1,1,42));await h.flush();
  const result=await a.exportSummary();assert.equal(result.events.length,1);assert.match(result.persistence.error,/storage unavailable/);
  assert.equal(writes,0);
});

test('another game stays separate and a saved summary exports without a running bot',async()=>{
  const f=fixture(),a=create(options(f)),first=a.start(metadata);first.observe(event(1,1,42));
  const second=a.start({...metadata,gameId:'other'});second.observe(event(1,2,99));await second.flush();
  assert.equal(f.rows.size,2);const recovered=await create(options(f)).exportSummary();
  assert.equal(recovered.metadata.gameId,'other');assert.equal(recovered.events.length,1);
});

test('restoring after buildings were lost records the loss and does not resurrect old structures',async()=>{
  const f=fixture(),a=create(options(f)),first=a.start(metadata);first.observe(event(1,1,42));await first.close();
  const b=create(options(f)),second=b.start(metadata);
  second.observe({kind:'infrastructure-change',seq:1,tick:50,structures:[]});await second.flush();
  const result=await b.exportSummary();assert.equal(result.finalStructures.length,0);
  assert.equal(result.events.at(-1).removed[0].tile,42);
});

test('refresh without building changes does not duplicate the infrastructure event',async()=>{
  const f=fixture(),a=create(options(f)),first=a.start(metadata);first.observe(event(1,1,42));await first.close();
  const b=create(options(f)),second=b.start(metadata);second.observe(event(1,50,42));
  const result=await second.export();assert.equal(result.events.length,1);
});

test('unsupported saved schemas are reported and never overwritten',async()=>{
  const f=fixture();const id=JSON.stringify(['game','self']);
  f.rows.set(id,{id,summary:{schemaVersion:2,type:'openfront-match-summary',metadata,events:[{kind:'command',action:'old'}]}});
  const a=create(options(f)),h=a.start(metadata);h.observe(event(1,1,42));
  const result=await h.export();assert.ok(result.persistence.error);assert.equal(result.persistence.restored,false);
  assert.equal(f.rows.get(id).summary.schemaVersion,2);
});

test('late player identity enables autosave without losing the beginning of the match',async()=>{
  const f=fixture(),a=create(options(f));let identity={gameId:'game',playerId:null};
  const h=a.start(identity,()=>identity);h.observe(event(1,6,42));await h.flush();assert.equal(f.rows.size,0);
  identity={gameId:'game',playerId:'self'};h.observe(event(2,200,43));await h.flush();
  const result=await h.export();assert.equal(result.metadata.playerId,'self');assert.equal(result.persistence.storage,'indexeddb');
  assert.equal(result.persistence.error,null);assert.equal(result.firstTick,6);assert.equal(result.events.length,2);
  const restored=await create(options(f)).exportSummary();assert.equal(restored.events.length,2);
});

test('late identity restores the existing match before concurrent flushes can save',async()=>{
  const f=fixture(),a=create(options(f)),first=a.start(metadata);first.observe(event(1,1,42));await first.close();
  let identity={gameId:'game',playerId:null};const b=create(options(f)),h=b.start(identity,()=>identity);
  h.observe(event(1,50,43));identity=metadata;await Promise.all([h.flush(),h.flush()]);
  const result=await b.exportSummary();assert.equal(result.persistence.restored,true);assert.equal(result.events.length,2);
});

test('late identity cannot merge a different game or overwrite an unsupported saved format',async()=>{
  for(const otherGame of [true,false]){
    const f=fixture(),id=JSON.stringify(['game','self']);
    f.rows.set(id,{id,summary:{schemaVersion:2,type:'openfront-match-summary',metadata,events:[]}});
    const a=create(options(f)),h=a.start({gameId:'game',playerId:null},()=>({...metadata,gameId:otherGame?'other':'game'}));
    h.observe(event(1,6,42));const result=await h.export();
    assert.ok(result.persistence.error);assert.equal(f.rows.size,1);assert.equal(f.rows.get(id).summary.schemaVersion,2);
  }
});
