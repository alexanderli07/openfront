# Central Turn Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the Auto-Bot's build-only and full play-phase schedules through one central `turn-plan` decision boundary without changing the legacy phase order or multi-action behavior.

**Architecture:** A pure `turn-planner.js` creates high-level phase candidates and repeatedly asks the strategy to choose among remaining phases. Runtime hooks provide immutable snapshots, parent-decision scopes and stale-owner checks. The builder replaces only the two scheduling regions in `NationBot.tick`; existing domain planners and command gateways remain the executors.

**Tech Stack:** Node.js CommonJS, `node:test`, existing decision engine/runtime, deterministic userscript builder.

## Global Constraints

- Preserve the original build-only cadence and full cadence phase order, gates, call count, side effects and multi-action behavior.
- Do not add economic weights, combat weights, action budgets, dependencies or a new default strategy.
- Do not pass live bots, players, behaviors, callbacks, events or promises into strategy snapshots.
- Random draws, searches and side effects run only after their phase is selected.
- Explicit wait, invalid selection, strategy error or stale ownership stops only the current turn pass.
- Phase exceptions retain identity and abort later phases through the existing `NationBot.tick` catch.
- Parent scopes restore after synchronous completion, async fulfillment and rejection.
- Advance the strategy to `1.84.0-plans.14` and the userscript to `1.84.15`.
- This directory is not a Git repository; fresh tests, generated-file checks and review checkpoints replace commits.

---

### Task 1: Pure turn planner

**Files:**
- Create: `src/brain/turn-planner.js`
- Create: `tests/brain-turn.test.js`
- Modify: `src/brain/legacy-strategy.js`

**Interfaces:**
- Consumes: `bot`, primitive `context`, and hooks `{ allowed, choose, execute, record }`.
- Produces: `createTurnPlanner().run(bot, context, hooks) -> Promise<{ stopped: boolean, completed: string[], decisionId: number|null }>`.

- [ ] **Step 1: Write failing availability and order tests**

Create fixtures whose bot methods append phase names. Test `build-only` produces only `structure-secondary`; test `full` produces the eleven phases in the exact spec order even when helpers return `true`, `false` or `undefined`.

```js
test('full path preserves every original phase in order', async () => {
  const f = fixture();
  const result = await planner.run(f.bot, { path: 'full', features: allFeatures }, f.hooks);
  assert.deepEqual(f.calls, ['casual-emoji', 'embargo-relations', 'bot-alliance-requests',
    'alliance-requests', 'alliance-extensions', 'mirv', 'structure', 'warship-deployment',
    'embargo', 'attack', 'warship-infestation', 'nuke']);
  assert.equal(result.stopped, false);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/brain-turn.test.js`

Expected: FAIL because `src/brain/turn-planner.js` does not exist.

- [ ] **Step 3: Implement phase definitions and lazy execution**

Implement `createTurnPlanner()` with stable `turn:<path>:<phase>` IDs, `$wait`, the build-only/full arrays, lazy feature gates, and an `executePhase` switch. Candidates use `readiness: 'unchecked'`; each selected phase reads its original gate immediately before execution so feature reads retain their original position:

```js
async function executePhase(bot, phase) {
  switch (phase) {
    case 'structure-secondary': return bot.structureBehavior.handleStructures();
    case 'casual-emoji': return bot.emojiBehavior.maybeSendCasualEmoji();
    case 'embargo-relations': return bot.updateRelationsFromEmbargos();
    case 'bot-alliance-requests': return bot.allianceBehavior.handleAllianceRequestsFromBots();
    case 'alliance-requests':
      bot.allianceBehavior.handleAllianceRequests();
      return bot.allianceBehavior.handleAllianceExtensionRequests();
    case 'mirv': return bot.mirvBehavior.considerMIRV();
    case 'structure': return bot.structureBehavior.handleStructures();
    case 'warship-deployment': return bot.warshipBehavior.maybeSpawnWarship();
    case 'embargo': return bot.handleEmbargoesToHostileNations();
    case 'attack': return bot.attackBehavior.maybeAttack();
    case 'warship-infestation': return bot.warshipBehavior.counterWarshipInfestation();
    case 'nuke': return bot.nukeBehavior.maybeSendNuke();
    default: throw new Error('Unknown turn phase: ' + phase);
  }
}
```

