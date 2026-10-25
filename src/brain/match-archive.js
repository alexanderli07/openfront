'use strict';

function createIndexedMatchStore(indexedDB) {
  let database;
  function open(){
    if(!database)database=new Promise((resolve,reject)=>{
      if(!indexedDB){reject(Error('IndexedDB unavailable; history is memory-only'));return;}
      const request=indexedDB.open('openfront-helper-match-history',1);
      request.onupgradeneeded=()=>{
        const store=request.result.createObjectStore('matches',{keyPath:'id'});
        store.createIndex('updatedAt','updatedAt');
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('Cannot open match history'));
      request.onblocked=()=>reject(Error('Match-history database upgrade blocked'));
    });
    return database;
  }
  async function transaction(mode,run){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('matches',mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Match-history transaction failed'));
      run(tx.objectStore('matches'),value=>{result=value;});
    });
  }
  return {
    load:id=>transaction('readonly',(store,done)=>{const r=store.get(id);r.onsuccess=()=>done(r.result);}),
    save:row=>transaction('readwrite',store=>store.put(row)),
    latest:()=>transaction('readonly',(store,done)=>{const r=store.index('updatedAt').openCursor(null,'prev');r.onsuccess=()=>done(r.result?.value);})
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
    let dirty=false,revision=0,closed=false,timer,loadFailed=false,identityPromise=null;
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
          h.restore(row.summary);status.restored=true;
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
    async function flush(){
      await ready;await ensureIdentity();if(!id||loadFailed||!dirty)return;
      const version=revision,summary=h.export();
      try{await serial(()=>store.save({id,updatedAt:Date.now(),summary}));status.lastSavedAt=Date.now();status.error=null;if(revision===version)dirty=false;}
      catch(error){fail(error);}
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
