'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const location = path.join(__dirname, '../src/brain/structure-placement-planner.js');
const createPlanner = fs.existsSync(location) ? require(location) : null;
const U = { City: 'City', Port: 'Port', Factory: 'Factory', SAMLauncher: 'SAMLauncher', MissileSilo: 'MissileSilo' };
const createLegacyStrategy = require('../src/brain/legacy-strategy');

test('legacy placement excludes added adaptive route samples', () => {
  const decision = createLegacyStrategy().decide({ domain: 'structure-placement' }, [
    { id: 'new-route', kind: 'structure-placement', eligible: true, adaptiveOnly: true, priority: 0 },
    { id: 'original-tile', kind: 'structure-placement', eligible: true, adaptiveOnly: false, priority: 1 },
    { id: '$wait', kind: 'wait', eligible: true }
  ]);
  assert.equal(decision.selectedId, 'original-tile');
});

function fixture(options = {}) {
  const probes = [], decisions = [], records = [];
  let allowed = true, decisionId = 0;
  const tiles = options.tiles || [1, 2, 3];
  let player;
  const makeOwner = (id, friendly) => ({ smallID: () => id, isPlayer: () => true, isAlive: () => true,
    units: type => allUnits.filter(unit => unit.owner() === (friendly ? ally : player) && unit.type() === type) });
  let ally;
  const allUnits = [];
  player = { smallID: () => 1, isPlayer: () => true, isAlive: () => true,
    borderTiles: () => [], isFriendly: other => other === ally,
    units: (...types) => allUnits.filter(unit => unit.owner() === player && (!types.length || types.includes(unit.type()))) };
  ally = makeOwner(2, true);
  const addUnit = (type, tile, owner, level = 1) => allUnits.push({ type: () => type, tile: () => tile,
    owner: () => owner, level: () => level, isUnderConstruction: () => false, hasTrainStation: () => true });
  for (const factory of options.factories || []) addUnit(U.Factory, factory.tile, factory.owner === 'ally' ? ally : player);
  for (const sam of options.sams || []) addUnit(U.SAMLauncher, sam.tile, sam.owner === 'ally' ? ally : player, sam.level || 1);
  const game = {
    x: tile => tile, y: () => 0, ref: x => x, isValidCoord: x => x >= 0 && x < 1000,
    isLand: () => true, isShore: tile => (options.shores || tiles).includes(tile),
    ownerID: () => 1, euclideanDistSquared: (a, b) => (a - b) ** 2,
    players: () => [player, ally], units: type => allUnits.filter(unit => unit.type() === type),
    config: () => ({ trainStationMinRange: () => 3, trainStationMaxRange: () => 10, samRange: () => 8 })
  };
  const actor = { game, player, random: {},
    randCoastalTileArray: () => tiles,
    tilesDeepInTerritory: () => options.deep || [], tilesNearFriendlySams: () => options.samTiles || [],
    structureSpawnTileValue: () => tile => options.scores?.[tile] ?? tile,
    safePlacementScorer: () => tile => options.safeScores?.[tile] ?? 0,
    getOrBuildReachableStations: () => options.stations || [],
    buildableFor: async (type, tile) => {
      probes.push(tile);
      if (options.stopAfterProbe) allowed = false;
      return options.unbuildable?.includes(tile) ? null : { type, canBuild: options.relocate?.[tile]??tile };
    }
  };
  const planner = createPlanner && createPlanner({ units: U, portWaterAccess:options.portWaterAccess, geography:options.geography, opening:options.opening, samPlacement:options.samPlacement, settings: () => ({ safePlacement: true, samUmbrella: true }),
    randomTerritoryTiles: () => tiles, maxProbes: options.maxProbes || 12 });
  const hooks = {
    allowed: () => allowed,
    choose(candidates, facts) {
      decisions.push({ candidates, facts });
      const selected = options.choose ? options.choose(candidates, facts) :
        candidates.filter(c => c.kind === 'structure-placement' && c.eligible).sort((a, b) => a.priority - b.priority)[0];
      return { selectedId: selected?.id ?? '$wait', decisionId: ++decisionId, reason: 'test choice' };
    },
    record: (kind, details) => records.push({ kind, ...details }), remember: () => {}
  };
  return { planner, actor, hooks, probes, decisions, records, stop: () => { allowed = false; } };
}

