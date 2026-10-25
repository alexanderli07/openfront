'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/economy-planner.js')();
const adapterPath = path.join(__dirname, '../src/economy-adapter.js');
const createAdapter = fs.existsSync(adapterPath) ? require(adapterPath) : null;
const UNIT = Object.fromEntries(['City', 'Port', 'Factory', 'SAMLauncher', 'MissileSilo', 'DefensePost', 'Warship', 'AtomBomb', 'HydrogenBomb', 'MIRV'].map(x => [x, x]));

function fixture() {
  const f = { tick: 100, gold: 1000000n, current: true, public: false, sent: [], units: [], quotes: [],
    settings: { enabled: true, economyPlanner: true, features: { build: true, nuke: true, warship: true },
      buildStructures: {}, samDefense: true, defensePosts: true } };
  const player = {
    id: () => 'me', smallID: () => 1, isAlive: () => true, isPlayer: () => true,
    gold: () => f.gold, troops: () => 900, numTilesOwned: () => 5000,
    units: (...types) => f.units.filter(u => !types.length || types.includes(u.type())),
    incomingAttacks: () => [], nearby: () => [], isFriendly: () => false,
    isOnSameTeam: () => false, isAlliedWith: () => false, hasEmbargoAgainst: () => false,
    borderTiles: () => new Set([0]),
    buildables: async (tile, types) => { f.quotes.push([tile, types]); return types.map(type => ({ type, cost: 125000n, canBuild: tile, canUpgrade: false })); },
    goldEarned: () => BigInt(f.tick * 1000), tradeGold: () => 0n, trainGold: () => 0n,
  };
  const config = { isUnitDisabled: type => f.disabled === type,
    maxTroops: () => 1000, unitInfo: () => ({ constructionDuration: 20, upgradable: true }),
    trainStationMaxRange: () => 110, trainStationMinRange: () => 15, samRange: () => 100 };
  const game = { myPlayer: () => player, ticks: () => f.tick, config: () => config,
    players: () => [player], units: (...types) => player.units(...types), numLandTiles: () => 100000,
    isLand: () => true, hasOwner: () => true, ownerID: () => 1, euclideanDistSquared: (a, b) => (a-b)**2,
    isWater: () => false, isOcean: () => false, neighbors: () => [], getWaterComponent: () => null,
    inSpawnPhase: () => false };
  const structures = { game, player, placementsCount: 0,
    ownedLevels: type => player.units(type).reduce((a, u) => a + u.level(), 0),
    samThreatLevels: () => 0, dominanceShare: () => 0.05,
    classifyBorder: () => ({ ok: true, threatFront: [], teammateSids: new Set() }),
    tilesDeepInTerritory: () => [0], randCoastalTileArray: () => [],
    structureSpawnTileValue: () => () => 1, safePlacementScorer: () => () => 1,
    getOrBuildReachableStations: () => [], getEnemyFrontTiles: () => [],
    sampleTilesNearFront: () => [], defensePostNeeded: () => false };
  const menu = { sendBuildOrUpgrade: (...args) => f.sent.push(args) };
  const deps = { core, UNIT, settings: () => f.settings, isCurrent: () => f.current,
    isPublic: () => f.public, getMenu: () => menu, sharedWater: () => null,
    territoryTiles: () => [0], log: () => {} };
  const bot = { mg: game, player, structureBehavior: structures };
  const adapter = createAdapter ? createAdapter(deps) : null;
  Object.assign(f, { player, game, config, structures, adapter, bot, menu });
  return f;
}
test('adapter is provided', () => assert.equal(typeof createAdapter, 'function'));
test('builds the first city with live quote, including valid tile zero', async () => {
  const f = fixture(); f.adapter.begin(f.bot);
  await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0][0].type, UNIT.City);
  assert.equal(f.sent[0][1], 0);
  assert.equal(f.sent[0][0].cost, 125000n);
});
test('does not send actions in a public game', async () => {
  const f = fixture(); f.public = true; f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
});
test('respects disabled building types and build toggle', async () => {
  for (const disable of ['type', 'feature', 'setting']) {
    const f = fixture();
    if (disable === 'type') f.disabled = UNIT.City;
    if (disable === 'feature') f.settings.features.build = false;
    if (disable === 'setting') f.settings.buildStructures.City = false;
    f.adapter.begin(f.bot); await f.adapter.run(f.structures);
    assert.equal(f.sent.length, 0);
  }
});
test('stop during an asynchronous quote prevents dispatch', async () => {
  const f = fixture(); const original = f.player.buildables;
  f.player.buildables = async (...args) => { const result = await original(...args); f.settings.enabled = false; return result; };
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
});
test('changing games during a quote prevents dispatch', async () => {
  const f = fixture(); const original = f.player.buildables;
  f.player.buildables = async (...args) => { const result = await original(...args); f.current = false; return result; };
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
});
test('revalidates cost before sending a selected investment', async () => {
  const f = fixture(); let calls = 0;
  f.player.buildables = async (tile, types) => types.map(type => ({ type, cost: ++calls > 1 ? 999999999n : 125000n, canBuild: tile, canUpgrade: false }));
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
});
test('a pending construction prevents a nuke spending the same wallet', async () => {
  const f = fixture(); f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(await f.adapter.send(f.menu, { type: UNIT.AtomBomb, cost: 1n, canBuild: 3, canUpgrade: false }, 3, { game: f.game, player: f.player }), false);
  assert.equal(f.sent.length, 1);
});
test('a dispatch error releases the local pending reservation', async () => {
  const f = fixture(); f.menu.sendBuildOrUpgrade = () => { throw new Error('dispatch failed'); };
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.adapter.inspect().pending, false);
});
test('missing quotes cannot become free buildings', async () => {
  const f = fixture(); f.player.buildables = async (tile, types) => types.map(type => ({ type, canBuild: tile, canUpgrade: false }));
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
});
test('repeated same-tick evaluation sends only one order', async () => {
  const f = fixture(); f.adapter.begin(f.bot); await f.adapter.run(f.structures); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 1);
});
test('export is JSON serializable and contains decision explanations', async () => {
  const f = fixture(); f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  const trace = JSON.parse(JSON.stringify(f.adapter.inspect()));
  assert.ok(trace.history.length > 0);
  assert.equal(typeof trace.history[0].reason, 'string');
});
test('unaffordable quote keeps urgent defense reserve even with both flags false', async () => {
  const f = fixture(); f.gold = 100000n;
  const enemy = { id: () => 'enemy', isPlayer: () => true, isAlive: () => true, numTilesOwned: () => 30000,
    units: type => type === UNIT.MissileSilo ? [{ isUnderConstruction: () => false }] : [] };
  f.game.players = () => [f.player, enemy]; f.structures.samThreatLevels = () => 1;
  f.player.buildables = async (tile, types) => types.map(type => ({ type, cost: 1500000n, canBuild: false, canUpgrade: false }));
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.sent.length, 0);
  assert.equal(f.adapter.inspect().history.at(-1).reserve, '1500000');
});
test('a rejected asynchronous menu dispatch is caught and releases its reservation', async () => {
  const f = fixture(); f.menu.sendBuildOrUpgrade = async () => { throw new Error('dispatch failed'); };
  f.adapter.begin(f.bot); await f.adapter.run(f.structures);
  assert.equal(f.adapter.inspect().pending, false);
});
test('origin mismatch cannot spend against a newer game context', async () => {
  const f = fixture(); f.adapter.begin(f.bot);
  const staleOrigin = { game: {}, player: f.player };
  assert.equal(await f.adapter.send(f.menu, { type: UNIT.Warship, cost: 0n, canBuild: 0 }, 0, staleOrigin), false);
});
module.exports = { fixture, UNIT };
