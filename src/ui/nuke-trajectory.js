'use strict';
// Read the path the client uses to move this missile. Native resolver plans are
// replaced (path + planId) rather than edited; legacy arrays have no such contract.
function projectNukeTrajectory(game,unit,options){
 const projector=projectNukeTrajectory.projector||(projectNukeTrajectory.projector=createNukeTrajectoryProjector());
 return projector.project(game,unit,options);
}
function createNukeTrajectoryProjector({maxEntries=512}={}){
 const entries=new Map();let gameIdentity,lastTick,width,height,seen=null;
 const capacity=Number.isFinite(maxEntries)?Math.max(1,Math.min(4096,Math.floor(maxEntries))):512;
 const raw=value=>value?.__src||value;
 const call=(value,key,...args)=>{try{return typeof value?.[key]==='function'?value[key](...args):undefined;}catch{return undefined;}};
 const read=(value,key)=>call(raw(value),key)??call(value,key);
 function clear(){entries.clear();gameIdentity=undefined;lastTick=undefined;seen=null;}
 function prepare(game){
  const identity=raw(game),tick=read(game,'ticks'),w=read(game,'width'),h=read(game,'height');
  if(identity!==gameIdentity||w!==width||h!==height||(Number.isFinite(tick)&&Number.isFinite(lastTick)&&tick<lastTick))entries.clear();
  gameIdentity=identity;width=w;height=h;lastTick=tick;
  return tick;
 }
 function project(game,unit,{maxPoints=128}={}){
  const tick=prepare(game);
  if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0)return null;
  const valid=tile=>Number.isSafeInteger(tile)&&tile>=0&&tile<width*height;
  const current=read(unit,'tile'),target=read(unit,'targetTile'),id=read(unit,'id');
  if(seen)seen.add(id);
  if(!valid(current)){entries.delete(id);return null;}
  const point=tile=>({x:tile%width,y:Math.floor(tile/width)});
  const limit=Number.isFinite(maxPoints)?Math.max(2,Math.min(512,Math.floor(maxPoints))):128;
  function validate(path){
   if(!(Array.isArray(path)||ArrayBuffer.isView(path))||!Number.isInteger(path.length)||path.length<2||path.length>65536)return null;
   const tiles=[],indices=new Map();
   for(let i=0;i<path.length;i++){
    const p=path[i],tile=typeof p==='object'&&p!==null?p.tile:p;
    if(!valid(tile))return null;
    tiles.push(tile);indices.set(tile,indices.has(tile)?-1:i);
   }
   if(valid(target)&&tiles.at(-1)!==target)return null;
   return {tiles,indices};
  }
  function result(data,index,source,path){
   const tiles=data.tiles,count=Math.min(limit,tiles.length-index),worldPts=[];
   for(let i=0;i<count;i++){
    const offset=count===1?index:index+Math.floor(i*(tiles.length-1-index)/(count-1));
    // Check every displayed native vertex. Any unexpected edit invalidates the
    // snapshot before drawing; do not mix old and new curve coordinates.
    if(path&&path[offset]!==tiles[offset])return null;
    worldPts.push(point(tiles[offset]));
   }
   return {worldPts,confidence:'exact',source};
  }
  const plans=call(raw(game),'motionPlans')??call(game,'motionPlans');
  let plan;try{plan=plans?.get?.(id);}catch{}
  const path=plan?.path;
  const cacheable=ArrayBuffer.isView(path)&&Object.prototype.toString.call(path)==='[object Uint32Array]';
  let cached=entries.get(id),data;
  if(cacheable&&cached?.path===path&&cached.planId===plan.planId&&cached.target===target&&cached.startTick===plan.startTick&&cached.ticksPerStep===plan.ticksPerStep&&cached.length===path.length){
   data=cached.data;
   if(path[0]!==data.tiles[0]||path[path.length-1]!==data.tiles.at(-1))data=null;
  }
  function load(){
   entries.delete(id);data=validate(path);
   if(data&&cacheable){
    cached={path,planId:plan.planId,target,startTick:plan.startTick,ticksPerStep:plan.ticksPerStep,length:path.length,data};
    entries.set(id,cached);
    if(entries.size>capacity)entries.delete(entries.keys().next().value);
   }
  }
  if(!data)load();
  if(data){
   let index=-1;
   if(Number.isFinite(tick)&&Number.isFinite(plan.startTick)&&Number.isFinite(plan.ticksPerStep)&&plan.ticksPerStep>=1){
    const expected=Math.max(0,Math.min(data.tiles.length-1,Math.floor((tick-plan.startTick)/plan.ticksPerStep)));
    if(path[expected]===current&&data.tiles[expected]===current)index=expected;
   }
   // A schedule mismatch can mean an in-place edit or stale movement. Validate
   // afresh before using the uniqueness index instead of trusting cached data.
   if(index<0){load();if(data)index=data.indices.get(current)??-1;}
   if(data&&index>=0){
    let projection=result(data,index,'motion-plan',cacheable?path:null);
    if(!projection){load();if(data){index=data.indices.get(current)??-1;if(index>=0)projection=result(data,index,'motion-plan');}}
    if(projection){if(cacheable){entries.delete(id);entries.set(id,cached);}return projection;}
   }
  }
  const state=read(unit,'nukeState'),legacy=validate(state?.trajectory);
  if(legacy){
   const index=legacy.indices.get(current)??-1;
   if(index>=0)return result(legacy,index,'nuke-state');
  }
  if(!valid(target))return null;
  return {worldPts:current===target?[point(current)]:[point(current),point(target)],confidence:'estimated',source:'target-line'};
 }
 return {project,beginScan(game){prepare(game);seen=new Set();},endScan(){if(seen){for(const id of entries.keys())if(!seen.has(id))entries.delete(id);seen=null;}},clear};
}
projectNukeTrajectory.createProjector=createNukeTrajectoryProjector;
if(typeof module!=='undefined'&&module.exports)module.exports=projectNukeTrajectory;
