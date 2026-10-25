# Structure planning implementation plan

Goal: make the central engine choose among structure plans with inspectable original priorities.

Architecture: a structure planner generates candidates and runs selected attempts through existing placement code; runtime supplies the central decision engine and records plan/command linkage. Plain JavaScript and Node tests; no external dependencies.

1. Write failing tests for candidate eligibility, original priorities, retry, wait, replacement policy and stopped/stale owner behavior.
2. Implement src/brain/structure-planner.js, legacy strategy batch ranking, and runtime plan selection/linkage. Retain existing command gateway.
3. Patch only doHandleStructures decision tail in the hash-pinned builder; keep original preparation/outer checks. Add module to standalone bootstrap.
4. Extend VM parity scenarios; run all test suites and review changed boundaries.
5. Update README and previous documentation to describe plan-level batching and correct the baseline lobby-predicate claim. Build version 1.84.2; verify syntax and reproducibility.

User authorized continuation of the next architectural step; no additional approval checkpoint is needed. This workspace has no Git repository.
