# Final Social and Events Implementation Plan

Goal: Finish audited social/event decision ownership, then audit and verify.
Architecture: Extend social planner and scoped runtime transactions; add alliance
event planner with checked generated callback helpers and explicit parent IDs.
JavaScript, Node tests, standalone builder. Non-Git workspace, no commits.

- [x] Failing social message/cooldown/winner tests, then minimal implementation.
- [x] Social parity, normal failures versus holds, scope/ancestry and token checks.
- [x] Failing alliance event target/response tests; planner/runtime integration.
- [x] Event parity, timestamp/button/exception semantics, holds and bookkeeping.
- [x] Independent review; fix findings and audit eight behavior classes.
- [x] Version/docs/build, full suite/comparison/syntax/freshness.
- [ ] Locate a genuine exported live trace and review it; if absent, request one.

Release: 1.84.39. Full suite: 1,587 passing tests. Comparison: seven scenarios,
two intentional differences, zero unexpected outcomes. No exported live trace
found in the workspace or Downloads; live review awaits the user's JSON export.
