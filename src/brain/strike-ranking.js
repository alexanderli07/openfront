'use strict';

function createStrikeRanking(deps) {
  function collect(actor,mode) {
    const entries=[];
    const add=(player,score,facts={})=>entries.push({player,score,facts,index:entries.length});
    if (['counter','denial','steamroll','win-fix'].includes(mode) && actor.player===null) {
      if (mode==='win-fix') return entries;
      throw new Error('not initialized');
    }
    if (mode==='counter') {
      for(const player of actor.getValidMirvTargetPlayers().filter(p=>actor.isInboundMIRVFrom(p))) add(player,player.numTilesOwned(),{inbound:true});
    } else if(mode==='win-fix') {
      const valid=actor.getValidMirvTargetPlayers().filter(p=>p.isAlive());
      if(!valid.length)return entries;
      const land=actor.game.numLandTiles()||1, settings=deps.settings();
      const minimum=settings.mirvTargetMinShare??.35, topN=settings.mirvTargetTopN??3;
      const top=new Set(actor.game.players().filter(p=>p.isAlive()).sort((a,b)=>b.numTilesOwned()-a.numTilesOwned()).slice(0,topN).map(p=>p.smallID()));
      for(const player of valid) if(top.has(player.smallID())&&player.numTilesOwned()/land>minimum) add(player,player.numTilesOwned(),{share:player.numTilesOwned()/land,minimum,topN});
    } else if(mode==='denial') {
      const land=actor.game.numLandTiles();if(land===0)return entries;
      for(const player of actor.getValidMirvTargetPlayers()) {
        let severity=0;const team=player.team();
        if(team!==null) {
          const members=actor.game.players().filter(p=>p.team()===team&&p.isPlayer());
          const share=members.map(p=>p.numTilesOwned()).reduce((a,b)=>a+b,0)/land;
          if(share>=actor.victoryDenialTeamThreshold) {
            let leader=null,largest=-1;
            for(const member of members) if(member.numTilesOwned()>largest){largest=member.numTilesOwned();leader=member;}
            if(leader!==null&&leader.smallID()===player.smallID())severity=share;
          }
        } else {
          const share=player.numTilesOwned()/land;
          if(share>=actor.victoryDenialIndividualThreshold)severity=share;
        }
        if(severity>0)add(player,severity,{team,share:severity});
      }
    } else if(mode==='steamroll') {
      const valid=actor.getValidMirvTargetPlayers();if(!valid.length)return entries;
      const cities=actor.game.players().filter(p=>p.isPlayer()).map(p=>({player:p,count:actor.countCities(p)})).sort((a,b)=>b.count-a.count);
      if(cities.length<2)return entries;
      const leader=cities[0],threshold=cities[1].count*actor.steamrollCityGapMultiplier;
      if(leader.count>actor.steamrollMinLeaderCities&&leader.count>=threshold&&valid.some(p=>p.smallID()===leader.player.smallID()))add(leader.player,leader.count,{runnerUpCities:cities[1].count,threshold});
    } else if(mode==='density') {
      for(const player of actor.game.players()) {
        if(player.smallID()===actor.player.smallID()||player.type()===deps.botType||actor.player.isFriendly(player))continue;
        const tiles=player.numTilesOwned();if(tiles===0)continue;
        let levels=0;for(const unit of player.units(...deps.structureTypes))levels+=unit.level();
        if(levels<deps.minLevels)continue;
        const density=levels/tiles;if(density>deps.densityThreshold)add(player,density,{tiles,levels,threshold:deps.densityThreshold});
      }
    } else if(mode==='crown') {
      const difficulty=deps.difficulty(),gameMode=actor.game.config().gameConfig().gameMode;
      if(gameMode!==deps.ffa||actor.game.players().length<=1)return entries;
      const players=actor.game.players().slice().sort((a,b)=>b.numTilesOwned()-a.numTilesOwned()),leader=players[0];
      if(difficulty==='Impossible'&&leader.smallID()===actor.player.smallID()&&players.length>=2&&!actor.player.isFriendly(players[1])) {
        add(players[1],players[1].numTilesOwned(),{reason:'Self leads; target runner-up'});return entries;
      }
      if(leader.smallID()===actor.player.smallID()||actor.player.isFriendly(leader))return entries;
      const land=actor.game.numLandTiles()-actor.game.numTilesWithFallout();if(land<=0)return entries;
      const gap=leader.numTilesOwned()/land-actor.player.numTilesOwned()/land;
      const threshold={Easy:.4,Medium:.3,Hard:.2,Impossible:.1}[difficulty]??.1;
      if(gap>threshold)add(leader,gap,{threshold});
    } else if(mode==='team') {
      if(actor.game.config().gameConfig().gameMode!==deps.team||actor.game.players().length<=1)return entries;
      const teams=new Map(),members=new Map();
      for(const player of actor.game.players()) {
        const team=player.team();if(team===null)continue;
        teams.set(team,(teams.get(team)??0)+player.numTilesOwned());
        if(!members.has(team))members.set(team,[]);members.get(team).push(player);
      }
      const ordered=[...teams].sort((a,b)=>b[1]-a[1]);if(!ordered.length)return entries;
      let team=ordered[0][0];if(team===actor.player.team()){if(ordered.length<2)return entries;team=ordered[1][0];}
      for(const player of members.get(team).filter(p=>!actor.player.isFriendly(p))) add(player,actor.game.config().maxTroops(player),{team,teamTiles:teams.get(team)});
    } else throw new Error(`Unknown strike ranking: ${mode}`);
    entries.sort((a,b)=>b.score-a.score||(mode==='team'?b.index-a.index:a.index-b.index));
    return entries;
  }
  function select(actor,mode,hooks) {
    if(!hooks.allowed())return {target:null,stop:true};
    const entries=collect(actor,mode), visible=entries.slice(0,79);
    const domain=['counter','denial','steamroll','win-fix'].includes(mode)?'mirv-target':'nuke-player';
    const candidates=visible.map((entry,priority)=>({id:`${mode}:${entry.index}`,kind:domain,priority,eligible:true,
      targetId:entry.player.id(),score:entry.score,facts:entry.facts,reason:`Original ${mode} ranking; ${mode==='team'?'last':'first'} tie wins`}));
    const decision=hooks.choose(domain,[...candidates,{id:'$wait',kind:'wait',reason:'Hold target selection'}],{mode,candidateLimit:79});
    const index=candidates.findIndex(c=>c.id===decision.selectedId);
    const allowed=hooks.allowed(),target=index>=0&&allowed?visible[index].player:null;
    const stop=!allowed||index<0&&(entries.length>0||decision.selectedId===null);
    hooks.record('strike-ranking-result',{mode,decisionId:decision.decisionId,status:!allowed?'stopped':target?'target-selected':'wait',
      targetId:index>=0?candidates[index].targetId:null,stop});
    return {target,stop,decisionId:decision.decisionId};
  }
  return {select};
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStrikeRanking;
