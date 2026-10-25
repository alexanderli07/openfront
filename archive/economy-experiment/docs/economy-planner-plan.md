# Economy planner implementation plan

**Goal:** ship an integrated, testable first replacement for economic choices and shared spending.
**Architecture:** pure policy in src/economy-planner.js; adapter in src/economy-adapter.js; scripts/build.js injects source into the immutable vendor baseline.
**Tech stack:** JavaScript, Node built-in test runner, existing browser userscript APIs.

1. Write scenario tests against `createEconomyPlanner()` (exported factory), its `IncomeTracker`, `BudgetLedger`, and `rankInvestments(snapshot, candidates)`. Run `node --test tests/economy-planner.test.js` to observe the missing implementation. Implement deterministic ranking, exact counter differences, unknown-data handling, and pending-action accounting. Repeat tests.
2. Write adapter tests using a minimal fake game and actual planner. Cover live quotes, new-versus-upgrade ranking, private-lobby gates, disabled settings, late asynchronous returns, and shared spending. Implement `createEconomyAdapter(deps)` with injected game/settings/action functions; prohibit action dispatch outside the broker. Run `node --test tests/*.test.js`.
3. Integrate the adapter into `StructureBehavior.handleStructures`, bot tick preparation, and every existing bot build dispatch. Add the strategy toggle and read-only recent decision export. Rebuild from the preserved baseline with exact-match assertions. Check syntax with `node --check openfront-helper.user.js`, run tests and an independent review, document live-test limits and a paired-match procedure.

No source-control commits: the supplied workspace is a plain folder. Keep the other two userscripts untouched. User approved execution in this session.
