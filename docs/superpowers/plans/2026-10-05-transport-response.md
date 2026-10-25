# Transport response implementation

1. Add failing generated tests for transport target/response holds.
2. Implement response planner with exact lazy predicates and provisional tokens;
   runtime hooks/scope and per-request decline callback; checked builder method.
3. Test baseline parity, nested/async holds, failures versus declines, windows,
   defer/reorder, token races and ancestry. Independent review and fixes.
4. Version/docs/build; full tests/comparison/syntax/freshness.

Completed as 1.84.35 (legacy 1.84.0-plans.32). All 1,336 tests pass,
including 45 new incoming-response cases. Independent read-only review found
no actionable defect. Strategy comparison retains the two intentional placement
changes and zero unexpected differences; generated syntax and freshness pass.
Live-match behavior remains unverified. Invasion/loss/trade source ranking and
outgoing response bookkeeping are separate follow-up work.
