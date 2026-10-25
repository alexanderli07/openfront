# Maintenance implementation

1. Add failing generated tick tests for phase policy holds and alternate order.
2. Implement pure synchronous maintenance planner; runtime scope/parent wrapper;
   checked builder replacement of only the original try-block's phase body.
3. Verify baseline gates, lazy settings, exceptions, independent ordinary tick,
   parenting/restoration and replay; obtain independent review.
4. Version/docs/build, full tests/comparison/syntax/freshness.

Completed in 1.84.34 (legacy 1.84.0-plans.31). Initial hold/reorder tests failed
against the original early block before implementation. All 32 focused tests and
1,291 full-suite tests pass. Independent review found no actionable findings.
Seven comparison scenarios have two intentional differences and zero unexpected
outcomes. Generated syntax and build freshness pass. No live match was run.

Only phase ownership changed. Threat-source ranking, incoming-transport responses
and nested hold/handled-state propagation remain the next increment. The smart
block entry cache preserves callback-driven settings changes, and early phase
holds leave ordinary cadence available.
