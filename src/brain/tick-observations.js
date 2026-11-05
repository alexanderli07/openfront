'use strict';
// Only stable unit summaries are shared. Money, troops, attacks, settings and
// final command validation are deliberately read live by the runtime.
function createTickObservations(){
 const games=new WeakMap();let hits=0,scans=0,invalidations=0;
 const raw=value=>value?.__src||value;
 const safe=(read,fallback)=>{try{return read();}catch{return fallback;}};
 function units(game,player){
  const nativeGame=raw(game),nativePlayer=raw(player),tick=safe(()=>game.ticks(),null);
  if(!nativeGame||typeof nativeGame!=='object'||!nativePlayer||typeof nativePlayer!=='object')return collect(player);
  let players=games.get(nativeGame);if(!players){players=new WeakMap();games.set(nativeGame,players);}
  const previous=players.get(nativePlayer);
  if(Number.isFinite(tick)&&previous?.tick===tick){hits++;return previous.value;}
  const value=collect(player);
  if(Number.isFinite(tick))players.set(nativePlayer,{tick,value});
  return value;
 }
 function collect(player){
  scans++;const all=safe(()=>player.units(),[]),counts={};
  for(const unit of all){
   const type=safe(()=>unit.type(),'unknown'),entry=counts[type]||=( {count:0,levels:0,building:0} );
   entry.count++;entry.levels+=Number(safe(()=>unit.level(),1));
   if(safe(()=>unit.isUnderConstruction(),false))entry.building++;
  }
  for(const entry of Object.values(counts))Object.freeze(entry);
  return Object.freeze({counts:Object.freeze(counts),units:Object.freeze([...all])});
 }
 function invalidate(game,player){
  const nativeGame=raw(game),nativePlayer=raw(player);
  if(nativeGame&&typeof nativeGame==='object'){
   if(nativePlayer&&typeof nativePlayer==='object')games.get(nativeGame)?.delete(nativePlayer);
   else games.delete(nativeGame);
  }
  invalidations++;
 }
 return {units,invalidate,diagnostics:()=>({hits,scans,invalidations})};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createTickObservations;
