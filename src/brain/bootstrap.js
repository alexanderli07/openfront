// Runs in the original Auto-Bot closure. No patches to the game's own event bus.
const ofhPortWaterAccess=createPortWaterAccess();
const ofhTeamGeography = createTeamGeography({units:UNIT,botType:PlayerType.Bot,teamMode:GameMode.Team});
const ofhTeamOpening = createTwoTeamOpening({units:UNIT,botType:PlayerType.Bot,teamMode:GameMode.Team,
  portWaterAccess:ofhPortWaterAccess,
  buildAllowed:type=>autoBotBuildAllowed(type)});
const ofhMatchArchive=createMatchArchive({createSummary:createMatchSummary,
  onError:message=>pushLog('Match history storage warning: '+message,'system'),
  indexedDB:(()=>{try{return window.indexedDB;}catch{return null;}})()});
window.addEventListener('pagehide',()=>{ofhMatchArchive.flush().catch(()=>{});});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')ofhMatchArchive.flush().catch(()=>{});});
const ofhBrainRuntime = createBrainRuntime({
  createEngine: createDecisionEngine,
  createCommandGuard,createSpendingLedger,createReactiveSam,createSamDevelopment,
  createSupportPosture:()=>createSupportPosture({units:UNIT,botType:PlayerType.Bot,teamMode:GameMode.Team}),
  wildernessCrossing:createWildernessCrossing(),
  portWaterAccess:ofhPortWaterAccess,
  defenseEconomy:createDefenseEconomy({units:UNIT,portWaterAccess:ofhPortWaterAccess,buildAllowed:type=>autoBotBuildAllowed(type)}),
  samDefenseObserver:createSamDefenseObserver({units:UNIT}),
  sendSamUpgrade:(actor,quote)=>{
    const menu=getBuildMenu();if(!menu||typeof menu.sendBuildOrUpgrade!=='function')return false;
    ofhBrainRuntime.build(actor,'SAMDefense',menu,quote);
    if(ofhBrainRuntime.wasDeclined(actor))return false;
    state.stats.builds++;setLastAction(tr('🛡️ SAM upgrade'),'build');return true;
  },
  openingExpansion:createOpeningExpansion({settings:()=>state.settings}),
  startHistory:bot=>{
    const identity=()=>{
      let gameId=null,playerId=null;
      try{gameId=(bot.mg.__src||bot.mg).gameID();playerId=(bot.mg.myPlayer()||bot.player)?.id();}catch{}
      return {gameId,playerId};
    };
    return ofhMatchArchive.start({...identity(),helperVersion:'1.84.75'},identity);
  },
  createLegacyStrategy,
  teamGeography:ofhTeamGeography,units:UNIT,buildAllowed:type=>autoBotBuildAllowed(type),reserveGold:gold=>mirvReserveHold(gold),
  twoTeamOpening: ofhTeamOpening,
  socialPlanner:createSocialPlanner(),
  allianceEventPlanner:createAllianceEventPlanner({collect:()=>collectAllianceEvents(),requestTypes:()=>ALLIANCE_REQUEST_TYPES,renewTypes:()=>RENEW_TYPES,
    isActioned:event=>_allianceBehaviorActioned.has(event),veto:target=>typeof companionAllianceVeto==='function'&&companionAllianceVeto(target),pick:pickAllianceButton}),
  strategies: [createAdaptiveStrategy(createLegacyStrategy())],
  defaultStrategy: 'adaptive-v1',
  boatPlanner: createBoatPlanner({state}),
  embargoPlanner: createEmbargoPlanner(),
  embargoAllCtor:()=>discoverCtors(getEventBus()).embargoAll,
  botType:PlayerType.Bot,
  spawnPlanner: createSpawnPlanner({settings:()=>state.settings,geography:ofhTeamGeography}),
  attackAllocationPlanner: createAttackAllocationPlanner({settings:()=>state.settings,difficulty:currentDifficulty,
    easy:Difficulty.Easy,botType:PlayerType.Bot}),
  attackRoutingPlanner: createAttackRoutingPlanner({settings:()=>state.settings,botType:PlayerType.Bot,closestTwoTiles}),
  diplomacyDetailsPlanner: createDiplomacyDetailsPlanner({settings:()=>state.settings,debug:ofhDebug}),
  buildingPlanner: createBuildingPlanner({ units: UNIT, settings: () => state.settings,
    difficulty: currentDifficulty, densityThreshold: UPGRADE_DENSITY_THRESHOLD, samProtectWeight }),
  turnPlanner: createTurnPlanner({ warshipAutoSpawn: () => state.settings.warshipAutoSpawn !== false }),
  warshipMaintenancePlanner: createWarshipMaintenancePlanner({ settings: () => state.settings }),
  warshipTransportPlanner: createWarshipTransportPlanner({ transportType: UNIT.TransportShip, tradeType: UNIT.TradeShip, warshipType: UNIT.Warship }),
  structurePlanner: createStructurePlanner({ units: UNIT, settings: () => state.settings, difficulty: currentDifficulty,
    spendableGold: actor => { const gold = actor.player.gold(); const hold = mirvReserveHold(gold); return gold > hold ? gold - hold : 0n; } }),
  structurePlacementPlanner: createStructurePlacementPlanner({ units: UNIT, settings: () => state.settings,
    portWaterAccess:ofhPortWaterAccess,
    opening:ofhTeamOpening,samPlacement:createSamPlacement({units:UNIT}),
    geography:ofhTeamGeography,
    randomTerritoryTiles: randTerritoryTileArray, maxProbes: MAX_SPAWN_PROBES }),
  botTargetPlanner: createBotTargetPlanner({ botType: PlayerType.Bot, attackStructures: AttackStructures }),
  attackGeographyPlanner: createAttackGeographyPlanner({ settings: () => state.settings,
    transportType: UNIT.TransportShip, ffaMode: GameMode.FFA, closestTwoTiles,
    encircleScanTicks: ENCIRCLE_SCAN_TICKS }),
  attackPlanner: createAttackPlanner({ settings: () => state.settings, difficulty: currentDifficulty,
    botType: PlayerType.Bot, hostileRelation: Relation.Hostile }),
  attackSequencePlanner: createAttackSequencePlanner({ state, botType: PlayerType.Bot,
    now: () => performance.now(), debug: ofhDebug }),
  diplomacyPlanner: createDiplomacyPlanner({ settings: () => state.settings, neutralRelation: Relation.Neutral,
    friendlyRelation: Relation.Friendly, difficulty: currentDifficulty,
    difficulties: { easy: Difficulty.Easy, medium: Difficulty.Medium }, humanType: PlayerType.Human,
    emojis: { confused: EMOJI_CONFUSED, scared: EMOJI_SCARED_OF_THREAT, love: EMOJI_LOVE, handshake: EMOJI_HANDSHAKE,
      assistLow: EMOJI_ASSIST_RELATION_TOO_LOW, assistMe: EMOJI_ASSIST_TARGET_ME,
      assistAlly: EMOJI_ASSIST_TARGET_ALLY, assistAccept: EMOJI_ASSIST_ACCEPT } }),
  navalLandingPlanner: createNavalLandingPlanner(),
  warshipPatrolPlanner: createWarshipPatrolPlanner(),
  warshipThreatPlanner: createWarshipThreatPlanner({transportType:UNIT.TransportShip,tradeType:UNIT.TradeShip,warshipType:UNIT.Warship,settings:()=>state.settings}),
  warshipDetailsPlanner: createWarshipDetailsPlanner({warshipType: UNIT.Warship, settings: () => state.settings}),
  warshipTradeHotspots:createWarshipTradeHotspots({units:UNIT,now:()=>performance.now()}),
  warshipMoveCtor:()=>discoverCtors(getEventBus()).moveWarship,
  warshipCombatPlanner: createWarshipCombatPlanner({ warshipType: UNIT.Warship, difficulty: currentDifficulty }),
  warshipSafetyPlanner: createWarshipSafetyPlanner({portType: UNIT.Port, settings: () => state.settings}),
  warshipDeploymentPlanner: createWarshipDeploymentPlanner({ portType: UNIT.Port, warshipType: UNIT.Warship }),
  strikePlanner: createStrikePlanner({ state, units: UNIT, difficulty: currentDifficulty, salvoPace,
    salvoMessage: count => setLastAction(tr('☢️ Salvo ×{n} → dense target', { n: count }), 'nuke') }),
  strikeTargetPlanner: createStrikeTargetPlanner({ units: UNIT, settings: () => state.settings, difficulty: currentDifficulty,
    ffa: GameMode.FFA, friendly: Relation.Friendly, hostile: Relation.Hostile, maxSiloLevel: MAX_NATION_SILO_UPGRADE_LEVEL,
    salvoPace, samMessage: count => setLastAction(tr('☢️ Salvo ×{n} → SAM break', { n: count }), 'nuke') }),
  strikeRanking: createStrikeRanking({ settings: () => state.settings, difficulty: currentDifficulty,
    ffa: GameMode.FFA, team: GameMode.Team, botType: PlayerType.Bot, structureTypes: NUKE_STRUCTURES_TYPES,
    densityThreshold: HIGH_DENSITY_NUKE_THRESHOLD, minLevels: MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE }),
  navalActionPlanner: createNavalActionPlanner({ state, transportType: UNIT.TransportShip, debug: ofhDebug }),
  probeLanding: (actor, tile, fallback) => withTimeout(actor.player.bestTransportShipSpawn(tile), WORKER_TIMEOUT_MS, fallback),
  probeCrossing:(actor,tile)=>withTimeout(actor.player.bestTransportShipSpawn(tile),500,false),
  landingDiagnostics: data => { state._distantDiag = data; },
  enabled: () => state.settings.enabled,
  settings: () => state.settings,
  isCurrent: bot => typeof _bot !== 'undefined' && _bot === bot && getGame() === bot.mg.__src,
  isPublic: game => isPublicLobby(game.__src || game),
  emitIntent: (ctor, ...args) => emitIntent(ctor, ...args),
  transportType: UNIT.TransportShip,
  isTransportIntent: ctor => ctor === _ctors.boat,
  isDonationIntent:ctor=>ctor===_ctors.donateTroops,
  watchTransportIntents: observe => {
    const bus=getEventBus(),ctor=discoverCtors(bus).boat;
    if(!bus||typeof bus.on!=='function'||typeof bus.off!=='function'||!ctor)throw new Error('Transport launch observer unavailable');
    const listener=event=>observe(event.dst);
    bus.on(ctor,listener);
    return ()=>bus.off(ctor,listener);
  },
  intentName: ctor => Object.keys(_ctors).find(key => _ctors[key] === ctor) || 'intent',
  log: message => pushLog(message, 'system')
});
function ofhDownloadBrainJSON(trace,prefix,pretty=false) {
  const blob = new Blob([JSON.stringify(trace, null, pretty?2:undefined)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ofhExportBrainTrace(){ofhDownloadBrainJSON(ofhBrainRuntime.inspect(),'openfront-decisions',true);}
async function ofhExportMatchSummary(){
  try{
    const summary=await ofhMatchArchive.exportSummary();
    if(summary.persistence.error)pushLog('History storage warning: '+summary.persistence.error,'system');
    ofhDownloadBrainJSON(summary,'openfront-match');
  }catch(error){pushLog('Match summary unavailable: '+String(error?.message||error),'system');}
}
window.OpenFrontBrain = Object.freeze({
  inspect: () => ofhBrainRuntime.inspect(),
  exportJSON: () => JSON.stringify(ofhBrainRuntime.inspect(), null, 2),
  download: ofhExportBrainTrace,
  matchSummary:()=>ofhMatchArchive.exportSummary(),
  downloadSummary:ofhExportMatchSummary,
  saveHistory:()=>ofhMatchArchive.flush(),
  strategies: () => ofhBrainRuntime.strategies(),
  replay: (id, trace) => ofhBrainRuntime.replay(id, trace),
  useStrategy: id => ofhBrainRuntime.select(id)
});
