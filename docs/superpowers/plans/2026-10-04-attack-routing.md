# Attack routing implementation

1. [x] Add generated-class tests in `tests/brain-parity.test.js`, watch route and
   targeted-boat policy tests fail while checking baseline scenarios.
2. [x] Add `src/brain/attack-routing-planner.js`, scoped synchronous runtime hooks,
   bootstrap dependency and legacy domains. Builder retains attack gates and
   original boat ready tail, replacing local routing/destination/allocation.
   Include nearby free-land site probing/allocation using the same runtime hooks.
3. [x] Verify guards, return values, bot budget, no retries, ancestry, concurrent
   probes and bounds. Independent review; resolve findings with regressions.
4. [x] Update version/docs/audit progress; build and run full suite, comparisons,
   syntax and generated freshness checks. Non-Git workspace; no commits.

Independent review found no introduced defects. It noted existing enclosing
sequence helpers still hold their context across awaits; the new routing/boat
hooks restore their own context synchronously. Standalone overlapping boat
calls, plus nested wave stop/reset, are tested; global async scope isolation
outside these new hooks is not claimed.

Completed as **1.84.27 / legacy plans.24**. Full suite: 983 passing tests.
Seven strategy scenarios: two intentional placement differences, zero unexpected
outcomes. Syntax and generated freshness checks pass. No live match validation.
