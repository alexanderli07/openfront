'use strict';
const create=require('../../src/brain/team-geography');
const U={Port:'Port',City:'City',Factory:'Factory',SAMLauncher:'SAM',Warship:'Warship',TransportShip:'Transport'};
function fixture({bridge=false,landBudget=6000}={}){
 let tick=1;const width=40,height=24,ref=(x,y)=>y*width+x;
 const locations=new Map(),allUnits=[];
 const makePlayer=(sid,team,x)=>({smallID:()=>sid,id:()=>String(sid),type:()=> 'Human',team:()=>team,
  isPlayer:()=>true,isAlive:()=>true,hasSpawned:()=>true,nameLocation:()=>({x,y:12}),
  isFriendly:p=>p.team()===team,units:type=>allUnits.filter(u=>u.owner().smallID()===sid&&u.type()===type),
  incomingAttacks:()=>[],borderTiles:()=>new Set([ref(x,12)]),gold:()=>1000n});
 const self=makePlayer(1,'A',8),friend=makePlayer(3,'A',5),enemy=makePlayer(2,'B',30);
 const players=[self,friend,enemy];
 const game={ticks:()=>tick,width:()=>width,height:()=>height,ref,x:t=>t%width,y:t=>Math.floor(t/width),
  isValidCoord:(x,y)=>x>=0&&x<width&&y>=0&&y<height,
  isLand:t=>{const x=t%width,y=Math.floor(t/width);return x<14||x>25||(bridge&&y===0);},
  isWater:t=>!game.isLand(t),isOcean:t=>!game.isLand(t),hasFallout:()=>false,
  neighbors:t=>[[game.x(t)-1,game.y(t)],[game.x(t)+1,game.y(t)],[game.x(t),game.y(t)-1],[game.x(t),game.y(t)+1]].filter(([x,y])=>game.isValidCoord(x,y)).map(([x,y])=>ref(x,y)),
  hasOwner:t=>locations.has(t),ownerID:t=>locations.get(t)||0,
  isShore:t=>game.isLand(t)&&game.neighbors(t).some(n=>game.isWater(n)),
  getWaterComponent:t=>game.isWater(t)?1:null,euclideanDistSquared:(a,b)=>(game.x(a)-game.x(b))**2+(game.y(a)-game.y(b))**2,
  manhattanDist:(a,b)=>Math.abs(game.x(a)-game.x(b))+Math.abs(game.y(a)-game.y(b)),
  players:()=>players,playerBySmallID:id=>players.find(p=>p.smallID()===id),units:type=>allUnits.filter(u=>u.type()===type),
  config:()=>({gameConfig:()=>({gameMode:'Team'}),warshipTargettingRange:()=>130})};
 const add=(type,tile,owner=self,extra={})=>{const unit={type:()=>type,tile:()=>tile,owner:()=>owner,isActive:()=>true,isUnderConstruction:()=>false,id:()=>String(allUnits.length),...extra};allUnits.push(unit);return unit;};
 const geo=create({units:U,botType:'Bot',teamMode:'Team',landBudget});
 return {game,self,friend,enemy,players,geo,add,ref,locations,next:()=>tick++};
}

module.exports={fixture,U};
