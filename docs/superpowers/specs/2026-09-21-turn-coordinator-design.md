# Central Turn Coordinator Design

## Goal

Move the Auto-Bot's top-level play-phase sequence into the central decision engine without changing the default algorithm. The coordinator must expose economic, military, diplomatic, naval and strike phases through one inspectable policy boundary while preserving the original cadence, phase gates, order, side effects and ability to perform multiple phases during one attack tick.

This pass creates the boundary future policies need to choose investment versus combat. It does not add economic scores, combat weights, action budgets or a new playing strategy.

## Scope

The coordinator owns the post-initialization play-phase scheduling currently performed by `NationBot.tick`:

- the secondary build cadence, which may run structure handling and then return;
- casual emoji and embargo-relation maintenance;
- Bot alliance-request handling;
- player alliance-request and extension handling;
- MIRV consideration;
- structure handling;
- initial warship deployment;
- embargo issuance;
- expansion and combat through `AttackBehavior.maybeAttack`;
- warship-infestation response;
- ordinary nuke consideration.

Spawn-phase handling, elimination handling, behavior initialization, the initial neutral-land attack, tick/cadence calculation and status changes remain in `NationBot.tick`. Internal structure, attack, diplomacy, naval, warship and strike planners remain unchanged and continue to own their existing candidate decisions.

Pocket detection, nearest-island search and the separate random-boat target search remain internal helpers in this pass.

## Alternatives Considered

### Central turn coordinator

Expose high-level phases as ordered `turn-plan` candidates. The legacy strategy repeatedly selects the next phase until the original sequence is exhausted. This preserves multi-action turns and creates a common policy boundary. This is the selected approach.

### Tactical-search migration first

Centralize pocket, island and random-boat searches before the outer turn. This is smaller, but it does not let one policy decide whether to invest or fight, so it postpones the main architectural goal.

### One action per turn

Let phases compete for one action budget. This would make investment and combat mutually exclusive immediately, but it would change the default bot's cadence and behavior. It is excluded from the centralization pass.

## Architecture

Add `src/brain/turn-planner.js` with a single async entry point:

```js
planner.run(bot, context, hooks)
```

`context` identifies the cadence path and contains the primitive scheduling facts already computed by `NationBot.tick`. `hooks` follows the established planner interface:

```js
{
  allowed(),
  choose(domain, candidates, facts),
  execute(decisionId, callback),
  record(kind, details)
}
```

The runtime exposes `planTurn(bot, context)`. Its hooks attach every `turn-plan` decision to the current bot, serialize only primitive facts, set the selected turn decision as the active parent while its phase executes, await completion, and restore the previous parent in `finally`.

The standalone builder replaces only the two play-phase execution regions in `NationBot.tick`:

- the secondary build cadence calls `planTurn` with `path: 'build-only'` and returns;
- the attack cadence calls `planTurn` with `path: 'full'` inside the existing `try/catch` boundary.

## Candidate Model

The `build-only` path contains one candidate:

1. `structure-secondary`

The `full` path contains these candidates in original order:

1. `casual-emoji`
2. `embargo-relations`
3. `bot-alliance-requests`
4. `alliance-requests`
5. `mirv`
6. `structure`
7. `warship-deployment`
8. `embargo`
9. `attack`
10. `warship-infestation`
11. `nuke`

Each candidate has `kind: 'turn-plan'`, a stable ID, original priority, `readiness: 'unchecked'`, and a primitive reason. A `$wait` candidate is always included. Candidate batches remain below the engine limit.

Feature gates are evaluated only after their phase is selected. A disabled phase produces a `turn-plan-result` with `status: 'skipped'`, is removed, and runs no helper. This lazy check preserves the original interleaving of unconditional phases and feature reads, including short-circuit evaluation of `expand || boat`. The legacy strategy chooses the first phase. After a phase completes, skips, succeeds, does nothing, or returns `undefined`, the coordinator asks the strategy to choose among the remaining phases. Therefore the default policy executes every originally enabled phase in the same order rather than stopping after the first successful action.

The coordinator does not pre-run phase helpers or nested planners while constructing candidates. Random draws, searches, cost lookups and side effects occur only inside the selected phase executor.

## Exact Legacy Behavior

The following behavior is preserved:

