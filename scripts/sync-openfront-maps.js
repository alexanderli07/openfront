'use strict';
// Read the official generated registry as data. Never evaluate downloaded code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function catalogFromSource(source,labels,{tag}){
  const entries=[...source.matchAll(/^  (\w+) = "([^"]+)", \/\/ map-generator\/assets\/maps\/([^/]+)\/info\.json/gm)];
  if(entries.length<95)throw new Error('Official map registry is missing or unexpectedly small');
  const maps=entries.map(([,key,wire,id])=>{
    const start=source.indexOf(`    id: "${key}",`);
    if(start<0)throw new Error('Map metadata missing: '+key);
    const end=source.indexOf('\n  },',start),block=source.slice(start,end);
    const labelKey=block.match(/translationKey: "map\.([^"]+)"/)?.[1];
    const name=labels.map?.[labelKey]||wire;
    const preferred=block.match(/specialTeamCount: (\d+)/)?.[1];
    return {id,name,aliases:[...new Set([key,wire])],thumbnail:`assets/map-thumbnails/${id}/thumbnail.webp`,
      ...(preferred?{specialTeamCount:Number(preferred)}:{})};
  });
  if(new Set(maps.map(m=>m.id)).size!==maps.length)throw new Error('Duplicate map ids');
  return {source:{repository:'https://github.com/openfrontio/OpenFrontIO',tag,
    path:'packages/engine-api/src/game/Maps.gen.ts',sha256:crypto.createHash('sha256').update(source).digest('hex')},maps};
}
module.exports={catalogFromSource};
if(require.main===module){
  const [registry,labels,tag]=process.argv.slice(2);
  if(!registry||!labels||!tag)throw new Error('Usage: node scripts/sync-openfront-maps.js Maps.gen.ts en.json release-tag');
  const catalog=catalogFromSource(fs.readFileSync(registry,'utf8'),JSON.parse(fs.readFileSync(labels,'utf8')),{tag});
  fs.writeFileSync(path.join(__dirname,'../src/lobby/maps.json'),JSON.stringify(catalog,null,2)+'\n');
  console.log(`Saved ${catalog.maps.length} maps from ${tag}`);
}
