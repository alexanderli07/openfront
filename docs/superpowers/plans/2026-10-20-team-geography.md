# Two-team geography implementation plan

Goal: group/coastal spawning, rear economic placement, island naval defense.
Architecture: measured geography service; existing planners supply candidates;
adaptive central policy ranks choices, with existing trace/dispatch boundaries.
Environment: standalone JavaScript, Node tests, non-Git local workspace.

- [x] Spawn: red scoring/geometry tests; geography facts and bounded candidate
  source; central selection and native integration/companion/bounds regressions.
- [x] Placement: red front-ranking/window tests; enemy-front measurement and
  owned interior/coastal samples; preserve grouping within rear safety bands.
- [x] Naval: red topology/interception/fleet-budget tests; bounded topology,
  defensive deployment, refreshed turn ordering, transport targeting and patrol.
- [x] Integration: strategy scenarios, runtime tests, independent code review,
  fixes, docs, version, full suite, syntax/audit and final generated freshness.

Review: fixed unrelated-enclave island false positive; own defensive ports must
belong to the measured land region. Regression suite and scenario comparison
passed. Gameplay remains unmeasured until a real match.
