'use strict';

// Observe the opening; policy choices remain in the selected strategy.
function createTwoTeamOpening(deps) {
  const U = deps.units;
  const geography = new WeakMap();
  function observe(game, player, context = {}) {
    const config = game.config();
    if (config.gameConfig().gameMode !== deps.teamMode) return null;
    const players=game.players(),roster = players.filter(p => p.type() !== deps.botType);
    const teams = new Set(roster.map(p => p.team()).filter(t => t !== null && t !== undefined));
    if (teams.size !== 2 || !teams.has(player.team())) return null;
    const enemies = new Set(roster.filter(p => p.isAlive() && !player.isFriendly(p)).map(p => p.smallID()));
    const expansionEnemies=new Set(players.filter(p=>p.isAlive()&&p.smallID()!==player.smallID()&&!player.isFriendly(p)).map(p=>p.smallID()));
    const border = player.borderTiles();
    const tick = game.ticks();
    let land = geography.get(player);
    // The view's border set can refresh between ticks. Threat ownership also
    // changes each tick, so retain measurements only within that exact view.
    if (!land || land.game !== game || land.tick !== tick || land.border !== border) {
      land = { game, tick, border, wilderness: false, enemyBorder: false, coast: false, borderKnown: border.size > 0,expansionTargets:new Set() };
      for (const tile of border) {
        if (game.isShore(tile)&&(!deps.portWaterAccess||deps.portWaterAccess.assess(game,tile).allowed)) land.coast = true;
        for (const neighbor of game.neighbors(tile)) {
          if (!game.isLand(neighbor)) continue;
          if (!game.hasOwner(neighbor)) {
            if (!game.hasFallout(neighbor)) land.wilderness = true;
          } else {
            const owner=game.ownerID(neighbor);
            if(enemies.has(owner))land.enemyBorder=true;
            if(expansionEnemies.has(owner))land.expansionTargets.add(owner);
          }
        }
      }
      geography.set(player, land);
    }
    const enabled = type => !config.isUnitDisabled(type) && (!deps.buildAllowed || deps.buildAllowed(type));
    const count = type => player.units(type).filter(unit => (!unit.isActive || unit.isActive())&&
      (type!==U.Port||!deps.portWaterAccess||deps.portWaterAccess.assess(game,unit.tile()).allowed)).length;
    const ports = count(U.Port), cities = count(U.City), factories = count(U.Factory), sams = count(U.SAMLauncher);
    const portTarget = enabled(U.Port) && land.coast && context.sharedWater !== false ? 2 : 0;
    const economyMode = portTarget ? 'coastal' : 'factory';
    const cityTarget = enabled(U.City) ? (portTarget ? 1 : 2) : 0;
    const factoryTarget = !portTarget && enabled(U.Factory) ? 1 : 0;
    const samEnabled = enabled(U.SAMLauncher) && !config.isUnitDisabled(U.MissileSilo) &&
      [U.AtomBomb, U.HydrogenBomb, U.MIRV].some(type => !config.isUnitDisabled(type));
    const frontline = land.enemyBorder || player.incomingAttacks().some(a => Number(a.troops()) > 0);
    const economyReady = ports >= portTarget && cities >= cityTarget && factories >= factoryTarget;
    return { frontline, wilderness: land.wilderness, borderKnown: land.borderKnown,
      expansionPending:land.wilderness||land.expansionTargets.size>0,expansionTargets:[...land.expansionTargets],
      ports, cities, factories, sams, portTarget, cityTarget, factoryTarget, samEnabled, economyReady, economyMode,
      stage: frontline ? 'frontline' : !land.borderKnown ? 'survey' : land.wilderness ? 'wilderness' :
        !economyReady ? 'economy' : samEnabled && !sams ? 'first-sam' : 'development' };
  }
  return { observe };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createTwoTeamOpening;
