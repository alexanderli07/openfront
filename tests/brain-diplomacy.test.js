'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createDiplomacyPlanner = require('../src/brain/diplomacy-planner.js');

function fixture(options = {}) {
  const calls = [], emojis = [], records = [];
  let allowed = options.allowed !== false, decision = 0;
  const target = {
    id: () => 'target', smallID: () => 2,
    isTraitor: () => !!options.traitor
  };
  const actor = {
    player: { relation: () => options.relation ?? 0 },
    random: {
      chance: odds => { calls.push(['chance', odds]); return options.chances?.shift() ?? false; },
      nextInt: (low, high) => { calls.push(['nextInt', low, high]); return options.ints?.shift() ?? low; }
    },
    emojiBehavior: { sendEmoji: (player, emoji) => emojis.push([player.id(), emoji]) },
    isRegularBot: () => { calls.push('regular-bot'); return !!options.regularBot; },
    isConfused: () => { calls.push('confused'); return !!options.confused; },
    isFarNation: () => { calls.push('far-nation'); return !!options.farNation; },
    isDominantForDiplomacy: () => { calls.push('dominant'); return !!options.dominant; },
    hasTooManyAlliances: () => { calls.push('alliance-cap'); return !!options.allianceCap; },
    isAlliancePartnerThreat: () => { calls.push('threat'); return !!options.threat; },
    shouldRejectInTeamGame: () => { calls.push('team-reject'); return !!options.teamReject; },
    isAlliancePartnerFriendly: () => { calls.push('friendly-relation'); return !!options.friendly; },
    checkAlreadyEnoughAlliances: () => { calls.push('enough-alliances'); return !!options.enough; },
    isEarlygame: () => { calls.push('early-game'); return !!options.early; },
    isAlliancePartnerSimilarlyStrong: () => { calls.push('similar-strength'); return !!options.similar; }
  };
  const planner = createDiplomacyPlanner({ settings: () => ({ winFixes: !!options.winFixes }), neutralRelation: 0,
    emojis: { confused: 'confused', scared: 'scared', love: 'love', handshake: 'handshake' } });
  const hooks = {
    allowed: () => allowed,
    choose: (domain, candidates, facts) => {
      assert.equal(domain, 'alliance-rule');
      assert.equal(facts.targetId, 'target');
      const selected = options.selectWait ? '$wait' : candidates.filter(c => c.kind === domain && c.eligible)
        .sort((a, b) => a.priority - b.priority)[0]?.id ?? '$wait';
      return { selectedId: selected, decisionId: ++decision, reason: 'test' };
    },
    execute: (_decisionId, execute) => execute(),
    record: (kind, details) => records.push([kind, details])
  };
  return { actor, target, planner, hooks, calls, emojis, records, stop: () => { allowed = false; } };
}

test('regular Bot is rejected by the first lazy rule', () => {
  const f = fixture({ regularBot: true });
  assert.deepEqual(f.planner.decide(f.actor, f.target, true, f.hooks),
    { accepted: false, stopped: false, decisionId: 1 });
  assert.deepEqual(f.calls, ['regular-bot']);
});

test('confused result terminates without evaluating later rules', () => {
  const f = fixture({ confused: true, chances: [true] });
  assert.equal(f.planner.decide(f.actor, f.target, true, f.hooks).accepted, true);
  assert.deepEqual(f.calls, ['regular-bot', 'confused', ['chance', 2]]);
});

test('traitor gate preserves nextInt then incoming emoji chance order', () => {
  const f = fixture({ traitor: true, ints: [90], chances: [true] });
  assert.equal(f.planner.decide(f.actor, f.target, true, f.hooks).accepted, false);
  assert.deepEqual(f.calls, ['regular-bot', 'confused', ['nextInt', 0, 100], ['chance', 3]]);
  assert.deepEqual(f.emojis, [['target', 'confused']]);
});

test('traitor mercy roll passes through to the final strength rule', () => {
  const f = fixture({ traitor: true, ints: [9], similar: true });
  const result = f.planner.decide(f.actor, f.target, false, f.hooks);
  assert.equal(result.accepted, true);
  assert.equal(result.decisionId, 12);
  assert.deepEqual(f.calls.slice(0, 3), ['regular-bot', 'confused', ['nextInt', 0, 100]]);
  assert.equal(f.calls.at(-1), 'similar-strength');
});

