'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createAttackGeographyPlanner = require('../src/brain/attack-geography-planner.js');

function hooksFixture(options = {}) {
  let allowed = true, sequence = 0;
  const choices = [], records = [], probes = [];
  return { choices, records, probes, stop: () => { allowed = false; }, hooks: {
    allowed: () => allowed,
    choose(domain, candidates, facts) {
      choices.push({ domain, candidates, facts });
      if (options.throwPolicy) throw options.throwPolicy;
      if (options.stopAfterChoose) allowed = false;
      const plans = candidates.filter(candidate => candidate.kind === domain && candidate.eligible);
      const selected = options.wait ? null : options.alternate ? plans[1] : plans[0];
      return { decisionId: ++sequence, selectedId: options.invalid ? 'invalid' : selected?.id ?? '$wait', reason: 'test' };
    },
    async probe(tile) {
      probes.push(tile);
      if (options.stopOnProbe === tile) allowed = false;
      return options.probeResults?.get(tile) ?? false;
    },
    record: (kind, details) => records.push([kind, details])
  } };
}

function target(id, tiles, borders = [id * 10]) {
  return { id: () => `p${id}`, smallID: () => id, isPlayer: () => true, isAlive: () => true,
    troops: () => tiles, numTilesOwned: () => tiles, borderTiles: () => new Set(borders) };
}

function pocketFixture(options = {}) {
  const self = { smallID: () => 1, nearby: () => options.targets || [],
    isFriendly: candidate => options.friendly?.has(candidate.smallID()) || false };
  const borderCalls = [];
  const neighborMap = options.neighborMap || new Map();
  const ownerMap = options.ownerMap || new Map();
  const game = {
    ticks: () => options.tickError ? (() => { throw options.tickError; })() : (options.tick ?? 500),
    numLandTiles: () => 1000, width: () => 100, height: () => 100,
    playerBySmallID: id => (options.targets || []).find(candidate => candidate.smallID() === id) || null,
    async ensureBorderTiles(candidate) {
      borderCalls.push(candidate.smallID());
      if (options.throwTarget === candidate.smallID()) throw Error('border failed');
      if (options.stopTarget === candidate.smallID()) options.stop();
    },
    isShore: tile => options.shore?.has(tile) || false,
    x: tile => options.edge?.has(tile) ? 0 : 10, y: () => 10,
    neighbors: tile => neighborMap.get(tile) || [], isLand: () => true,
    hasOwner: tile => ownerMap.has(tile), ownerID: tile => ownerMap.get(tile)
  };
  return { actor: { game, player: self }, borderCalls };
}

function pocketDeps(settings = {}) {
  return { settings: () => ({ encircleMaxShare: .1, encircleMinSealShare: .6, ...settings }),
    transportType: 'Transport', ffaMode: 'FFA', closestTwoTiles: () => null };
}

test('attack geography planner is available', () => assert.equal(typeof createAttackGeographyPlanner, 'function'));

test('pocket selects greatest seal share with first ties and records primitive facts', async () => {
  const a = target(2, 50, [20]), b = target(3, 50, [30]), c = target(4, 50, [40]);
  const neighbors = new Map([[20, [201,202,203]], [30, [301,302,303,304]], [40, [401,402,403,404]]]);
  const owners = new Map([[201,1],[202,1],[301,1],[302,1],[303,1],[401,1],[402,1],[403,1]]);
  const f = pocketFixture({ targets: [a,b,c], neighborMap: neighbors, ownerMap: owners }), h = hooksFixture();
  const result = await createAttackGeographyPlanner(pocketDeps()).select(f.actor, 'pocket', h.hooks);
  assert.equal(result.target, b);
  assert.deepEqual(f.borderCalls, [2,3,4]);
  assert.equal(f.actor._pocketSid, 3);
  assert.equal(h.choices[0].facts.mode, 'pocket');
  assert.equal(h.choices[0].candidates[0].facts.sealShare, .75);
  assert.doesNotThrow(() => JSON.stringify(h.choices[0]));
});

