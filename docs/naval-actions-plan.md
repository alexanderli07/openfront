# Naval action selection design and plan

Migrate the opportunity-selection tail of maybeOpportunisticBoat into a naval-action decision domain. Preserve its existing early feature/transport-disabled/concurrent-cap/throttle/shore gates and initial timestamp/fill/surplus snapshots. Do not rewrite attackWithRandomBoat's separate tactical invocation or random/nearby geography search internals.

Seven lazy plans: reinforce an existing landing (surge), disconnected-player grab, nearby island/weak coast, MIRV crater, random unowned/Bot target, random enemy target, distant target. Default ordinal priority is exactly the original sequence. Only a selected plan probes or consumes RNG. Refresh in-flight boat-target positions once, before the first nonsurge plan; the original surge is before that refresh.

Surge uses original beachhead age/surged/fill/landing-success/reachability guards and troop fraction. A failed surge launch falls through. After any other plan finds a target, insufficient fill or failed emit ends the pass; don't reclassify it as target-search failure and continue. Preserve original flags affecting fill and labels: disconnected/distant mark owned+island; nearby uses its owned/fallout flags; crater and random use surplus fill. Set lastOppBoatMs and beachhead only on successful dispatch, using original initial timestamp and current tick for a new beachhead. Keep tile zero valid.

Runtime creates a scoped naval pass and restoring plan links. A naval-action wait/error stops this pass. A deliberate wait/error in a nested distant/disconnected landing decision stops the enclosing naval pass; an exhausted/no-target lookup continues normal fallback. Standalone landing lookups retain lookup-only stop semantics. All awaited search/probe results are checked against enabled/current owner and cancellation before dispatch or state mutation. Scope is cleared/restored in finally.

Trace naval-action decisions include fill/surplus/shore count and priority/readiness; naval-action-result distinguishes no target, held on fill, launch result, wait and exception. Nested landing decision -> probe and action -> command retain parent IDs. Values describe actual rules, not invented tactical scores. Original send/boat limits/opening checks stay in emitBoat.

Implementation:
1. Tests for all fallback branches, selected-only execution, surge bookkeeping, fill stop, dispatch-failure asymmetry, tile zero, nested wait/error, stale async results and parent restoration.
2. Implement src/brain/naval-action-planner.js, runtime planNavalActions and scoped cancellation, legacy domain and bootstrap.
3. Replace only the original opportunistic selection tail after early gates. Build1.84.6.
4. Original-vs-rebuilt VM parity across branches, RNG order, probe calls, amounts, labels and state. Review and full regression/build/syntax checks.

User authorized this next migration. No economic/combat tuning or live-play performance claims.
