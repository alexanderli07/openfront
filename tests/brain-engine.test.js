'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const location = path.join(__dirname, '../src/brain/engine.js');
const createEngine = fs.existsSync(location) ? require(location) : null;
const legacyPath = path.join(__dirname, '../src/brain/legacy-strategy.js');
const legacy = fs.existsSync(legacyPath) ? require(legacyPath)() : null;
const snapshot = { tick: 1, self: { gold: '1000', troops: 200 } };
const action = { id: 'attack-1', kind: 'attack', source: 'AttackBehavior.sendAttack', args: ['enemy', 50] };
function engine(options) {
  const result = createEngine(options); result.register(legacy); result.select(legacy.id); return result;
}

test('production retention preserves construction and its command explanation through routine floods', () => {
  const e=engine({maxRecords:12,retainImportant:true});
  const build=e.decide({tick:1,domain:'structure-placement'},[{id:'sam',kind:'structure-placement',eligible:true,tile:42,reason:'Place SAM'}]);
  const command={id:'build-sam',kind:'build',parentDecisionId:build.decisionId};
  e.submit({tick:1},command,()=>true);
  e.record('structure-placement-result',{decisionId:build.decisionId,tile:42,status:'selected'});
  e.record('infrastructure-change',{tick:1,structures:[{type:'SAM Launcher',tile:42}]});
  for(let tick=2;tick<502;tick++){
    e.decide({tick,domain:'embargo-relation-response'},[{id:'keep',kind:'embargo-relation-response',eligible:true,reason:'Keep'}]);
    e.record('rule-result',{tick,module:'structureBehavior',rule:'getPerceivedCost',result:'1000'});
  }
  const trace=e.exportTrace();
  assert.ok(trace.records.some(r=>r.kind==='dispatch'));
  assert.ok(trace.records.some(r=>r.decisionId===build.decisionId&&r.kind==='decision'));
  assert.ok(trace.records.some(r=>r.kind==='structure-placement-result'&&r.tile===42));
  assert.ok(trace.records.some(r=>r.kind==='infrastructure-change'&&r.structures[0].tile===42));
  assert.ok(trace.records.length<=12);
  assert.ok(trace.retention.suppressedRecords>900);
  assert.equal(trace.retention.counts['rule-result'],500);
  assert.ok(e.replay('legacy-v1',trace).every(r=>r.sameChoice));
  assert.deepEqual(trace.records.map(r=>r.seq),trace.records.map(r=>r.seq).sort((a,b)=>a-b));
});

test('production event archive is bounded and reports event eviction and strategy errors', () => {
  const e=engine({maxRecords:12,retainImportant:true});
  for(let i=0;i<50;i++)e.record('strategy-error',{reason:String(i)});
  const trace=e.exportTrace();
  assert.ok(trace.records.length<=12);
  assert.ok(trace.retention.evictedImportantRecords>0);
  assert.equal(trace.records.at(-1).reason,'49');
});

test('rule exceptions survive repetition sampling and observation flooding', () => {
  const e=engine({maxRecords:12,retainImportant:true});
  e.record('rule-result',{tick:1,module:'structureBehavior',rule:'getPerceivedCost',result:'1000'});
  e.record('rule-result',{tick:2,module:'structureBehavior',rule:'getPerceivedCost',error:'API missing'});
  for(let tick=3;tick<100;tick++)e.record('observation',{snapshot:{tick}});
  assert.ok(e.exportTrace().records.some(r=>r.error==='API missing'));
});

test('telemetry never reads array accessors or breaks on hostile objects', () => {
  const e = engine(); const values = [];
  Object.defineProperty(values, '0', { get() { throw Error('getter'); } });
  assert.doesNotThrow(() => e.record('sample', { values }));
  assert.doesNotThrow(() => e.record('sample', new Proxy({}, { ownKeys() { throw Error('proxy'); } })));
  const result = Object.defineProperty({}, 'then', { get() { throw Error('then'); } });
  assert.equal(e.submit(snapshot, action, () => result), result);
});

