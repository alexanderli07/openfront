# Structure Placement and First-SAM Reserve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put all ordinary structure tile choices behind the central decision engine, prefer owned/allied factory lines after the first owned SAM, extend useful rail routes with new factories, and save enough gold to construct the first SAM when it is due.

**Architecture:** A new pure `structure-placement` planner prepares primitive tile facts, asks the selected strategy to choose a tile, probes buildability, and reports outcomes. `adaptive-v1` adds first-SAM reserve behavior in `structure-plan` and phase-aware tile ranking in `structure-placement`; `legacy-v1` retains original score ordering. Runtime adapters preserve decision ancestry and the builder replaces only the original `structureSpawnTile` body.

**Tech Stack:** JavaScript, Node.js built-in test runner, PowerShell, userscript source generation.

## Global Constraints

- Preserve construction quotes, command arguments, upgrades, cooldowns, feature gates, and normal no-site returns.
- Count both owned and allied factories as valid factory-line anchors.
- Spread and safety remain primary before the first owned SAM.
- Factory-line grouping dominates spacing after the first owned SAM.
- Ordinary no-site exhaustion returns `null`; it does not throw.
- Candidate decisions contain at most 79 tiles plus `$wait` and retain primitive data only.
- Advance the userscript to `1.84.18` and adaptive policy to `1.1.0-placement`.
- This directory is not a Git repository, so task checkpoints use tests instead of commits.

---

### Task 1: First-SAM reserve policy

**Files:**
- Modify: `src/brain/structure-planner.js`
- Modify: `src/brain/adaptive-strategy.js`
- Modify: `src/brain/bootstrap.js`
- Modify: `tests/brain-structure.test.js`
- Modify: `tests/brain-adaptive-strategy.test.js`
- Modify: `tests/fixtures/strategy-scenarios.json`

**Interfaces:**
- `createStructurePlanner({ ..., spendableGold(actor) })`
- SAM candidates add `ownedLevels`, `targetLevels`, `perceivedCost`, `availableGold`, `affordable`, and `firstSamReserve`.
- Adaptive `structure-plan` chooses the eligible first-SAM candidate when affordable and `$wait` otherwise.

- [ ] **Step 1: Write failing reserve tests**

Add tests proving an unaffordable first SAM produces `$wait` and no build attempt, an affordable first SAM is attempted before port/factory, and owning one SAM restores delegated ordering. Add a fixed scenario whose expected adaptive choice differs from legacy.

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```powershell
node --test tests/brain-structure.test.js tests/brain-adaptive-strategy.test.js
```

Expected: failures because reserve facts and adaptive branching do not exist.

- [ ] **Step 3: Add replayable reserve facts**

In `structure-planner.js`, compute the normal SAM target and spendable gold once per candidate refresh. Mark only the eligible normal SAM plan as `firstSamReserve` when owned SAM levels are zero and the target is positive. Use string-safe integer comparison in the adaptive strategy:

```js
const reserve = candidates.find(candidate => candidate.kind === 'structure-plan' &&
  candidate.unitType === 'SAMLauncher' && candidate.firstSamReserve && candidate.eligible);
if (reserve) {
  return reserve.affordable
    ? select(reserve, candidates, 'Fund the first owned SAM before other structures')
    : select(candidates.find(candidate => candidate.id === '$wait'), candidates,
        'Save spendable gold for the first owned SAM');
}
```

Pass `spendableGold` from bootstrap using the same `mirvReserveHold` calculation as `maybeSpawnStructure`.

- [ ] **Step 4: Verify reserve tests green**

Run the focused command from Step 2. Expected: all focused tests pass.

---

### Task 2: Central structure-placement planner

**Files:**
- Create: `src/brain/structure-placement-planner.js`
- Create: `tests/brain-structure-placement.test.js`
- Modify: `src/brain/runtime.js`
- Modify: `src/brain/bootstrap.js`
- Modify: `scripts/build.js`
- Modify: `tests/brain-build.test.js`

**Interfaces:**
- `createStructurePlacementPlanner(deps).run(actor, unitType, hooks) -> Promise<buildable|null>`
- Runtime adapter: `planStructurePlacement(actor, unitType)`.
- Hooks: `allowed()`, `choose(candidates, facts)`, `record(kind, details)`, `remember(buildable, decisionId)`.
- Candidate kind/domain: `structure-placement`.

- [ ] **Step 1: Write failing planner and integration tests**

Cover original-score ordering, bounded candidate windows, duplicate removal, selected-tile buildability probing, unbuildable continuation, wait, stale ownership, no-site results, and `structure-plan -> structure-placement -> command` ancestry. Assert the generated source contains the planner and this replacement:

```js
async structureSpawnTile(e){return ofhBrainRuntime.planStructurePlacement(this,e)}
```

