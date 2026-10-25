'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {buildSource}=require('../scripts/build');
const vendor=fs.readFileSync(path.join(__dirname,'../vendor/openfront-helper-1.84.0.user.js'),'utf8');
const source=buildSource().source;
const pane=s=>s.slice(s.indexOf('<div class="ab-pane" data-pane="config">'),s.indexOf('<div class="ab-pane" data-pane="log">'));
const numeric=s=>[...s.matchAll(/data-cfg-range="([^"]+)"/g)].map(m=>m[1]).sort();
const automatic=[...pane(vendor).matchAll(/data-cfg="([^"]+)"/g)].map(m=>m[1]);
function load(saved){
 const d=source.indexOf('DEFAULTS={'),end=source.indexOf(';',d);
 const start=source.indexOf('function loadSettings(){const n=['),stop=source.indexOf('function saveSettings(){',start);
 const unitNames=['City','Port','Factory','DefensePost','SAMLauncher','MissileSilo'];
 return vm.runInNewContext('const DEFAULTS='+source.slice(d+'DEFAULTS='.length,end)+';'+source.slice(start,stop)+';loadSettings()',
 {UNIT:Object.fromEntries(unitNames.map(t=>[t,t])),STORAGE_KEY:'test',window:{localStorage:{getItem:()=>JSON.stringify(saved)}},console});
}
test('all redundant internal switches are removed, including the warship purchase override',()=>{
 const config=pane(source);assert.ok(!config.includes('data-cfg="'));assert.ok(!config.includes('Auto-build warships'));
 assert.ok(config.includes('data-role="cfg-structs"'));assert.ok(config.includes('Advanced tuning'));
 const opening=config.slice(config.indexOf('<details'),config.indexOf('>',config.indexOf('<details'))+1);
 assert.ok(!/\bopen(?:\s|=|>)/.test(opening));
 assert.deepEqual(numeric(config),numeric(pane(vendor)));
 assert.ok(source.includes('featRow("warship","Warship automation"'));
});
test('old hidden rule overrides cannot disable automatic strategy; genuine user choices survive',()=>{
 const settings=load({...Object.fromEntries(automatic.map(k=>[k,false])),features:{warship:true,nuke:false,boat:false},
  enabled:false,buildStructures:{City:false},donateNeedThreshold:.6,warshipRetreatHealthPct:80});
 for(const key of automatic)assert.equal(settings[key],true,key);
 assert.equal(settings.enabled,false);assert.equal(settings.features.warship,true);assert.equal(settings.features.nuke,false);
 assert.equal(settings.features.boat,false);assert.equal(settings.buildStructures.City,false);
 assert.equal(settings.donateNeedThreshold,.6);assert.equal(settings.warshipRetreatHealthPct,80);
});
test('warship master off remains off despite removed purchase switch being enabled internally',async()=>{
 const settings=load({features:{warship:false},warshipAutoSpawn:false});
 assert.equal(settings.features.warship,false);const calls=[];
 const bot={feat:key=>key==='warship'?settings.features.warship:false,
 emojiBehavior:{maybeSendCasualEmoji(){}},updateRelationsFromEmbargos(){},allianceBehavior:{handleAllianceRequestsFromBots(){}},
 warshipBehavior:{maybeSpawnWarship:()=>calls.push('build'),counterWarshipInfestation:()=>calls.push('counter')}};
 const strategy=require('../src/brain/legacy-strategy')();
 await require('../src/brain/turn-planner')({warshipAutoSpawn:()=>settings.warshipAutoSpawn}).run(bot,{path:'full'},{
 allowed:()=>true,choose:(domain,cs)=>({...strategy.decide({domain},cs),decisionId:1}),record(){},execute:(_id,run)=>run()});
 assert.deepEqual(calls,[]);
});