test('structure placement planner exists', () => assert.equal(typeof createPlanner, 'function'));

test('all port pools reject high-scoring lake sites before placement ranking',()=>{
 const f=fixture({tiles:[10,20],scores:{10:99999,20:1,99:999999},factories:[{tile:16}],
  geography:{placementContext:()=>({}),rearTiles:()=>[99],rearMetrics:()=>({})},
  portWaterAccess:{assess:(_,tile)=>({allowed:tile===20,reason:'Ocean access required'})}});
 const plans=f.planner.prepare(f.actor,U.Port);assert.deepEqual(plans.map(p=>p.tile),[20]);
});

test('a worker relocation into enclosed water is rejected instead of dispatching a port',async()=>{
 const f=fixture({tiles:[20],relocate:{20:99},portWaterAccess:{assess:(_,tile)=>({allowed:tile===20,reason:'Enclosed water'})}});
 assert.equal(await f.planner.run(f.actor,U.Port,f.hooks),null);
 assert.ok(f.records.some(r=>r.status==='invalid-port-water'&&r.tile===99));
});
test('legacy winner stays visible when added route samples have higher scores', async () => {
  const legacy = createLegacyStrategy();
  const f = fixture({ tiles: [1], sams: [{ tile: 1 }],
    factories: Array.from({ length: 20 }, (_, i) => ({ tile: 100 + i * 30 })),
    choose: candidates => candidates.find(c => c.id === legacy.decide({ domain: 'structure-placement' }, candidates).selectedId) });
  const result = await f.planner.run(f.actor, U.City, f.hooks);
  assert.equal(result?.canBuild, 1);
});

test('legacy ordering probes greatest original score first and advances past unbuildable tiles', async () => {
  const f = fixture({ scores: { 1: 5, 2: 30, 3: 20 }, unbuildable: [2] });
  const result = await f.planner.run(f.actor, U.City, f.hooks);
  assert.equal(result.canBuild, 3);
  assert.deepEqual(f.probes, [2, 3]);
  assert.ok(f.records.some(record => record.status === 'unbuildable' && record.tile === 2));
  assert.ok(f.records.some(record => record.status === 'selected' && record.tile === 3));
});

test('placement candidates are primitive, deduplicated and bounded to 79 plus wait', async () => {
  const many = Array.from({ length: 120 }, (_, index) => index + 1);
  const f = fixture({ tiles: many, deep: many.slice(0, 20), choose: candidates => candidates.find(c => c.id === '$wait') });
  assert.equal(await f.planner.run(f.actor, U.City, f.hooks), null);
  assert.equal(f.decisions[0].candidates.length, 80);
  assert.equal(new Set(f.decisions[0].candidates.filter(c => c.tile !== undefined).map(c => c.tile)).size, 79);
  assert.equal(JSON.stringify(f.decisions[0]).includes('[object Object]'), false);
  assert.deepEqual(f.probes, []);
});

test('stale ownership after a probe and exhausted candidates return null with terminal outcomes', async () => {
  const stale = fixture({ stopAfterProbe: true });
  assert.equal(await stale.planner.run(stale.actor, U.City, stale.hooks), null);
  assert.deepEqual(stale.probes, [3]);
  assert.ok(stale.records.some(record => record.status === 'stopped'));
  const empty = fixture({ tiles: [] });
  assert.equal(await empty.planner.run(empty.actor, U.City, empty.hooks), null);
  assert.ok(empty.records.some(record => record.status === 'no-buildable-tile'));
});

