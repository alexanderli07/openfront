'use strict';
// Only measurements: landing selection, worker validation and dispatch stay
// behind the existing central runtime gateways.
function createWildernessCrossing(){
  function sites(actor){
    const g=actor.game,self=actor.player,border=Array.from(self.borderTiles());
    const shores=border.filter(t=>g.isLand(t)&&g.isShore(t));
    if(!shores.length)return [];
    const count=Math.min(24,shores.length),offset=Math.floor(g.ticks()/10)%shores.length;
    const origins=Array.from({length:count},(_,i)=>shores[(Math.floor(i*shores.length/count)+offset)%shores.length]);
    const regions=new Map(),found=[];let budget=20000;
    const neighbors=t=>{if(budget<=0)return [];const n=g.neighbors(t);budget-=n.length;return n;};
    const neutral=t=>g.isLand(t)&&!g.hasOwner(t)&&!g.hasFallout(t);
    function region(tile){
      if(regions.has(tile))return regions.get(tile);
      const seen=new Set([tile]),queue=[tile],hostiles=new Set();let connected=false,roomCapped=false,processed=0;
      for(;processed<queue.length&&processed<512&&budget>0;processed++)for(const n of neighbors(queue[processed])){
        if(g.isLand(n)&&g.hasOwner(n)&&g.ownerID(n)===self.smallID())connected=true;
        if(g.isLand(n)&&g.hasOwner(n)&&g.ownerID(n)!==self.smallID()){
          const owner=g.playerBySmallID?.(g.ownerID(n));
          if(owner?.isPlayer?.()&&owner.isAlive?.()!==false&&self.isFriendly?.(owner)===false)hostiles.add(g.ownerID(n));
        }
        if(neutral(n)&&!seen.has(n)){
          if(seen.size<512){seen.add(n);queue.push(n);}else roomCapped=true;
        }
      }
      roomCapped ||= processed<queue.length;
      const result={room:seen.size,roomCapped,enemyFrontier:hostiles.size,excluded:connected||seen.size<8,tile:null,crossingSteps:Infinity};
      for(const t of seen)regions.set(t,result);
      return result;
    }
    for(const origin of origins){
      if(budget<=0)break;
      const seen=new Set(),queue=[];
      for(const t of neighbors(origin))if(g.isWater(t)){seen.add(t);queue.push({tile:t,depth:1});}
      for(let i=0;i<queue.length&&budget>0;i++){
        const {tile,depth}=queue[i];
        for(const n of neighbors(tile)){
          if(neutral(n)){
            const r=region(n),steps=depth+1;
            if(!r.excluded&&steps<r.crossingSteps){
              if(r.tile===null)found.push(r);
              const entranceWidth=neighbors(n).filter(neutral).length,bottleneck=entranceWidth<=2&&r.room>=64;
              const opportunityScore=Math.log2(r.room+1)*24-steps*4+(bottleneck?12:0)+Math.min(2,r.enemyFrontier)*8;
              Object.assign(r,{tile:n,origin,crossingSteps:steps,dist:steps*steps,entranceWidth,bottleneck,opportunityScore});
            }
          }else if(depth<12&&seen.size<256&&g.isWater(n)&&!seen.has(n)){
            seen.add(n);queue.push({tile:n,depth:depth+1});
          }
        }
      }
    }
    return found.sort((a,b)=>a.crossingSteps-b.crossingSteps||b.room-a.room||a.tile-b.tile)
      .slice(0,24).map(({tile,origin,crossingSteps,room,dist,roomCapped,enemyFrontier,entranceWidth,bottleneck,opportunityScore})=>
        ({tile,origin,crossingSteps,room,dist,roomCapped,enemyFrontier,entranceWidth,bottleneck,opportunityScore}));
  }
  return {sites};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWildernessCrossing;
