# Alliance Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the legacy `getAllianceDecision` rule chain through the central decision engine while preserving its synchronous return value, random-call order, emoji side effects, and request actions.

**Architecture:** Add a synchronous `diplomacy-planner.js` whose candidates represent the legacy alliance rules and are evaluated lazily. Add runtime hooks for decisions, explicit waits, and one-shot parent links consumed by the existing intent/callback gateways. Patch only the minified rule method and its three call contexts; the request loops and event actions remain legacy executors.

**Tech Stack:** Node.js CommonJS, `node:test`, the existing decision engine/runtime, and the deterministic userscript build script.

## Global Constraints

- Preserve legacy behavior, rule order, random-call order and bounds, synchronous returns, and emoji side effects.
- Keep players, events, buttons, and callbacks out of decision snapshots and trace records.
- Explicit policy waits, strategy errors, stale ownership, and disabled features must stop the affected request.
- Logging failures must not affect gameplay.
- This directory is not a Git repository, so commit steps are replaced by verified file checkpoints.

---

### Task 1: Lazy alliance-rule planner

**Files:**
- Create: `src/brain/diplomacy-planner.js`
- Create: `tests/brain-diplomacy.test.js`
- Modify: `src/brain/legacy-strategy.js`

**Interfaces:**
- Consumes: `createDiplomacyPlanner({ settings, neutralRelation, emojis })` and hooks `{ allowed, choose, execute, record }`.
- Produces: `planner.decide(actor, target, incoming, hooks) -> { accepted: boolean, stopped: boolean, decisionId: number|null }`.

- [ ] **Step 1: Write failing planner tests**

Create fixtures with deterministic `chance` and `nextInt` queues. Cover regular-bot rejection; confused accept/reject; traitor pass-through and rejection; far-nation accept/dominant rejection; alliance cap; threat; team rejection; hostile relation; friendly relation; enough alliances; early game; final similarly-strong result; exact random call order; emoji calls; explicit wait; policy error; stale guard; and recovery on the next call.

The key test shape is:

```js
const planner = createDiplomacyPlanner({ settings: () => settings, neutralRelation: 0,
  emojis: { confused: 'confused', scared: 'scared', love: 'love', handshake: 'handshake' } });
const result = planner.decide(actor, target, true, hooks());
assert.deepEqual(result, { accepted: false, stopped: false, decisionId: 2 });
assert.deepEqual(randomCalls, [['chance', 10], ['nextInt', 0, 100], ['chance', 3]]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/brain-diplomacy.test.js`

Expected: FAIL because `src/brain/diplomacy-planner.js` does not exist.

- [ ] **Step 3: Implement the minimal planner**

Use these ordered rule IDs:

```js
const rules = [
  'regular-bot', 'confused', 'traitor', 'far-nation', 'alliance-cap', 'threat',
  'team-reject', 'hostile-relation', 'friendly-relation', 'enough-alliances',
  'early-game', 'similar-strength'
];
```

Expose all remaining rules as lazy candidates with `kind: 'alliance-rule'`, original priority, `readiness: 'unchecked'`, and stable facts limited to `targetId`, `incoming`, and rule name. Add `$wait`. On selection, execute only the chosen rule, record `diplomacy-rule-result`, return on a matched rule, or remove that rule and decide again. Implement the exact original checks by calling the actor's existing helpers:

```js
case 'regular-bot': return actor.isRegularBot(target) ? reject('Regular Bot') : pass();
case 'confused': return actor.isConfused() ? finish(actor.random.chance(2), 'Confused roll') : pass();
case 'traitor':
  if (!target.isTraitor() || actor.random.nextInt(0, 100) < 10) return pass();
  if (incoming && actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.confused);
  return reject('Traitor rejection');
case 'far-nation':
  if (!deps.settings().winFixes || !actor.isFarNation(target)) return pass();
  return finish(!actor.isDominantForDiplomacy(), 'Far-nation win-fix');
case 'alliance-cap': return actor.hasTooManyAlliances(target) ? reject('Alliance cap') : pass();
case 'threat':
  if (!actor.isAlliancePartnerThreat(target)) return pass();
  if (!incoming && actor.random.chance(6)) actor.emojiBehavior.sendEmoji(target, deps.emojis.scared);
  if (incoming && actor.random.chance(6)) actor.emojiBehavior.sendEmoji(target, deps.emojis.love);
  return accept('Threat alliance');
case 'team-reject': return actor.shouldRejectInTeamGame() ? reject('Team-game rejection') : pass();
case 'hostile-relation':
  if (actor.player.relation(target) >= deps.neutralRelation) return pass();
  if (incoming && actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.confused);
  return reject('Negative relation');
case 'friendly-relation':
  if (!actor.isAlliancePartnerFriendly(target)) return pass();
  if (actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.handshake);
  return accept('Friendly relation');
case 'enough-alliances': return actor.checkAlreadyEnoughAlliances(target) ? reject('Enough alliances') : pass();
case 'early-game': return actor.isEarlygame() ? accept('Early game') : pass();
case 'similar-strength': return finish(actor.isAlliancePartnerSimilarlyStrong(target), 'Relative strength');
```

If `allowed()` is false, or the selected ID is `$wait`, null, unknown, or comes from a strategy error, return `{ accepted: false, stopped: true, decisionId }`. Do not catch original helper exceptions.

- [ ] **Step 4: Register the policy domain**