test('replay receives exactly the nested inputs originally evaluated', () => {
  const e = engine();
  e.register({ id: 'deep', version: '1', decide: s => ({ selectedId: s.a.b.c.d.e.f.value ? action.id : null, reason: 'deep field' }) });
  e.select('deep');
  e.decide({ a: { b: { c: { d: { e: { f: { value: true } } } } } } }, [action]);
  assert.equal(e.replay('deep', e.exportTrace())[0].sameChoice, true);
});
test('engine and original policy are available', () => {
  assert.equal(typeof createEngine, 'function'); assert.equal(typeof legacy?.decide, 'function');
});
test('original policy preserves synchronous executor return and exact arguments', () => {
  const e = engine(); const args = [{ target: 'enemy' }, 50];
  const result = e.submit(snapshot, action, () => { assert.equal(args[0].target, 'enemy'); return 'original-return'; });
  assert.equal(result, 'original-return');
  const decision = e.exportTrace().records.find(r => r.kind === 'decision');
  assert.equal(decision.selectedId, action.id);
  assert.equal(decision.strategy.id, 'legacy-v1');
  assert.equal(decision.candidates.some(c => c.kind === 'wait'), true);
});
test('a replacement policy can select a different concrete candidate', () => {
  const e = engine(); e.register({ id: 'cheapest', version: '1', decide: (s, candidates) => ({ selectedId: candidates[1].id, reason: 'Prefer this alternative' }) });
  e.select('cheapest');
  const result = e.decide(snapshot, [action, { id: 'city', kind: 'build', cost: '100' }]);
  assert.equal(result.selectedId, 'city');
});
test('waiting never invokes an executor', () => {
  const e = engine(); e.register({ id: 'hold', version: '1', decide: () => ({ selectedId: null, reason: 'Wait for more troops' }) });
  e.select('hold'); let called = false;
  assert.equal(e.submit(snapshot, action, () => { called = true; }), false);
  assert.equal(called, false);
});
test('invalid choices and strategy errors fail closed with explanations', () => {
  for (const decide of [() => ({ selectedId: 'not-a-candidate', reason: 'bad' }), () => { throw new Error('broken strategy'); }]) {
    const e = engine(); e.register({ id: 'bad', version: '1', decide }); e.select('bad');
    let sent = 0; assert.equal(e.submit(snapshot, action, () => sent++), false); assert.equal(sent, 0);
    assert.ok(e.exportTrace().records.some(r => r.kind === 'strategy-error'));
  }
});
test('strategy receives immutable copies, not mutable game data', () => {
  const e = engine(); const input = { self: { gold: 5n } };
  e.register({ id: 'check', version: '1', decide: (s, candidates) => {
    assert.equal(Object.isFrozen(s.self), true); assert.equal(s.self.gold, '5');
    assert.equal(Object.isFrozen(candidates[0]), true);
    return { selectedId: null, reason: 'Inspection only' };
  } });
  e.select('check'); e.decide(input, [action]); assert.equal(input.self.gold, 5n);
});
test('dispatch exceptions are recorded and rethrown unchanged', () => {
  const e = engine(); const error = new Error('transport failed');
  assert.throws(() => e.submit(snapshot, action, () => { throw error; }), actual => actual === error);
  assert.equal(e.exportTrace().records.at(-1).status, 'threw');
});
test('false dispatch return is recorded as failed, not as a sent action', () => {
  const e = engine(); assert.equal(e.submit(snapshot, action, () => false), false);
  assert.equal(e.exportTrace().records.at(-1).status, 'not-submitted');
});
test('async dispatch preserves promise identity and records resolution', async () => {
  const e = engine(); const promise = Promise.resolve(false);
  assert.equal(e.submit(snapshot, action, () => promise), promise);
  await promise; await Promise.resolve();
  assert.equal(e.exportTrace().records.at(-1).status, 'not-submitted');
});
test('async rejection is recorded without changing the original promise', async () => {
  const e = engine(); const error = new Error('async fail'); const promise = Promise.reject(error);
  assert.equal(e.submit(snapshot, action, () => promise), promise);
  await assert.rejects(promise, actual => actual === error); await Promise.resolve();
  assert.equal(e.exportTrace().records.at(-1).status, 'rejected');
});
test('bounded JSON records do not retain cyclic objects or functions', () => {
  const e = engine({ maxRecords: 5 }); const obj = { n: 1n }; obj.self = obj;
  for (let i = 0; i < 12; i++) e.record('rule', { obj, ignored: () => {} });
  const trace = JSON.parse(JSON.stringify(e.exportTrace()));
  assert.equal(trace.records.length, 5); assert.equal(trace.droppedRecords, 7);
});
test('a failing log subscriber cannot block an action', () => {
  const e = engine({ onRecord: () => { throw new Error('panel absent'); } });
  assert.equal(e.submit(snapshot, action, () => 42), 42);
});
test('replay compares choices without executing commands or modifying trace', () => {
  const e = engine(); let sent = 0; e.submit(snapshot, action, () => sent++);
  const trace = e.exportTrace(); const count = trace.records.length;
  const result = e.replay('legacy-v1', trace);
  assert.equal(result.length, 1); assert.equal(result[0].sameChoice, true); assert.equal(sent, 1);
  assert.equal(e.exportTrace().records.length, count);
});
