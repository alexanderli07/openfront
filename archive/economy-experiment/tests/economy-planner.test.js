'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/economy-planner.js');
const api = fs.existsSync(file) ? require(file)() : {};
const snapshot = (extra = {}) => ({ gold: 1000n, incomePerTick: 10, horizonTicks: 100,
  emergencyReserve: 0n, ...extra });
const investment = (id, extra = {}) => ({ id, type: 'Port', cost: 100n,
  incomePerTick: 5, durationTicks: 10, survival: 1, confidence: 1, utility: 0, ...extra });

test('planner factory exposes the economic policy', () => {
  assert.equal(typeof api.rankInvestments, 'function');
});
test('compares investments by risk-adjusted return, not candidate order', () => {
  const result = api.rankInvestments(snapshot(), [investment('poor', { incomePerTick: 1 }), investment('good')]);
  assert.equal(result.action.id, 'good');
  assert.equal(result.kind, 'spend');
});
test('prefers a safe upgrade over a more exposed new port', () => {
  const result = api.rankInvestments(snapshot(), [investment('new', { survival: 0.15 }), investment('upgrade')]);
  assert.equal(result.action.id, 'upgrade');
});
test('does not invest in a disconnected or unprofitable trade building', () => {
  const result = api.rankInvestments(snapshot(), [investment('isolated', { incomePerTick: 0 })]);
  assert.equal(result.kind, 'hold');
});
test('urgent defense wins over economic growth', () => {
  const result = api.rankInvestments(snapshot(), [investment('port'), investment('sam', {
    type: 'SAM Launcher', incomePerTick: 0, emergency: true, utility: 2
  })]);
  assert.equal(result.action.id, 'sam');
});
test('can save for a better investment when the wait is short', () => {
  const result = api.rankInvestments(snapshot({ gold: 50n }), [investment('upgrade')]);
  assert.equal(result.kind, 'save');
  assert.equal(result.reserve, 100n);
});
test('does not wait indefinitely for an unaffordable investment with unknown income', () => {
  const result = api.rankInvestments(snapshot({ gold: 50n, incomePerTick: null }), [investment('upgrade')]);
  assert.equal(result.kind, 'hold');
});
test('retains emergency reserve when buying a nonessential investment', () => {
  const result = api.rankInvestments(snapshot({ gold: 150n, emergencyReserve: 100n, incomePerTick: null }), [investment('port')]);
  assert.equal(result.kind, 'hold');
  assert.equal(result.reserve, 100n);
});
test('zero-cost valid buildings work and missing prices are excluded', () => {
  const result = api.rankInvestments(snapshot(), [investment('bad', { cost: null }), investment('free', { cost: 0n })]);
  assert.equal(result.action.id, 'free');
});
test('cumulative receipts survive spending and trade excludes donations', () => {
  const tracker = new api.IncomeTracker();
  tracker.sample('g', 0, { goldEarned: 1000n, tradeGold: 100n, trainGold: 0n });
  tracker.sample('g', 100, { goldEarned: 11000n, tradeGold: 300n, trainGold: 100n });
  const rates = tracker.rates();
  assert.equal(rates.total, 100);
  assert.equal(rates.trade, 2);
  assert.equal(rates.train, 1);
  assert.equal(rates.recurring, 3);
});
test('missing counters stay unknown; a rollback resets the sample window', () => {
  const tracker = new api.IncomeTracker();
  tracker.sample('g', 0, {}); tracker.sample('g', 100, {});
  assert.equal(tracker.rates().total, null);
  tracker.sample('new', 0, { goldEarned: 0n });
  assert.equal(tracker.rates().total, null);
});
test('counter reset does not become negative income', () => {
  const tracker = new api.IncomeTracker();
  tracker.sample('g', 0, { tradeGold: 1000n });
  tracker.sample('g', 100, { tradeGold: 0n });
  assert.equal(tracker.rates().trade, null);
});
test('ledger prevents two subsystems spending one stale wallet', () => {
  const ledger = new api.BudgetLedger();
  ledger.observe('g', 10, 1000n, 'units-a');
  assert.equal(ledger.commit(800n, 0n), true);
  assert.equal(ledger.commit(100n, 0n), false);
  ledger.observe('g', 11, 1000n, 'units-a');
  assert.equal(ledger.commit(100n, 0n), false);
  ledger.observe('g', 12, 200n, 'units-b', true);
  assert.equal(ledger.commit(100n, 0n), true);
});
test('ledger supports zero gold cost, exact large balances, and bounded retry', () => {
  const ledger = new api.BudgetLedger(20);
  ledger.observe('g', 1, 900719925474099300n, 'a');
  assert.equal(ledger.commit(900719925474099301n, 0n), false);
  assert.equal(ledger.commit(0n, 0n), true);
  ledger.observe('g', 20, 100n, 'a');
  assert.equal(ledger.pending !== null, true);
  ledger.observe('g', 21, 100n, 'a');
  assert.equal(ledger.pending, null);
});
test('ledger resets pending actions between matches', () => {
  const ledger = new api.BudgetLedger();
  ledger.observe('one', 100, 100n, 'a'); ledger.commit(100n, 0n);
  ledger.observe('two', 0, 100n, 'a');
  assert.equal(ledger.commit(100n, 0n), true);
});
test('unrelated unit changes do not acknowledge a purchase', () => {
  const ledger = new api.BudgetLedger();
  ledger.observe('g', 0, 100n, 'a'); ledger.commit(50n, 0n);
  ledger.observe('g', 1, 100n, 'unrelated-warship-died');
  assert.equal(ledger.commit(50n, 0n), false);
});
test('equal military benefit prefers the cheaper upgrade', () => {
  const result = api.rankInvestments(snapshot(), [investment('city:build', { cost: 1000n, incomePerTick: 0, utility: 3 }),
    investment('city:upgrade', { cost: 100n, incomePerTick: 0, utility: 3 })]);
  assert.equal(result.action.id, 'city:upgrade');
});
