# Warship safety implementation plan

Goal: centralize home-port and nuke-dodge choices without changing default play.
Architecture: a safety planner supplies home/threat/escape and dodge decisions;
runtime scopes preserve ancestry; generated adapters retain scanning and ready emit.
Tech stack: JavaScript and Node test runner, standalone userscript builder.

- [x] Failing tests for home and escape choices, waits and dodge bookkeeping.
- [x] Add safety planner, runtime, bootstrap and builder adapters.
- [x] Actual baseline parity, alternatives, errors, bounds and ancestry/replay.
- [x] Independent code review; fix actionable findings.
- [x] Document and regenerate 1.84.24/plans.21; full tests, comparison, syntax,
  generated-artifact verification.

Inline execution under ongoing authorization. No Git repository is present.

Verified: 829 tests passed; 7 comparison scenarios with 2 intentional differences and 0 unexpected outcomes. Userscript syntax and generated-artifact checks passed. Independent read-only review found no actionable issues.
