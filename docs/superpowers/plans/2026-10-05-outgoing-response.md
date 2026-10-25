# Outgoing Response Implementation Plan

**Goal:** Central decisions own transport loss/trade capture removal and tracking phases.
**Architecture:** Extend the ship response planner with outgoing target/response
and tracking-phase domains. Runtime owns synchronous scopes; per-request tokens
handle late declines. Checked builder replaces original loop methods.
**Tech Stack:** JavaScript, Node test runner, standalone userscript builder.
**Constraints:** Preserve lazy predicates/order, no async parent scope, max80
candidates, no fallback on policy failures. Non-Git workspace; no commits.

- [x] Add failing generated hold/removal tests and confirm failures.
- [x] Implement planner/runtime/bootstrap/builder/default domains; verify tests.
- [x] Add baseline parity, failure/decline, race, ancestry and window checks;
  request independent review and resolve defects.
- [x] Version/docs/build, full tests, comparison, syntax, freshness.

Completed as 1.84.37 (legacy 1.84.0-plans.34). All 1,441 tests pass,
including 63 new checks. Independent review found a missing production tradeType
dependency; a bootstrap-driven regression failed before the fix and passed
afterward. Re-review found no remaining actionable issue. Seven comparison
scenarios retain two intentional placement differences and zero unexpected
outcomes; syntax and generated freshness pass. No live match was run.
Social message/recipient choices and event-response bookkeeping remain next.
