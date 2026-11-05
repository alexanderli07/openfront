'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const project=require('../src/ui/nuke-trajectory');
const {buildSource}=require('../scripts/build');
function fixture(path=[11,22,33,24,15]){
 const plan={path:Uint32Array.from(path),startTick:100,ticksPerStep:2,planId:1};
 let tile=path[0],target=path.at(-1),tick=100;
 const unit={id:()=>7,tile:()=>tile,targetTile:()=>target};
 const game={width:()=>10,height:()=>10,x:t=>t%10,y:t=>Math.floor(t/10),ticks:()=>tick,motionPlans:()=>new Map([[7,plan]])};
 return {game,unit,plan,move:(i)=>{tile=path[i];tick=100+i*2;},target:t=>target=t};
}
test('both arc orientations follow the native motion plan, including halfway detection',()=>{
 for(const path of [[11,22,33,24,15],[51,42,33,44,55]]){
  const f=fixture(path);f.move(2);
  const result=project(f.game,f.unit);
  assert.equal(result.source,'motion-plan');assert.equal(result.confidence,'exact');
  assert.deepEqual(result.worldPts,path.slice(2).map(t=>({x:t%10,y:Math.floor(t/10)})));
 }
});
test('replacement plans and changed targets update immediately instead of keeping the old curve',()=>{
 const f=fixture();project(f.game,f.unit);
 f.plan.path=Uint32Array.from([11,12,13,14]);f.target(14);
 assert.deepEqual(project(f.game,f.unit).worldPts,[11,12,13,14].map(t=>({x:t%10,y:Math.floor(t/10)})));
});
test('legacy numeric and tile-record nuke trajectories use current position, not a stale index',()=>{
 for(const trajectory of [[11,22,33,24,15],[11,22,33,24,15].map(tile=>({tile}))]){
  const f=fixture();delete f.game.motionPlans;f.move(2);
  f.unit.nukeState=()=>({trajectory,trajectoryIndex:0});
  assert.equal(project(f.game,f.unit).source,'nuke-state');
  assert.deepEqual(project(f.game,f.unit).worldPts,[{x:3,y:3},{x:4,y:2},{x:5,y:1}]);
 }
});
test('unverified, malformed and wrong-target paths become uncertain target lines',()=>{
 for(const path of [[11,22,33,24,16],[11,NaN,15],[11,1000,15]]){
  const f=fixture();f.plan.path=path;
  const result=project(f.game,f.unit);assert.equal(result.confidence,'estimated');
  assert.deepEqual(result.worldPts,[{x:1,y:1},{x:5,y:1}]);
 }
});
test('repeated tiles require a matching motion schedule; output stays bounded and includes the target',()=>{
 const f=fixture([11,22,11,24,15]);f.move(2);
 assert.deepEqual(project(f.game,f.unit,{maxPoints:2}).worldPts,[{x:1,y:1},{x:5,y:1}]);
 delete f.game.motionPlans;f.unit.nukeState=()=>({trajectory:[11,22,11,24,15],trajectoryIndex:0});
 assert.equal(project(f.game,f.unit).confidence,'estimated');
});
test('native wrapped views and long paths retain both endpoints within the point budget',()=>{
 const f=fixture(Array.from({length:90},(_,i)=>i));f.move(20);
 const result=project({__src:f.game},{__src:f.unit},{maxPoints:8});
 assert.equal(result.worldPts.length,8);assert.deepEqual(result.worldPts[0],{x:0,y:2});
 assert.deepEqual(result.worldPts.at(-1),{x:9,y:8});
});
test('shipped overlay replaces stale curves and no longer reads the build-menu direction',()=>{
 const source=buildSource().source;
 const a=source.indexOf('function projectNukeTrajectory('),b=source.indexOf('function drawNukeTrajectory(',a);
 assert.ok(a>=0,'projection module is included in the overlay');
 const f=fixture();
 Object.assign(f.unit,{isActive:()=>true,owner:()=>({}),type:()=> 'Atom Bomb'});
 f.game.units=()=>[f.unit];
 const context=vm.createContext({NUKE_TRAJ_MAX_POINTS:96,NUKE_TRAJ_UNIT_TYPES:['Atom Bomb'],_nukeTrajScan:[],
  getNukePredictionRelation:()=> 'enemy',nukeTrajColor:()=> '#f00',game:f.game});
 vm.runInContext(source.slice(a,b),context);vm.runInContext('collectNukeTrajectoryScan(game)',context);
 assert.equal(context._nukeTrajScan[0].source,'motion-plan');
 f.move(2);vm.runInContext('collectNukeTrajectoryScan(game)',context);
 assert.equal(context._nukeTrajScan[0].worldPts[0].y,3);
 f.game.units=()=>[];vm.runInContext('collectNukeTrajectoryScan(game)',context);assert.equal(context._nukeTrajScan.length,0);
 assert.equal(source.includes('function readNukeDirection()'),false);
});
test('unconfirmed target lines render more faintly than verified trajectories',()=>{
 const source=buildSource().source,a=source.indexOf('function drawNukeTrajectory('),b=source.indexOf('registerMapOverlayLayer(',a);
 const strokes=[],ctx={globalAlpha:.8,save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},setLineDash(value){this.dash=value;},stroke(){strokes.push({alpha:this.globalAlpha,dash:[...this.dash]});}};
 const context=vm.createContext({_nukeTrajScan:['estimated','exact'].map(confidence=>({confidence,worldPts:[{x:0,y:0},{x:10,y:10}],color:'#fff'})),
  mapWorldToScreen:(transform,x,y)=>({x,y}),mapPointOnScreen:()=>true,ctx});
 vm.runInContext(source.slice(a,b),context);vm.runInContext('drawNukeTrajectory(ctx,null,{})',context);
 assert.deepEqual(strokes,[{alpha:.8*.45,dash:[2,8]},{alpha:.8,dash:[5,6]}]);
});
