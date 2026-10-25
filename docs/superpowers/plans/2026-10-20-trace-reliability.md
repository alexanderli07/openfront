# Transport, warship targeting and trace reliability

Scope approved by the user's request to fix the issues identified in the supplied exports.

Design: reconcile transport reservations against new ships before expiring unacknowledged requests after 40 game ticks. Keep unresolved asynchronous submissions reserved until settlement. Preserve the two automatic slots and manual third slot. Filter trade targets by the ship's water component before ranking; retain the final movement check.

Tracing: production uses bounded recent detail plus a protected event history, exported together in sequence order. Protect commands, errors, building placement and their available decision ancestors. Sample repeated routine decisions/results and cost checks, retaining counters that distinguish suppressed repetition from evicted history. Keep complete decision inputs for replay. Default engine behavior remains available for fixtures.

- [x] Reproduce expired automatic/manual reservations, wrong-water targets and log flooding with failing tests.
- [x] Implement fixes and run focused regression tests.
- [x] Rebuild userscript, run full tests, strategy scenarios, syntax, decision audit and build freshness checks.
- [x] Document retention limits and deployment version; report runtime verification limits.

Implementation notes: restrict sampling to known no-op responses and instrumented rules; substantive decisions remain complete. Rule-result error fields bypass sampling and receive protection. Infrastructure milestones preserve actual building locations (up to 80), previous counts, upgrades, completions and losses without trade-ship churn. Review caught the rule-error case; regression added.

Validation: 1,687 tests; 20 strategy scenarios with zero unexpected outcomes. Feeding each of the user's latest 5,000-record exports into the retention logic suppressed 3,357 and 2,325 repetitive records respectively; an inserted early SAM-placement marker survived both floods. This is an offline retention check, not proof of live server acceptance. Install version 1.84.50 for the next match; previously overwritten logs cannot be recovered.
