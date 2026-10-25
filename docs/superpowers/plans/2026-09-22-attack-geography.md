# Attack Geography Centralization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route sealable-pocket and nearest-island-enemy selection through the central decision engine while preserving the legacy result, scan/probe order, cache state, and attack behavior.

**Architecture:** A pure `attack-geography-planner.js` owns the two asynchronous searches and returns `{ target, decisionId, stop }`. Runtime hooks provide snapshots, ownership checks, and guarded transport probes. The attack planner executes `sendAttack` beneath the selected geography decision; thin generated adapters cover standalone helper calls.

**Tech Stack:** Node.js CommonJS, `node:test`, existing decision engine/runtime, deterministic standalone userscript builder.

## Global Constraints

- Preserve the original pocket and island filters, ordering, strict boundaries, first ties, awaited operations, cache mutations, return values, and exceptions.
- Keep all policy inputs primitive; never expose player, game, promise, callback, or behavior objects.
- Run searches and probes only after the enclosing attack purpose is selected.
- A wait, invalid selection, policy error, or stale owner stops the current attack pass and produces a terminal result.
- Preserve `turn-plan -> attack-plan -> attack-geography -> command` ancestry.
- Do not add gameplay scoring, dependencies, or unrelated refactors.
- Advance the userscript to `1.84.16` and the legacy strategy to `1.84.0-plans.15`.
- This directory is not a Git repository; review checkpoints and fresh verification replace commit steps.

---

### Task 1: Pure attack-geography planner

**Files:**
- Create: `src/brain/attack-geography-planner.js`
- Create: `tests/brain-attack-geography.test.js`
- Modify: `src/brain/legacy-strategy.js`

**Interfaces:**
- Consumes: `createAttackGeographyPlanner({ settings, transportType, ffaMode })`, `actor`, `mode`, and hooks `{ allowed, choose, probe, record }`.
- Produces: `planner.select(actor, mode, hooks) -> Promise<{ target: object|null, decisionId: number|null, stop: boolean }>`.

- [ ] **Step 1: Write failing pocket-selection tests**

Cover the highest seal ratio, stable first tie, player/friendly/dead/land-share filters, shore/map-edge/foreign-owner rejection, strict minimum threshold, per-player scan exceptions, tick-read failure, empty selection, and exact `_pocketTick`/`_pocketSid` mutations. Assert `ensureBorderTiles` follows nearby order and candidate facts are primitive.

```js
const result = await planner.select(actor, 'pocket', hooks);
assert.equal(result.target, bestPocket);
assert.deepEqual(borderCalls, [first.smallID(), bestPocket.smallID()]);
assert.equal(actor._pocketSid, bestPocket.smallID());
assert.equal(choice.snapshot.mode, 'pocket');
```

- [ ] **Step 2: Verify the new test is red**

Run: `node --test tests/brain-attack-geography.test.js`

Expected: failure because `src/brain/attack-geography-planner.js` does not exist.

- [ ] **Step 3: Implement pocket scanning and caching**

Implement the original cache fast path before candidate creation. On a miss, clear the original cache fields, scan nearby players in order, and create candidates with stable IDs and primitive facts:

```js
{
  id: `attack-geography:pocket:${smallId}`,
  kind: 'attack-geography', mode: 'pocket', targetId, inputIndex,
  priority, eligible: true,
  facts: { tilesOwned, landShare, maxLandShare, ownedPerimeter, openPerimeter, sealShare, minSealShare },
  reason: 'Sealable pocket meeting original land-share and perimeter thresholds'
}
```

Sort by descending `sealShare`, then `inputIndex`. Keep at most 79 candidates plus `$wait`, and report visible/hidden counts. The legacy strategy therefore selects the original strict-greater-than winner. Store the selected small ID or `null` in `_pocketSid`.

- [ ] **Step 4: Write island-selection tests**

Cover disabled transports, boat cap, no own shore, empty players, FFA strength exclusion, missing centers, stable distance ties, border preparation, missing shore pairs, failed/timeout probes, stopping after two reachable players, alternate selection, and border-preparation exception identity.

```js
const result = await planner.select(actor, 'island', hooks);
assert.equal(result.target, nearestReachable);
assert.deepEqual(probes, [nearestTile, secondTile]);
assert.equal(choices[0].candidates.filter(c => c.kind === 'attack-geography').length, 2);
```

- [ ] **Step 5: Implement island search**

Preserve the original gates and stable distance sort. Scan until two reachable players are collected or inputs are exhausted. Each reachable candidate contains `targetId`, `inputIndex`, `distance`, `priority`, and a primitive reason. Use `hooks.probe(destinationTile)` so ownership can be checked around the awaited operation.

- [ ] **Step 6: Add stop, error, and stale tests**

Test `$wait`, invalid selection, a throwing policy hook, stale ownership before scanning, ownership loss during border preparation/probing, terminal `attack-geography-result` records, and no selection from late async results. Verify exceptions from original border preparation retain identity.

- [ ] **Step 7: Register the domain and verify Task 1**

Add `attack-geography` to the legacy strategy's ordered domains and advance its version to `1.84.0-plans.15`.

Run: `node --test tests/brain-attack-geography.test.js`

Expected: all planner tests pass.

---

### Task 2: Runtime, attack-plan ancestry, and generated adapters

