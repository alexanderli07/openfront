'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const location = require('node:path').join(__dirname, '../src/brain/building-planner.js');
const createPlanner = fs.existsSync(location) ? require(location) : null;
const legacy = require('../src/brain/legacy-strategy')();
const U = Object.fromEntries(['City', 'Port', 'Factory', 'MissileSilo', 'SAMLauncher', 'DefensePost'].map(t => [t,t]));
function fixture(options = {}) {
  const calls = [], records = [], decisions = [], remembered = [];
  let active = true;
  const unit = (id, tile, type = U.City, level = 1) => ({ id: () => id, tile: () => tile, type: () => type, level: () => level });
  const units = options.units || [unit('a', 2), unit('b', 9)];
  const sams = [unit('sam', 9, U.SAMLauncher, 2)];
  const actor = { placementsCount: 1, player: { units: (...types) => types.includes(U.SAMLauncher) ? sams : units },
    game: { ticks: () => 42, config: () => ({ isUnitDisabled: () => false, unitInfo: () => ({ upgradable: true }), samRange: () => 2 }),
      euclideanDistSquared: (a,b) => (a-b)**2 },
    random: { nextInt: () => 99, randElement: items => items.at(-1) },
    defensePostNeeded: () => !!options.emergency,
    tryBuildDefensePost: async () => { calls.push('defense'); actor.dpDeclinedOnTiming = !!options.timing; return !!options.defenseSuccess; },
    isOnStructureCooldown: () => !!options.cooldown, isInPostSaveUpBlockedPhase: () => false,
    doHandleStructures: async () => { calls.push('normal'); return !!options.normalSuccess; },
    getTotalStructureDensity: () => options.density ?? 1,
    maybeUpgradeStructure: async () => { calls.push('upgrade'); return !!options.upgradeSuccess; },
    _placeNewStructure: async () => { calls.push('build'); return true; },
    buildableFor: async (_type,tile) => { calls.push(tile); if(options.stopOnProbe) active=false;
      return options.unbuildable?.includes(tile) ? null : { canUpgrade: true, canBuild: tile }; }
  };
  const planner = createPlanner && createPlanner({ units: U, densityThreshold: .5,
    difficulty: () => options.difficulty || 'Impossible', settings: () => ({ defensePosts: !!options.optional, samDefense: !!options.samDefense }),
    samProtectWeight: () => 1 });
  const hooks = { allowed: () => active,
    choose(domain, candidates, facts) { decisions.push({ domain,candidates,facts });
      return { ... (options.choose ? options.choose(domain,candidates) : legacy.decide({ domain },candidates)), decisionId: decisions.length }; },
    execute: (_id,run) => run(), record: (kind,details) => records.push({kind,...details}),
    remember: (quote,id) => remembered.push({quote,id}) };
  return { planner,actor,hooks,calls,records,decisions,remembered,units,unit,stop: () => {active=false;} };
}
test('building planner exists', () => assert.equal(typeof createPlanner,'function'));
test('urgent defense blocks normal spending unless timing declines', async () => {
  const blocked=fixture({ emergency:true, normalSuccess:true });
  assert.equal(await blocked.planner.handle(blocked.actor,blocked.hooks),false);
  assert.deepEqual(blocked.calls,['defense']);
  const timing=fixture({ emergency:true,timing:true,normalSuccess:true });
  assert.equal(await timing.planner.handle(timing.actor,timing.hooks),true);
  assert.deepEqual(timing.calls,['defense','normal']);
  assert.equal(timing.actor.lastStructureTick,42); assert.equal(timing.actor.placementsCount,2);
});
test('optional defense does not advance normal structure bookkeeping',async () => {
  const f=fixture({optional:true,defenseSuccess:true});
  assert.equal(await f.planner.handle(f.actor,f.hooks),true);
  assert.deepEqual(f.calls,['normal','defense']); assert.equal(f.actor.placementsCount,1);
  assert.equal(f.actor.lastStructureTick,undefined);
});
test('cooldown and explicit phase wait prevent build attempts',async () => {
  for(const options of [{cooldown:true},{choose:()=>({selectedId:'$wait'})}]) {
    const f=fixture(options);assert.equal(await f.planner.handle(f.actor,f.hooks),false);assert.deepEqual(f.calls,[]);
  }
});
test('dense upgrade failure cannot fall through to a new building when one exists',async () => {
  const f=fixture();assert.equal(await f.planner.action(f.actor,U.City,f.units,f.hooks),false);
  assert.deepEqual(f.calls,['upgrade']);
  const empty=fixture({units:[]});assert.equal(await empty.planner.action(empty.actor,U.City,[],empty.hooks),true);
  assert.deepEqual(empty.calls,['upgrade','build']);
  const sparse=fixture({density:.1});assert.equal(await sparse.planner.action(sparse.actor,U.City,sparse.units,sparse.hooks),true);
  assert.deepEqual(sparse.calls,['build']);
});
test('upgrade ranking probes in input order, then picks greatest owned SAM coverage',async () => {
  const f=fixture(); const target=await f.planner.upgrade(f.actor,f.units,f.hooks);
  assert.equal(target.structure,f.units[1]); assert.deepEqual(f.calls,[2,9]);
  assert.equal(f.remembered[0].quote,target.bu);
  assert.equal(f.decisions[0].facts.mode,'sam-coverage');
  assert.doesNotThrow(()=>JSON.stringify(f.decisions));
});
test('SAM upgrades favor protected economic value without a random draw',async () => {
  const f=fixture({samDefense:true});f.actor.random.nextInt=()=>{throw Error('unexpected random draw');};
  const sams=[f.unit('sam-a',2,U.SAMLauncher),f.unit('sam-b',8,U.SAMLauncher)];
  const target=await f.planner.upgrade(f.actor,sams,f.hooks);
  assert.equal(target.structure,sams[0]); // equal protected value retains first tie
  assert.equal(f.decisions[0].facts.mode,'protected-value');
});
test('random upgrade winner remains visible in bounded windows',async () => {
  const f=fixture({difficulty:'Easy'});f.actor.random.nextInt=()=>0;
  const many=Array.from({length:110},(_,i)=>f.unit('unit-'+i,i));
  const target=await f.planner.upgrade(f.actor,many,f.hooks);
  assert.equal(target.structure,many.at(-1));assert.equal(f.decisions[0].candidates.length,80);
  assert.equal(f.decisions[0].facts.mode,'random');
});
test('defense placement retries unbuildable sites and respects policy wait',async () => {
  const f=fixture({unbuildable:[2]});const quote=await f.planner.defense(f.actor,[2,9],f.hooks);
  assert.equal(quote.canBuild,9);assert.deepEqual(f.calls,[2,9]);assert.equal(f.remembered.length,1);
  const hold=fixture({choose:()=>({selectedId:'$wait'})});
  assert.equal(await hold.planner.defense(hold.actor,[2],hold.hooks),null);assert.deepEqual(hold.calls,[]);
});
test('stopped async probes cannot return an upgrade or defense quote',async () => {
  for(const mode of ['upgrade','defense']) {
    const f=fixture({stopOnProbe:true});const input=mode==='upgrade'?f.units:[2,9];
    assert.equal(await f.planner[mode](f.actor,input,f.hooks),null);assert.equal(f.calls.length,1);assert.deepEqual(f.remembered,[]);
    if(mode==='defense') assert.ok(f.records.some(record=>record.status==='stopped' && record.decisionId===1));
  }
});

test('a physical opening target forces new construction even in dense territory',async()=>{
 const f=fixture({density:100,upgradeSuccess:true});f.hooks.forceNew=true;
 await f.planner.action(f.actor,U.Port,f.units,f.hooks);
 assert.deepEqual(f.calls,['build']);
 assert.equal(f.decisions[0].facts.forceNew,true);
});
