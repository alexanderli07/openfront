# Decision engine implementation plan

1. Test and implement a pure engine with `register(strategy)`, `select(id)`, `decide(snapshot, candidates)`, `submit(snapshot, proposal, executor)`, `record(kind, details)`, `exportTrace()`, and side-effect-free `replay(strategyId, trace)`.
2. Test and implement the legacy policy: select the command already proposed by the original behavior; explicitly record waiting as an alternative. Preserve submitted command arguments, sync return values, exceptions, and promise identity. Bound and freeze recording data.
3. Implement runtime snapshot/proposal adapters and selective rule instrumentation. Trace evaluated functions, no-action passes, submissions, and later state snapshots. Expose one-click JSON export and recent human-readable decisions in the existing Log tab.
4. Replace only exact Auto-Bot sink call sites and attach a per-bot engine. Keep original decision math and scheduling unchanged. Pin the vendor hash; reject unexpected source layouts. Build the same standalone filename.
5. Run baseline parity fixtures against original and rebuilt classes, sink coverage and syntax checks, and independent review. Document limits and how to add/test a new policy.