**Files:**
- Modify: `src/brain/runtime.js`
- Modify: `src/brain/attack-planner.js`
- Modify: `src/brain/bootstrap.js`
- Modify: `scripts/build.js`
- Modify: `tests/brain-runtime.test.js`
- Modify: `tests/brain-attack.test.js`
- Modify: `tests/brain-build.test.js`

**Interfaces:**
- Consumes: `deps.attackGeographyPlanner.select(actor, mode, hooks)`.
- Produces: `runtime.selectAttackGeography(actor, mode)` and `attackHooks(actor).geography(mode)`.

- [ ] **Step 1: Write failing runtime and ancestry tests**

Test that a selected pocket or island decision has the current attack-purpose decision as `parentDecisionId`, and that the resulting attack command has the geography decision as its parent. Test wait/error propagation stops the attack pass and the next pass starts clean.

```js
assert.equal(geography.snapshot.parentDecisionId, purpose.decisionId);
assert.equal(command.candidates[0].parentDecisionId, geography.decisionId);
```

- [ ] **Step 2: Add runtime geography hooks**

Create hooks using the existing snapshot and attack scope:

```js
function attackGeographyHooks(actor) {
  const controller = owners.get(actor);
  return {
    allowed: () => deps.enabled() && deps.isCurrent(controller.bot) &&
      !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped,
    choose: (domain, candidates, facts) => controller.engine.decide({
      ...safe(() => snapshot(controller), { unavailable: true }), domain,
      attackGeography: facts,
      ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
    }, candidates),
    probe: tile => deps.probeLanding(actor, tile, false),
    record: (kind, details) => controller.engine.record(kind, details)
  };
}
```

`selectAttackGeography` awaits the planner, marks the current attack scope stopped when `result.stop` is true, records `attack-stop`, and returns only `result.target` for compatibility with original helper callers.

- [ ] **Step 3: Integrate geography choices into attack purposes**

Add `geography(mode)` to `attackHooks`. In `attack-planner.js`, replace the direct helper calls with:

```js
const choice = await hooks.geography('pocket');
if (choice.stop) return WAIT;
return choice.target && hooks.allowed()
  ? hooks.execute(choice.decisionId, () => actor.sendAttack(choice.target, true))
  : false;
```

Use the same flow for `island` without the forced-attack flag. This creates the required purpose-to-geography-to-command ancestry without retaining an async global parent.

- [ ] **Step 4: Wire bootstrap and builder**

Instantiate the planner in `bootstrap.js` with the live settings, `UNIT.TransportShip`, and `GameMode.FFA`. Add the module to the builder list. Replace the two original methods with adapters:

```js
async findSealablePocket(){return ofhBrainRuntime.selectAttackGeography(this,"pocket")}
async findNearestIslandEnemy(){return ofhBrainRuntime.selectAttackGeography(this,"island")}
```

Advance the userscript version to `1.84.16`.

- [ ] **Step 5: Verify Task 2**

Run:

```powershell
node --test tests/brain-attack-geography.test.js tests/brain-attack.test.js tests/brain-runtime.test.js tests/brain-build.test.js
```

Expected: focused planner, ancestry, generated-adapter, version, and gateway-count tests pass.

---

### Task 3: Original/generated parity, documentation, and final artifact

**Files:**
- Modify: `tests/brain-parity.test.js`
- Modify: `README.md`
- Generate: `openfront-helper.user.js`

**Interfaces:**
- Validates the real original and generated helper methods and attack-plan integration.
- Documents the new `attack-geography` domain and updates remaining work.

- [ ] **Step 1: Add focused original/generated parity fixtures**

Compare target identity, `_pocketTick`, `_pocketSid`, border-call order, probe destinations, and thrown behavior for:

- pocket winner, tie, cache hit, no candidate, rejected shore/map-edge/foreign perimeter, ignored per-player exception, and tick-read failure;
- island nearest reachable, first unreachable, two reachable, stable distance tie, disabled transport, boat cap, no shore, FFA strength filter, no shore pair, empty result, and border-preparation throw;
- selected pocket/island purpose continuing to the exact original `sendAttack` flags and later-purpose fallback when no target exists.

- [ ] **Step 2: Run only geography parity tests and correct demonstrated mismatches**

Run:

```powershell
node --test --test-name-pattern "pocket geography|island geography|geography attack purpose" tests/brain-parity.test.js
```

Expected: original and generated traces are identical. Change production behavior only for a demonstrated mismatch or a written-spec violation.

- [ ] **Step 3: Update README**

Document `attack-geography`, `attack-geography-result`, the ancestry chain, lazy execution, cache/probe semantics, and policy-stop behavior. Remove pocket and nearest-island-enemy searches from remaining work; leave random-boat and other naval geography internals listed.

- [ ] **Step 4: Run one final verification pass and generate the installable file**

Run:

```powershell
node --test tests/*.test.js
node scripts/build.js
node --check openfront-helper.user.js
node scripts/build.js --check
```

Expected: zero failed tests; 17 event gateways, 9 build gateways, and 3 alliance callbacks; syntax exit 0; deterministic build check reports that the standalone userscript matches source modules.

- [ ] **Step 5: Request one independent review**

Review current files against `docs/superpowers/specs/2026-09-22-attack-geography-design.md`. Fix every Critical or Important issue, regenerate the userscript if sources change, and repeat the final verification once. Report that live browser gameplay remains untested.