test('pocket preserves filters, strict thresholds, ignored player failures, and empty cache state', async () => {
  const friendly = target(2, 10), dead = target(3, 10), large = target(4, 101), exact = target(5, 10, [50]),
    shore = target(6, 10, [60]), edge = target(7, 10, [70]), foreign = target(8, 10, [80]), broken = target(9, 10, [90]);
  dead.isAlive = () => false;
  const neighbors = new Map([[50,[501,502,503,504,505]], [60,[601]], [70,[701]], [80,[801]], [90,[901]]]);
  const owners = new Map([[501,1],[502,1],[801,99],[901,1]]);
  const f = pocketFixture({ targets:[friendly,dead,large,exact,shore,edge,foreign,broken], friendly:new Set([2]),
    neighborMap:neighbors, ownerMap:owners, shore:new Set([60]), edge:new Set([70]), throwTarget:9 }), h = hooksFixture();
  const result = await createAttackGeographyPlanner(pocketDeps()).select(f.actor, 'pocket', h.hooks);
  assert.equal(result.target, null);
  assert.equal(f.actor._pocketTick, 500); assert.equal(f.actor._pocketSid, null);
  assert.deepEqual(f.borderCalls, [5,6,7,8,9]);
  assert.equal(h.choices.length, 0);
});

test('pocket cache returns its living player without rescanning or deciding', async () => {
  const cached = target(2, 10), f = pocketFixture({ targets:[cached], tick:550 }), h = hooksFixture();
  Object.assign(f.actor, { _pocketTick: 500, _pocketSid: 2 });
  const result = await createAttackGeographyPlanner(pocketDeps()).select(f.actor, 'pocket', h.hooks);
  assert.equal(result.target, cached); assert.deepEqual(f.borderCalls, []); assert.deepEqual(h.choices, []);
});

test('pocket tick failure returns empty without mutating cache', async () => {
  const f = pocketFixture({ tickError: Error('tick') }), h = hooksFixture();
  Object.assign(f.actor, { _pocketTick: 10, _pocketSid: 2 });
  const result = await createAttackGeographyPlanner(pocketDeps()).select(f.actor, 'pocket', h.hooks);
  assert.equal(result.target, null); assert.equal(f.actor._pocketTick, 10); assert.equal(f.actor._pocketSid, 2);
});

test('pocket rejects a zero seal ratio even when the configured minimum is zero', async () => {
  const candidate=target(2,10,[20]);
  const f=pocketFixture({targets:[candidate],neighborMap:new Map([[20,[201]]]),ownerMap:new Map()}),h=hooksFixture();
  const result=await createAttackGeographyPlanner(pocketDeps({encircleMinSealShare:0})).select(f.actor,'pocket',h.hooks);
  assert.equal(result.target,null); assert.equal(h.choices.length,0);
});

function islandFixture(options = {}) {
  const self = { smallID: () => 1, troops: () => 100, unitCount: () => options.unitCount || 0,
    borderTiles: () => new Set(options.ownBorders || [1]), isFriendly: p => options.friendly?.has(p.smallID()) || false };
  const borderCalls = [];
  const players = options.targets || [];
  const game = { config: () => ({ isUnitDisabled: () => !!options.disabled, boatMaxNumber: () => options.boatMax ?? 5,
      gameConfig: () => ({ gameMode: options.mode || 'FFA' }) }), players: () => [self, ...players],
    isShore: tile => (options.shores || new Set([1,20,30,40])).has(tile),
    ref: (x,y) => `${x},${y}`, manhattanDist: (a,b) => Math.abs(Number(a.split(',')[0]) - Number(b.split(',')[0])),
    async ensureBorderTiles(p) { borderCalls.push(p.smallID()); if (options.throwTarget === p.smallID()) throw options.error; },
  };
  const actor = { game, player:self, isFFA: () => (options.mode || 'FFA') === 'FFA',
    getPlayerCenter: p => options.centers?.get(p.smallID()) || { x:p.smallID()*10, y:0 } };
  return { actor, borderCalls };
}

