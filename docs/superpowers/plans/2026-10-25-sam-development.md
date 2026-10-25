# SAM development implementation plan

User approved development, coverage and salvo based protection, preferring upgrades to additional launchers. The observed level-two SAM in the uploaded match was manually upgraded by the user.

Design: retain the opening. Once the developed economy reaches its reserve stage, aim for level two, then increase the target when owned economic structures gain useful protection at a higher level, or recent relevant incoming salvos exceed capacity. Prefer the existing launcher that gains the most useful protection. Search coverage through level eight; remember peak relevant salvo size for 1,800 ticks, capped at eight slots. Never repeatedly buy levels beyond the computed need. Existing allied coverage counts for geometry, but does not invent guaranteed spare ammunition. Pause while upgrading or loading uncertain SAM state.

Planned upgrades preserve the fixed 3m emergency reserve and reserve up to a further 3m for the next upgrade, so optional economy cannot perpetually spend the upgrade savings. Check actual quotes immediately before dispatch. Emergency upgrades retain their existing proof and may use the emergency reserve. No additional SAM construction is introduced by this increment. Unreachable buildings are recorded rather than triggering endless upgrades.

- [x] Regression: a triple strike must never be independently counted as already covered by one slot. Keep uncertain multi-strike emergency purchases conservative.
- [x] Pure planning model and tests for mature economy, coverage gain, allied coverage, salvo memory, bounded targets and ramp/unknown-state holds.
- [x] Observer supplies owned economic structure locations and owned SAM identities.
- [x] Central runtime combines emergency and planned candidates, gives emergency first priority, enforces quote/permission/ledger guards and reserves planned savings across purchase sources.
- [x] Test runtime saving, dispatch, manual upgrades, concurrency, reserve preservation and unchanged opening; update trace summaries/docs/version.
- [x] Build, full test suite, strategy comparison, syntax, gateway audit, freshness check. Live gameplay remains unverified.

Completed in 1.84.57 (adaptive policy 1.8.0-sam-development). Independent focused review reported no actionable findings. Full suite: 1,807 passing tests; 33 strategy scenarios, zero unexpected outcomes. Live matches remain unverified.
