'use strict';

function createIndexedMatchStore(indexedDB) {
  let database;
  function open(){
    if(database)return database;
    let rejected=false;
    const attempt=new Promise((resolve,reject)=>{
      const fail=error=>{rejected=true;reject(error);};
      if(!indexedDB){fail(Error('IndexedDB unavailable; history is memory-only'));return;}
      const request=indexedDB.open('openfront-helper-match-history',2);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('matches')){
          const store=db.createObjectStore('matches',{keyPath:'id'});
          store.createIndex('updatedAt','updatedAt');
        }
        if(!db.objectStoreNames.contains('summaryRows')){
          const store=db.createObjectStore('summaryRows',{keyPath:['matchId','table','key']});
          store.createIndex('matchId','matchId');
        }
      };
      request.onsuccess=()=>{
        const db=request.result;
        // A failed request must not leak a connection if a late success is
        // delivered. Temporary upgrade blocking keeps this request pending.
        if(rejected){db.close();return;}
        db.onversionchange=()=>{db.close();if(database===attempt)database=null;};
        resolve(db);
      };
      request.onerror=()=>fail(request.error||Error('Cannot open match history'));
      // Another tab may hold the old schema open. Keep the restore pending so
      // this recorder merges saved history before any write when it unblocks.
      request.onblocked=()=>{};
    }).catch(error=>{if(database===attempt)database=null;throw error;});
    database=attempt;return attempt;
  }
  async function transaction(mode,run){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(['matches','summaryRows'],mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Match-history transaction failed'));
      try{run(tx.objectStore('matches'),tx.objectStore('summaryRows'),value=>{result=value;});}
      catch(error){tx.abort();reject(error);}
    });
  }
  function materialize(row,parts,done){
    if(!row||row.storageVersion!==2){done(row);return;}
    const tables={events:[],holds:[],plans:[]};
    const request=parts.index('matchId').openCursor(row.id);
    request.onsuccess=()=>{
      const cursor=request.result;
      if(cursor){const part=cursor.value;if(tables[part.table])tables[part.table].push(part);cursor.continue();}
      else{
        const summary={...row.header};
        for(const table of Object.keys(tables))summary[table]=tables[table].sort((a,b)=>a.position-b.position).map(part=>part.row);
        done({id:row.id,updatedAt:row.updatedAt,storageVersion:2,summary});
      }
    };
  }
  return {
    load:id=>transaction('readonly',(store,parts,done)=>{const r=store.get(id);r.onsuccess=()=>materialize(r.result,parts,done);}),
    save:row=>transaction('readwrite',store=>store.put(row)),
    savePatch:patch=>transaction('readwrite',(store,parts)=>{
      const request=store.get(patch.id);
      request.onsuccess=()=>{
        const prior=request.result;
        const positions={events:0,holds:0,plans:0,...prior?.positions};
        const manifest={id:patch.id,updatedAt:patch.updatedAt,storageVersion:2,header:patch.header,positions};
        // Each changed aggregate replaces a single durable row. New rows receive
        // an insertion position so errors can be updated without reordering history.
        let remaining=patch.events.length+patch.holds.length+patch.plans.length;
        if(!remaining)store.put(manifest);
        for(const table of ['events','holds','plans'])for(const row of patch[table]){
          const key=table==='events'?row.id:row.key;
          const lookup=parts.get([patch.id,table,key]);
          lookup.onsuccess=()=>{
            parts.put({matchId:patch.id,table,key,position:lookup.result?.position??positions[table]++,row});
            if(--remaining===0)store.put(manifest);
          };
        }
      };
    }),
    latest:()=>transaction('readonly',(store,parts,done)=>{const r=store.index('updatedAt').openCursor(null,'prev');r.onsuccess=()=>materialize(r.result?.value,parts,done);})
  };
}

