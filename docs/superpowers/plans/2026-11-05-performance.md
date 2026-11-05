# Script performance implementation plan

**Goal:** Reduce repeated work without changing central decisions, command guards,
missile projection accuracy, controls, or complete match-history exports.

**Architecture:** Cache stable observations by live game/player/tick; keep resources
and command checks fresh. Store history changes incrementally, cache immutable
native missile plans, and replace cosmetic polling with browser-driven styles.
Move the affected legacy integration into small readable build adapters.

**Tech stack:** Plain JavaScript userscript modules, Node test runner, IndexedDB.

## Constraints

- Do not edit the immutable vendor baseline.
- Do not delay critical defense or weaken dispatch-time validation.
- Preserve full history, reload continuity and existing export format.
- Bound caches, invalidate on game changes/rewinds, and retain immutable decisions.
- No dependencies or visible debug UI are needed; profiling is opt-in and bounded.

## Work

- [x] Shared observations: unit summaries once per game tick, fresh money/troops/
  attacks, invalidation at command boundaries; operation-count and integration tests.
- [x] Logging: skip redundant expensive telemetry processing without losing
  counters or important events; incremental history writes with legacy-load tests.
- [x] Missile paths: validate/cache versioned native plans, sample only the remaining
  segment, prune dead missiles and reset across games; deterministic work-count tests.
- [x] Background work: remove periodic theme rewrites, consolidate safe housekeeping,
  preserve controls and defense timing; fake-clock and DOM installation tests.
- [x] Readable modules: extract affected UI overlay/connection glue from the build
  script, centralize observation collection, and expose bounded optional timings.
- [x] Integrate, inspect diffs, run the full suite and strategy comparisons, and
  document measured synthetic work reductions separately from live performance.

## Verification

Use counters rather than machine-dependent timing thresholds to establish work
reduction. Run focused tests for each subsystem before the full suite, reproducible
build check, JavaScript syntax check and deterministic strategy scenarios. Live FPS
and CPU improvements require a real-game profile and must not be claimed here.
