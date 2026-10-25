'use strict';

// Pure policy: no DOM, game objects, timers, or action dispatch.
function createEconomyPlanner() {
  const money = value => {
    if (typeof value === 'bigint') return value >= 0n ? value : null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    return null;
  };
  const positive = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const bounded = (value, fallback = 1) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

  function rankInvestments(snapshot, candidates) {
    const gold = money(snapshot.gold) ?? 0n;
    const emergencyReserve = money(snapshot.emergencyReserve) ?? 0n;
    const horizon = Math.max(1, positive(snapshot.horizonTicks));
    const income = positive(snapshot.incomePerTick);
    const evaluated = [];
    for (const candidate of candidates) {
      const cost = money(candidate.cost);
      if (cost === null || candidate.valid === false) continue;
      const reserve = candidate.emergency ? 0n : emergencyReserve;
      const need = cost + reserve > gold ? cost + reserve - gold : 0n;
      const wait = need === 0n ? 0 : income > 0 ? Number(need) / income : Infinity;
      // A short explicit saving decision may beat a mediocre affordable purchase.
      if (wait > horizon / 3) continue;
      const duration = positive(candidate.durationTicks);
      const productiveTicks = Math.max(0, horizon - duration - wait);
      const gain = positive(candidate.incomePerTick);
      const confidence = bounded(candidate.confidence);
      const survival = bounded(candidate.survival);
      const expectedGold = gain * productiveTicks * confidence * survival;
      const returnRatio = expectedGold / Math.max(1, Number(cost));
      const utility = positive(candidate.utility) * survival;
      // Utility expresses military/connection value, not fictional gold income.
      const score = returnRatio - 1 + utility + (candidate.emergency ? 100 : 0);
      if (!Number.isFinite(score) || score <= 0) continue;
      evaluated.push({ ...candidate, cost, score, waitTicks: wait,
        paybackTicks: gain * confidence * survival > 0 ? duration + Number(cost) / (gain * confidence * survival) : null,
        expectedGold });
    }
    evaluated.sort((a, b) => b.score - a.score || (a.cost < b.cost ? -1 : a.cost > b.cost ? 1 : 0) ||
      a.durationTicks - b.durationTicks || a.id.localeCompare(b.id));
    const action = evaluated[0] ?? null;
    if (!action) return { kind: 'hold', action: null, reserve: emergencyReserve,
      reason: 'No investment clears the return or urgency threshold', alternatives: evaluated };
    return { kind: action.waitTicks > 0 ? 'save' : 'spend', action,
      reserve: action.cost + (action.emergency ? 0n : emergencyReserve),
      reason: action.reason || (action.emergency ? 'Respond to immediate threat' : 'Best estimated value over the planning horizon'),
      alternatives: evaluated };
  }

  class IncomeTracker {
    constructor(windowTicks = 600, minSpan = 100) {
      this.windowTicks = windowTicks;
      this.minSpan = minSpan;
      this.key = null;
      this.samples = [];
    }
    sample(key, tick, counters) {
      if (!Number.isFinite(tick)) return;
      const values = {};
      for (const field of ['goldEarned', 'tradeGold', 'trainGold']) values[field] = money(counters[field]);
      const last = this.samples.at(-1);
      const reset = this.key !== key || last && (tick < last.tick || Object.keys(values).some(field =>
        values[field] !== null && last[field] !== null && values[field] < last[field]));
      if (reset) this.samples = [];
      this.key = key;
      if (this.samples.at(-1)?.tick === tick) return;
      this.samples.push({ tick, ...values });
      while (this.samples.length > 1 && this.samples[1].tick <= tick - this.windowTicks) this.samples.shift();
    }
    rates() {
      const result = { total: null, trade: null, train: null, recurring: null };
      const last = this.samples.at(-1);
      if (!last) return result;
      for (const [field, name] of [['goldEarned', 'total'], ['tradeGold', 'trade'], ['trainGold', 'train']]) {
        if (last[field] === null) continue;
        const first = this.samples.find(s => s[field] !== null);
        if (!first || last.tick - first.tick < this.minSpan) continue;
        const rate = Number(last[field] - first[field]) / (last.tick - first.tick);
        if (Number.isFinite(rate) && rate >= 0) result[name] = rate;
      }
      // Do not turn missing streams into a measured zero.
      if (result.trade !== null && result.train !== null) result.recurring = result.trade + result.train;
      return result;
    }
  }

  class BudgetLedger {
    constructor(timeoutTicks = 30) {
      this.timeoutTicks = timeoutTicks;
      this.key = null;
      this.tick = -1;
      this.gold = 0n;
      this.pending = null;
      this.signature = '';
    }
    observe(key, tick, gold, signature, acknowledged = false) {
      if (key !== this.key || tick < this.tick) this.pending = null;
      if (this.pending && tick > this.pending.tick &&
          (acknowledged || tick - this.pending.tick >= this.timeoutTicks)) this.pending = null;
      this.key = key;
      this.tick = tick;
      this.gold = money(gold) ?? 0n;
      this.signature = signature;
    }
    commit(cost, reserve) {
      cost = money(cost); reserve = money(reserve);
      if (this.pending || cost === null || reserve === null || cost + reserve > this.gold) return false;
      this.pending = { tick: this.tick, signature: this.signature, cost };
      return true;
    }
    cancel() { this.pending = null; }
  }
  return { money, rankInvestments, IncomeTracker, BudgetLedger };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createEconomyPlanner;