test('far nation win-fix accepts unless the bot is dominant', () => {
  for (const dominant of [false, true]) {
    const f = fixture({ winFixes: true, farNation: true, dominant });
    assert.equal(f.planner.decide(f.actor, f.target, false, f.hooks).accepted, !dominant);
    assert.deepEqual(f.calls, ['regular-bot', 'confused', 'far-nation', 'dominant']);
  }
});

test('alliance cap, team rejection and enough-alliance rules reject at their original positions', () => {
  for (const [option, expectedDecision] of [['allianceCap', 5], ['teamReject', 7], ['enough', 10]]) {
    const f = fixture({ [option]: true });
    const result = f.planner.decide(f.actor, f.target, false, f.hooks);
    assert.equal(result.accepted, false); assert.equal(result.decisionId, expectedDecision);
  }
});

test('threat rule preserves direction-specific emoji and accepts', () => {
  for (const [incoming, emoji] of [[false, 'scared'], [true, 'love']]) {
    const f = fixture({ threat: true, chances: [true] });
    assert.equal(f.planner.decide(f.actor, f.target, incoming, f.hooks).accepted, true);
    assert.deepEqual(f.calls.at(-1), ['chance', 6]);
    assert.deepEqual(f.emojis, [['target', emoji]]);
  }
});

test('negative relation rejection sends confused emoji only for incoming requests', () => {
  for (const incoming of [false, true]) {
    const f = fixture({ relation: -1, chances: [true] });
    assert.equal(f.planner.decide(f.actor, f.target, incoming, f.hooks).accepted, false);
    assert.deepEqual(f.emojis, incoming ? [['target', 'confused']] : []);
  }
});

test('friendly and early-game rules accept before final strength fallback', () => {
  const friendly = fixture({ friendly: true, chances: [true] });
  assert.equal(friendly.planner.decide(friendly.actor, friendly.target, true, friendly.hooks).accepted, true);
  assert.deepEqual(friendly.emojis, [['target', 'handshake']]);
  const early = fixture({ early: true });
  assert.equal(early.planner.decide(early.actor, early.target, false, early.hooks).accepted, true);
  assert.equal(early.calls.at(-1), 'early-game');
});

test('similar strength is the final definitive boolean result', () => {
  for (const similar of [false, true]) {
    const f = fixture({ similar });
    const result = f.planner.decide(f.actor, f.target, false, f.hooks);
    assert.equal(result.accepted, similar); assert.equal(result.decisionId, 12);
  }
});

test('explicit wait and stale ownership fail closed without evaluating a rule', () => {
  const wait = fixture({ selectWait: true });
  assert.deepEqual(wait.planner.decide(wait.actor, wait.target, true, wait.hooks),
    { accepted: false, stopped: true, decisionId: 1 });
  assert.deepEqual(wait.calls, []);
  const stale = fixture({ allowed: false });
  assert.deepEqual(stale.planner.decide(stale.actor, stale.target, true, stale.hooks),
    { accepted: false, stopped: true, decisionId: null });
});

test('losing ownership during a pass stops later rules', () => {
  const f = fixture();
  const original = f.actor.isRegularBot;
  f.actor.isRegularBot = target => { const result = original(target); f.stop(); return result; };
  assert.deepEqual(f.planner.decide(f.actor, f.target, true, f.hooks),
    { accepted: false, stopped: true, decisionId: 1 });
  assert.deepEqual(f.calls, ['regular-bot']);
});

test('snapshot target ID reads only the preferred identifier', () => {
  const f = fixture({ regularBot: true }); let ids = 0, smallIds = 0;
  f.target.id = () => { ids++; return 'target'; };
  f.target.smallID = () => { smallIds++; return 2; };
  f.planner.decide(f.actor, f.target, true, f.hooks);
  assert.equal(ids, 1); assert.equal(smallIds, 0);
});

