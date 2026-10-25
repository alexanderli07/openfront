// Included inside the existing Auto-Bot closure by scripts/build.js.
const ofhEconomyCore = createEconomyPlanner();
const ofhEconomyAdapter = createEconomyAdapter({
  core: ofhEconomyCore,
  UNIT,
  settings: () => state.settings,
  isCurrent: game => getGame() === game.__src,
  isPublic: game => isPublicLobby(game.__src || game),
  getMenu: () => getBuildMenu(),
  sharedWater: (game, player) => shimSharedWaterComponents(game, player),
  territoryTiles: (behavior, count) => randTerritoryTileArray(behavior.random, behavior.game, behavior.player, count),
  log: message => pushLog(message, 'build'),
  onBuild: action => {
    state.stats.builds++;
    setLastAction(`${action.upgrade ? 'Upgrade' : 'Build'} ${action.type} · ${action.reason}`, 'build');
  }
});
async function ofhPlannerSend(origin, menu, buildable, tile) {
  if (!state.settings.enabled || getGame() !== origin.game.__src || isPublicLobby(origin.game.__src)) return false;
  if (state.settings.economyPlanner === false) {
    return (await menu.sendBuildOrUpgrade(buildable, tile)) !== false;
  }
  return ofhEconomyAdapter.send(menu, buildable, tile, { game: origin.game, player: origin.player });
}
// Diagnostic access never exposes a dispatch function or mutable planner state.
window.OpenFrontEconomyPlanner = Object.freeze({
  inspect: () => ofhEconomyAdapter.inspect(),
  exportJSON: () => JSON.stringify(ofhEconomyAdapter.inspect(), null, 2)
});