function createMatchArchive(options) {
  const store=options.store||createIndexedMatchStore(options.indexedDB);
  const schedule=options.setInterval||setInterval,cancel=options.clearInterval||clearInterval;
  let tail=Promise.resolve(),active=null;
  function serial(run){const next=tail.then(run);tail=next.catch(()=>{});return next;}
  function start(metadata,resolveIdentity){
    metadata={...metadata};
    const previous=active,h=options.createSummary({metadata});
    let id=metadata.gameId&&metadata.playerId?JSON.stringify([metadata.gameId,metadata.playerId]):null;
    let dirty=false,revision=0,closed=false,timer,loadFailed=false,identityPromise=null,pendingPatch=null,flushTail=Promise.resolve();
    const status={storage:id?'indexeddb':'memory',restored:false,lastSavedAt:null,error:id?null:'Game/player identity unavailable; memory-only session'};
    const fail=error=>{
      const message=String(error?.message||error).slice(0,400);
      if(status.error!==message)try{options.onError?.(message);}catch{}
      status.error=message;
    };
    async function restoreSaved(){
      if(id){const row=await serial(()=>store.load(id));if(row){
          if(row.summary?.schemaVersion!==1||row.summary.type!=='openfront-match-summary'||!Array.isArray(row.summary.events)||
              row.summary.metadata?.gameId!==metadata.gameId||row.summary.metadata?.playerId!==metadata.playerId)
            throw Error('Saved match identity or format is invalid; not overwriting it');
          h.restore(row.summary,{checkpointed:row.storageVersion===2});status.restored=true;
      }}
    }
    const ready=(async()=>{
      try{
        if(previous)await previous.close();
        await restoreSaved();
      }catch(error){loadFailed=true;fail(error);}
    })();
    async function ensureIdentity(){
      if(identityPromise)return identityPromise;
      if(id||!resolveIdentity)return;
      identityPromise=(async()=>{
        try{
          const identity=resolveIdentity();if(!identity?.gameId||!identity.playerId)return;
          h.identify(identity);metadata={...metadata,gameId:identity.gameId,playerId:identity.playerId};
          id=JSON.stringify([metadata.gameId,metadata.playerId]);status.storage='indexeddb';
          await restoreSaved();status.error=null;dirty=true;revision++;
        }catch(error){if(id)loadFailed=true;fail(error);}
      })();
      try{await identityPromise;}finally{identityPromise=null;}
    }
    async function saveChanges(){
      await ready;await ensureIdentity();if(!id||loadFailed||!dirty)return;
      const version=revision,updatedAt=Date.now();
      try{
        if(store.savePatch&&h.takeChanges){
          const changes=options.performance?.active()?options.performance.measure('history.checkpoint',()=>h.takeChanges()):h.takeChanges();
          if(pendingPatch)for(const table of ['events','holds','plans']){
            const key=table==='events'?'id':'key';
            changes[table]=[...new Map([...pendingPatch[table],...changes[table]].map(row=>[row[key],row])).values()];
          }
          pendingPatch={id,updatedAt,...changes};
          await serial(()=>store.savePatch(pendingPatch));pendingPatch=null;
        }else{
          const summary=h.export();await serial(()=>store.save({id,updatedAt,summary}));
        }
        status.lastSavedAt=updatedAt;status.error=null;if(revision===version)dirty=false;
      }catch(error){fail(error);}
    }
    function flush(){
      const next=flushTail.then(saveChanges);flushTail=next.catch(()=>{});return next;
    }
    const recorder={
      observe:e=>{if(!closed){try{h.observe(e);dirty=true;revision++;}catch(error){fail(error);}}},
      flush,
      close:()=>{if(!closed){closed=true;cancel(timer);}return flush();},
      export:async()=>{await flush();await ready;return {...h.export(),persistence:{...status,unsavedChanges:dirty}};}
    };
    timer=schedule(()=>{flush().catch(fail);},5000);timer?.unref?.();active=recorder;return recorder;
  }
  async function exportSummary(){
    if(active)return active.export();
    const row=await serial(()=>store.latest());
    if(!row)throw Error('No saved match history yet. Start the bot in a match first.');
    return {...row.summary,persistence:{storage:'indexeddb',recoveredSavedMatch:true,lastSavedAt:row.updatedAt}};
  }
  return {start,exportSummary,flush:()=>active?active.flush():Promise.resolve()};
}
if(typeof module!=='undefined'&&module.exports){module.exports=createMatchArchive;module.exports.createIndexedMatchStore=createIndexedMatchStore;}
