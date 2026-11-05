'use strict';
// Read the path the client uses to move this missile. Never reconstruct a new
// parabola from an in-flight position or consult the local launch-menu toggle.
function projectNukeTrajectory(game,unit,{maxPoints=128}={}){
 const raw=value=>value?.__src||value;
 const call=(value,key,...args)=>{try{return typeof value?.[key]==='function'?value[key](...args):undefined;}catch{return undefined;}};
 const read=(value,key)=>call(raw(value),key)??call(value,key);
 const width=read(game,'width'),height=read(game,'height');
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0)return null;
 const valid=tile=>Number.isSafeInteger(tile)&&tile>=0&&tile<width*height;
 const current=read(unit,'tile'),target=read(unit,'targetTile'),id=read(unit,'id');
 if(!valid(current))return null;
 const point=tile=>({x:tile%width,y:Math.floor(tile/width)});
 const limit=Number.isFinite(maxPoints)?Math.max(2,Math.min(512,Math.floor(maxPoints))):128;
 function pathTiles(path){
  if(!(Array.isArray(path)||ArrayBuffer.isView(path))||!Number.isInteger(path.length)||path.length<2||path.length>65536)return null;
  const tiles=Array.from(path,p=>typeof p==='object'&&p!==null?p.tile:p);
  if(!tiles.every(valid)||(valid(target)&&tiles.at(-1)!==target))return null;
  return tiles;
 }
 function result(tiles,index,source){
  const count=Math.min(limit,tiles.length-index),worldPts=[];
  for(let i=0;i<count;i++){
   const offset=count===1?index:index+Math.floor(i*(tiles.length-1-index)/(count-1));
   worldPts.push(point(tiles[offset]));
  }
  return {worldPts,confidence:'exact',source};
 }
 function uniqueIndex(tiles){
  let index=-1;
  for(let i=0;i<tiles.length;i++)if(tiles[i]===current){if(index!==-1)return -1;index=i;}
  return index;
 }
 const plans=call(raw(game),'motionPlans')??call(game,'motionPlans');
 let plan;try{plan=plans?.get?.(id);}catch{}
 const tiles=pathTiles(plan?.path);
 if(tiles){
  const tick=read(game,'ticks');let index=-1;
  if(Number.isFinite(tick)&&Number.isFinite(plan.startTick)&&Number.isFinite(plan.ticksPerStep)&&plan.ticksPerStep>=1){
   const expected=Math.max(0,Math.min(tiles.length-1,Math.floor((tick-plan.startTick)/plan.ticksPerStep)));
   if(tiles[expected]===current)index=expected;
  }
  if(index<0)index=uniqueIndex(tiles);
  if(index>=0)return result(tiles,index,'motion-plan');
 }
 const state=read(unit,'nukeState'),legacy=pathTiles(state?.trajectory);
 if(legacy){
  // trajectoryIndex can lag behind plan-driven movement; verify against the
  // live tile instead. A repeated tile without a schedule is ambiguous.
  const index=uniqueIndex(legacy);
  if(index>=0)return result(legacy,index,'nuke-state');
 }
 if(!valid(target))return null;
 return {worldPts:current===target?[point(current)]:[point(current),point(target)],confidence:'estimated',source:'target-line'};
}
if(typeof module!=='undefined'&&module.exports)module.exports=projectNukeTrajectory;
