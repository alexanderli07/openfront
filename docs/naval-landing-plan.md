# Naval landing selection design and implementation plan

Scope: migrate the reachability-probe loops in findDistantBoatTarget and findDisconnectedBoatTarget. Keep their original destination gathering/filtering, squared-distance sorting, getPlayerCenter and setting-derived cap. This is landing-site selection, not full naval strategy or warship control.

The original nearest-first bounded set becomes naval-landing candidates. Each selected destination checks boatTargetTaken immediately before probing. Taken destinations consume the original rank slot but not a probe call. False/unreachable and timeout advance to remaining destinations; the first reachable choice returns its tile, including tile zero. Only selected destinations query bestTransportShipSpawn. A wait/error stops this lookup with null; original outer naval fallbacks may still run, so this does not claim whole-pass naval cancellation.

Keep the distant timeout sentinel distinct from false so _distantDiag counters remain unchanged. Disconnected timeout uses false. Preserve the historical disconnected-player filter, including that it does not independently exclude friendly players. No new troop, feature or strategic weights. Every probe outcome records decisionId, tile, status and counts; reachability is not dispatch or server acceptance. Return no live game objects in candidates.

Window at most 79 destinations plus wait. Only original indices below probeCap are in the search pool, including taken entries, preserving fractional and large positive caps through index comparison. The full ranked set count and capped/window-hidden counts are separate metadata. Refill windows after failed/skipped choices. Default legacy selects minimum original priority. Alternative policies can choose another visible site or stop the lookup. Check enabled/current ownership before and after asynchronous probes; stale results return null. Keep original exceptions propagated.

Implementation:
1. Add tests for nearest-first fallback, taken-slot/cap semantics, timeout diagnostics, zero tile, no candidates, alternate policy/wait, stale ownership and >79 destinations.
2. Add src/brain/naval-landing-planner.js; runtime supplies central decisions, selected reachability probes and scoped trace parent. Bootstrap injects existing withTimeout/WORKER_TIMEOUT_MS and diagnostics.
3. Replace only the two probe-loop tails using pinned baseline anchors. Include module and version1.84.5.
4. Compare real original-vs-rebuilt methods for order, inputs, return values and diagnostic counts. Test existing random boat and attack paths through full regression suite.
5. Review, document exact coverage, build, syntax-check and verify deterministic output. No live gameplay claim.
