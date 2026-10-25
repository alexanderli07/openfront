# Warship details implementation plan

Goal: expose placement and unit choices through the existing engine.
Architecture: a details planner supplies spawn/movement decisions; deployment
adds bounded port/enemy-unit choices. Runtime scopes only synchronous execution.
Tech stack: dependency-free JavaScript, Node test runner, generated userscript.

- [x] Write failing planner and runtime tests for alternative unit/site selection,
  original RNG, wait, patrol cancellation and command ancestry.
- [x] Add details planner, runtime adapters, deployment decisions and generated
  method adapters; keep command-ready movement body intact.
- [x] Compare original/generated movement and spawn behavior including filters,
  ties, missing constructors, emit rejection, coordinate limits and cooldowns.
- [x] Review independently; resolve actionable findings.
- [x] Bump to 1.84.22/plans.19, document remaining scope, regenerate and run
  `node --test tests/*.test.js`, comparison, syntax and build --check.

No Git checkout exists, so no commits or worktrees are needed. Existing user
authorization covers the design and inline implementation.

Validation: 737 tests passed; 7 comparison scenarios, 2 intentional differences, 0 unexpected outcomes; userscript syntax and generated-artifact check passed. Independent read-only review found no actionable issues.