function islandDeps() {
  return { settings: () => ({}), transportType:'Transport', ffaMode:'FFA',
    closestTwoTiles: (_game, _own, theirs) => theirs.length ? { x:1, y:theirs[0] } : null };
}

test('island preserves distance/probe order, collects two reachable, and permits alternate policy', async () => {
  const a=target(2,40,[20]), b=target(3,50,[30]), c=target(4,60,[40]);
  const f=islandFixture({ targets:[c,b,a] }), h=hooksFixture({ alternate:true,
    probeResults:new Map([[20,true],[30,true]]) });
  const result=await createAttackGeographyPlanner(islandDeps()).select(f.actor,'island',h.hooks);
  assert.equal(result.target,b); assert.deepEqual(f.borderCalls,[2,3]); assert.deepEqual(h.probes,[20,30]);
  assert.deepEqual(h.choices[0].candidates.filter(c=>c.kind==='attack-geography').map(c=>c.targetId),['p2','p3']);
});

test('island preserves transport, shore, FFA strength, and empty-result gates', async () => {
  const strong=target(2,100,[20]);
  for (const options of [{disabled:true},{unitCount:5},{ownBorders:[9],shores:new Set([20])},{targets:[strong]}]) {
    const f=islandFixture({ targets:[], ...options }), h=hooksFixture({ probeResults:new Map([[20,true]]) });
    const result=await createAttackGeographyPlanner(islandDeps()).select(f.actor,'island',h.hooks);
    assert.equal(result.target,null); assert.equal(h.choices.length,0);
  }
});

test('island keeps scanning after failed probes and propagates border errors unchanged', async () => {
  const a=target(2,20,[20]), b=target(3,20,[30]);
  const f=islandFixture({targets:[a,b]}), h=hooksFixture({probeResults:new Map([[20,false],[30,true]])});
  assert.equal((await createAttackGeographyPlanner(islandDeps()).select(f.actor,'island',h.hooks)).target,b);
  const error=Error('border'), broken=islandFixture({targets:[a],throwTarget:2,error});
  await assert.rejects(() => createAttackGeographyPlanner(islandDeps()).select(broken.actor,'island',hooksFixture().hooks),
    thrown => thrown === error);
});

test('island rereads own border tiles after the shore gate', async () => {
  const candidate=target(2,20,[20]); let reads=0, sourceShore;
  const f=islandFixture({targets:[candidate],shores:new Set([1,9,20])});
  f.actor.player.borderTiles=()=>new Set([++reads===1?1:9]);
  const deps={...islandDeps(),closestTwoTiles:(_game,own,theirs)=>{sourceShore=own;return{x:own[0],y:theirs[0]};}};
  const h=hooksFixture({probeResults:new Map([[20,true]])});
  assert.equal((await createAttackGeographyPlanner(deps).select(f.actor,'island',h.hooks)).target,candidate);
  assert.equal(reads,2); assert.deepEqual(sourceShore,[9]);
});

test('wait, invalid policy, strategy throw, and stale async completion stop with terminal records', async () => {
  const a=target(2,20,[20]);
  for (const options of [{wait:true},{invalid:true},{throwPolicy:Error('policy')},{stopOnProbe:20,probeResults:new Map([[20,true]])}]) {
    const f=islandFixture({targets:[a]}), h=hooksFixture({probeResults:new Map([[20,true]]),...options});
    const result=await createAttackGeographyPlanner(islandDeps()).select(f.actor,'island',h.hooks);
    assert.equal(result.stop,true); assert.equal(result.target,null);
    assert.ok(h.records.some(([kind,details])=>kind==='attack-geography-result'&&details.status==='stopped'));
  }
});
