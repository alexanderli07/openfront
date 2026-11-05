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

function patchFixture(){
  const rows=new Map(),writes=[];let fail=false;
  const store={
    load:async id=>structuredClone(rows.get(id)), latest:async()=>structuredClone([...rows.values()].at(-1)),
    savePatch:async patch=>{
      writes.push(structuredClone(patch));if(fail)throw Error('disk full');
      const previous=rows.get(patch.id)?.summary||{events:[],holds:[],plans:[]};
      const next={...patch.header};
      for(const table of ['events','holds','plans']){
        const key=table==='events'?'id':'key', merged=new Map(previous[table].map(r=>[r[key],r]));
        for(const row of patch[table])merged.set(row[key],row);
        next[table]=[...merged.values()];
      }
      rows.set(patch.id,{id:patch.id,updatedAt:patch.updatedAt,storageVersion:2,summary:structuredClone(next)});
    }
  };
  return {rows,writes,store,setFail:value=>{fail=value;}};
}

test('long-match periodic patches write only new events and changed aggregates',async()=>{
  const f=patchFixture(),a=create(options(f)),h=a.start(metadata);
  for(let i=1;i<=1000;i++){h.observe({kind:'build-delay',seq:i,tick:i,type:'City'});if(i%10===0)await h.flush();}
  assert.equal(f.writes.length,100);
  assert.equal(f.writes.reduce((n,p)=>n+p.events.length,0),1000);
  assert.ok(f.writes.every(p=>p.events.length===10&&!p.header.events));
  assert.equal((await create(options(f)).exportSummary()).events.length,1000);
});

test('patch retries preserve errors, updates and observations during an in-flight save',async()=>{
  const f=patchFixture(),a=create(options(f)),h=a.start(metadata);
  h.observe({kind:'rule-result',seq:1,tick:1,error:'failed'});await h.flush();
  f.setFail(true);h.observe({kind:'rule-result',seq:2,tick:2,error:'failed'});await h.flush();
  h.observe({kind:'build-delay',seq:3,tick:3});f.setFail(false);
  await Promise.all([h.flush(),h.flush()]);
  const result=await create(options(f)).exportSummary();
  assert.equal(result.events.find(e=>e.kind==='error').count,2);
  assert.equal(result.events.filter(e=>e.kind==='build-delay').length,1);
  assert.equal(result.counts['rule-result'],2);
});

test('IndexedDB adapter migrates v1 rows and preserves updated error order in atomic patches',async()=>{
  const indexedDB=require('./memory-indexeddb-fixture')();
  const store=create.createIndexedMatchStore(indexedDB);
  const seed=summary({metadata,segment:'old'});seed.observe({kind:'build-delay',seq:1,tick:1});
  await store.save({id:JSON.stringify(['game','self']),updatedAt:1,summary:seed.export()});
  const a=create({...options({store}),indexedDB}),h=a.start(metadata);
  h.observe({kind:'rule-result',seq:1,tick:2,error:'failed'});await h.flush();
  const before=indexedDB.puts;
  h.observe({kind:'build-delay',seq:2,tick:3});h.observe({kind:'rule-result',seq:3,tick:4,error:'failed'});await h.flush();
  assert.equal(indexedDB.puts-before,3); // changed error, new event, fixed-size manifest
  const recovered=await create(options({store})).exportSummary();
  assert.deepEqual(recovered.events.map(e=>e.kind),['build-delay','error','build-delay']);
  assert.equal(recovered.events[1].count,2);
  assert.equal(indexedDB.tables.get('matches').values().next().value.storageVersion,2);
  const storedBefore=structuredClone(await store.latest());
  indexedDB.failWrite();h.observe({kind:'build-delay',seq:4,tick:5});await h.flush();
  assert.deepEqual(await store.latest(),storedBefore);
  await h.flush();assert.equal((await store.latest()).summary.events.length,4);
});

test('queued flushes capture arrivals during a save without overlapping or overwriting newer state',async()=>{
  const f=patchFixture();let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  const save=f.store.savePatch;let active=0,maxActive=0,calls=0;
  f.store.savePatch=async patch=>{active++;maxActive=Math.max(maxActive,active);if(calls++===0){entered();await gate;}await save(patch);active--;};
  const h=create(options(f)).start(metadata);h.observe({kind:'build-delay',seq:1,tick:1});
  const first=h.flush();await started;h.observe({kind:'build-delay',seq:2,tick:2});
  const second=h.flush();release();await Promise.all([first,second]);
  assert.equal(maxActive,1);assert.equal(f.writes.length,2);
  const restored=create(options(f)).start(metadata);restored.observe({kind:'build-delay',seq:1,tick:3});
  const result=await restored.export();assert.equal(result.events.length,3);assert.equal(result.counts['build-delay'],3);
});

