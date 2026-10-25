# Social Recipient Implementation Plan

**Goal:** Centralize casual phases and recipient choices while preserving defaults.
**Architecture:** Social planner owns phase/recipient/small-attack decisions;
runtime owns synchronous scope and recipient action parents; checked builder
routes original methods through these boundaries. JavaScript and Node tests.
**Constraints:** No cooldown/message policy migration, original RNG timing,
bounded windows<=80, no live objects in candidates, no policy-error fallback.
Non-Git workspace: no commits/worktrees.

- [x] Generated phase and recipient hold tests fail before implementation.
- [x] Planner/runtime/bootstrap/legacy/builder integration passes hold tests.
- [x] Original parity, alternate policies, RNG, windows, failure/reset and
  ancestry checks; independent review and fixes.
- [x] Version/docs/build, full tests/comparison/syntax/freshness.

Completed as 1.84.38 (legacy 1.84.0-plans.35). All 1,489 tests pass,
including 48 new social checks. Review found the rat pool variable bypassing
the recipient rewrite; hold regression failed before fixing the checked anchor.
All four recipient paths now have hold tests, and rat has an alternate-policy
check. Re-review found no further actionable issues. Comparison has seven
scenarios, two intentional placement differences and zero unexpected outcomes.
Syntax and generated freshness pass. No live match was run.
Message/cooldown/winner-response decisions and event-response bookkeeping remain.
