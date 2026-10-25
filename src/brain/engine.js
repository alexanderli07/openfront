'use strict';

function createDecisionEngine(options = {}) {
  const strategies = new Map();
  const records = [];
  const limit = Math.max(1, Math.min(10000, options.maxRecords ?? 1500));
  const retention = options.retainImportant === true;
  const recentLimit = retention ? Math.max(1, Math.floor(limit * .3)) : limit;
  const importantLimit = limit - recentLimit;
  const important = new Map(), decisions = new Map(), samples = new Map();
  const counts = Object.create(null);
  let suppressed = 0, evictedImportant = 0, lastTick = 0;
  let selected = null, sequence = 0, decisionSequence = 0, dropped = 0;

  // Read data properties only: logging must not invoke arbitrary game getters.
  function copy(value, depth = 0, seen = new WeakSet()) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 1500);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'undefined') return null;
    if (typeof value !== 'object') return `[${typeof value}]`;
    if (seen.has(value)) return '[circular]';
    if (depth >= 7) return '[depth limit]';
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      result = Array.from({ length: Math.min(descriptors.length.value, 80) }, (_, i) =>
        descriptors[i] && 'value' in descriptors[i] ? copy(descriptors[i].value, depth + 1, seen) : '[accessor or hole]');
    } else {
      result = Object.create(null);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Object.keys(descriptors).slice(0, 60)) {
        if (key === '__src' || key === '__proto__') continue;
        const descriptor = descriptors[key];
        if ('value' in descriptor) result[key] = copy(descriptor.value, depth + 1, seen);
      }
    }
    seen.delete(value);
    return result;
  }
  function freeze(value) {
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    return value;
  }
  function protect(entry, seen = new Set()) {
    if (!entry || seen.has(entry.seq)) return;
    seen.add(entry.seq);
    const parent = entry.snapshot?.parentDecisionId ?? entry.parentDecisionId ??
      entry.candidates?.find(c => c.id === entry.selectedId)?.parentDecisionId;
    if (parent !== undefined) protect(decisions.get(parent), seen);
    if (entry.kind !== 'decision' && entry.decisionId !== undefined) protect(decisions.get(entry.decisionId), seen);
    important.set(entry.seq, entry);
    if (important.size > importantLimit) {
      important.delete(important.keys().next().value); evictedImportant++;
    }
  }
  function retain(entry) {
    const { kind } = entry, domain = entry.snapshot?.domain;
    const tick = entry.snapshot?.tick ?? entry.tick ?? lastTick;
    if (Number.isFinite(tick)) lastTick = tick;
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'decision') {
      decisions.set(entry.decisionId, entry);
      if (decisions.size > 1024) decisions.delete(decisions.keys().next().value);
    }
    const critical = !!entry.error || /error|blocked|dispatch|transport-reservation|transport-manual-request/.test(kind) ||
      kind === 'structure-placement-result' || kind === 'infrastructure-change' ||
      kind === 'decision' && !domain;
    const building = kind === 'decision' && entry.selectedId !== '$wait' && /structure|building|spawn/.test(domain || '') ||
      kind === 'plan-result' || kind === 'building-result';
    const noisy = kind === 'rule-call' || kind === 'rule-result' ||
      kind === 'embargo-result' && entry.status === 'kept' ||
      kind === 'warship-transport-response-result' && entry.status === 'kept' ||
      kind === 'decision' && entry.selectedId === 'keep' &&
        ['embargo-relation-response', 'warship-trade-outgoing-response', 'warship-transport-outgoing-response'].includes(domain);
    if (!critical && noisy) {
      // Omit repeated no-op relations and getter chatter, retaining one example
      // per 100 game ticks and counters for every event. Never alter policy inputs.
      const selected = entry.candidates?.find(c => c.id === entry.selectedId);
      const key = [kind, domain || '', entry.module || '', entry.rule || '',
        selected?.kind || '', selected?.purpose || '', entry.reason || '', entry.status || '',
        kind === 'decision' ? entry.selectedId?.replace(/:\d+$/, ':*') : ''].join('|');
      const previous = samples.get(key);
      if (previous !== undefined && tick >= previous && tick - previous < 100) { suppressed++; return false; }
      samples.set(key, tick);
      if (samples.size > 2048) samples.delete(samples.keys().next().value);
    }
    if (critical || building) protect(entry);
    return true;
  }
  function append(kind, details) {
    const entry = freeze({ ...details, seq: ++sequence, kind });
    if (!retention || retain(entry)) {
      records.push(entry);
      if (records.length > recentLimit) { records.shift(); dropped++; }
    }
    try { options.onRecord?.(entry); } catch { /* A closed/broken panel cannot stop the bot. */ }
    return entry.seq;
  }
  function record(kind, details = {}) {
    try { return append(kind, copy(details)); }
    catch { return append('telemetry-error', { originalKind: kind, reason: 'Unable to serialize record' }); }
  }
  function register(strategy) {
    if (!strategy || typeof strategy.id !== 'string' || !strategy.id || typeof strategy.version !== 'string' ||
        typeof strategy.decide !== 'function') throw new TypeError('Strategy requires id, version, and decide(snapshot, candidates).');
    if (strategies.has(strategy.id)) throw new Error(`Strategy already registered: ${strategy.id}`);
    strategies.set(strategy.id, Object.freeze({ id: strategy.id, version: strategy.version,
      name: strategy.name || strategy.id, decide: strategy.decide.bind(strategy) }));
  }
  function select(id) {
    if (!strategies.has(id)) throw new Error(`Unknown strategy: ${id}`);
    selected = id;
  }
  function evaluate(strategy, snapshot, candidates) {
    const state = freeze(copy(snapshot));
    const proposals = freeze(copy(candidates));
    if (!Array.isArray(candidates) || candidates.length > 80 || candidates.some(c => !c || typeof c.id !== 'string') ||
        new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error('Candidates require unique string IDs; maximum 80.');
    const choice = strategy.decide(state, proposals);
    if (choice?.then) {
      // Decisions are synchronous and replayable; async game I/O belongs to proposal generation.
      Promise.resolve(choice).catch(() => {});
      throw new Error('Strategy.decide must return synchronously.');
    }
    if (!choice || typeof choice.reason !== 'string' ||
        choice.selectedId !== null && !proposals.some(c => c.id === choice.selectedId)) {
      throw new Error('Strategy must select a supplied candidate (or null) and explain the choice.');
    }
    return { snapshot: state, candidates: proposals, selectedId: choice.selectedId,
      reason: choice.reason, evaluations: copy(choice.evaluations ?? []) };
  }
  function decide(snapshot, candidates) {
    const strategy = strategies.get(selected);
    const decisionId = ++decisionSequence;
    try {
      if (!strategy) throw new Error('No strategy selected.');
      const choice = evaluate(strategy, snapshot, candidates);
      // These inputs are already sanitized; copying at a different depth breaks replay.
      append('decision', { decisionId, strategy: { id: strategy.id, version: strategy.version }, ...choice });
      return { decisionId, selectedId: choice.selectedId, reason: choice.reason };
    } catch (error) {
      const reason = String(error?.message || error);
      record('strategy-error', { decisionId, strategy: selected, reason });
      return { decisionId, selectedId: null, reason };
    }
  }
  function submit(snapshot, proposal, executor) {
    const wait = { id: '$wait', kind: 'wait', source: 'DecisionEngine', reason: 'Do not submit this command' };
    const choice = decide(snapshot, [proposal, wait]);
    if (choice.selectedId !== proposal.id) return false;
    const outcome = (status, extra = {}) => record('dispatch', { decisionId: choice.decisionId,
      proposalId: proposal.id, tick: snapshot.tick, status, ...extra });
    try {
      const result = executor();
      let then;
      try { then = result?.then; } catch { /* Return introspection cannot change executor behavior. */ }
      if (typeof then === 'function') {
        outcome('pending');
        // Observe settlement, but return exactly the promise the original executor returned.
        Promise.resolve(result).then(
          value => outcome(value === false ? 'not-submitted' : 'submitted'),
          error => outcome('rejected', { error: String(error?.message || error) })
        ).catch(() => {});
      } else outcome(result === false ? 'not-submitted' : 'submitted');
      return result;
    } catch (error) {
      outcome('threw', { error: String(error?.message || error) });
      throw error;
    }
  }
  function exportTrace() {
    const retained = retention ? [...new Map([...important.values(), ...records].map(e => [e.seq, e])).values()]
      .sort((a,b) => a.seq-b.seq) : records;
    return { schemaVersion: 1, strategy: selected, droppedRecords: dropped,
      ...(retention ? { retention: { recentLimit, importantLimit, suppressedRecords: suppressed,
        evictedImportantRecords: evictedImportant, counts: { ...counts },
        samplingTicks: 100, decisionContextLimit: 1024 } } : {}),
      records: retained.map(entry => JSON.parse(JSON.stringify(entry))) };
  }
  function replay(strategyId, trace) {
    const strategy = strategies.get(strategyId);
    if (!strategy) throw new Error(`Unknown strategy: ${strategyId}`);
    return trace.records.filter(entry => entry.kind === 'decision').map(entry => {
      const result = evaluate(strategy, entry.snapshot, entry.candidates);
      return { decisionId: entry.decisionId, originalChoice: entry.selectedId,
        replayChoice: result.selectedId, sameChoice: result.selectedId === entry.selectedId, reason: result.reason };
    });
  }
  return { register, select, decide, submit, record, exportTrace, replay, selectedStrategy:()=>selected,
    strategies: () => [...strategies.values()].map(({ id, version, name }) => ({ id, version, name })) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createDecisionEngine;