test('checkpoint reload writes only new rows and merges pre-restore error and hold updates',async()=>{
  const f=patchFixture(),h=create(options(f)).start(metadata);
  const hold=(seq,tick)=>({kind:'command-operational-hold',seq,tick,reason:'Wait'});
  h.observe({kind:'rule-result',seq:1,tick:1,error:'failed'});h.observe(hold(2,1));
  for(let i=3;i<103;i++)h.observe({kind:'build-delay',seq:i,tick:i});await h.flush();
  const second=create(options(f)).start(metadata);
  second.observe({kind:'rule-result',seq:1,tick:200,error:'failed'});second.observe(hold(2,200));
  await second.flush();const patch=f.writes.at(-1);
  assert.equal(patch.events.length,1);assert.equal(patch.events[0].count,2);
  assert.equal(patch.holds.length,1);assert.equal(patch.holds[0].count,2);
  const result=await create(options(f)).exportSummary();assert.equal(result.events.length,101);
  assert.equal(result.events[0].count,2);assert.equal(result.holds[0].count,2);
});

test('failed IndexedDB opens can retry and close late successful connections',async()=>{
  const backend=require('./memory-indexeddb-fixture')();let firstRequest,opens=0,closed=0;
  const indexedDB={open(){opens++;if(opens===1){firstRequest={error:Error('open failed')};setImmediate(()=>firstRequest.onerror());return firstRequest;}return backend.open();}};
  const store=create.createIndexedMatchStore(indexedDB);
  await assert.rejects(store.load('missing'),/open failed/);
  assert.equal(await store.latest(),undefined);assert.equal(opens,2);
  firstRequest.result={close(){closed++;}};firstRequest.onsuccess();
  assert.equal(closed,1);
});

test('versionchange closes the cached connection and the next operation reopens',async()=>{
  const backend=require('./memory-indexeddb-fixture')();let opens=0,lastRequest,closed=0;
  const indexedDB={open(){opens++;const request=backend.open();lastRequest=request;return request;}};
  const store=create.createIndexedMatchStore(indexedDB);await store.latest();
  lastRequest.result.close=()=>{closed++;};
  assert.equal(typeof lastRequest.result.onversionchange,'function');lastRequest.result.onversionchange();
  assert.equal(closed,1);await store.latest();assert.equal(opens,2);
});


test('an active recorder waits through a blocked upgrade, then restores and saves all history',async()=>{
  const backend=require('./memory-indexeddb-fixture')();
  const originalStore=create.createIndexedMatchStore(backend);
  const saved=summary({metadata,segment:'before'});saved.observe({kind:'build-delay',seq:1,tick:1});
  const id=JSON.stringify(['game','self']);await originalStore.save({id,updatedAt:1,summary:saved.export()});
  let release,blocked;
  const blockedEvent=new Promise(resolve=>{blocked=resolve;});
  const indexedDB={open(){
    const request={};
    setImmediate(()=>{request.onblocked();blocked();});
    release=()=>{
      const next=backend.open();
      next.onupgradeneeded=()=>{request.result=next.result;request.onupgradeneeded?.();};
      next.onsuccess=()=>{request.result=next.result;request.onsuccess();};
      next.onerror=()=>{request.error=next.error;request.onerror();};
    };
    return request;
  }};
  const archive=create({indexedDB,createSummary:summary,setInterval:()=>1,clearInterval:()=>{}});
  const recorder=archive.start(metadata);recorder.observe({kind:'build-delay',seq:1,tick:2});
  let finished=false;const flushing=recorder.flush().then(()=>{finished=true;});
  await blockedEvent;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);release();await flushing;
  const result=await recorder.export();
  assert.equal(result.persistence.restored,true);assert.equal(result.persistence.error,null);
  assert.deepEqual(result.events.map(e=>e.tick),[1,2]);
  const persisted=await originalStore.load(id);assert.deepEqual(persisted.summary.events.map(e=>e.tick),[1,2]);
});
