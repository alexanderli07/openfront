# Two-team opening implementation plan

Goal: wilderness-first attacks and income-before-SAM construction for safe spawns.
Architecture: a measured two-team-opening facts module, adaptive policy decisions
in existing attack/build domains plus a traced individual-route opening gate.
Standalone JavaScript builder, Node tests; non-Git workspace, no commits.

- [x] Failing facts/policy tests: team detection, wilderness, threat transitions,
  economy targets, first SAM and disabled/coastal cases.
- [x] Add facts module and runtime/bootstrap integration; preserve legacy behavior.
- [x] Add attack sequencing/country-veto gating and no-fallthrough regressions.
- [x] Add opening structure candidates and scoped forced-new actions; test holds,
  affordability, disabled settings, constructed buildings and transitions.
- [x] Add scenario comparisons, independent review, documentation and release
  verification (suite, comparison, syntax, generated freshness).

Later increments: group/coastal spawning, rear-safe placement, naval interception.