- [ ] **Step 2: Run focused tests and verify red**

```powershell
node --test tests/brain-structure-placement.test.js tests/brain-runtime.test.js tests/brain-build.test.js
```

Expected: missing planner/runtime adapter failures.

- [ ] **Step 3: Implement candidate collection and probing**

Collect the original random/coastal, deep, and SAM-near tile sources through injected helpers, deduplicate by tile, compute the original scorer once, and emit primitive candidates. Refill 79-candidate windows after failed probes. Record `structure-placement-result` statuses `selected`, `unbuildable`, `wait`, `stopped`, `no-buildable-tile`, and `threw`.

Store the successful buildable object's placement decision in a runtime `WeakMap`. In `build()`, temporarily use that decision as the command parent and consume it once, preserving the original quote object and return value.

- [ ] **Step 4: Wire the builder and bootstrap**

Add `structure-placement-planner.js` after `structure-planner.js` in the module list, instantiate it with `UNIT`, settings, `randTerritoryTileArray`, and `MAX_SPAWN_PROBES`, and replace the baseline `structureSpawnTile` method range with the runtime adapter.

- [ ] **Step 5: Verify central placement tests green**

Run the focused command from Step 2. Expected: all focused tests pass and generated source parses.

---

### Task 3: Adaptive factory-line and protection scoring

**Files:**
- Modify: `src/brain/structure-placement-planner.js`
- Modify: `src/brain/adaptive-strategy.js`
- Modify: `tests/brain-structure-placement.test.js`
- Modify: `tests/brain-adaptive-strategy.test.js`
- Modify: `tests/fixtures/strategy-scenarios.json`

**Interfaces:**
- Placement candidates expose `originalScore`, `safeScore`, `ownedFactoryRoutes`, `alliedFactoryRoutes`, `routeClusters`, `futureRouteCapacity`, `ownSamCoverage`, `alliedSamCoverage`, `hasOwnSam`, and `adaptiveOnly`.
- `adaptive-v1` ranks these facts synchronously and returns a supplied candidate ID.

- [ ] **Step 1: Write failing gameplay tests**

Add tests proving:

```text
pre-SAM: greater originalScore wins even when another tile has a factory route
post-SAM: a factory-route tile beats a higher spread score
post-SAM: allied and owned factory routes both qualify
route tie: own SAM coverage beats allied coverage
factory tie: more distinct rail clusters wins, then futureRouteCapacity
no route: highest originalScore remains usable
```

- [ ] **Step 2: Run placement/adaptive tests and verify red**

```powershell
node --test tests/brain-structure-placement.test.js tests/brain-adaptive-strategy.test.js
```

Expected: adaptive choices still match legacy and route facts are absent.

- [ ] **Step 3: Add deterministic route candidates and facts**

Sample owned land around completed owned/allied factories at the configured train minimum, midpoint, and maximum radii using fixed directions. Port samples must be shore tiles. Compute direct factory connections, distinct reachable-station clusters, deterministic future owned-tile capacity, and own/allied SAM coverage without retaining units or players in candidates.

- [ ] **Step 4: Implement adaptive lexicographic ranking**

For City, Port, and Factory:

```text
before first SAM: originalScore, any factory route, stable priority
after first SAM: any factory route, own SAM coverage, allied SAM coverage,
                 Factory-only routeClusters and futureRouteCapacity,
                 originalScore, stable priority
```

For SAM and MissileSilo, select the original-score winner. Include concrete evaluations explaining each compared fact.

- [ ] **Step 5: Verify gameplay tests green**

Run the focused command from Step 2. Expected: all gameplay cases pass.

---

### Task 4: Documentation, versions, and final artifact

**Files:**
- Modify: `src/brain/legacy-strategy.js`
- Modify: `src/brain/adaptive-strategy.js`
- Modify: `scripts/build.js`
- Modify: `README.md`
- Regenerate: `openfront-helper.user.js`

**Interfaces:**
- Legacy ordered domains include `structure-placement`.
- Adaptive version is `1.1.0-placement`.
- Userscript version is `1.84.18`.

- [ ] **Step 1: Update versions and documentation**

Document the reserve trigger, pre/post-SAM placement order, owned/allied factory routes, factory extension facts, placement outcomes, and ancestry. Update build assertions to `1.84.18`.

- [ ] **Step 2: Run focused comparison reports**

```powershell
node scripts/compare-strategies.js
```

Update the comparison harness so intentional scenario differences are reported as expected outcomes rather than unconditional parity failures.

- [ ] **Step 3: Run full verification and regenerate**

```powershell
node --test tests/*.test.js
node scripts/build.js
node --check openfront-helper.user.js
node scripts/build.js --check
```

Expected: zero failed tests, successful build, valid syntax, and deterministic generated output.
