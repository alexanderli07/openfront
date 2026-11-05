'use strict';
// A request/transaction fixture: writes commit together only once the request
// queue drains. It deliberately exposes write failure and operation counts.
module.exports=function memoryIndexedDB(){
  const tables=new Map();let failWrite=false,puts=0;
  const api={tables,get puts(){return puts;},failWrite(){failWrite=true;},open(){
    const request={};setImmediate(()=>{
      const db={objectStoreNames:{contains:name=>tables.has(name)},
        createObjectStore(name){tables.set(name,new Map());return {createIndex(){}};},
        transaction(names,mode){
          const data=new Map([...tables].map(([name,rows])=>[name,new Map(rows)]));
          let queued=0,done=false;
          const tx={error:null,abort(){if(done)return;done=true;tx.error=Error('aborted');setImmediate(()=>tx.onabort?.());},objectStore:name=>objectStore(name)};
          function enqueue(run){
            queued++;const r={};setImmediate(()=>{
              if(done)return;
              try{run(r);}catch(error){tx.error=error;done=true;tx.onerror?.();return;}
              queued--;if(queued===0&&!done){done=true;if(mode==='readwrite')for(const [name,rows] of data)tables.set(name,rows);tx.oncomplete?.();}
            });return r;
          }
          function objectStore(name){
            const rows=data.get(name);
            return {
              get:key=>enqueue(r=>{r.result=structuredClone(rows.get(JSON.stringify(key)));r.onsuccess?.();}),
              put:row=>enqueue(r=>{
                if(failWrite){failWrite=false;throw Error('disk full');}
                puts++;const key=name==='matches'?row.id:[row.matchId,row.table,row.key];
                rows.set(JSON.stringify(key),structuredClone(row));r.onsuccess?.();
              }),
              index:index=>({openCursor(query,direction){
                const values=[...rows.values()].filter(row=>query===undefined||query===null||row[index]===query);
                if(index==='updatedAt')values.sort((a,b)=>direction==='prev'?b.updatedAt-a.updatedAt:a.updatedAt-b.updatedAt);
                let position=0;
                const r=enqueue(advance);
                function advance(){
                  const value=values[position++];r.result=value?{value:structuredClone(value),continue(){enqueue(advance);}}:null;r.onsuccess?.();
                }
                return r;
              }})
            };
          }
          // A newly created empty transaction completes asynchronously, just as IDB.
          setImmediate(()=>{if(queued===0&&!done){done=true;tx.oncomplete?.();}});
          return tx;
        }};
      request.result=db;if(!tables.has('summaryRows'))request.onupgradeneeded?.();request.onsuccess?.();
    });return request;
  }};return api;
};
