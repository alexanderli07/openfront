# Diplomacy details implementation plan

Goal: expose donation and outreach choices while preserving default behavior.
Architecture: a details planner owns target and amount proposals; synchronous
runtime hooks preserve parents and cancellation; builder keeps original gates
and command-ready dispatch bodies. JavaScript with Node tests.

- [x] Write failing planner tests for recipients, amounts, outreach order and holds.
- [x] Implement planner and runtime/build/bootstrap integration.
- [x] Verify generated/vendor parity, holds/errors, bounds and trace ancestry.
- [x] Independent review and fixes.
- [x] Update 1.84.25/plans.22, regenerate and run full suite/comparison/syntax/check.

Continue inline under user authorization. No Git checkout exists.

Verification: 897 tests passed; 7 comparison scenarios with 2 intentional differences and 0 unexpected outcomes; syntax and generated-artifact checks passed. Independent review found no actionable issues.
