# Attack allocation implementation

1. [x] Add generated-class tests in `tests/brain-parity.test.js` for land reserve,
   amount, bot amount and forced amount selection/holds; observe failure.
2. [x] Add `src/brain/attack-allocation-planner.js`, runtime hooks, bootstrap dependency
   and legacy domain ranking. Builder extracts unchanged reserve facts/ready tails
   from baseline and replaces the three public methods. Test baseline matrices
   and rollback on policy holds versus failed emitters.
3. [x] Update version, README and audit progress; independent review. Build, full
   tests, strategy comparisons, syntax and final generated freshness checks.

No Git checkout is present; edits and review use workspace files.

Completed as 1.84.26 / legacy plans.23. All 935 tests pass; seven strategy
comparison scenarios show two expected placement differences and zero unexpected
outcomes. Syntax and generated freshness checks pass. Independent review caught
an alternate final bot amount below the viability floor; fixed and regression
tested. Direct wave hold propagation and next-wave reset also regression tested.
No live match validation performed.
