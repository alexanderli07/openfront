# Nuclear player search implementation

1. Add generated-class tests in brain-parity.test.js for remaining player-search
   domains; watch custom-policy alternatives/holds fail, retain existing parity.
2. Replace only local player branches in strike-target-planner.js with bounded
   lazy search helpers and explicit parents. Register legacy domain ordering.
3. Test alternative ally/request/hostile, single-choice holds, exact predicates,
   lazy queries, >79 entries, empty fallthrough, ancestry/replay and next-call reset.
   Independent review; correct findings with regression tests.
4. Bump version/docs/audit; build, full tests, comparison, syntax and freshness.

Completed in 1.84.30 (legacy 1.84.0-plans.27). All 46 focused cases and
1,102 full-suite tests pass. Independent review found no actionable issues.
Seven strategy comparison scenarios have two intentional differences and zero
unexpected outcomes. Generated JavaScript syntax and build freshness pass.
An explicit null selection is a valid wait, so the fault tests distinguish it
from thrown policies and invalid candidate IDs. No live match was run.