After every selection, remove that phase regardless of its return value. Record `turn-plan-result` as `completed`, `stopped` or `threw`. Recheck `allowed()` before selection, before execution and after awaiting execution.

- [ ] **Step 4: Add feature, replacement-policy and failure tests**

Test each feature gate, `warshipAutoSpawn === false`, alternate selection, explicit wait, invalid selection, stopped owner, stop during an awaited phase, and exact thrown-error identity. Assert no unselected phase helper runs and candidates contain primitives only.

```js
test('stale async phase prevents remaining phases', async () => {
  const f = fixture({ stopDuring: 'mirv' });
  const result = await planner.run(f.bot, { path: 'full', features: allFeatures }, f.hooks);
  assert.equal(result.stopped, true);
  assert.equal(f.calls.includes('structure'), false);
});
```

- [ ] **Step 5: Register `turn-plan` with the legacy strategy and verify GREEN**

Add `turn-plan` to the ordered-domain list in `legacy-strategy.js`, then run:

```powershell
node --test tests/brain-turn.test.js
```

Expected: all turn-planner tests pass.

---

### Task 2: Runtime integration and ancestry

**Files:**
- Modify: `src/brain/runtime.js`
- Modify: `tests/brain-runtime.test.js`

**Interfaces:**
- Consumes: `deps.turnPlanner` and an attached `NationBot`.
- Produces: `runtime.planTurn(bot, context) -> Promise<{ stopped, completed, decisionId }>`.

- [ ] **Step 1: Write failing runtime tests**

Add a turn planner dependency to the runtime fixture. Test that `planTurn` is missing, then cover:

```js
test('turn phase links nested planner and command ancestry', async () => {
  await runtime.planTurn(bot, fullContext);
  const turn = decisions.find(r => r.snapshot.domain === 'turn-plan' && r.selectedId.endsWith(':attack'));
  const attack = decisions.find(r => r.snapshot.domain === 'attack-plan');
  const command = decisions.find(r => r.candidates[0]?.source === 'AttackBehavior.sendAttack');
  assert.equal(attack.snapshot.parentDecisionId, turn.decisionId);
  assert.equal(command.candidates[0].parentDecisionId, attack.decisionId);
});
```

Also test primitive `snapshot.turn`, explicit wait/error recovery on the next call, and no parent leakage after fulfilled/rejected deferred phase helpers.

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `node --test tests/brain-runtime.test.js`

Expected: FAIL because `planTurn` and turn hooks are absent.

- [ ] **Step 3: Implement turn hooks and runtime entry point**

Add:

```js
function turnHooks(bot) {
  const controller = owners.get(bot);
  if (!controller || !deps.turnPlanner) throw new Error('Turn planner is not attached');
  return {
    allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg),
    choose: (domain, candidates, facts) => controller.engine.decide({
      ...safe(() => snapshot(controller), { unavailable: true }), domain, turn: facts,
      ...(activePlans.has(bot) ? { parentDecisionId: activePlans.get(bot) } : {})
    }, candidates),
    execute: (decisionId, execute) => withPlan(bot, decisionId, execute),
    record: (kind, details) => controller.engine.record(kind, details)
  };
}
async function planTurn(bot, context) {
  return deps.turnPlanner.run(bot, context, turnHooks(bot));
}
```

Export `planTurn`. Keep scopes local to each call; do not add shared turn cancellation state.

- [ ] **Step 4: Verify runtime behavior**

Run:

```powershell
node --test tests/brain-runtime.test.js tests/brain-turn.test.js
```

Expected: all focused tests pass.

---

### Task 3: Standalone builder integration

**Files:**
- Modify: `src/brain/bootstrap.js`
- Modify: `scripts/build.js`
- Modify: `tests/brain-build.test.js`

**Interfaces:**
- Consumes: `createTurnPlanner()` and `runtime.planTurn`.
- Produces: two generated `NationBot.tick` call sites for `build-only` and `full` paths.

