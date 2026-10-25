# Bot-target planning implementation plan

Goal: central comparison and traceable selection of hostile bot targets, retaining baseline strategy.

1. Add failing tests for bot-target order, pure candidates, alternate selection, wait, original attack count/bookkeeping, windowing and stale-state checks.
2. Implement src/brain/bot-target-planner.js and legacy policy domain; wire runtime with current-state snapshots and parent command linkage.
3. Replace only attackBots in the pinned original through scripts/build.js. Include planner/bootstrap; version 1.84.3.
4. Add real original-vs-rebuilt class parity cases, then review new code and fix concrete findings.
5. Update README with completed scope and remaining attack paths. Run all tests, build, syntax and reproducibility checks.

Plain JavaScript and Node built-ins; no package dependencies or economic tuning. User authorized the next incremental migration; proceed within that scope.
