# Warship combat and retaliation plan

Continue the approved migration without strategy tuning. Combat preparation, battle
simulation, fleet collection and per-ship cooldown gates remain original. Replace the
per-ship purpose/movement tail with a synchronous planner exposing retreat, evade,
engage and trade-hunt eligibility. Preserve weakest-enemy and nearest-trade ties,
water-component fallback, patrol-distance threshold and movement cooldown behavior.

Retaliation exposes build/reposition after the original self, fleet-cap and difficulty
gates. Keep random draws lazy and exact. Probe buildability asynchronously without
holding a parent scope across awaits. Execute the original ready-build tail under a
synchronous decision scope; stop stale completions. Preserve void initiation, caught
build exceptions, fallback moves, emojis and relation penalties.

Tests: pure policy/threshold cases, original/generated command and state comparisons,
wait/error policies, stale async work, parent restoration and concurrent completions.
Build version 1.84.8 and run the full suite plus syntax/source consistency checks.
Infestation counter-target selection, initial deployment and ship-choice internals
remain original and must not be described as migrated.