function combatHooks(options = {}) {
  let decisionId = 0, allowed = true;
  const choices = [], records = [];
  return {
    choices, records, stop: () => { allowed = false; },
    hooks: {
      allowed: () => allowed,
      choose(domain, candidates, facts) {
        choices.push({ domain, candidates, facts });
        const eligible = candidates.filter(candidate => candidate.kind === domain && candidate.eligible);
        const picked = options.waitDomain === domain ? null : options.pickLastDomain === domain ? eligible.at(-1) : eligible[0];
        return { selectedId: picked?.id ?? '$wait', decisionId: ++decisionId, reason: 'test' };
      },
      execute: (_id, execute) => execute(),
      record: (kind, details) => records.push([kind, details])
    }
  };
}

function assistFixture(options = {}) {
  const calls = [], emoji = [], relations = [];
  const self = { smallID: () => 1 };
  const makeTarget = (id, extra = {}) => ({ id: () => id, smallID: () => Number(id.replace(/\D/g, '')) || 2,
    isPlayer: () => true, ...extra });
  const targets = options.targets || [makeTarget('enemy2')];
  let targetReads = 0;
  const ally = { id: () => 'ally', targets: () => { targetReads++; return targets; } };
  const actor = {
    emojiBehavior: { sendEmoji: (target, value) => emoji.push([target.id(), value]) },
    game: { config: () => ({ disableAlliances: () => !!options.disabled }) },
    player: {
      allies: () => options.allies || [ally], relation: () => options.relation ?? 1,
      smallID: self.smallID, isFriendly: target => !!target.friendly,
      updateRelation: (target, amount) => relations.push([target.id(), amount])
    },
    sendAttack: async (target, ...args) => {
      calls.push(['attack', target.id(), ...args]);
      if (options.attackError) throw options.attackError;
      return options.attackResults?.shift() ?? true;
    }
  };
  return { actor, ally, targets, calls, emoji, relations, targetReads: () => targetReads, makeTarget };
}

test('assistance preserves relation and invalid-target emoji order', async () => {
  const selfTarget = { id: () => 'self', smallID: () => 1, isPlayer: () => true };
  const friendly = { id: () => 'friend', smallID: () => 3, isPlayer: () => true, friendly: true };
  const f = assistFixture({ targets: [selfTarget, friendly], relation: 1 });
  const h = combatHooks();
  const result = await createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0,
    friendlyRelation: 1, emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } })
    .assist(f.actor, h.hooks);
  assert.deepEqual(result, { completed: false, stopped: false, decisionId: 3 });
  assert.deepEqual(f.emoji, [['ally', 'me'], ['ally', 'ally']]);
  assert.deepEqual(f.calls, []); assert.equal(f.targetReads(), 2);
});

test('low-relation assistance sends one emoji and never reads targets twice', async () => {
  const f = assistFixture({ relation: 0 }); const h = combatHooks();
  const planner = createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0, friendlyRelation: 1,
    emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } });
  const result = await planner.assist(f.actor, h.hooks);
  assert.equal(result.completed, false); assert.deepEqual(f.emoji, [['ally', 'low']]);
  assert.equal(f.targetReads(), 1); assert.deepEqual(f.calls, []);
  const record = h.records.find(([kind, details]) => kind === 'diplomacy-combat-result' && details.domain === 'assist-ally')[1];
  assert.equal(record.outcome, 'relation-too-low');
  assert.deepEqual(record.facts, { targetCount: 1, relation: 0, friendlyThreshold: 1 });
});

test('assistance falls through failed attacks then updates relation after success', async () => {
  const f = assistFixture({ targets: [
    { id: () => 'enemy2', smallID: () => 2, isPlayer: () => true },
    { id: () => 'enemy3', smallID: () => 3, isPlayer: () => true }
  ], attackResults: [false, true] });
  const h = combatHooks(); const planner = createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0,
    friendlyRelation: 1, emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } });
  const result = await planner.assist(f.actor, h.hooks);
  assert.equal(result.completed, true);
  assert.deepEqual(f.calls, [['attack', 'enemy2'], ['attack', 'enemy3']]);
  assert.deepEqual(f.relations, [['ally', -20]]); assert.deepEqual(f.emoji, [['ally', 'accept']]);
});

