'use strict';
function createLiveMapCatalog({seed=[],cache,save=()=>{},changed=()=>{},limit=512}={}){
  const maps=[],ids=[];
  const redirects=Object.create(null),seedIds=new Set();
  const token=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const text=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[<>\u0000-\u001f]/.test(value);
  let dirty=false;
  const validId=id=>typeof id==='string'&&/^[a-z0-9]{1,64}$/.test(id);
  function resolveId(id){const seen=new Set();while(redirects[id]&&!seen.has(id)){seen.add(id);id=redirects[id];}return id;}
  function normalizeFilters(raw){
    const result=Object.create(null);
    for(const [id,value] of Object.entries(raw||{}))if(validId(id)){
      const key=resolveId(id);result[key]=result[key]===true||value===true;
    }
    return result;
  }
  function merge(entry){
    if(!entry||typeof entry.id!=='string'||!/^[a-z0-9]{1,64}$/.test(entry.id)||!text(entry.name))return;
    let map=maps.find(m=>m.id===entry.id);
    if(!map){
      if(maps.length>=limit)return;
      map={id:entry.id,name:entry.name,aliases:[],thumbnail:`assets/map-thumbnails/${entry.id}/thumbnail.webp`};
      maps.push(map);ids.push(map.id);dirty=true;
    }
    if(map.name!==entry.name){map.name=entry.name;dirty=true;}
    if(map.placeholder!==!!entry.placeholder){map.placeholder=!!entry.placeholder;dirty=true;}
    if(entry.metadataResolved===true&&!map.metadataResolved){map.metadataResolved=true;dirty=true;}
    if(typeof entry.manifestVersion==='string'&&entry.manifestVersion.length<=2048&&map.manifestVersion!==entry.manifestVersion){map.manifestVersion=entry.manifestVersion;dirty=true;}
    for(const alias of [entry.id,entry.name,...(Array.isArray(entry.aliases)?entry.aliases.slice(0,16):[])])
      if(text(alias)&&!map.aliases.includes(alias)&&map.aliases.length<20){map.aliases.push(alias);dirty=true;}
    if(Number.isInteger(entry.specialTeamCount)&&entry.specialTeamCount>0&&entry.specialTeamCount<=256&&map.specialTeamCount!==entry.specialTeamCount){map.specialTeamCount=entry.specialTeamCount;dirty=true;}
    if(entry.metadataResolved===true&&entry.specialTeamCount==null&&map.specialTeamCount!==undefined){delete map.specialTeamCount;dirty=true;}
  }
  function flush(){
    if(!dirty)return;dirty=false;
    try{save({version:1,redirects:{...redirects},maps:maps.filter(map=>!seedIds.has(map.id)).map(({id,name,aliases,placeholder,specialTeamCount,metadataResolved,manifestVersion})=>({id,name,aliases,placeholder,specialTeamCount,metadataResolved,manifestVersion}))});}catch{}
    try{changed();}catch{}
  }
  for(const entry of seed){merge({...entry,metadataResolved:true});seedIds.add(entry.id);}
  if(cache?.version===1&&Array.isArray(cache.maps))for(const entry of cache.maps.slice(0,limit))if(!seedIds.has(entry?.id))merge(entry);
  if(cache?.version===1&&cache.redirects&&typeof cache.redirects==='object')for(const [from,to] of Object.entries(cache.redirects).slice(0,limit))
    if(validId(from)&&validId(to)&&from!==to&&maps.some(m=>m.id===to))redirects[from]=to;
  dirty=false;
  function assets(manifest){
    const pending=[];
    if(!manifest||typeof manifest!=='object')return pending;
    for(const [key,url] of Object.entries(manifest).slice(0,50000)){
      const match=key.match(/^maps\/([a-z0-9]{1,64})\/(manifest\.json|thumbnail\.webp)$/);if(!match)continue;
      const id=resolveId(match[1]);let map=maps.find(m=>m.id===id);
      if(!map){merge({id,name:id,placeholder:true});map=maps.find(m=>m.id===id);}
      if(map?.manifestVersion&&match[2]==='manifest.json'&&typeof url==='string'&&map.manifestVersion!==url&&map.metadataResolved){map.metadataResolved=false;dirty=true;}
      if(map&&!map.metadataResolved&&id===match[1]&&match[2]==='manifest.json'&&typeof url==='string')pending.push({id,url});
    }
    flush();return pending;
  }
  function lobbies(snapshot){
    const groups=snapshot?.games;if(!groups||typeof groups!=='object')return;
    let visited=0;
    for(const group of Object.values(groups))if(Array.isArray(group))for(const lobby of group){
      if(visited++>=512)break;
      const name=lobby?.gameConfig?.gameMap;if(!text(name))continue;
      const id=token(name);if(!id||id.length>64)continue;
      const map=maps.find(m=>[m.id,m.name,...m.aliases].some(alias=>token(alias)===id));
      merge({id:map?.id||id,name:!map||map.placeholder?name:map.name,aliases:[name],
        placeholder:map?.placeholder&&!name.includes(' ')});
    }
    flush();
  }
  function metadata(id,value,manifestVersion){
    if(!value||token(value.id)!==id||!text(value.name))return;
    const aliases=[value.id,value.name];
    for(const map of [...maps])if(map.id!==id&&!seedIds.has(map.id)&&map.aliases.some(alias=>token(alias)===token(value.name))){
      redirects[map.id]=id;aliases.push(map.id,...map.aliases);
      maps.splice(maps.indexOf(map),1);ids.splice(ids.indexOf(map.id),1);dirty=true;
    }
    merge({id,name:text(value.display_name)?value.display_name:value.name,aliases,metadataResolved:true,manifestVersion,
      specialTeamCount:value.special_team_count??value.specialTeamCount});flush();
  }
  return {maps,ids,assets,lobbies,metadata,normalizeFilters};
}
if(typeof module!=='undefined')module.exports={createLiveMapCatalog};
