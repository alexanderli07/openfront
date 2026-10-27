'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLiveMapCatalog}=require('../src/lobby/live-map-catalog');
const seed=[{id:'baikal',name:'Baikal',aliases:['Baikal']},{id:'tourney1',name:'Tourney 2 Teams',aliases:['Tourney 2 Teams']}];
test('native assets and lobbies extend stable shared map/id arrays',()=>{
 const c=createLiveMapCatalog({seed}),maps=c.maps,ids=c.ids;
 c.assets({'maps/newisland/manifest.json':'/_assets/maps/newisland/manifest.abc.json'});
 assert.ok(ids.includes('newisland'));assert.equal(c.maps,maps);assert.equal(c.ids,ids);
 c.lobbies({games:{team:[{gameConfig:{gameMap:'New Island'}}]}});
 assert.equal(c.maps.find(m=>m.id==='newisland').name,'New Island');assert.equal(c.maps.length,3);
});
test('unknown live maps appear without requiring an asset list',()=>{
 const c=createLiveMapCatalog({seed});c.lobbies({games:{special:[{gameConfig:{gameMap:'Future Planet'}}]}});
 assert.ok(c.ids.includes('futureplanet'));
});
test('native metadata replaces a placeholder and keeps wire aliases',()=>{
 const c=createLiveMapCatalog({seed});c.assets({'maps/nextworld/manifest.json':'a'});
 c.metadata('nextworld',{id:'NextWorld',name:'Next World',specialTeamCount:3});
 assert.equal(c.maps.at(-1).name,'Next World');assert.equal(c.maps.at(-1).specialTeamCount,3);
 c.lobbies({games:{team:[{gameConfig:{gameMap:'NextWorld'}}]}});assert.equal(c.maps.length,3);
});
test('cached discoveries survive reload without deleting bundled maps',()=>{
 let saved;const c=createLiveMapCatalog({seed,save:v=>saved=v});
 c.lobbies({games:{ffa:[{gameConfig:{gameMap:'A New Map'}}]}});
 const next=createLiveMapCatalog({seed,cache:saved});assert.ok(next.ids.includes('anewmap'));assert.ok(next.ids.includes('baikal'));
});
test('repeated observations cause no duplicate entries or cache writes',()=>{
 let writes=0;const c=createLiveMapCatalog({seed,save:()=>writes++});
 const snapshot={games:{team:[{gameConfig:{gameMap:'Future World'}}]}};
 c.lobbies(snapshot);c.lobbies(snapshot);assert.equal(writes,1);assert.equal(c.maps.length,3);
});
test('rejects malformed cached/assets/lobby data and bounds discovery',()=>{
 const c=createLiveMapCatalog({seed,limit:4,cache:{version:1,maps:[{id:'__proto__',name:'bad'},{id:'evil',name:'<script>'}]}});
 c.assets({'maps/../../evil/manifest.json':'x'});
 c.lobbies({games:{ffa:Array.from({length:100},(_,i)=>({gameConfig:{gameMap:'Map '+i}}))}});
 assert.equal(c.maps.length,4);assert.equal(c.ids.includes('evil'),false);
});
test('storage failures never break map discovery or existing aliases',()=>{
 const c=createLiveMapCatalog({seed,save:()=>{throw new Error('storage full');}});
 c.lobbies({games:{ffa:[{gameConfig:{gameMap:'Tourney 2 Teams'}},{gameConfig:{gameMap:'Next World'}}]}});
 assert.equal(c.maps.length,3);assert.ok(c.ids.includes('tourney1'));
});
test('lobby names do not prevent later native metadata discovery',()=>{
 const c=createLiveMapCatalog({seed});c.lobbies({games:{team:[{gameConfig:{gameMap:'New Island'}}]}});
 assert.equal(c.assets({'maps/newisland/manifest.json':'a'}).length,1);
 c.metadata('newisland',{id:'NewIsland',name:'New Island',display_name:'New Island (Classic)',special_team_count:3});
 assert.equal(c.maps.at(-1).name,'New Island (Classic)');assert.equal(c.maps.at(-1).specialTeamCount,3);
});
test('native id reconciles a synthetic lobby slug and preserves its filter selection',()=>{
 let cache;const c=createLiveMapCatalog({seed,save:v=>cache=v});
 c.lobbies({games:{team:[{gameConfig:{gameMap:'Tourney 18 Teams'}}]}});
 c.assets({'maps/tourney9/manifest.json':'a'});c.metadata('tourney9',{id:'Tourney9',name:'Tourney 18 Teams'});
 assert.equal(c.maps.filter(m=>m.aliases.includes('Tourney 18 Teams')).length,1);
 assert.equal(c.normalizeFilters({tourney18teams:true}).tourney9,true);
 const next=createLiveMapCatalog({seed,cache});assert.equal(next.normalizeFilters({tourney18teams:true}).tourney9,true);
});
test('cached labels do not overwrite a newer bundled map definition',()=>{
 const c=createLiveMapCatalog({seed:[{id:'baikal',name:'Current Baikal',specialTeamCount:4}],cache:{version:1,maps:[{id:'baikal',name:'Old Baikal',specialTeamCount:2}]}});
 assert.equal(c.maps[0].name,'Current Baikal');assert.equal(c.maps[0].specialTeamCount,4);
});
test('a changed native manifest refreshes previously discovered map metadata',()=>{
 const c=createLiveMapCatalog({seed});c.assets({'maps/newisland/manifest.json':'first'});
 c.metadata('newisland',{id:'NewIsland',name:'New Island'},'first');
 assert.equal(c.assets({'maps/newisland/manifest.json':'first'}).length,0);
 assert.equal(c.assets({'maps/newisland/manifest.json':'changed'}).length,1);
 c.metadata('newisland',{id:'NewIsland',name:'New Island',display_name:'New Island Updated'},'changed');
 assert.equal(c.maps.at(-1).name,'New Island Updated');
});
test('removed native team preference does not remain cached after a map update',()=>{
 const c=createLiveMapCatalog({seed});c.assets({'maps/newisland/manifest.json':'first'});
 c.metadata('newisland',{id:'NewIsland',name:'New Island',special_team_count:3},'first');
 c.metadata('newisland',{id:'NewIsland',name:'New Island'},'changed');
 assert.equal(c.maps.at(-1).specialTeamCount,undefined);
});