test('candidate facts include owned and allied factory routes, rail clusters and SAM protection', () => {
  const f = fixture({ tiles: [5, 10, 15], factories: [{ tile: 0, owner: 'self' }, { tile: 20, owner: 'ally' }],
    sams: [{ tile: 5, owner: 'self' }, { tile: 15, owner: 'ally' }],
    stations: [{ tile: 0, cluster: 'own', weight: 1 }, { tile: 20, cluster: 'ally', weight: 1 }] });
  const candidates = f.planner.prepare(f.actor, U.Factory);
  const own = candidates.find(candidate => candidate.tile === 5);
  const bridge = candidates.find(candidate => candidate.tile === 10);
  const allied = candidates.find(candidate => candidate.tile === 15);
  assert.equal(own.ownedFactoryRoutes, 1);
  assert.equal(allied.alliedFactoryRoutes, 1);
  assert.equal(bridge.routeClusters, 2);
  assert.equal(own.hasOwnSam, true);
  assert.ok(own.ownSamCoverage > 0);
  assert.ok(allied.alliedSamCoverage > 0);
  assert.ok(candidates.some(candidate => candidate.adaptiveOnly));
  assert.ok(candidates.some(candidate => candidate.futureRouteCapacity > 0));
});

test('post-SAM placement window keeps a useful factory route visible beyond 79 spread candidates', async () => {
  const tiles = Array.from({ length: 120 }, (_, index) => index + 1);
  const f = fixture({ tiles, factories: [{ tile: 0, owner: 'self' }], sams: [{ tile: 1, owner: 'self' }],
    choose: candidates => candidates.find(candidate => (candidate.ownedFactoryRoutes || 0) +
      (candidate.alliedFactoryRoutes || 0) > 0) || candidates.find(candidate => candidate.kind === 'structure-placement') });
  const result = await f.planner.run(f.actor, U.City, f.hooks);
  assert.ok(result.canBuild >= 3 && result.canBuild <= 10);
  assert.ok(f.decisions[0].candidates.some(candidate => (candidate.ownedFactoryRoutes || 0) > 0));
});

test('rear adaptive candidates remain visible beyond the original 79-tile window',async()=>{
 const adaptive=require('../src/brain/adaptive-strategy')(createLegacyStrategy());
 const geography={placementContext:()=>({frontline:true}),rearTiles:()=>[999],
  rearMetrics:(_game,tile)=>({frontline:true,rearDistance:tile===999?150:0,rearBand:tile===999?5:0})};
 const f=fixture({tiles:Array.from({length:100},(_,i)=>i+1),geography,
  choose:cs=>cs.find(c=>c.id===adaptive.decide({domain:'structure-placement'},cs).selectedId)});
 await f.planner.run(f.actor,U.Port,f.hooks);
 assert.deepEqual(f.probes,[999]);assert.ok(f.decisions[0].candidates.length<=80);
});

const adaptivePlacement=require('../src/brain/adaptive-strategy')(createLegacyStrategy());
test('SAM anchor candidates stay visible above 79 samples and retain native buildability retries',async()=>{
 const samPlacement={prepare:()=>({anchorKind:'Port',tiles:[998,999],
 metrics:t=>({samAnchorKind:'Port',samAnchorTile:999,samAnchorProtection:0,samAnchorDistance:Math.abs(999-t)})})};
 const f=fixture({tiles:Array.from({length:100},(_,i)=>i+1),samPlacement,unbuildable:[999],
 choose:cs=>cs.find(c=>c.id===adaptivePlacement.decide({domain:'structure-placement'},cs).selectedId)});
 const result=await f.planner.run(f.actor,U.SAMLauncher,f.hooks);
 assert.ok(f.probes.includes(999)&&f.probes.includes(998));assert.ok(f.probes.length<=12);assert.equal(result.canBuild,998);
 assert.ok(f.decisions[0].candidates.length<=80);assert.ok(f.decisions[0].candidates.some(c=>c.tile===999));
});
test('factory opening facts activate route priority before SAM and remain visible to the policy',async()=>{
 const opening={observe:()=>({economyMode:'factory',cities:2,cityTarget:2,factories:1,factoryTarget:1})};
 const f=fixture({tiles:[1,2],factories:[{tile:5}],scores:{1:999,2:1},opening,
 choose:cs=>cs.find(c=>c.id===adaptivePlacement.decide({domain:'structure-placement'},cs).selectedId)});
 const prepared=f.planner.prepare(f.actor,U.City);assert.ok(prepared.every(c=>c.factoryLinePriority));
 assert.ok(prepared.every(c=>c.hasOwnSam===false));
 const routed=prepared.filter(c=>c.ownedFactoryRoutes>0);assert.ok(routed.length>0);
 await f.planner.run(f.actor,U.City,f.hooks);assert.ok(f.probes.length>0);
});
test('legacy SAM selection keeps its original tile with adaptive anchor samples present',async()=>{
 const samPlacement={prepare:()=>({anchorKind:'City',tiles:[999],
 metrics:t=>({samAnchorKind:'City',samAnchorTile:999,samAnchorProtection:0,samAnchorDistance:Math.abs(999-t)})})};
 const f=fixture({tiles:[1,2,3],samPlacement,
 choose:cs=>cs.find(c=>c.id===createLegacyStrategy().decide({domain:'structure-placement'},cs).selectedId)});
 await f.planner.run(f.actor,U.SAMLauncher,f.hooks);assert.deepEqual(f.probes,[3]);
});

