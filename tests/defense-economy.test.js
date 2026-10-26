'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/brain/defense-economy');
const units = { Port: 'Port', City: 'City', Factory: 'Factory', SAMLauncher: 'SAM' };
function fixture(options = {}) {
  const owned = { Port: [], City: [], Factory: [], SAM: [] };
  const disabled = new Set();
  const game = { config: () => ({ isUnitDisabled: type => disabled.has(type) }) };
  const player = { units: type => owned[type] || [] };
  const opening = { borderKnown: true, frontline: false, wilderness: false, samEnabled: true,
    portTarget: 2, cityTarget: 1, factoryTarget: 0, economyMode: 'coastal' };
  const model = create({ units, ...options });
  const set = (type, count, building = false) => {
    owned[type] = Array.from({ length: count }, () => ({ isActive: () => true, isUnderConstruction: () => building }));
  };
  return { game, player, opening, owned, disabled, model, set, observe: () => model.observe(game, player, opening) };
}
test('initial economy precedes the first SAM and has no emergency reserve', () => {
  const f = fixture();
  assert.equal(f.observe().stage, 'initial-economy');
  assert.equal(f.observe().requiredType, units.Port);
  assert.equal(f.observe().reserve, 0n);
  f.set(units.Port, 1); assert.equal(f.observe().requiredType, units.City);
  f.set(units.City, 1); assert.equal(f.observe().requiredType, units.Port);
  f.set(units.Port, 2); assert.equal(f.observe().stage, 'first-sam');
  assert.equal(f.observe().requiredType, units.SAMLauncher);
});