test('assistance wait, disabled alliances and attack exceptions preserve control flow', async () => {
  const planner = createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0, friendlyRelation: 1,
    emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } });
  const waiting = assistFixture(), waitHooks = combatHooks({ waitDomain: 'assist-ally' });
  assert.equal((await planner.assist(waiting.actor, waitHooks.hooks)).stopped, true);
  assert.equal(waiting.targetReads(), 0);
  const disabled = assistFixture({ disabled: true });
  assert.deepEqual(await planner.assist(disabled.actor, combatHooks().hooks), { completed: false, stopped: false, decisionId: null });
  const failure = Error('attack failed'), throwing = assistFixture({ attackError: failure });
  await assert.rejects(() => planner.assist(throwing.actor, combatHooks().hooks), error => error === failure);
});

test('assistance refills bounded windows and permits alternate target selection', async () => {
  const emptyAllies = Array.from({ length: 80 }, (_, i) => ({ id: () => `empty-${i}`, targets: () => [] }));
  const finalTarget = { id: () => 'enemy', smallID: () => 2, isPlayer: () => true };
  const finalAlly = { id: () => 'final', targets: () => [finalTarget] };
  const f = assistFixture({ allies: [...emptyAllies, finalAlly] }); const h = combatHooks();
  const planner = createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0, friendlyRelation: 1,
    emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } });
  assert.equal((await planner.assist(f.actor, h.hooks)).completed, true);
  assert.ok(h.choices.every(choice => choice.candidates.length <= 80));

  const alternate = assistFixture({ targets: [
    { id: () => 'first', smallID: () => 2, isPlayer: () => true },
    { id: () => 'last', smallID: () => 3, isPlayer: () => true }
  ] });
  await planner.assist(alternate.actor, combatHooks({ pickLastDomain: 'assist-target' }).hooks);
  assert.deepEqual(alternate.calls, [['attack', 'last']]);
});

test('assistance marks a stale async completion as stopped', async () => {
  const f = assistFixture(); const h = combatHooks();
  f.actor.sendAttack = async target => { f.calls.push(['attack', target.id()]); h.stop(); return true; };
  const planner = createDiplomacyPlanner({ settings: () => ({}), neutralRelation: 0, friendlyRelation: 1,
    emojis: { assistLow: 'low', assistMe: 'me', assistAlly: 'ally', assistAccept: 'accept' } });
  const result = await planner.assist(f.actor, h.hooks);
  assert.equal(result.stopped, true);
  assert.deepEqual(f.relations, []); assert.deepEqual(f.emoji, []);
});

function betrayFixture(options = {}) {
  const calls = [];
  const player = {
    troops: () => options.selfTroops ?? 1000,
    isAlliedWith: target => target.allied !== false
  };
  const actor = {
    player, game: { config: () => ({ disableAlliances: () => !!options.disabled,
      maxTroops: target => target.capacity ?? 1000 }) },
    allianceBehavior: { betray: target => calls.push(['betray', target.id()]) },
    sendAttack: async (target, force) => { calls.push(['attack', target.id(), force]); return options.attackResult ?? true; }
  };
  const friend = (id, extra = {}) => ({ id: () => id, troops: () => extra.troops ?? 100,
    outgoingAttacks: () => (extra.outgoing || []).map(troops => ({ troops: () => troops })),
    type: () => extra.type ?? 'Human', isTraitor: () => !!extra.traitor,
    allied: extra.allied, capacity: extra.capacity });
  return { actor, calls, friend };
}

function combatPlanner(options = {}) {
  return createDiplomacyPlanner({ settings: () => ({ features: { betray: options.betray !== false } }),
    difficulty: () => options.difficulty || 'Hard', difficulties: { easy: 'Easy', medium: 'Medium' },
    humanType: 'Human', neutralRelation: 0, friendlyRelation: 1, emojis: {} });
}

