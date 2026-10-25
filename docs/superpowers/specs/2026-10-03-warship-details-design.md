# Warship placement and unit choices

Continue the authorized incremental centralization without changing gameplay ranking.
Add warship-port, warship-placement and warship-unit domains. Port and enemy-ship
choices retain exactly one original random draw over the original unit array. The
drawn winner heads a bounded list of alternatives (79 units plus wait). Placement
retains the original 50 coordinate-pair limit and accepts the first water sample;
policy may request another sample or wait. Friendly ship selection retains the
fallback patrol-distance filter and smart patrol state, component, cooldown and
maximum travel distance gates. Stable nearest-first sorting preserves first ties.

Each choice logs serializable facts and parents. Commands descend from the selected
unit/site decision. Deployment probes keep a local parent across await; concurrent
responses cannot share an active asynchronous scope. A ship-selection hold stops
the current synchronous patrol pass without servicing a cell or cooling a ship.
Missing eligible ships still permit original next-zone fallthrough. No fallback
algorithm is added. Invalid strategy choices/errors decline through the engine.

Keep existing command-ready bodies, messages and return types. Combat enemy/trade
targets, escape paths and threat/tracking geometry are outside this increment.
Verify actual baseline/generated parity, alternative choices, waits/errors, RNG,
trace ancestry, stale completion and existing full-suite/build checks.