test('SAM selection ranks actual quoted build tiles when the worker relocates requests',async()=>{
 const samPlacement={prepare:()=>({anchorKind:'Port',tiles:[999,998],
 metrics:t=>({samAnchorKind:'Port',samAnchorTile:999,samAnchorProtection:0,samAnchorDistance:Math.abs(999-t)})})};
 const f=fixture({tiles:[1],samPlacement,
 choose:cs=>cs.find(c=>c.id===adaptivePlacement.decide({domain:'structure-placement'},cs).selectedId)});
 f.actor.buildableFor=async (_type,tile)=>{f.probes.push(tile);return {type:U.SAMLauncher,canBuild:tile===999?995:tile};};
 const quote=await f.planner.run(f.actor,U.SAMLauncher,f.hooks);
 assert.equal(quote.canBuild,998);assert.ok(f.decisions.some(d=>d.candidates.some(c=>c.quoted&&c.tile===998&&c.samAnchorDistance===1)));
});
test('SAM quote search spans distance bands so invalid nearest requests cannot starve valid farther sites',async()=>{
 const samPlacement={prepare:()=>({anchorKind:'City',tiles:Array.from({length:13},(_,i)=>100+i),
 metrics:t=>({samAnchorKind:'City',samAnchorTile:0,samAnchorProtection:0,samAnchorDistance:t>=100?2:6})})};
 const f=fixture({tiles:[1],samPlacement,
 choose:cs=>cs.find(c=>c.id===adaptivePlacement.decide({domain:'structure-placement'},cs).selectedId)});
 f.actor.buildableFor=async (_type,tile)=>{f.probes.push(tile);return tile>=100?null:{type:U.SAMLauncher,canBuild:tile};};
 const quote=await f.planner.run(f.actor,U.SAMLauncher,f.hooks);assert.equal(quote.canBuild,1);assert.ok(f.probes.length<=12);
});

test('holding SAM quote search prevents probes and holding the final quoted choice prevents placement',async()=>{
 const samPlacement={prepare:()=>({anchorKind:'City',tiles:[998],metrics:t=>({samAnchorKind:'City',samAnchorTile:999,samAnchorProtection:0,samAnchorDistance:Math.abs(t-999)})})};
 const held=fixture({samPlacement,choose:cs=>cs.find(c=>c.id==='$wait')});
 assert.equal(await held.planner.run(held.actor,U.SAMLauncher,held.hooks),null);assert.deepEqual(held.probes,[]);
 const final=fixture({samPlacement,choose:cs=>cs.some(c=>c.quoted)?cs.find(c=>c.id==='$wait'):
 cs.find(c=>c.id===adaptivePlacement.decide({domain:'structure-placement'},cs).selectedId)});
 assert.equal(await final.planner.run(final.actor,U.SAMLauncher,final.hooks),null);assert.ok(final.probes.length>0);
});