test('betrayal preserves hard weakness, traitor and sole-opponent rules', async () => {
  for (const scenario of [
    { friend: { troops: 100, outgoing: [50], capacity: 1000 }, total: 2 },
    { friend: { troops: 800, traitor: true }, total: 2 },
    { friend: { troops: 300 }, total: 1 }
  ]) {
    const f = betrayFixture(), target = f.friend('ally', scenario.friend), h = combatHooks();
    const result = await combatPlanner({ difficulty: 'Hard' }).betray(f.actor, [target], Array(scenario.total - 1).fill({}), h.hooks);
    assert.equal(result.completed, true); assert.deepEqual(f.calls, [['betray', 'ally'], ['attack', 'ally', true]]);
  }
});

test('betrayal preserves easy human exclusion and medium ten-times boundary', async () => {
  const easy = betrayFixture({ selfTroops: 1000 }), human = easy.friend('human', { troops: 100, type: 'Human' });
  assert.equal((await combatPlanner({ difficulty: 'Easy' }).betray(easy.actor, [human], [], combatHooks().hooks)).completed, false);
  const medium = betrayFixture({ selfTroops: 1000 }), target = medium.friend('human', { troops: 100, type: 'Human' });
  assert.equal((await combatPlanner({ difficulty: 'Medium' }).betray(medium.actor, [target], [{}], combatHooks().hooks)).completed, true);
});

test('betrayal skips strict boundaries and non-allies before the next candidate', async () => {
  const f = betrayFixture({ selfTroops: 1000 });
  const nonAlly = f.friend('not-allied', { allied: false, troops: 1 });
  const boundary = f.friend('boundary', { troops: 200, capacity: 1000, outgoing: [] });
  const winner = f.friend('winner', { troops: 100, capacity: 1000 });
  const result = await combatPlanner({ difficulty: 'Hard' }).betray(f.actor, [nonAlly, boundary, winner], [], combatHooks().hooks);
  assert.equal(result.completed, true); assert.deepEqual(f.calls, [['betray', 'winner'], ['attack', 'winner', true]]);
});

test('betrayal wait, disabled feature and exact attack result are preserved', async () => {
  const f = betrayFixture({ attackResult: false }), target = f.friend('ally', { troops: 100, capacity: 1000 });
  assert.equal((await combatPlanner().betray(f.actor, [target], [{}], combatHooks({ waitDomain: 'betray-target' }).hooks)).stopped, true);
  assert.deepEqual(f.calls, []);
  assert.equal((await combatPlanner({ betray: false }).betray(f.actor, [target], [{}], combatHooks().hooks)).completed, false);
  const result = await combatPlanner().betray(f.actor, [target], [{}], combatHooks().hooks);
  assert.equal(result.completed, false); assert.deepEqual(f.calls, [['betray', 'ally'], ['attack', 'ally', true]]);
});

test('betrayal refills bounded windows and permits alternate selection', async () => {
  const f = betrayFixture();
  const nonAllies = Array.from({ length: 80 }, (_, i) => f.friend(`skip-${i}`, { allied: false }));
  const winner = f.friend('winner', { troops: 100, capacity: 1000 }); const h = combatHooks();
  assert.equal((await combatPlanner().betray(f.actor, [...nonAllies, winner], [{}], h.hooks)).completed, true);
  assert.ok(h.choices.every(choice => choice.candidates.length <= 80));

  const alternate = betrayFixture();
  const first = alternate.friend('first', { troops: 100, capacity: 1000 });
  const last = alternate.friend('last', { troops: 100, capacity: 1000 });
  await combatPlanner().betray(alternate.actor, [first, last], [{}], combatHooks({ pickLastDomain: 'betray-target' }).hooks);
  assert.deepEqual(alternate.calls, [['betray', 'last'], ['attack', 'last', true]]);
});

test('betrayal stops before side effects when ownership is lost after evaluation', async () => {
  const f = betrayFixture(), target = f.friend('ally', { troops: 100, capacity: 1000 });
  const h = combatHooks(); const execute = h.hooks.execute;
  h.hooks.execute = (id, run) => { const result = execute(id, run); h.stop(); return result; };
  const result = await combatPlanner().betray(f.actor, [target], [{}], h.hooks);
  assert.equal(result.stopped, true); assert.deepEqual(f.calls, []);
  const record = h.records.find(([kind]) => kind === 'diplomacy-combat-result')[1];
  assert.equal(record.outcome, 'stale-after-evaluation'); assert.equal(record.condition, 'weak-capacity');
});
