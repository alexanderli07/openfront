# Structure Placement and First-SAM Reserve

## Goal

Improve economic structure placement and ensure the bot can fund its first owned SAM. Before the first owned SAM, the bot should retain its safer spread-out opening. After the first owned SAM, cities, ports, and factories should strongly prefer useful train lines connected to owned or allied factories. New factories should extend the rail network and create space for later buildings.

## Scope

- Add a central `structure-placement` decision for tile selection.
- Apply the central tile decision to city, port, factory, SAM, and missile-silo placement.
- Change adaptive placement scoring for cities, ports, and factories.
- Add an adaptive first-SAM reserve rule to `structure-plan`.
- Preserve construction quotes, build commands, upgrade behavior, cooldowns, feature gates, and ordinary no-site behavior.
- Do not change defense-post, warship, or strike placement in this iteration.

## Chosen Approach

Use a central placement planner. The existing placement methods may supply map facts and candidate tiles, but `adaptive-v1` selects the final tile through the decision engine. This keeps gameplay policy in one inspectable strategy and avoids hiding new weights in the generated userscript.

A score-only patch to the legacy value functions was rejected because it would leave tile selection outside the central policy. Multi-step rail-network simulation was deferred because it would be expensive and would depend on speculative future ownership.

## Candidate Pool

The planner receives the existing territory, coastal, deep-interior, and friendly-SAM candidates. For cities, ports, and factories it also adds deterministic route candidates sampled around owned and allied factories at valid train distances. A route candidate must be owned land; port candidates must also be valid coastal tiles.

Duplicate tiles are removed before scoring. The planner exposes at most 79 candidates plus wait in each decision window and continues with later candidates if the selected tile is not buildable. Candidate preparation and scoring must not call the build command.

Each candidate contains primitive facts:

- existing placement score and safety score;
- owned and allied factory connections within valid train range;
- distinct reachable rail clusters connected by the tile;
- future route capacity, measured from deterministic owned-tile samples within valid train range;
- own and allied SAM coverage;
- whether the bot already owns a completed or under-construction SAM;
- stable input order for ties.

## Placement Policy

Before the first owned SAM, existing spread, interior depth, and safety remain the primary scores. A valid owned or allied factory connection is useful but does not override the opening spread preference.

After the first owned SAM, cities, ports, and factories rank candidates lexicographically:

1. tiles with a valid route to an owned or allied factory;
2. own SAM coverage, then allied SAM coverage;
3. for factories, distinct rail clusters and future route capacity;
4. existing safety and placement score;
5. stable input order.

This makes useful factory lines dominate deliberate spreading after the first SAM while retaining safety as a tie-breaker. If no candidate connects to a factory, the adaptive policy uses the best available original candidate rather than refusing to build.

Factories receive an additional route-extension evaluation. Connecting multiple distinct clusters is preferred. When cluster counts tie, the candidate with more sampled owned tiles available for future valid routes wins. An isolated factory can still be selected when no connected candidate is buildable.

SAM and missile-silo tile rankings retain their current behavior in this iteration, but their tile choice still passes through `structure-placement` for tracing and future policy changes.

## First-SAM Reserve

The reserve activates when all of these are true:

- the bot owns zero SAM levels, including construction;
- the existing structure target reports that a SAM is due;
- SAMs and nuclear play are enabled by the existing gates;
- the SAM plan is otherwise eligible.

While active, `adaptive-v1` selects the SAM plan when it is affordable. When it is not affordable, it selects `$wait` and spends nothing on ordinary cities, ports, factories, or silos during that structure pass. Existing MIRV reserves and other affordability calculations remain intact. Once the first SAM is owned or under construction, the reserve ends.

The structure-plan snapshot and candidates expose primitive `ownedLevels`, `targetLevels`, `perceivedCost`, `availableGold`, and `firstSamReserve` facts so the decision and explanation are replayable.

## Outcomes and Errors

A policy wait stops only the current structure pass. A selected tile that is stale or unbuildable is recorded and the planner continues with remaining candidates. Exhausting valid candidates records `no-buildable-tile` and returns the existing false/no-build result. Existing strategy errors continue to fail closed. No new exceptions are introduced for ordinary placement failure.

Commands retain the ancestry `turn-plan -> structure-plan -> structure-placement -> command`. No live game objects are stored in traces.

## Testing

Focused tests will cover:

- opening spread winning before the first owned SAM;
- a valid owned-factory route winning after the first SAM;
- an allied-factory route receiving the same route priority;
- own SAM coverage winning over allied coverage when route quality ties;
- a factory preferring multiple clusters and then future route capacity;
- fallback to the best original tile when no route candidate exists;
- unbuildable selected tiles advancing without duplicate probes;
- first-SAM saving, affordable SAM construction, and reserve release;
- decision ancestry, policy waits, stale ownership, and bounded windows;
- generated userscript syntax and source determinism.

The fixed strategy scenarios will gain first-SAM reserve and post-SAM factory-line cases. Intentional adaptive differences will be asserted explicitly instead of treated as accidental parity failures.

## Versioning

Advance the userscript from `1.84.17` to `1.84.18` and the adaptive policy from `1.0.0-baseline` to its first gameplay version.