- [ ] **Step 1: Write failing builder tests**

Assert the generated source includes `function createTurnPlanner`, bootstrap dependency `turnPlanner: createTurnPlanner()`, version `1.84.15`, and these call shapes:

```js
await ofhBrainRuntime.planTurn(this,{path:"build-only",tick:e,attackRate:i})
await ofhBrainRuntime.planTurn(this,{path:"full",tick:e,attackRate:i})
```

Also assert the original phase sequence no longer remains inside `NationBot.tick`, while the thinking status and outer catch remain.

- [ ] **Step 2: Run build tests and verify RED**

Run: `node --test tests/brain-build.test.js`

Expected: FAIL because the module and call sites are not wired into the generated build.

- [ ] **Step 3: Wire bootstrap and builder**

Add `turnPlanner: createTurnPlanner()` to bootstrap dependencies and `turn-planner.js` to the builder module list. Replace only:

```js
if(!l){if(u&&this.feat("build")){await this.structureBehavior.handleStructures()}return}
```

with a build-only `planTurn` call that retains the same `!l`, `u`, feature and return behavior.

Replace the statements inside the existing full-path `try` from `this.emojiBehavior.maybeSendCasualEmoji()` through `await this.nukeBehavior.maybeSendNuke()` with one full `planTurn` call. Let the planner evaluate each feature expression lazily after that phase is selected, including separate MIRV/nuke and warship-deployment/infestation reads. Eagerly building a flags object would move every feature read ahead of the unconditional opening phases and violate parity. Retain the thinking status, the `try/catch`, and the original error log.

Advance the metadata and legacy strategy versions exactly as specified.

- [ ] **Step 4: Verify generated integration**

Run:

```powershell
node --test tests/brain-build.test.js tests/brain-runtime.test.js tests/brain-turn.test.js
node scripts/build.js
node --check openfront-helper.user.js
```

Expected: focused tests pass, builder reports 17 event gateways, 9 build gateways and 3 alliance callbacks, and syntax check exits 0.

---

### Task 4: Original/generated parity and documentation

**Files:**
- Modify: `tests/brain-parity.test.js`
- Modify: `README.md`
- Generate: `openfront-helper.user.js`

**Interfaces:**
- Validates the complete coordinator through original and generated `NationBot.tick` behavior.
- Documents the new public trace domains and remaining work.

- [ ] **Step 1: Add cadence parity fixtures**

Extend the `NationBot` parity fixture so each behavior records calls. Compare original and generated output for:

- build-only cadence;
- full cadence with all features;
- each feature disabled;
- `warshipAutoSpawn === false`;
- helpers returning true, false and undefined;
- a phase throwing and aborting later phases;
- multiple command-producing phases in one tick.

Use the real `tick` method and control `attackTick`, `attackRate`, `lastSeenTick` and current tick so the same cadence path executes in both builds.

- [ ] **Step 2: Run parity tests and correct demonstrated mismatches**

Run: `node --test tests/brain-parity.test.js`

Expected: all original/generated parity cases pass. Change production code only for a demonstrated mismatch or violated spec requirement.

- [ ] **Step 3: Update README**

Document version `1.84.15`, `turn-plan`, `turn-plan-result`, the hierarchy `turn-plan -> domain plan -> target/rule -> command`, multi-action legacy semantics, wait/error behavior and the remaining pocket/island/random-boat migrations. Remove shared investment-versus-combat coordination from the remaining-work list because the common high-level boundary now exists; state that no new weighting policy is enabled.

- [ ] **Step 4: Run final verification**

Run exactly:

```powershell
node --test tests/*.test.js
node scripts/build.js
node --check openfront-helper.user.js
node scripts/build.js --check
```

Expected: zero failed tests; 17 event, 9 build and 3 callback gateways; syntax exit 0; deterministic build check reports that the standalone userscript matches source modules.

- [ ] **Step 5: Request independent code review**

Ask a reviewer to compare current files against `docs/superpowers/specs/2026-09-21-turn-coordinator-design.md`, fix every Critical or Important issue, and repeat the full verification after the final edit. Report that live browser gameplay remains untested.
