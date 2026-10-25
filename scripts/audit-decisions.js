'use strict';
const {buildSource}=require('./build');
const source=buildSource().source;
const names=['EmojiBehavior','AllianceBehavior','MirvBehavior','WarshipBehavior','StructureBehavior','AttackBehavior','NukeBehavior','NationBot'];
function body(name){
  const start=source.indexOf(`class ${name}{`);if(start<0)throw Error(`Missing ${name}`);
  let depth=1,quote=null,index=start+`class ${name}{`.length;
  for(;index<source.length&&depth;index++){
    const char=source[index];
    if(quote){if(char==='\\')index++;else if(char===quote)quote=null;}
    else if(char==='"'||char==="'"||char==='`')quote=char;
    else if(char==='{')depth++;else if(char==='}')depth--;
  }
  if(depth)throw Error(`Unclosed ${name}`);return source.slice(start,index);
}
let failures=0;
for(const name of names){
  const text=body(name),rawIntents=[...text.matchAll(/\bemitIntent\(/g)].length,
    rawBuilds=[...text.matchAll(/\.sendBuildOrUpgrade\(/g)].length,
    plannerCalls=[...text.matchAll(/ofhBrainRuntime\./g)].length;
  if(rawIntents||rawBuilds)failures++;
  process.stdout.write(`${name}: ${plannerCalls} runtime boundaries; ${rawIntents} raw intents; ${rawBuilds} raw builds\n`);
  for(const match of text.matchAll(/random\.randElement\(|\.sort\(/g)){
    process.stdout.write(`  review fact/sample: ${text.slice(Math.max(0,match.index-45),match.index+85)}\n`);
  }
}
const reactionCalls=[...source.matchAll(/respondToMIRV\(this\.game,this\.random,e,this\)/g)].length;
if(reactionCalls!==1)failures++;
process.stdout.write(`MIRV reaction: ${reactionCalls} owned actor call; respondToEmoji references: ${[...source.matchAll(/\brespondToEmoji\(/g)].length} (definition only expected)\n`);
process.stdout.write('This inventory requires source review; gateway counts alone do not prove decision ownership.\n');
process.exitCode=failures?1:0;
