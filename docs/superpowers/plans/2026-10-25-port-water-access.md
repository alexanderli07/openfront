# Reject enclosed-water ports

User reported severe bad port placement on waterlocked areas. Source review found random coastal sampling filters water access, but factory-route and rear-placement candidate pools only require a shore. Their high scores can select an enclosed lake; worker relocations and final port upgrades also lack a common water guard.

Implement a shared port-water observer requiring a verified water connection to an ocean-labelled tile. Direct ocean water qualifies immediately; rivers can qualify through their water component using a bounded incremental flood. Shared component membership alone is not sufficient proof. Closed lakes and unresolved geometry fail closed. Cache component results; bound per-call/per-tick exploration and refresh negative results so newly opened waterways can qualify.

Apply to every placement pool before ranking, to the actual worker-quoted construction tile, and to final port build/upgrade dispatch. The opening observer counts only verified useful coasts, so a lake-only spawn selects its city/factory opening instead of saving forever for impossible ports. Preserve rail/rear/SAM scoring among valid sea-access sites; do not change manual game controls or attempt to remove existing ports.

Regression tests: ocean vs lake vs sea-connected river; unknown topology; incremental budgets/cache refresh; high-scoring rear/route lake candidates; quote relocation; final build and upgrade guard; lake-only economy mode. Build1.84.61, full tests/scenarios, syntax/gateway audit/freshness and independent review. Offline evidence does not prove a specific live match outcome without its trace.

Completed in1.84.61. Review cache-starvation finding fixed with a failing-then-passing4,001-node river plus65lake-components regression. Both opening observers exclude existing enclosed-water ports from physical useful-port counts. Full1,858tests pass;38strategy scenarios have zero unexpected outcomes; syntax, gateway audit and generated freshness pass. Live placement remains unverified.
