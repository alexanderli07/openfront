# Building Decisions Implementation Plan

**Goal:** Centralize structure phases, upgrade versus build, upgrade target and defense-post tile choices without changing the baseline policy.

**Architecture:** A focused building planner provides primitive candidates to the existing engine. Runtime adapters preserve nesting and quote ancestry. Builder replacements retain original gates and command executors.

**Tech stack:** JavaScript, Node test runner, generated userscript.

- [x] Write failing focused tests for phases, action selection, upgrade target and defense placement, including wait and cancellation.
- [x] Implement `src/brain/building-planner.js` with injected game constants and original ranking rules.
- [x] Wire runtime/bootstrap and builder adapters; preserve original command bodies as ready executors.
- [x] Add integration and generated wiring tests, verify focused tests.
- [x] Update README/version, rebuild, run full tests, scenario comparison, syntax and artifact checks.

Work inline under existing user authorization; no Git checkpoints are available. Continue other gameplay domains in separate increments.
