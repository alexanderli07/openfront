'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildSource}=require('../scripts/build');
function shipped(){
 const source=buildSource().source;
 const match=source.match(/\(function\(\)\{const e=(\[[\s\S]*?\]);globalThis\.OPENFRONT_MAPS=Object\.freeze\(e\)/);
 assert.ok(match,'shipped map catalog');
 const maps=vm.runInNewContext(match[1]);
 const start=source.indexOf('(function e(a){const n=Array.isArray(a.OPENFRONT_MAPS)'),end=source.indexOf('})(globalThis);',start)+'})(globalThis);'.length;
 const context=vm.createContext({OPENFRONT_MAPS:maps});vm.runInContext(source.slice(start,end),context);
 const mapStart=source.indexOf('function getLobbyMapTokens('),mapEnd=source.indexOf('function pruneCooldowns()',mapStart);
 context.MAPS=maps;context.settings={mapFilters:{},mapExcludeFilters:{}};
 context.normalizeComparableText=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
 context.normalizeMapToken=v=>context.normalizeComparableText(v).replace(/[^a-z0-9]+/g,'');
 // Old helper functions are needed by the baseline, before the fix.
 const helpers=source.slice(source.indexOf('function addMapTokensFromValue('),mapStart);
 vm.runInContext(helpers+source.slice(mapStart,mapEnd),context);
 return {source,maps,context,match:lobby=>context.lobbyMatchesMapFilters(lobby)};
}
test('picker includes all135released maps, retaining existing ids',()=>{
 const f=shipped();assert.equal(f.maps.length,135);
 for(const id of ['madagascar','newzealand','babelmandebstrait','riodejaneiro','branchingpaths','clearwaterlakes','baikal','europe'])assert.ok(f.maps.some(m=>m.id===id),id);
});
test('saved selections survive normalization and new maps default off',()=>{
 const f=shipped(),settings=f.context.OpenFrontHelperSettings.normalizeSettings({mapFilters:{baikal:true,madagascar:true},mapExcludeFilters:{newzealand:true}});
 assert.equal(settings.mapFilters.baikal,true);assert.equal(settings.mapFilters.madagascar,true);
 assert.equal(settings.mapExcludeFilters.newzealand,true);assert.equal(settings.mapFilters.clearwaterlakes,false);
});
test('actual wire map wins over unrelated metadata and exclusions win over inclusion',()=>{
 const f=shipped();f.context.settings.mapFilters.europe=true;
 assert.equal(f.match({gameConfig:{gameMap:'Madagascar',mapMetadata:{suggestedMap:'Europe'}}}),false);
 f.context.settings.mapFilters={madagascar:true};assert.equal(f.match({gameConfig:{gameMap:'Madagascar'}}),true);
 f.context.settings.mapExcludeFilters.madagascar=true;assert.equal(f.match({gameConfig:{gameMap:'Madagascar'}}),false);
});
test('new maps match wire names, enum ids and displayed names',()=>{
 const f=shipped();f.context.settings.mapFilters.babelmandebstrait=true;
 for(const gameMap of ['Bab el-Mandeb Strait','BabelMandebStrait'])assert.equal(f.match({gameConfig:{gameMap}}),true,gameMap);
 f.context.settings.mapFilters={archipelagosea:true};assert.equal(f.match({gameConfig:{gameMap:'ArchipelagoSea'}}),true);
});
test('every released map matches its canonical wire identity without prefix collisions',()=>{
 const f=shipped();
 for(const map of f.maps){
  f.context.settings.mapFilters={[map.id]:true};
  for(const name of [map.name,map.id,...map.aliases])assert.equal(f.match({gameConfig:{gameMap:name}}),true,name);
 }
 f.context.settings.mapFilters={baikal:true};assert.equal(f.match({gameConfig:{gameMap:'Baikal Nuke Wars'}}),false);
});
test('active map filters do not join a lobby with missing map identity',()=>{
 const f=shipped();f.context.settings.mapExcludeFilters.europe=true;assert.equal(f.match({gameConfig:{gameMapSize:'Normal'}}),false);
 f.context.settings.mapExcludeFilters={};assert.equal(f.match({gameConfig:{gameMapSize:'Normal'}}),true);
});
test('forecast does not silently assign new maps zero probability',()=>{
 const f=shipped(),a=f.source.indexOf('function getForecastMapsForType('),b=f.source.indexOf('function pickWeighted(',a);
 vm.runInContext(f.source.slice(a,b),Object.assign(f.context,{FORECAST_MAP_FREQUENCY:{},FORECAST_ARCADE_MAP_IDS:new Set(),FORECAST_SPECIAL_ONLY_MAP_IDS:new Set()}));
 for(const type of ['team','ffa','special'])assert.ok(f.context.getForecastMapsForType(type).some(m=>m.id==='madagascar'&&m.weight>0));
});
test('forecast preferred teams follow current registry instead of the old three-map list',()=>{
 const f=shipped(),a=f.source.indexOf('function randomTeamConfigForMap('),b=f.source.indexOf('function teamConfigToTeamSize(',a);
 const math=Object.create(Math);math.random=()=>.5;f.context.Math=math;
 vm.runInContext(f.source.slice(a,b),f.context);
 assert.equal(f.context.randomTeamConfigForMap('madagascar'),2);
 assert.equal(f.context.randomTeamConfigForMap('branchingpaths'),3);
});
