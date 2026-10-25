# Spawn decisions

Centralize spawn action/cadence, source, heatmap spot/nearby adjustment and random
site choices, keeping original default behavior. Companion first and authoritative
when available; heatmap first fitting spot; random first valid ordinary sample or
best of 1,000 smart samples with first ties. Preserve team sampling bounds and
original validity/distance rules, including heatmap's lack of team-area filtering.
Preserve the different empty-heatmap fallback rules in currentSpawnTopKey and pick.

Use bounded 79-plus-wait windows for unchecked heatmap spots, nearby alternatives
and distinct scored random candidates, retaining the original winner. Measure
invalid nearby geometry only through the original first valid tile, then offer
that winner and untested later coordinates; do not log a choice per invalid tile.
Ordinary random
mode exposes accept/resample/wait without drawing extra samples by default.
Leave geometry, scores and companion input as measurements. No source fallback
after a policy hold/error; original unavailable-source fallthrough remains.

Retain six-tick checks and top-key-change gate. Keep permits skipping a check;
explicit hold/error restores check tick/key. Normal no-site, duplicate-site,
missing-constructor and real emit failures retain original cadence/bookkeeping.
Only a permitted ready command updates spawn flag/tile/count. Direct public
pick/doSpawn methods remain usable; synchronous scopes link all child decisions.

Verify generated-class parity for sources, nearby order, score ties, random
draws, gating, metadata, tile zero, holds/errors, alternate sites, parents and
stale controllers. Live-match strength remains unverified.
