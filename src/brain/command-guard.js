'use strict';
/**
 * One guard per controller/actor. Route every automatic boat path through dispatch
 * using the same destination key, and every donation using the recipient key.
 * `emit` is synchronous: only literal false rejects; thrown errors propagate.
 * A true/void return means emitted, NOT acknowledged by the game. Call acknowledge
 * only when a ship/accepted command is observed. Supply active own destinations
 * each dispatch when available. Manual intents bypass automatic operational holds.
 * Policy holds are explicit caller decisions, reported separately from backpressure.
 */
function createCommandGuard(options = {}) {
  const positive = (name, fallback) => {
    const value = options[name] === undefined ? fallback : options[name];
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
    return value;
  };
  const pendingTicks = positive('pendingTicks', 40);
  const retryBaseTicks = positive('retryBaseTicks', 40);
  const retryMaxTicks = positive('retryMaxTicks', 640);
  const retentionTicks = positive('retentionTicks', 2560);
  const maxEntries = positive('maxEntries', 512);
  const boats = new Map(), donations = new Set();
  let lastTick = null;
  const result = (emitted, reason, hold = null) => ({emitted, reason, hold});
  const held = reason => result(false, reason, 'operational');
  const keyOf = key => {
    if ((typeof key !== 'string' && typeof key !== 'number') || key === '' ||
        (typeof key === 'number' && !Number.isFinite(key))) throw new TypeError('key must be a destination or recipient ID');
    return String(key);
  };
  function reset() { boats.clear(); donations.clear(); lastTick = null; }
  function advance(tick) {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new TypeError('tick must be a nonnegative integer');
    if (lastTick !== null && tick < lastTick) reset();
    if (tick !== lastTick) donations.clear();
    lastTick = tick;
    for (const [key, record] of boats) {
      if (record.pendingUntil !== null && tick >= record.pendingUntil) {
        record.failures = Math.min(record.failures + 1, 53);
        record.retryAt = record.pendingUntil + Math.min(retryMaxTicks, retryBaseTicks * 2 ** (record.failures - 1));
        record.pendingUntil = null;
      }
      // Blocked checks never extend retention. Live reservations/cooldowns survive.
      if (record.pendingUntil === null && tick > Math.max(record.lastAttempt + retentionTicks, record.retryAt)) boats.delete(key);
    }
  }
  function acknowledge(key, tick) {
    advance(tick);
    const record = boats.get(keyOf(key));
    if (!record) return;
    record.pendingUntil = null;
    record.retryAt = 0;
    record.failures = 0;
  }
  function dispatch({kind, key, tick, emit, manual = false, policyHold = false, activeBoatDestinations}) {
    advance(tick);
    if (kind !== 'boat' && kind !== 'donation') throw new TypeError('kind must be boat or donation');
    if (typeof emit !== 'function') throw new TypeError('emit must be a synchronous function');
    key = keyOf(key);
    if (policyHold) return result(false, 'policy-hold', 'policy');
    if (manual) return emit() === false ? result(false, 'emit-rejected') : result(true, 'emitted');
    const previous = boats.get(key);
    if (kind === 'boat') {
      if (activeBoatDestinations && Array.from(activeBoatDestinations).some(destination => String(destination) === key)) return held('active-destination');
      if (previous && previous.pendingUntil !== null) return held('pending');
      if (previous && previous.lastAttempt === tick) return held('same-tick');
      if (previous && tick < previous.retryAt) return held('retry-cooldown');
      if (!previous && boats.size >= maxEntries) return held('capacity');
      boats.set(key, {pendingUntil:tick + pendingTicks, retryAt:0, failures:previous ? previous.failures : 0, lastAttempt:tick});
    } else {
      if (donations.has(key)) return held('same-tick');
      if (donations.size >= maxEntries) return held('capacity');
      donations.add(key);
    }
    const release = () => {
      if (kind === 'donation') donations.delete(key);
      else if (previous) boats.set(key, previous);
      else boats.delete(key);
    };
    try {
      if (emit() === false) { release(); return result(false, 'emit-rejected'); }
    } catch (error) { release(); throw error; }
    return result(true, 'emitted');
  }
  return {dispatch, acknowledge, reset};
}
if (typeof module !== 'undefined' && module.exports) module.exports = createCommandGuard;
