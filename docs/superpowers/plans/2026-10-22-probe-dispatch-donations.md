# Probe dispatch and donation reliability

Fix the reported probe and donation failures without changing the 65% front-line recipient threshold or donor reserves.

Confirmed causes: bestTransportShipSpawn now requires a water/shore destination, while the distant search submits inland name-label tiles; a transport capacity rejection stops the enclosing attack scope before the donation phase; the generated donation helper returns success even when its event constructor is absent or emission fails.

Implementation: supply actual hostile coastal candidates sharing an owned shore's water component for the adaptive enemy-probe purpose, then use the existing centralized landing choice, worker reachability and 1% launch path. Keep the legacy search explicit for its original purpose. Treat a transport capacity hold as an operational hold instead of an explicit policy stop. Report unsuccessful donation submission truthfully and retain precise skip reasons. Native opening/protection and donation reserves remain enforced.

Validation: add failing source/dispatch tests first; run focused and complete tests, scenario comparison, generated syntax/audit and final freshness check. Current upstream source: SpatialQuery.closestShoreByWater rejects inland targets (https://github.com/openfrontio/OpenFrontIO/blob/main/packages/engine/src/pathfinding/spatial/SpatialQuery.ts).

Completed in 1.84.52. Four initial regressions reproduced the reported failure paths; an additional integration test exercises the generated coastal search and actual centralized 1% boat command. Review caught an adapter difference: component IDs exist only on water tiles in our game adapter. Tests now explicitly return null for land and verify adjacent-water component matching; those tests failed before the correction. Review found no remaining concrete scope/donation issues.

Final validation: 1,695 tests pass; 23 scenario comparisons have zero unexpected outcomes; syntax, command audit and build freshness pass. Live browser installation and server acceptance were not verified. No donor/recipient thresholds were loosened. New logs identify coast-search exhaustion, donation phase holds, reserve/amount holds and unsuccessful submission; a submitted event still does not prove server acceptance.