Add `alliance-rule` to the planning-domain list in `legacy-strategy.js` and increment the internal strategy version from `1.84.0-plans.11` to `1.84.0-plans.12`.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/brain-diplomacy.test.js`

Expected: all focused planner tests pass.

---

### Task 2: Runtime and generated-script integration

**Files:**
- Modify: `src/brain/runtime.js`
- Modify: `src/brain/bootstrap.js`
- Modify: `scripts/build.js`
- Modify: `tests/brain-runtime.test.js`
- Modify: `tests/brain-build.test.js`

**Interfaces:**
- Consumes: `diplomacyPlanner.decide(actor, target, incoming, hooks)` from Task 1.
- Produces: `runtime.decideAlliance(actor, target, incoming, context) -> boolean` and `runtime.allianceDecisionStopped(actor) -> boolean`.

- [ ] **Step 1: Write failing runtime/build tests**

Assert that a live `AllianceBehavior` gets the `alliance-rule` snapshot; strategy wait returns false and marks the decision stopped; the next decision recovers; and callback/intent commands receive the final rule's `parentDecisionId`. Assert the generated script contains:

```js
getAllianceDecision(e,t,a){return ofhBrainRuntime.decideAlliance(this,e,t,a)}
getAllianceDecision(t,true,"incoming")
getAllianceDecision(i,true,"renewal")
getAllianceDecision(t,false,"outgoing")
```

Also assert the incoming loop checks `allianceDecisionStopped(this)` before accepting or rejecting.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/brain-runtime.test.js tests/brain-build.test.js`

Expected: FAIL because diplomacy runtime APIs and build rewrites are absent.

- [ ] **Step 3: Add runtime hooks and one-shot command parents**

Add WeakMaps for stopped state and pending command parents. `decideAlliance` obtains the attached controller, calls the planner with synchronous hooks, records `domain: 'alliance-rule'` plus stable diplomacy facts, stores the final decision ID only when the legacy caller will immediately issue an action (`incoming`, accepted `renewal`, or accepted `outgoing`), and clears it otherwise.

Wrap `intent` and `callback` submission with a helper that temporarily places the one-shot diplomacy parent in `activePlans`, consumes it in `finally`, and restores any previous plan:

```js
function withPendingDiplomacyParent(actor, execute) {
  const decisionId = diplomacyParents.get(actor);
  if (decisionId === undefined) return execute();
  const previous = activePlans.get(actor);
  activePlans.set(actor, decisionId);
  try { return execute(); }
  finally {
    diplomacyParents.delete(actor);
    if (previous === undefined) activePlans.delete(actor); else activePlans.set(actor, previous);
  }
}
```

An explicit wait sets the stopped flag for the current call. A subsequent call resets it before planning.

- [ ] **Step 4: Bootstrap the planner**

Instantiate it with `state.settings`, `Relation.Neutral`, and the four existing emoji constants. Add `diplomacy-planner.js` to the injected module list before `runtime.js`.

- [ ] **Step 5: Patch the exact minified anchors**

Replace only the `getAllianceDecision` method body. Add explicit context strings to its three legacy call sites. In `handleAllianceRequests`, insert a stopped check between the decision and the accept/reject action. Keep renewal and outgoing false results as their existing no-action paths.

- [ ] **Step 6: Verify GREEN**

Run: `node --test tests/brain-diplomacy.test.js tests/brain-runtime.test.js tests/brain-build.test.js`

Expected: all focused tests pass.

---

### Task 3: Original/generated parity, documentation, and release build

**Files:**
- Modify: `tests/brain-parity.test.js`
- Modify: `README.md`
- Modify: `scripts/build.js`
- Generate: `openfront-helper.user.js`

**Interfaces:**
- Consumes: generated `AllianceBehavior` integration from Task 2.
- Produces: userscript version `1.84.13` and documented alliance-decision coverage.

- [ ] **Step 1: Add failing original/generated parity cases**

Use queued random values and identical actor/player fixtures for original and generated classes. Compare return value, exact random-call trace, emojis, and request commands for every terminating rule plus pass-through boundaries. Include incoming rejection, incoming acceptance, renewal acceptance/no action, outgoing acceptance/no action, disabled alliances, regular Bot, traitor 90/10 boundary, far dominant/non-dominant, threat incoming/outgoing, team rejection, negative relation, friendly relation, alliance-count rejection, early-game threshold, and similarly-strong final result.

- [ ] **Step 2: Run parity tests and verify RED where integration is incomplete**

Run: `node --test tests/brain-parity.test.js`

Expected before final fixes: at least one new diplomacy parity case fails for a concrete return, random trace, side effect, or command mismatch.

- [ ] **Step 3: Make the smallest parity corrections**

Correct the planner or integration only where the original/generated comparison identifies a difference. Do not tune thresholds or reorder rules.

- [ ] **Step 4: Update release metadata and docs**

Set the generated userscript version to `1.84.13`. Update `README.md` to list centralized alliance rule decisions, preserved executor loops, trace behavior, and combat diplomacy as the next remaining pass.

- [ ] **Step 5: Run full verification**

Run in order:

```powershell
node --test tests/*.test.js
node scripts/build.js
node --check openfront-helper.user.js
node scripts/build.js --check
```

Expected: zero failed tests; build reports the unchanged 17 event, 9 build, and 3 alliance callback gateways; syntax exits 0; generated source matches checked-in source.

- [ ] **Step 6: Self-review against the design**

Confirm no live player/event/button objects appear in exported snapshots, no unselected rule consumes randomness or sends an emoji, a policy wait cannot reject an incoming request, one-shot parents cannot leak to later commands, and combat diplomacy remains unchanged for Pass 2.
