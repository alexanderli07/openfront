'use strict';
function createSupportPosture({units:U,botType,teamMode}){
  const states=new WeakMap();
  const call=(v,k,...args)=>{try{return v?.[k]?.(...args);}catch{return undefined;}};
  const sample=(a,n)=>a.filter((_,i)=>i%Math.max(1,Math.ceil(a.length/n))===0).slice(0,n);
  function observe(game,self,opening){
    if(!opening||call(call(game,'config'),'gameConfig')?.gameMode!==teamMode)return null;
    const tick=call(game,'ticks');let state=states.get(self);
    if(!state||state.game!==game||tick<state.tick){state={game,tick:-1,lastDanger:-Infinity};states.set(self,state);}
    if(state.tick===tick)return state.facts;
    const ready=opening?.borderKnown===true&&!opening.wilderness;
    const base={ready,keepFraction:.25,probeThrottleMs:600,donationThrottleMs:1000};
    const finish=(conserve,reason,anchor=null)=>{
      state.tick=tick;state.facts={...base,conserve,reason,anchor};return state.facts;
    };
    if(['x','y','ref','isLand','hasOwner','ownerID','playerBySmallID','neighbors','isValidCoord'].some(k=>typeof game[k]!=='function'))
      return finish(true,'Home geography unavailable');
    const xy=t=>({x:call(game,'x',t),y:call(game,'y',t)});
    const valid=p=>Number.isFinite(p.x)&&Number.isFinite(p.y);
    const near=(a,b,r)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=r;
    const border=Array.from(call(self,'borderTiles')||[]);let anchor;
    for(const type of [U.SAMLauncher,U.City,U.Port]){
      const own=(call(self,'units',type)||[]).filter(u=>call(u,'isActive')!==false&&Number.isFinite(call(u,'tile')))
        .sort((a,b)=>call(a,'id')-call(b,'id'));
      if(own.length){anchor=call(own[0],'tile');break;}
    }
    anchor??=border[0];
    if(!Number.isFinite(tick)||anchor==null||!valid(xy(anchor)))return finish(true,'Home geography unavailable');
    const center=xy(anchor),home=border.filter(t=>valid(xy(t))&&near(xy(t),center,220));
    const hostile=p=>p&&call(p,'smallID')!==call(self,'smallID')&&call(self,'isFriendly',p)!==true;
    let danger=(call(self,'incomingAttacks')||[]).some(a=>hostile(call(a,'attacker')));
    let reason=danger?'Incoming attack: conserve for combat':'';
    const hostileLand=tile=>{
      if(!call(game,'isLand',tile)||!call(game,'hasOwner',tile))return false;
      const owner=call(game,'playerBySmallID',call(game,'ownerID',tile));
      return hostile(owner)&&call(owner,'isPlayer')===true&&call(owner,'isAlive')!==false&&call(owner,'type')!==botType;
    };
    if(!danger){
      danger=home.some(tile=>(call(game,'neighbors',tile)||[]).some(hostileLand));
      if(danger)reason='Enemy on the home border: conserve for combat';
    }
    if(!danger)outer:for(const tile of sample(home.length?home:[anchor],32)){
      const p=xy(tile);
      for(const dx of [-48,-24,0,24,48])for(const dy of [-48,-24,0,24,48]){
        if(Math.abs(dx)+Math.abs(dy)>48||!call(game,'isValidCoord',p.x+dx,p.y+dy))continue;
        if(hostileLand(call(game,'ref',p.x+dx,p.y+dy))){danger=true;reason='Enemy land near home: conserve for combat';break outer;}
      }
    }
    if(!danger)for(const ship of call(game,'units',U.TransportShip)||[]){
      const target=call(ship,'targetTile'),position=call(ship,'tile');
      if(call(ship,'isActive')===false||!hostile(call(ship,'owner'))||target==null||position==null)continue;
      if(valid(xy(target))&&near(xy(target),center,220)&&call(game,'manhattanDist',position,target)<=60){
        danger=true;reason='Enemy transport approaching home: conserve for combat';break;
      }
    }
    if(danger)state.lastDanger=tick;
    const sticky=tick-state.lastDanger<50;
    return finish(danger||sticky,reason||(sticky?'Rebuild after a home threat':'Safe home: support the front'),anchor);
  }
  return {observe};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createSupportPosture;
