'use strict';

function createWarshipCombatPlanner(deps) {
  const wait = { id: '$wait', kind: 'wait', reason: 'Hold destination' };
  function destination(hooks, domain, entries, facts) {
    const candidates = entries.slice(0,79).map((entry,priority)=>({ ...entry,
      id:`${domain}:${priority}`,kind:domain,priority,eligible:true }));
    const decision = hooks.choose(domain,[...candidates,wait],facts);
    const selected = candidates.find(c=>c.id===decision.selectedId);
    const allowed = hooks.allowed();
    hooks.record(`${domain}-result`,{decisionId:decision.decisionId,
      status: !allowed ? 'stopped' : selected ? 'selected' : 'wait',tile:selected?.tile,reason:decision.reason});
    return { tile: allowed && selected ? selected.tile : null, decisionId:decision.decisionId,selected };
  }
  function target(actor, context, purpose, hooks) {
    const entries = [];
    if(purpose==='trade-hunt'&&context.hotspotMode)return destination(hooks,'warship-hotspot',
      context.hotspotCandidates||[],{unitId:context.ship.id(),purpose:'trade-area'});
    if (purpose === 'intercept') return destination(hooks, 'warship-target',
      context.transports.map(t => ({ ...t, reason:'Hostile transport approaching same-team land; shortest remaining landing distance first' })),
      {purpose,unitId:context.ship.id(),targets:context.transports.length});
    if(purpose==='return-to-team')return destination(hooks,'warship-destination',
      [{tile:context.returnToTeam,reason:'Withdraw toward supported team water; no eligible local piracy post'}],{purpose,unitId:context.ship.id()});
    if (purpose === 'retreat') {
      if (context.home !== null) entries.push({tile:context.home,reason:'Return to original home destination'});
      return destination(hooks,'warship-destination',entries,{purpose,unitId:context.ship.id()});
    }
    const units = purpose === 'engage' ? context.enemies : context.trades;
    const component = purpose === 'trade-hunt' ? actor.game.getWaterComponent(context.ship.tile()) : null;
    let winner = purpose === 'engage' ? -1 : 0, best = Infinity;
    for (const [index,unit] of units.entries()) {
      if (purpose === 'trade-hunt' && actor.game.getWaterComponent(unit.tile()) !== component) continue;
      const value = purpose === 'engage' ? unit.health() : actor.game.manhattanDist(context.ship.tile(),unit.tile());
      if (value < best) { best=value;winner=index; }
      entries.push({index,value,unit});
    }
    const ranked = entries.filter(e=>purpose!=='engage'||e.value<Infinity)
      .sort((a,b)=>(a.index===winner?-1:b.index===winner?1:0)||a.value-b.value||a.index-b.index);
    const proposals=[];
    for(const entry of ranked.slice(0,79)) {
      let tile,targetId;
      // Only the original winner's tile was mandatory in the baseline. Extra
      // alternative/telemetry getters must not abort that original action.
      if(entry.index===winner)tile=entry.unit.tile();
      else { try { tile=entry.unit.tile(); } catch { continue; } }
      try { targetId=entry.unit.id?.(); } catch {}
      proposals.push({tile,targetId,metric:entry.value,
        reason:purpose==='engage'?'Lowest enemy health, preserving first ties':'Nearest hostile trade, preserving first ties'});
    }
    return destination(hooks,'warship-target',proposals,
      {purpose,unitId:context.ship.id(),targets:units.length,candidateLimit:79});
  }
  function waypoint(actor, start, home, enemies, hooks) {
    if (!hooks.allowed()) return null;
    const game=actor.game,component=game.getWaterComponent(start);
    const queue=[{tile:start,depth:0}],seen=new Set([start]),entries=[];
    let best=-Infinity,winner=0;
    for(let cursor=0;cursor<queue.length;cursor++) {
      if (!hooks.allowed()) return null;
      const {tile,depth}=queue[cursor];let nearest=Infinity;
      for(const enemy of enemies) {
        const distance=game.manhattanDist(tile,enemy.tile());
        if(distance<nearest)nearest=distance;
      }
      const homeDistance=home?game.manhattanDist(tile,home):0;
      const neighbors=game.neighbors(tile);let waterNeighbors=0;
      for(const neighbor of neighbors)if(game.isWater(neighbor))waterNeighbors++;
      const score=Math.min(nearest,15)*50-homeDistance-(4-waterNeighbors)*15;
      if(score>best){best=score;winner=cursor;}
      entries.push({tile,depth,nearestEnemy:nearest,homeDistance,waterNeighbors,score,order:cursor,
        reason:'Original enemy-distance, home-distance and water-neighbor score'});
      if(depth>=30)continue;
      for(const neighbor of neighbors)if(game.isWater(neighbor)&&game.getWaterComponent(neighbor)===component&&!seen.has(neighbor)) {
        seen.add(neighbor);queue.push({tile:neighbor,depth:depth+1});
      }
    }
    entries.sort((a,b)=>(a.order===winner?-1:b.order===winner?1:0)||b.score-a.score||a.order-b.order);
    const result=destination(hooks,'warship-waypoint',entries,{start,home,depthLimit:30,
      visited:entries.length,candidateLimit:79,enemies:enemies.length});
    if(result.tile!==null)hooks.remember?.(result.decisionId);
    return result.tile;
  }
  function choose(hooks, domain, purposes, facts) {
    const candidates = purposes.map(([purpose, eligible, reason, adaptiveOnly], priority) => ({
      id: `${domain}:${purpose}`, kind: domain, purpose, eligible, priority, reason, ...(adaptiveOnly ? {adaptiveOnly:true} : {})
    }));
    const decision = hooks.choose(domain, [...candidates, { id: '$wait', kind: 'wait', reason: 'Hold position' }], facts);
    const selected = candidates.find(c => c.id === decision.selectedId && c.eligible);
    const report = (status, details = {}) => hooks.record(`${domain}-result`, {
      decisionId: decision.decisionId, purpose: selected?.purpose, status, ...details
    });
    if (!selected) report('wait', { reason: decision.reason });
    return { selected, decision, report };
  }

  function combat(actor, context, hooks) {
    if (!hooks.allowed()) return;
    const { ship, smart, health, maxHealth, retreatRatio, evade, enemies, trades, home, hunt, patrol } = context;
    const low = health < maxHealth * retreatRatio;
    const danger = evade && enemies.length > 0;
    const { selected, decision, report } = choose(hooks, 'warship-combat', [
      ['retreat', low, 'Health below retreat threshold'],
      ['evade', !low && danger, 'Battle prediction requires evasion'],
      ['engage', !low && !evade && enemies.length > 0, 'Engage weakest nearby enemy'],
      ['trade-hunt', !low && !danger && enemies.length === 0 && hunt && (context.hotspotMode?context.hotspotCandidates?.length>0:trades.length>0), context.hotspotMode?'Hold a productive trade area':'Hunt nearest hostile trade ship'],
      ...(context.returnToTeam!=null?[['return-to-team',!low&&!danger&&enemies.length===0,
        'Withdraw from unsupported waters toward our team',true]]:[]),
      ...(context.transports?.length ? [['intercept', !low && !danger && enemies.length === 0,
        'Intercept hostile transports approaching same-team land', true]] : [])
    ], { unitId: ship.id(), tile: ship.tile(), health, maxHealth, retreatRatio, evade,
      nearbyEnemies: enemies.length, tradeTargets: trades.length, home });
    if (!selected) return;
    if (!hooks.allowed()) { report('stopped'); return; }
    return hooks.execute(decision.decisionId, () => {
      const escape = selected.purpose === 'evade' || selected.purpose === 'retreat' && danger;
      const result = escape ? (hooks.waypoint ? hooks.waypoint(ship.tile(),home,enemies) :
        { tile:actor.findSafeWaypoint(ship.tile(),home,enemies),decisionId:decision.decisionId }) :
        target(actor,context,selected.purpose,hooks);
      const { tile } = result;
      if (tile === null) { report('held', { reason: 'No destination' }); return; }
      const previous = patrol ? patrol.patrolTile : undefined;
      const distant = previous === undefined || actor.game.manhattanDist(previous, tile) > 20;
      let sameWater = true;
      try { sameWater = actor.game.getWaterComponent(tile) === actor.game.getWaterComponent(ship.tile()); } catch {}
      if(context.hotspotMode&&selected.purpose==='trade-hunt'&&!distant&&sameWater)hooks.assigned?.(result.selected);
      if (!distant || !sameWater) { report('held', { tile, distant, sameWater }); return; }
      if (!hooks.allowed()) { report('stopped'); return; }
      let commandDeclined=false;
      hooks.execute(result.decisionId,()=>{
        const moved=context.hotspotMode&&selected.purpose==='trade-hunt'&&hooks.move?hooks.move(ship,tile):actor.moveWarship(ship,tile);
        commandDeclined=moved===false||hooks.wasDeclined?.() === true;
        if(!commandDeclined&&context.hotspotMode&&selected.purpose==='trade-hunt')hooks.assigned?.(result.selected);
        if(!commandDeclined)smart.cooldown.set(ship.id(), actor.game.ticks());
      });
      report(commandDeclined?'declined':'move-attempted', { tile });
    });
  }

  function retaliate(actor, tile, target, cause, hooks) {
    if (!hooks.allowed()) return;
    if (target.smallID() === actor.player.smallID()) return;
    const capped = actor.player.units(deps.warshipType).length >= 10;
    let build = false;
    if (!capped) {
      const difficulty = deps.difficulty();
      if (difficulty === 'Medium') build = actor.random.nextInt(0, 100) < 15;
      else if (difficulty === 'Hard') build = actor.random.nextInt(0, 100) < 50;
      else if (difficulty === 'Impossible') build = actor.random.nextInt(0, 100) < 100;
    }
    const { selected, decision, report } = choose(hooks, 'warship-retaliation', [
      ['reposition', capped, 'Fleet cap reached; reposition existing warship'],
      ['build', build, 'Original difficulty roll permits retaliation build']
    ], { tile, targetId: target.smallID(), cause, capped, build });
    if (!selected) { if(capped||build||decision.selectedId===null)hooks.hold(); return; }
    if (!hooks.allowed()) { report('stopped'); return; }
    if (selected.purpose === 'reposition') {
      hooks.execute(decision.decisionId, () => actor.maybeMoveWarship(tile));
      report('move-attempted', { tile }); return;
    }
    // Do not hold the actor's parent scope while waiting: concurrent responses can finish out of order.
    void (async () => {
      try {
        const buildable = await actor.buildableWarship(tile);
        if (!hooks.allowed()) { hooks.hold(); report('stopped'); return; }
        const outcome = hooks.execute(decision.decisionId, () => actor._retaliateBuildReady(tile, target, cause, buildable));
        report('response-completed', { tile, outcome: outcome === false ? 'declined' : outcome,
          buildable: buildable != null && buildable.canBuild !== false });
      } catch (error) { report('threw', { error: String(error?.message || error) }); }
    })();
  }
  return { combat, retaliate, waypoint };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createWarshipCombatPlanner;
