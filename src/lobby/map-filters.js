// These functions run in the lobby closure and share MAPS and settings.
function getLobbyMapTokens(lobby){
  const tokens=new Set();
  function identity(value,depth=0){
    if(depth>2||value==null)return;
    if(typeof value==='string'){
      const token=normalizeMapToken(value);if(token)tokens.add(token);return;
    }
    if(typeof value==='object'&&!Array.isArray(value))
      for(const key of ['id','name','type','key','displayName'])identity(value[key],depth+1);
  }
  // gameConfig.gameMap is the official wire identity. Do not let unrelated
  // map-sized/preview/metadata fields turn a different map into a match.
  const fields=['gameMap','gameMapId','gameMapID','gameMapName','mapId','mapID','mapName','map','mapInfo'];
  for(const container of [lobby?.gameConfig,lobby])for(const key of fields){
    identity(container?.[key]);if(tokens.size)return tokens;
  }
  return tokens;
}
function mapMatchesTokens(map,tokens){
  return [map.id,map.name,...(map.aliases||[])].some(value=>tokens.has(normalizeMapToken(value)));
}
function lobbyMatchesMapFilters(lobby){
  const included=MAPS.filter(map=>settings.mapFilters[map.id]);
  const excluded=MAPS.filter(map=>settings.mapExcludeFilters[map.id]);
  if(!included.length&&!excluded.length)return true;
  const tokens=getLobbyMapTokens(lobby);
  if(!tokens.size)return false;
  if(excluded.some(map=>mapMatchesTokens(map,tokens)))return false;
  return !included.length||included.some(map=>mapMatchesTokens(map,tokens));
}