test('enclosed-water ports do not satisfy a coastal opening goal',()=>{
 const f=fixture({portWaterAccess:{assess:(_,tile)=>({allowed:tile===99})}});
 f.owned.Port=[10,20].map(tile=>({isActive:()=>true,tile:()=>tile}));
 f.set(units.City,1);
 assert.equal(f.observe().counts.ports,0);assert.equal(f.observe().requiredType,units.Port);
});
test('construction counts physical economy, levels and inactive units do not', () => {
  const f = fixture(); f.set(units.Port, 2, true); f.set(units.City, 1, true);
  f.owned.Port.push({ isActive: () => false, level: () => 9 });
  assert.deepEqual(f.observe().counts, { ports: 2, cities: 1, factories: 0, sams: 0 });
  assert.equal(f.observe().stage, 'first-sam');
});
test('a SAM under construction waits without constructing a duplicate or advancing development', () => {
  const f = fixture(); f.set(units.Port, 2); f.set(units.City, 1); f.set(units.SAMLauncher, 1, true);
  assert.equal(f.observe().stage, 'first-sam');
  assert.equal(f.observe().requiredType, null);
  assert.equal(f.observe().waitingForSam, true);
});
test('completed SAM permits two additional ports and cities before the reserve', () => {
  const f = fixture(); f.set(units.Port, 2); f.set(units.City, 1); f.set(units.SAMLauncher, 1);
  let facts = f.observe();
  assert.equal(facts.stage, 'development'); assert.equal(facts.reserve, 0n);
  assert.deepEqual(facts.targetCounts, { ports: 4, cities: 3, factories: 0, sams: 1 });
  assert.equal(facts.samUpgradeReactiveOnly, true);
  f.set(units.Port, 4, true); f.set(units.City, 3, true);
  facts = f.observe(); assert.equal(facts.stage, 'reserve'); assert.equal(facts.reserve, 3000000n);
  assert.equal(facts.requiredType, null);
});
test('landlocked economy substitutes two cities and one factory, then two more of each', () => {
  const f = fixture(); Object.assign(f.opening, { portTarget: 0, cityTarget: 2, factoryTarget: 1, economyMode: 'factory' });
  assert.equal(f.observe().requiredType, units.City);
  f.set(units.City, 1); assert.equal(f.observe().requiredType, units.City);
  f.set(units.City, 2); assert.equal(f.observe().requiredType, units.Factory);
  f.set(units.City, 2); f.set(units.Factory, 1);
  assert.equal(f.observe().stage, 'first-sam'); f.set(units.SAMLauncher, 1);
  assert.deepEqual(f.observe().targetCounts, { ports: 0, cities: 4, factories: 3, sams: 1 });
  f.set(units.City, 4); f.set(units.Factory, 3); assert.equal(f.observe().reserve, 3000000n);
});
test('disabled and disallowed economy types do not create impossible goals', () => {
  const f = fixture({ buildAllowed: type => type !== units.City }); f.disabled.add(units.Port);
  assert.equal(f.observe().requiredType, units.Factory);
  f.set(units.Factory, 1); assert.equal(f.observe().requiredType, units.SAMLauncher);
  f.set(units.SAMLauncher, 1); f.set(units.Factory, 3);
  assert.equal(f.observe().reserve, 3000000n);
});
test('missing opening, unknown borders and initial frontline are outside scope', () => {
  const f = fixture(); assert.equal(f.model.observe(f.game, f.player, null), null);
  f.opening.borderKnown = false; assert.equal(f.observe(), null);
  f.opening.borderKnown = true; f.opening.frontline = true; assert.equal(f.observe(), null);
});
test('safe wilderness still permits economy development', () => {
  const f = fixture(); f.opening.wilderness = true; assert.equal(f.observe().requiredType, units.Port);
});
test('disabled nuclear defense does not impose arbitrary savings', () => {
  const f = fixture(); f.opening.samEnabled = false; assert.equal(f.observe(), null);
  f.opening.samEnabled = true; f.disabled.add(units.SAMLauncher); assert.equal(f.observe(), null);
});
test('economic destruction restarts missing development without requiring the old3M reserve',()=>{
 const f=fixture();f.set(units.Port,4);f.set(units.City,3);f.set(units.SAMLauncher,1);
 assert.equal(f.observe().reserve,3000000n);
 f.set(units.Port,1);let facts=f.observe();assert.equal(facts.recovering,true);
 assert.equal(facts.stage,'initial-economy');assert.equal(facts.reserve,0n);assert.equal(facts.requiredType,units.Port);
 f.opening.frontline=true;assert.equal(f.observe().requiredType,units.Port);
 f.set(units.Port,2);facts=f.observe();assert.equal(facts.stage,'development');assert.equal(facts.reserve,0n);
 f.set(units.Port,4);facts=f.observe();assert.equal(facts.stage,'reserve');assert.equal(facts.recovering,false);assert.equal(facts.reserve,3000000n);
});
test('complete nuclear wipe repeats the physical opening and restores the reserve only after recovery',()=>{
 const f=fixture();f.set(units.Port,4);f.set(units.City,3);f.set(units.SAMLauncher,1);f.observe();
 f.set(units.Port,0);f.set(units.City,0);f.set(units.SAMLauncher,0);
 assert.equal(f.observe().requiredType,units.Port);assert.equal(f.observe().reserve,0n);
 f.set(units.Port,1);assert.equal(f.observe().requiredType,units.City);
 f.set(units.City,1);assert.equal(f.observe().requiredType,units.Port);
 f.set(units.Port,2);assert.equal(f.observe().requiredType,units.SAMLauncher);
 f.set(units.SAMLauncher,1,true);assert.equal(f.observe().waitingForSam,true);assert.equal(f.observe().requiredType,null);
 f.set(units.SAMLauncher,1);assert.equal(f.observe().stage,'development');assert.equal(f.observe().reserve,0n);
 f.set(units.Port,4);f.set(units.City,3);assert.equal(f.observe().reserve,3000000n);
});
test('a frontline without physical economic loss retains its emergency reserve',()=>{
 const f=fixture();f.set(units.Port,4);f.set(units.City,3);f.set(units.SAMLauncher,1);f.observe();
 f.opening.frontline=true;assert.equal(f.observe().reserve,3000000n);assert.equal(f.observe().recovering,false);
});
test('SAM replacement can use reserve and restores its latch after completion', () => {
  const f = fixture(); f.set(units.Port, 4); f.set(units.City, 3); f.set(units.SAMLauncher, 1); f.observe();
  f.set(units.SAMLauncher, 0); assert.equal(f.observe().stage, 'first-sam'); assert.equal(f.observe().reserve, 3000000n);
  f.opening.frontline = true; assert.equal(f.observe().requiredType, units.SAMLauncher);
  f.set(units.SAMLauncher, 1);
  assert.equal(f.observe().reserve, 3000000n);
});
test('reserve state resets for a different game identity', () => {
  const f = fixture(); f.set(units.Port, 4); f.set(units.City, 3); f.set(units.SAMLauncher, 1); f.observe();
  f.set(units.Port, 2); f.set(units.City, 1);
  assert.equal(f.model.observe({ ...f.game }, f.player, f.opening).reserve, 0n);
});
test('actual quoted cost must preserve the emergency reserve including pending commitments', () => {
  const affordable = create.affordable;
  assert.equal(affordable({ gold: 3000000n, cost: 1n, reserve: 3000000n }), false);
  assert.equal(affordable({ gold: 4000000n, cost: 1000000n, reserve: 3000000n }), true);
  assert.equal(affordable({ gold: 4000000n, cost: 1100000n, reserve: 3000000n }), false);
  assert.equal(affordable({ gold: 4000000n, cost: 1000000n, reserve: 3000000n, pendingCost: 1n }), false);
  assert.equal(affordable({ gold: 100n, cost: 100n, reserve: 0n }), true);
});
test('missing, negative, fractional and imprecise quote values fail closed', () => {
  for (const cost of [undefined, null, -1n, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) {
    assert.equal(create.affordable({ gold: 4000000n, cost, reserve: 3000000n }), false);
  }
  assert.equal(create.affordable({ gold: 4000000, cost: 1000000, reserve: 3000000 }), true);
  assert.equal(create.affordable({ gold: -1n, cost: 0n, reserve: 0n }), false);
  assert.equal(create.affordable({ gold: 4000000n, cost: 1n, reserve: -1n }), false);
});

test('factory economy losses recover cities and factories before rebuilding the reserve',()=>{
 const f=fixture();Object.assign(f.opening,{portTarget:0,cityTarget:2,factoryTarget:1});
 f.set(units.City,4);f.set(units.Factory,3);f.set(units.SAMLauncher,1);f.observe();
 f.set(units.City,0);f.set(units.Factory,0);
 assert.equal(f.observe().requiredType,units.City);assert.equal(f.observe().reserve,0n);
 f.set(units.City,2);assert.equal(f.observe().requiredType,units.Factory);
 f.set(units.Factory,1);assert.equal(f.observe().stage,'development');assert.equal(f.observe().counts.sams,1);
});
test('uncertain port-water topology alone cannot reset the reserve',()=>{
 let allowed=true;const f=fixture({portWaterAccess:{assess:()=>({allowed})}});
 f.owned.Port=Array.from({length:4},()=>({isActive:()=>true,tile:()=>99}));
 f.set(units.City,3);f.set(units.SAMLauncher,1);f.observe();allowed=false;
 assert.equal(f.observe().reserve,3000000n);assert.equal(f.observe().recovering,false);
});
