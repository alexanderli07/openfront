// Runs in the native overlay closure; rendering does not affect SAM decisions.
function collectNukeTrajectoryScan(game){
 const scan=[];
 _nukeTrajectoryProjector.beginScan(game);
 try{
  const units=game.units(...NUKE_TRAJ_UNIT_TYPES);
  for(const unit of units){
   if(!unit?.isActive?.())continue;
   const relation=getNukePredictionRelation(game,unit);
   if(!relation)continue;
   const projection=_nukeTrajectoryProjector.project(game,unit,{maxPoints:NUKE_TRAJ_MAX_POINTS});
   if(!projection||projection.worldPts.length<2)continue;
   scan.push({...projection,relation,color:nukeTrajColor(relation,unit.owner?.())});
  }
  _nukeTrajScan=scan;
 }catch{_nukeTrajScan=[];}
 finally{_nukeTrajectoryProjector.endScan();}
}
function drawNukeTrajectory(context,game,transform){
 if(!_nukeTrajScan.length)return;
 const projector=typeof mapMakeProjector==='function'?mapMakeProjector(transform):null;
 context.save();
 const alpha=context.globalAlpha;
 context.lineWidth=2;context.lineCap='round';context.lineJoin='round';
 const scratch={x:0,y:0};
 for(const trajectory of _nukeTrajScan){
  const points=trajectory.worldPts;
  if(!points||points.length<2)continue;
  context.beginPath();let started=false,onScreen=false;
  for(const point of points){
   let screen;
   if(projector){mapProject(projector,point.x,point.y,scratch);screen=scratch;}
   else{screen=mapWorldToScreen(transform,point.x,point.y);if(!screen){started=false;continue;}}
   if(mapPointOnScreen(screen.x,screen.y,200))onScreen=true;
   if(started)context.lineTo(screen.x,screen.y);
   else{context.moveTo(screen.x,screen.y);started=true;}
  }
  if(onScreen){
   const exact=trajectory.confidence==='exact';
   context.globalAlpha=alpha*(exact?1:.45);context.setLineDash(exact?[5,6]:[2,8]);
   context.strokeStyle=trajectory.color||nukeTrajColor(trajectory.relation);context.stroke();
  }
 }
 context.restore();
}
