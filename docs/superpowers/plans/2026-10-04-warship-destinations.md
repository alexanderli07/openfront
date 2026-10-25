# Warship destination implementation plan

Goal: centralize combat target and escape destination choices without new weights.
Architecture: combat planner generates ranked target and waypoint candidates;
runtime scopes the selected destination as command parent. Builder replaces only
the existing waypoint selector. Dependency-free JavaScript and Node tests.

- [x] Add failing alternative/hold tests for combat targets and waypoint choices.
- [x] Implement ranked target/home decisions and bounded BFS waypoint decisions.
- [x] Wire runtime/builder, test actual baseline parity and parent/replay behavior.
- [x] Independent review and fixes.
- [x] Update to 1.84.23/plans.20, document remaining scope, regenerate and verify
  full tests, comparison, syntax and build --check.

Execute inline under continuing user authorization. This directory has no Git
checkout; no branch, commit or worktree steps apply.

Verification: 771 tests passed; 7 comparison scenarios with 2 intentional differences and 0 unexpected outcomes; syntax and generated-artifact checks passed. Independent review confirmed metadata and command-decline fixes, with no remaining actionable findings.
