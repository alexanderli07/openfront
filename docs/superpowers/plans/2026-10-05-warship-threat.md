# Warship Threat Implementation Plan

**Goal:** Centralize the three patrol source rankings without changing defaults.
**Architecture:** A source planner supplies bounded ranked candidates; runtime
owns synchronous stop scope and source provenance; checked builder delegates
original methods and guards their enclosing patrol. JavaScript, Node tests.
**Constraints:** Original formulas/order, 79 plus wait windows, no fallback on
policy failure, no outgoing response migration, no live-match claims. Non-Git
workspace: no commits or worktrees.

- [x] Add generated hold tests, run to confirm failure.
- [x] Add `warship-threat-planner.js`, runtime source/pass methods, bootstrap,
  legacy domains and builder integration. Run source tests to confirm passing.
- [x] Compare original/generated invasion/loss/trade behavior; exercise alternate
  choices, windows, errors, nested holds and reset. Request independent review.
- [x] Update version/docs, build, full tests, comparison, syntax and freshness.

Completed as 1.84.36 (legacy 1.84.0-plans.33). All 1,378 tests pass,
including 42 new source cases. Review identified invasion throwing-tile winner
bookkeeping and extra loss-centroid validation; both received failing/passing
parity regressions and lazy alternative validation fixes. Re-review found no
further actionable issue. Seven comparison scenarios have two intentional
placement differences and zero unexpected outcomes. Syntax/freshness pass.
No live match was run. Outgoing response bookkeeping remains separate work.
