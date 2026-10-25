# Front-line donations

Requested change: lower recipient need cutoff from 80% to 65% (strictly below),
and restrict adaptive donations to teammates fighting or bordering an enemy.
Keep own reserve, opening, defense, minimum chunk and throttle rules unchanged.

Implement in adaptive-v1's donation-target decision. Keep legacy-v1 as a
comparison baseline; planner supplies border-enemy measurement in candidate
facts without changing baseline ordering. Border checks use the recipient's
friendliness and actual shared border, not the donor's geography. Missing
border metadata does not qualify a peaceful recipient. Respect lower user
cutoffs; cap old saved 80% values at 65%. Reflect effective cutoff in settings UI.

- [x] Failing policy tests for threshold boundary, combat, border and rear allies.
- [x] Implement measurements/policy/default/UI and intentional comparison cases.
- [x] Integration tests, review and full verification; release 1.84.42.

Use an explicit skipDonation candidate when nobody qualifies, preserving the
ability to continue the attack pass. Deliberate policy waits/errors still stop
the pass. In bounded pools, preserve the legacy winner then expose qualified
front-line recipients before rear recipients; reserve a slot for skipDonation.
Regression coverage includes a border ally behind 99 rear allies and checks that
ordinary skips do not trigger hold. Full suite currently passes 1,613 tests.
Live gameplay remains unverified.

Independent review found no actionable issues and passed all 19 focused tests.
Comparison: nine scenarios, four intentional differences (two existing placement
changes and two donation changes), zero unexpected outcomes. Syntax and generated
freshness checks passed.