- A non-attack cadence tick runs only the secondary structure phase when the existing cadence and build feature allow it, then returns.
- A full cadence tick sets the existing thinking status before entering the coordinator.
- Casual emoji and embargo-relation maintenance run unconditionally on the full path.
- Bot alliance requests run unconditionally on the full path.
- Player alliance handling remains gated by the alliance feature.
- MIRV and ordinary nuke phases remain separately gated by the nuke feature.
- Structure handling remains gated by the build feature.
- Both warship phases retain the warship feature and `warshipAutoSpawn !== false` gates.
- Embargo handling retains the embargo feature gate.
- Attack handling retains the existing `expand || boat` gate.
- The existing outer `try/catch` still logs a phase exception and prevents later phases in that turn.
- Phase return values do not change whether the legacy coordinator advances to the next phase.

The legacy policy samples no new randomness and does not alter the number or order of calls made by the original sequence.

## Policy Semantics

A replacement strategy may reorder phases or select `$wait`. A reordered phase evaluates its gate at its new selected position; reordering therefore changes when it observes shared state and is an intentional policy change. Selecting `$wait` stops the remaining phases for the current cadence pass. The next bot tick starts with a fresh scope.

The coordinator exposes high-level choices such as `structure` versus `attack`; it does not flatten every nested structure, target or strike candidate into one simultaneous list. After selecting a phase, the existing nested planner exposes its concrete choices. This produces a hierarchy rather than speculative execution:

```text
turn-plan -> domain plan -> target or rule -> command -> dispatch
```

This boundary is sufficient for a future strategy to prefer investing, attacking or striking from the shared game snapshot while leaving each domain responsible for its detailed choices.

## Snapshots and Tracing

`turn-plan` decisions use the runtime's existing game snapshot and add a primitive `turn` object containing:

- cadence path;
- current tick and attack rate facts supplied by `NationBot.tick`;
- remaining, visible and eligible phase counts;
- the selected phase's original priority through its candidate.

Unevaluated feature flags and `warshipAutoSpawn` do not enter the snapshot. Their values are read lazily when the corresponding selected phase reaches its original position, and the result record identifies a disabled gate with primitive `gate` and `enabled` fields.

No live bot, player, behavior, callback, event or promise enters a policy snapshot.

Each selected phase produces `turn-plan-result` with its decision ID, phase, status and summarized return or exception state. Nested planners and command gateways receive the selected turn decision as `parentDecisionId`. A phase with no nested decision still has a terminal result record.

## Stops, Errors and Async Safety

Before selection, before execution and after every awaited phase, the planner calls `allowed()`. If the bot stopped, ownership changed or the game became disallowed, the coordinator records a stopped result and runs no later phase.

An explicit `$wait`, an invalid policy selection or a strategy exception stops the current cadence pass. The runtime's decision engine continues to record the underlying strategy error.

Phase executor exceptions retain their original identity. The coordinator records the throw and rethrows it so the existing `NationBot.tick` catch aborts the remaining sequence exactly as before.

Active parent state is restored in `finally` after synchronous returns, fulfilled promises and rejected promises. A stale asynchronous completion cannot start a later phase.

## Testing

Planner tests cover:

- exact build-only and full phase order;
- every feature gate;
- multiple enabled phases executing during one pass;
- phase return values not stopping legacy progression;
- alternate phase ordering;
- `$wait`, invalid selection and strategy error stops;
- stale ownership before and during an async phase;
- thrown executor identity;
- primitive candidate and snapshot data.

Runtime tests cover:

- turn decision to nested decision to command ancestry;
- parent restoration after synchronous completion, async fulfillment and rejection;
- no parent leakage to later unrelated commands;
- a stopped turn scope resetting on the next tick.

Generated parity tests compare the original and generated `NationBot.tick` behavior for build-only cadence, full cadence, disabled features, phase call order, multiple actions, false/undefined returns, and thrown phases. Build tests assert both generated call sites and unchanged command-gateway counts.

Final verification runs the full Node test suite, rebuilds `openfront-helper.user.js`, checks its syntax and confirms deterministic source equality. Live browser gameplay remains a separate validation step.

## Versioning and Documentation

The legacy strategy version advances from `1.84.0-plans.13` to `1.84.0-plans.14`. The standalone userscript advances from `1.84.14` to `1.84.15`. The README documents `turn-plan`, `turn-plan-result`, the nested decision chain and the remaining tactical-search work.
