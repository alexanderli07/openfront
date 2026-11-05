'use strict';
// Opt-in aggregate timings only: no event stream, game objects or persistent
// history. Disabled mode never reads the clock or allocates metric rows.
function createPerformanceMonitor({now=()=>performance.now(),maxMetrics=32}={}){
 const metrics=new Map();let enabled=false;
 const limit=Number.isFinite(maxMetrics)?Math.max(1,Math.min(128,Math.floor(maxMetrics))):32;
 function time(){try{return now();}catch{return null;}}
 function measure(name,run){
  if(!enabled)return run();
  const start=time();
  try{return run();}
  finally{
   try{
    const end=time();
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start){
     name=String(name).slice(0,80);
     if(metrics.has(name)||metrics.size<limit){
      const row=metrics.get(name)||{name,calls:0,totalMs:0,maxMs:0};
      row.calls++;row.totalMs+=end-start;row.maxMs=Math.max(row.maxMs,end-start);metrics.set(name,row);
     }
    }
   }catch{}
  }
 }
 function report(){return {enabled,metrics:[...metrics.values()].map(row=>({...row,averageMs:row.totalMs/row.calls})),
  note:'Synchronous userscript work only; these figures do not measure game FPS or asynchronous server time.'};}
 return {active:()=>enabled,measure,report,start(){metrics.clear();enabled=true;},stop(){enabled=false;return report();}};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createPerformanceMonitor;
