# Attack Geography Centralization

## Goal

Move sealable-pocket and nearest-island-enemy selection into the central decision engine without changing the legacy bot's results, call order, cache behavior, probes, or command execution. This completes the remaining geographic target choices used by the main attack planner.

## Scope

Add an `attack-geography` planner with two modes:

- `pocket`: choose among nearby enemies whose land share and sealed perimeter satisfy the existing settings.
- `island`: choose among reachable nonfriendly players after the existing transport, shoreline, strength, distance, and reachability checks.

The existing `attack-plan` continues to choose the purpose. The new decision sits below it:

```text
turn-plan -> attack-plan -> attack-geography -> command
```

Random-boat targeting, opportunistic naval searches, warship placement, and strike calculations remain outside this pass.

## Planner Interface

Create `src/brain/attack-geography-planner.js` with an asynchronous entry point:

```js
planner.select(actor, mode, hooks)
```

It returns `{ target, decisionId, stop }`. Hooks provide `allowed`, `choose`, `record`, and the existing guarded reachability probe. Candidates contain only primitive identifiers, ranks, distances, shares, ratios, eligibility, and explanations. Live player objects remain private to the planner.

The runtime exposes `selectAttackGeography(actor, mode)`. It uses the current attack scope, attaches the active attack-purpose decision as the parent, and marks that attack scope stopped when a policy wait, invalid choice, strategy error, or stale continuation occurs.

The builder replaces `findSealablePocket` and `findNearestIslandEnemy` with thin runtime adapters. This ensures both attack-planner calls and any standalone calls use the same policy boundary.

## Pocket Selection

The planner preserves the original tick read, 100-tick cache, nearby-player order, friendly/dead/player filters, maximum-land-share check, `ensureBorderTiles` sequence, shore and map-edge rejection, perimeter ownership scan, minimum seal-share threshold, strict greater-than ranking, and first ties.

On a cache hit, only the cached living player is returned, matching the original helper without a new decision or scan. On a cache miss, every qualifying pocket becomes an `attack-geography` candidate. The legacy strategy chooses the candidate with the greatest seal ratio and keeps the first tie. The selected small ID is stored in the original cache fields. No selection stores `null` as before.

Per-player scan exceptions remain ignored. A tick-read failure returns no target. The planner rechecks ownership after awaited border preparation and cannot select from a stale continuation.

## Island Selection

The planner preserves the disabled-transport and boat-cap gates, own-shore requirement, player filters, FFA strength rule, center calculation, Manhattan-distance sorting, stable ties, border preparation, closest-shore lookup, and transport-spawn probing.

The original method continues scanning until it finds two reachable players or exhausts the sorted list. Those reachable players become candidates in their original order with distance and player facts. The legacy strategy chooses the first, which preserves the original result and probe count. An empty reachable set returns no target without a policy decision.

Border-preparation exceptions retain their original identity. Timeout or failed spawn probes continue to the next player. A stale result cannot become a target.

## Policy and Trace Semantics

`$wait` is always available when candidates exist. Selecting it stops the enclosing attack pass. Invalid choices and strategy errors fail closed the same way. Every decision or stop produces an `attack-geography-result` record describing the mode, selected target ID, status, and reason.

The selected geography decision becomes the parent of the existing `sendAttack` path. The current opening checks, reserves, troop allocation, land/boat choice, and final command gateway remain unchanged.

## Testing and Integration

Focused planner tests cover legacy winners and ties, filters and thresholds, pocket cache hits/misses, island gates and probe order, alternate selections, waits/errors, stale async completion, exception identity, primitive snapshots, and terminal records.

Runtime tests cover attack-purpose to geography to command ancestry and attack-scope stop/reset behavior. Generated parity tests compare original and generated pocket/island results, cache mutations, border/probe order, empty searches, failures, and thrown operations. Build tests verify both adapters and module wiring.

After focused tests pass, run the full Node suite once, rebuild the userscript, check syntax, and verify deterministic source equality. Live gameplay remains separate validation.

## Versioning

- Userscript: `1.84.16`
- Legacy strategy: `1.84.0-plans.15`
