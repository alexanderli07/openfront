'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const file = '../src/brain/warship-details-planner';
const create = fs.existsSync(require('node:path').join(__dirname, file + '.js')) ? require(file) : null;
const legacy = require('../src/brain/legacy-strategy')();
function fixture(policy) {
  assert.equal(typeof create, 'function', 'warship details planner exists');
  const calls = [], records = [];
  const unit = (id, tile, state = 'patrolling', patrolTile = tile) => ({ id: () => id, tile: () => tile,
    warshipState: () => ({ state, patrolTile }) });
  const ships = [unit(1, 10), unit(2, 20)];
  const actor = { player: { units: () => ships }, game: { isWater: () => true,
    x: x => x, y: () => 0, isValidCoord: () => true, ref: x => x,
    getWaterComponent: () => 1, manhattanDist: (a,b) => Math.abs(a-b) },
    random: { nextInt: low => { calls.push(['random', low]); return low; } },
    _moveSelectedWarship: (...args) => { calls.push(['move', ...args]); return true; } };
  const hooks = { allowed: () => true, choose: (domain, candidates, facts) => {
    const decision = { decisionId: records.length + 1, ...(policy || ((d,c) => legacy.decide({domain:d},c)))(domain,candidates,facts) };
    records.push({ domain,candidates,facts,decision }); return decision;
  }, record: (kind,details) => records.push({kind,...details}),
    remember: id => calls.push(['parent',id]), execute: (id,fn) => fn(), hold: () => calls.push(['hold']) };
  return { actor,ships,unit,calls,records,hooks,planner: create({warshipType:'Warship',settings:()=>({})}) };
}
test('default unit selection keeps nearest ship and first ties', () => {
  const f = fixture(); assert.equal(f.planner.move(f.actor,0,{},f.hooks),true);
  assert.equal(f.calls.find(c=>c[0]==='move')[1],f.ships[0]);
  f.ships[1] = f.unit(2,10); f.planner.move(f.actor,0,{},f.hooks);
  assert.equal(f.calls.filter(c=>c[0]==='move')[1][1],f.ships[0]);
});
test('routine patrols use an unposted ship instead of pulling a ship off its piracy post',()=>{
 const f=fixture();f.hooks.canMove=ship=>ship.id()!==1;
 assert.equal(f.planner.move(f.actor,0,{smart:{cooldown:new Map()},tick:100},f.hooks),true);
 assert.equal(f.calls.find(c=>c[0]==='move')[1],f.ships[1]);
});
test('policy can choose a different eligible ship', () => {
  const f=fixture((d,c)=>({selectedId:c[1].id,reason:'second'}));
  f.planner.move(f.actor,0,{},f.hooks); assert.equal(f.calls.find(c=>c[0]==='move')[1],f.ships[1]);
});
test('unit wait marks hold without command or cooldown', () => {
  const f=fixture(()=>({selectedId:'$wait',reason:'hold'})); const smart={cooldown:new Map()};
  assert.equal(f.planner.move(f.actor,0,{smart,tick:100},f.hooks),false);
  assert.deepEqual(f.calls,[['hold']]); assert.equal(smart.cooldown.size,0);
});
test('no eligible ships does not block next-zone fallthrough', () => {
  const f=fixture(); f.ships.splice(0); f.planner.move(f.actor,0,{},f.hooks);
  assert.deepEqual(f.calls,[]);
});
test('smart selection filters cooldown, state and components', () => {
  const f=fixture(); const smart={cooldown:new Map([[1,95]])};
  f.planner.move(f.actor,0,{smart,tick:100},f.hooks);
  assert.equal(f.calls.find(c=>c[0]==='move')[1],f.ships[1]);
  f.ships[1]=f.unit(2,20,'moving'); assert.equal(f.planner.move(f.actor,0,{smart,tick:100},f.hooks),false);
});
test('placement accepts first water without extra RNG', () => {
  const f=fixture(); assert.equal(f.planner.spawn(f.actor,300,250,f.hooks),50);
  assert.equal(f.calls.filter(c=>c[0]==='random').length,2);
});
test('placement policy can resample within original fifty attempts', () => {
  const f=fixture((d,c)=>({selectedId:c.find(c=>c.resample).id,reason:'resample'}));
  assert.equal(f.planner.spawn(f.actor,300,250,f.hooks),null);
  assert.equal(f.calls.filter(c=>c[0]==='random').length,100);
});
test('placement wait ends search immediately', () => {
  const f=fixture(()=>({selectedId:'$wait',reason:'hold'}));
  assert.equal(f.planner.spawn(f.actor,300,250,f.hooks),null);
  assert.equal(f.calls.filter(c=>c[0]==='random').length,2);
});
