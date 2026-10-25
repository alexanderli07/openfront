'use strict';

function createGameConfigAdapter(config, unwrapPlayer) {
  // EngineConfig methods moved out of the browser Config. These rules match
  // upstream 420f27a33a0e321a4258062558da38554eea1661 (2026-10-18).
  const engineRules = {
    waterNukes: () => config.gameConfig().waterNukes ?? false,
    goldMultiplier: () => config.gameConfig().goldMultiplier ?? 1,
    boatMaxNumber: () => config.isUnitDisabled('Transport') ? 0 : 3,
    trainStationMinRange: () => 15,
    minDistanceBetweenPlayers: () => 30,
    defaultSamRange: () => 70,
    defaultNukeTargetableRange: () => 150,
    warshipTargettingRange: () => 130,
    warshipShellAttackRate: () => 20,
    warshipRetreatHealthPercent: () => 75,
    warshipVeterancyShellDamageBonus: () => 20,
    nukeSpeed: type => {
      switch(type) {
        case 'Atom Bomb': case 'Hydrogen Bomb': return 10;
        case 'MIRV': return 15;
        case 'MIRV Warhead': return 22;
        default: throw new Error(`Unknown nuke type: ${type}`);
      }
    }
  };
  function goldInteger(value) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    throw new Error('Unsupported starting gold configuration: expected a nonnegative integer');
  }
  function configuredStartingGold(playerInfo = {}) {
    // Browser configs can omit the server-side startingGold(PlayerInfo) method.
    // Use the configured initial amount, never the player's changing balance.
    if (playerInfo.playerType === 'BOT') return 0n;
    const scalar = config.startingGold;
    const match = config.gameConfig();
    const base = goldInteger(scalar === undefined ? match.startingGold ?? 0 : scalar);
    return base + (playerInfo.isLobbyCreator ? goldInteger(match.hostCheats?.startingGold ?? 0) : 0n);
  }
  return new Proxy(config, {
    get(target, key) {
      if (key === 'maxTroops') return player => config.maxTroops(unwrapPlayer(player));
      const value = target[key];
      if (key === 'startingGold' && typeof value !== 'function') return configuredStartingGold;
      if (value === undefined && Object.prototype.hasOwnProperty.call(engineRules, key)) return engineRules[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
// END GAME CONFIG COMPAT

if (typeof module !== 'undefined' && module.exports) module.exports = createGameConfigAdapter;
