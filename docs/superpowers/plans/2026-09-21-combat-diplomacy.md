# Combat Diplomacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize ally-assistance and betrayal choices while preserving the original iteration order, side effects, return values, and command ancestry.

**Architecture:** Extend `diplomacy-planner.js` with two async planners. Assistance exposes ordered relation gates and target attempts so skipped-target emojis occur at the same point as before. Betrayal exposes allies lazily and evaluates the original `maybeBetray` conditions only after selection. Runtime hooks nest these decisions under the active attack purpose and scope both `AttackBehavior` and `AllianceBehavior` during betrayal execution.

**Tech Stack:** Node.js CommonJS, `node:test`, existing decision engine/runtime, deterministic userscript builder.

## Global Constraints

- Preserve original ally and target order, strict/inclusive comparisons, difficulty rules, side effects, and return values.
- Do not tune combat or diplomacy behavior.
- Do not pass live players, events, callbacks, or behaviors into policy snapshots.
- Explicit wait, strategy error, stale ownership, or disabled features stop the affected combat-diplomacy purpose.
- Keep candidate batches within 80 entries including `$wait`, refilling as steps are consumed.
- This directory is not a Git repository; verified file checkpoints replace commits.

---

### Task 1: Assistance planner

**Files:**
- Modify: `src/brain/diplomacy-planner.js`
- Modify: `src/brain/legacy-strategy.js`
- Modify: `tests/brain-diplomacy.test.js`

**Interfaces:**
- Produces `planner.assist(actor, hooks) -> Promise<{ completed: boolean, stopped: boolean, decisionId: number|null }>`.
- Uses hooks `{ allowed, choose, execute, record }`.

- [ ] Write failing tests for empty allies, disabled alliances, low-relation emoji, self-target emoji, friendly-target emoji, failed attack fallback, successful attack relation update and acceptance emoji, stable first ordering, bounded refill beyond 79, policy wait/error, stale completion, and thrown attack identity.
- [ ] Run `node --test tests/brain-diplomacy.test.js` and confirm failure because `assist` is missing.
- [ ] Implement ordered steps. Each ally with targets contributes one relation step followed by target steps. A low relation sends `EMOJI_ASSIST_RELATION_TOO_LOW` once and removes the ally's remaining steps. Self/friendly targets send their original emojis and advance. An enemy target calls `sendAttack`; false advances, true updates the ally relation by `-20`, sends `EMOJI_ASSIST_ACCEPT`, and returns success.
- [ ] Add `assist-target` to the legacy planning domains and verify focused tests pass.

### Task 2: Betrayal planner

**Files:**
- Modify: `src/brain/diplomacy-planner.js`
- Modify: `tests/brain-diplomacy.test.js`

**Interfaces:**
- Produces `planner.betray(actor, friends, enemies, hooks) -> Promise<{ completed: boolean, stopped: boolean, decisionId: number|null }>`.

- [ ] Write failing tests for disabled alliances, disabled betrayal feature, non-allies, Hard/Impossible weak-capacity condition, Easy/Medium ten-times condition with Easy-human exclusion, non-Easy traitor condition, sole-opponent condition, strict boundaries, first eligible ally, alternate strategy selection, wait/error, stale owner, and exact attack return.
- [ ] Run the focused tests and confirm failure because `betray` is missing.
- [ ] Implement lazy `betray-target` candidates. When a selected ally matches the original conditions, call `allianceBehavior.betray(friend)` and then `sendAttack(friend, true)` exactly once. Return the attack result. Otherwise remove the candidate and continue.
- [ ] Add `betray-target` to the legacy planning domains and verify focused tests pass.

### Task 3: Runtime and generated integration

**Files:**
- Modify: `src/brain/runtime.js`
- Modify: `scripts/build.js`
- Modify: `tests/brain-runtime.test.js`
- Modify: `tests/brain-build.test.js`

**Interfaces:**
- Produces `runtime.planAssist(actor)` and `runtime.planBetray(actor, friends, enemies)`.
- Reuses the attached `diplomacyPlanner` and active attack scope.

- [ ] Write failing runtime/build tests for the two generated wrappers, purpose-to-diplomacy-to-command ancestry, policy wait/error propagation, dual behavior scope restoration, and stale async completion.
- [ ] Run focused tests and verify the missing runtime/build integration fails.
- [ ] Add combat-diplomacy hooks. Decision snapshots use `domain`, primitive facts, and the current attack-purpose parent. Executor scope sets the selected decision on the attack actor and its alliance behavior, awaits completion, and restores both in `finally`.
- [ ] Patch only `assistAllies` and `maybeBetrayAndAttack` in the minified baseline. Keep `AllianceBehavior.maybeBetray`, `betray`, emoji methods, relation updates, and command gateways available as legacy executors/helpers.
- [ ] Set the strategy version to `1.84.0-plans.13` and userscript version to `1.84.14`.
- [ ] Run focused tests until green.

### Task 4: Parity, documentation, and verification

**Files:**
- Modify: `tests/brain-parity.test.js`
- Modify: `README.md`
- Generate: `openfront-helper.user.js`

- [ ] Add original/generated parity cases for all assistance skip/success paths and every betrayal condition/boundary, including exact emojis, relation updates, betrayal/attack command order, and return values.
- [ ] Run `node --test tests/brain-parity.test.js`; correct only demonstrated mismatches.
- [ ] Document `assist-target` and `betray-target`, update remaining work, and generate 1.84.14.
- [ ] Run `node --test tests/*.test.js`, `node scripts/build.js`, `node --check openfront-helper.user.js`, and `node scripts/build.js --check`.
- [ ] Confirm the gateway counts remain 17 event, 9 build, and 3 alliance callbacks, and note that live gameplay remains untested.
