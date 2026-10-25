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
      const seen=new Set([tile]),queue=[tile];let connected=false;
      for(let i=0;i<queue.length&&i<64&&budget>0;i++)for(const n of neighbors(queue[i])){
        if(g.isLand(n)&&g.hasOwner(n)&&g.ownerID(n)===self.smallID())connected=true;
        if(seen.size<64&&neutral(n)&&!seen.has(n)){seen.add(n);queue.push(n);}
      }
      const result={room:seen.size,excluded:connected||seen.size<8,tile:null,crossingSteps:Infinity};
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
              Object.assign(r,{tile:n,origin,crossingSteps:steps,dist:steps*steps});
            }
          }else if(depth<12&&seen.size<256&&g.isWater(n)&&!seen.has(n)){
            seen.add(n);queue.push({tile:n,depth:depth+1});
          }
        }
      }
    }
    return found.sort((a,b)=>a.crossingSteps-b.crossingSteps||b.room-a.room||a.tile-b.tile)
      .slice(0,24).map(({tile,origin,crossingSteps,room,dist})=>({tile,origin,crossingSteps,room,dist}));
  }
  return {sites};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createWildernessCrossing;
