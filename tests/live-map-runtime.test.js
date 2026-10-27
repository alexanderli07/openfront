'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLiveMapCatalog}=require('../src/lobby/live-map-catalog');
const {installLiveMapCatalog}=require('../src/lobby/live-map-runtime');
function fixture(){
 const saved=new Map(),requests=[],intervals=[];
 const global={localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},
  location:{origin:'https://openfront.io',href:'https://openfront.io/'},URL,AbortSignal,TextDecoder,
  CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:()=>{},
  document:{body:{classList:{contains:()=>false}}},setInterval:fn=>intervals.push(fn),
  fetch:async(url,options)=>{requests.push({url,options});let done=false;return {ok:true,headers:{get:()=>null},body:{getReader:()=>({
   read:async()=>done?{done:true}:(done=true,{done:false,value:new TextEncoder().encode(JSON.stringify({id:'NewPlace',name:'New Place'}))}),releaseLock(){}
  })}};}};
 return {global,saved,requests,intervals,install:()=>installLiveMapCatalog([{id:'baikal',name:'Baikal'}],global,createLiveMapCatalog)};
}
test('late game bootstrap discovers new assets and resolves public map labels',async()=>{
 const f=fixture(),c=f.install();
 f.global.BOOTSTRAP_CONFIG={cdnBase:'https://cdn.openfront.io',assetManifest:{'maps/newplace/manifest.json':'/_assets/maps/newplace/manifest.123.json'}};
 f.intervals[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(c.ids.includes('newplace'));assert.equal(c.maps.at(-1).name,'New Place');
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.credentials,'omit');
 assert.equal(f.requests[0].url,'https://cdn.openfront.io/_assets/maps/newplace/manifest.123.json');
 assert.equal(f.global.OPENFRONT_MAPS,c.maps);
});
test('cached discoveries are available immediately on the next page',()=>{
 const f=fixture();let c=f.install();c.lobbies({games:{ffa:[{gameConfig:{gameMap:'Future Map'}}]}});
 c=f.install();assert.ok(c.ids.includes('futuremap'));assert.ok(c.ids.includes('baikal'));
});
test('metadata requests stay on the native asset origin and retry at most twice',async()=>{
 const f=fixture();f.global.ASSET_MANIFEST={'maps/newplace/manifest.json':'https://unrelated.example/maps/newplace/manifest.json'};
 f.install();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.length,0);
 f.global.ASSET_MANIFEST={'maps/newplace/manifest.json':'/_assets/maps/newplace/manifest.123.json'};
 f.global.fetch=async()=>{f.requests.push({});throw new Error('offline');};
 for(let i=0;i<5;i++){f.intervals[0]();await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(f.requests.length,2);
});
test('storage denial cannot stop native discovery',()=>{
 const f=fixture();f.global.localStorage={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
 const c=f.install();c.lobbies({games:{team:[{gameConfig:{gameMap:'New Map'}}]}});assert.ok(c.ids.includes('newmap'));
});
test('oversized metadata streams are cancelled before buffering the whole body',async()=>{
 const f=fixture();let cancelled=false,reads=0;
 f.global.ASSET_MANIFEST={'maps/newplace/manifest.json':'/_assets/maps/newplace/manifest.123.json'};
 f.global.fetch=async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({
  read:async()=>{reads++;return {done:false,value:new Uint8Array(1000001)};},
  cancel:async()=>{cancelled=true;},releaseLock(){}
 })}});
 const c=f.install();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cancelled,true);assert.equal(reads,2);assert.equal(c.maps.at(-1).placeholder,true);
});
