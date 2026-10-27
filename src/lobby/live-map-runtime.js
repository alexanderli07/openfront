function installLiveMapCatalog(seed,global,create=createLiveMapCatalog){
  const key='ofh:live-map-catalog:v1';let cache;
  try{cache=JSON.parse(global.localStorage.getItem(key));}catch{}
  const registry=create({seed,cache,
    save:value=>global.localStorage.setItem(key,JSON.stringify(value)),
    changed:()=>global.dispatchEvent(new global.CustomEvent('ofh-map-catalog-update'))});
  global.__OFH_liveMaps=registry;global.OPENFRONT_MAPS=registry.maps;
  const attempts=new Map(),inFlight=new Set();
  function poll(){
    if(global.document?.body?.classList.contains('in-game'))return;
    const bootstrap=global.BOOTSTRAP_CONFIG||{};
    const manifest=global.ASSET_MANIFEST||bootstrap.assetManifest;
    for(const target of registry.assets(manifest)){
      if(inFlight.size>=2)break;
      if(inFlight.has(target.id)||(attempts.get(target.id)||0)>=2)continue;
      let url;
      try{
        const base=global.CDN_BASE||bootstrap.cdnBase||'';
        const allowed=new global.URL(base||global.location.origin,global.location.href);
        url=new global.URL(base+target.url,global.location.href);
        if(url.origin!==allowed.origin||!['https:','http:'].includes(url.protocol)||
          !url.pathname.includes(`/maps/${target.id}/manifest`))continue;
      }catch{continue;}
      inFlight.add(target.id);attempts.set(target.id,(attempts.get(target.id)||0)+1);
      Promise.resolve().then(()=>global.fetch(url.href,{credentials:'omit',redirect:'error',cache:'force-cache',
        signal:global.AbortSignal.timeout(5000)})).then(async response=>{
        if(!response.ok||Number(response.headers?.get('content-length'))>2000000)return;
        const reader=response.body?.getReader();if(!reader)return;
        const decoder=new global.TextDecoder();let text='',bytes=0;
        try{
          while(true){
            const part=await reader.read();if(part.done)break;
            bytes+=part.value.byteLength;
            if(bytes>2000000){await reader.cancel();return;}
            text+=decoder.decode(part.value,{stream:true});
          }
          text+=decoder.decode();registry.metadata(target.id,JSON.parse(text),target.url);
        }finally{reader.releaseLock();}
      }).catch(()=>{}).finally(()=>inFlight.delete(target.id));
    }
  }
  registry.poll=poll;poll();global.setInterval(poll,5000);
  return registry;
}
if(typeof module!=='undefined')module.exports={installLiveMapCatalog};
