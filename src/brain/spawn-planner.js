'use strict';
function createSpawnPlanner(deps) {
  const wait={id:'$wait',kind:'wait',reason:'Hold spawn selection'};
  function choose(hooks,domain,entries,facts={}) {
    const cs=entries.slice(0,79).map((entry,priority)=>({...entry,id:`${domain}:${priority}`,kind:domain,
      priority,eligible:entry.eligible!==false}));
    const d=hooks.choose(domain,[...cs,wait],facts),index=cs.findIndex(c=>c.id===d.selectedId&&c.eligible);
    if(index<0||!hooks.allowed()){hooks.hold();hooks.record('spawn-result',{domain,decisionId:d.decisionId,status:'held'});return null;}
    return {...entries[index],decisionId:d.decisionId};
  }
  function site(hooks,selected) {
    hooks.remember(selected.tile,selected.decisionId);
    hooks.record('spawn-result',{decisionId:selected.decisionId,tile:selected.tile,status:'selected'});
    return selected.tile;
  }
  function neighborhood(actor,spot,facts,hooks) {
    const coords=[{x:spot.x,y:spot.y}];
    for(let radius=2;radius<=24;radius+=2)for(let dy=-radius;dy<=radius;dy+=2)for(let dx=-radius;dx<=radius;dx+=2){
      if(Math.abs(dx)!==radius&&Math.abs(dy)!==radius)continue;
      coords.push({x:spot.x+dx,y:spot.y+dy});
    }
    const entries=coords.map((coord,index)=>({...coord,index}));
    const measured=new Map();let original;
    const probe=entry=>{
      if(measured.has(entry.index))return measured.get(entry.index);
      let tile=null;
      if(facts.game.isValidCoord(entry.x,entry.y)){
        const candidate=facts.game.ref(entry.x,entry.y);if(facts.valid(candidate))tile=candidate;
      }
      measured.set(entry.index,tile);return tile;
    };
    // Invalid geometry is measurement. Stop at the original first valid tile;
    // expose that winner and untested alternatives without querying past it.
    for(const entry of entries){if(!hooks.allowed())return null;if(probe(entry)!==null){original=entry;break;}}
    if(!original){hooks.record('spawn-result',{domain:'spawn-neighborhood',status:'no-valid-neighbor'});return null;}
    let remaining=[{...original,tile:measured.get(original.index),reason:'Original first valid nearby tile',readiness:'valid'},
      ...entries.filter(entry=>entry!==original&&!measured.has(entry.index)).map(entry=>({...entry,
        reason:'Alternative nearby coordinate; validity checked after selection',readiness:'unchecked'}))];
    while(remaining.length&&hooks.allowed()) {
      const chosen=choose(hooks,'spawn-neighborhood',remaining,{remaining:remaining.length});if(!chosen)return null;
      remaining=remaining.filter(c=>c.index!==chosen.index);
      const tile=probe(chosen);
      if(tile!==null)return site(hooks,{tile,decisionId:chosen.decisionId});
    }
    return null;
  }
  function heatmap(actor,facts,hooks) {
    const spots=actor._spawnHeatmap();
    let remaining=(spots||[]).map((spot,index)=>({spot,index}));
    while(remaining.length&&hooks.allowed()) {
      const chosen=choose(hooks,'spawn-heatmap-spot',remaining.map(e=>({index:e.index,x:e.spot.x,y:e.spot.y,
        readiness:'unchecked',reason:'Original heatmap spot order; search nearby valid tile after selection'})),{remaining:remaining.length});
      if(!chosen)return null;
      const entry=remaining.find(e=>e.index===chosen.index);remaining=remaining.filter(e=>e!==entry);
      const tile=hooks.execute(chosen.decisionId,()=>neighborhood(actor,entry.spot,facts,hooks));
      if(tile!==null||!hooks.allowed())return tile;
    }
    return null;
  }
  function random(actor,facts,hooks) {
    const {game,width,height,team,players,smart}=facts;let pool=[];
    for(let trial=0;trial<1000&&hooks.allowed();trial++) {
      const x=team?actor.random.nextInt(team.x,team.x+team.width):actor.random.nextInt(0,width);
      const y=team?actor.random.nextInt(team.y,team.y+team.height):actor.random.nextInt(0,height);
      if(!game.isValidCoord(x,y))continue;
      const tile=game.ref(x,y);
      if(!game.isLand(tile)||game.hasOwner(tile)||game.isBorder(tile)||facts.tooClose(tile))continue;
      if(!smart) {
        const chosen=choose(hooks,'spawn-random',[{tile,mode:'use',reason:'Original first valid random trial'},
          {mode:'resample',reason:'Request another random trial within the original limit'}],{trial,smart});
        if(!chosen)return null;
        if(chosen.mode==='use')return site(hooks,chosen);
        continue;
      }
      const score=actor.scoreSpawnTile(tile,players,width,height,team);
      if(score>-Infinity){
        const prior=pool.find(entry=>entry.tile===tile);
        if(prior&&prior.score>=score)continue;
        if(prior)pool=pool.filter(entry=>entry!==prior);
        pool.push({tile,score,trial,reason:'Original highest score, preserving first ties'});
        pool.sort((a,b)=>b.score-a.score||a.trial-b.trial);if(pool.length>79)pool.pop();}
    }
    if(!hooks.allowed()||!pool.length)return null;
    const chosen=choose(hooks,'spawn-random',pool,{smart,trials:1000,candidateLimit:79});
    return chosen?site(hooks,chosen):null;
  }
  function pick(actor,hooks) {
    if(!hooks.allowed())return null;
    const game = actor.mg;
    const teamSpawn = !!deps.geography && deps.settings().smartSpawn !== false && deps.geography.applies(game, actor.player);
    let remaining=[{source:'companion',reason:'Original companion override first',readiness:'unchecked'},
      {source:'heatmap',eligible:!!deps.settings().smartSpawn,reason:'Original smart heatmap second',readiness:'unchecked'},
      {source:'random',reason:'Original random search after unavailable earlier sources'}];
    if (teamSpawn) remaining.push({ source:'team-geography', adaptiveOnly:true, reason:'Measured group/coastal spawn pool' });
    let facts;
    while(remaining.some(e=>e.eligible!==false)&&hooks.allowed()) {
      const chosen=choose(hooks,'spawn-source',remaining,{teamSpawn});if(!chosen)return null;
      remaining=remaining.filter(e=>e.source!==chosen.source);
      const tile=hooks.execute(chosen.decisionId,()=>{
        if(chosen.source==='companion'){
          const tile=actor._spawnCompanion();if(tile==null)return null;
          const selected=choose(hooks,'spawn-companion',[{tile,reason:'Original authoritative companion tile'}]);
          return selected?site(hooks,selected):null;
        }
        facts??=actor._spawnFacts();
        if (chosen.source === 'team-geography') return teamSites(actor, facts, hooks);
        return chosen.source==='heatmap'?heatmap(actor,facts,hooks):random(actor,facts,hooks);
      });
      if(tile!==null||!hooks.allowed())return tile;
      hooks.record('spawn-result',{decisionId:chosen.decisionId,source:chosen.source,status:'unavailable'});
    }
    return null;
  }
  function teamSites(actor, facts, hooks) {
    const {game,width,height,team} = facts;
    const pool = [], seen = new Set();
    const add = (x,y) => {
      if (!hooks.allowed() || !game.isValidCoord(x,y) || team && (x < team.x || y < team.y || x >= team.x + team.width || y >= team.y + team.height)) return;
      const tile = game.ref(x,y);
      if (seen.has(tile) || !facts.valid(tile) || game.hasFallout(tile)) return;
      seen.add(tile);
      pool.push({tile, ...deps.geography.spawnMetrics(game, actor.player, tile, facts.players), reason:'Measured valid group/coastal spawn candidate'});
    };
    const spots = actor._spawnHeatmap() || [];
    for (const spot of spots.slice(0, 12)) {
      for (const [dx,dy] of [[0,0],[8,0],[-8,0],[0,8],[0,-8]]) {
        if (pool.length >= 24) break;
        add(spot.x+dx,spot.y+dy);
      }
    }
    for (let i=0; i<500 && pool.length<72 && hooks.allowed(); i++) {
      add(actor.random.nextInt(team?.x || 0,team ? team.x+team.width : width),
        actor.random.nextInt(team?.y || 0,team ? team.y+team.height : height));
    }
    if (!pool.length || !hooks.allowed()) return null;
    const chosen = choose(hooks,'team-spawn-site',pool,{candidates:pool.length,teamArea:!!team});
    return chosen ? site(hooks,chosen) : null;
  }
  function dispatch(actor,hooks) {
    if(!hooks.allowed())return;
    hooks.clearSite();const tile=actor.pickSpawnCenter();
    if(!hooks.allowed())return;
    hooks.execute(hooks.siteParent(),()=>actor._spawnReady(tile));
    if(hooks.wasDeclined())hooks.hold();
  }
  function tick(actor,tick,hooks) {
    if(!actor.feat('spawn')||!hooks.allowed())return;
    const due=actor.lastSpawnPickTick==null||tick-actor.lastSpawnPickTick>=6;
    const key=due?actor.currentSpawnTopKey():null;
    const repick=due&&(!actor.spawnExecAdded||key!=null&&key!==actor.lastSpawnTopKey);
    const selected=choose(hooks,'spawn-action',[{action:'repick',eligible:!!repick,reason:'Original due spawn or changed top key'},
      {action:'check',eligible:due&&!repick,reason:'Original due check; existing spawn key unchanged'},
      {action:'keep',reason:'Keep current spawn and check metadata'}],{tick,due,key,repick});
    if(!selected||selected.action==='keep')return;
    const fields=['lastSpawnPickTick','lastSpawnTopKey'];
    const before=fields.map(key=>({key,had:Object.hasOwn(actor,key),value:actor[key]}));
    try {
      actor.lastSpawnPickTick=tick;
      if(selected.action==='repick'){
        actor.lastSpawnTopKey=key;hooks.execute(selected.decisionId,()=>actor.doSpawn());
      }
    }finally{if(hooks.stopped())for(const entry of before){if(entry.had)actor[entry.key]=entry.value;else delete actor[entry.key];}}
  }
  return {pick,dispatch,tick};
}
if (typeof module !== 'undefined' && module.exports) module.exports = createSpawnPlanner;
