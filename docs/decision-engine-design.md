# Central decision engine

This describes the initial framework. Version 1.84.2 adds structure-plan batching; see `structure-planning-design.md`. The baseline lobby predicate is constant false and does not enforce a public-lobby restriction.

The user rejected the economy rewrite and restored 1.84.0. Preserve that exact strategy as the initial policy. Establish one decision boundary for actual Auto-Bot commands, structured rule/action/outcome traces, and a replaceable strategy interface. Do not introduce new economy weights, reserves, timing, or build priorities.

Pipeline: legacy behavior checks -> explicit action proposal -> strategy.decide(snapshot, candidates) -> selected command executor -> dispatch result -> later observed game state. The initial legacy adapter submits proposals sequentially to preserve command order and stateful behavior. Each decision compares the proposed command with waiting. This is deliberately not a claim that the original code already generates every possible move in a common batch. The engine accepts batches; future proposal generators can supply them without changing the engine or recorder.

Decision records name the strategy/version, snapshot, proposed alternatives, selected action, explanation, and dispatch status. Instrument existing rule functions to record actual arguments and returned thresholds/choices. Do not fabricate explanations for opaque branches. Record no-action behavior passes as well. Dispatch success means submitted, not server accepted. Subsequent state observations are separate records, not invented causal attribution.

Files: src/brain/engine.js (pure strategy/trace engine); src/brain/legacy-strategy.js (original policy adapter); src/brain/runtime.js (game snapshots, proposal gateways, rule instrumentation, export UI); scripts/build.js (exact-match integration from immutable vendor baseline). Keep discarded economics under archive/economy-experiment; never include it in active build.

No global patches to game event buses or manual controls. Integrate only the 17 Auto-Bot event submissions, 9 build-menu calls and 3 alliance callbacks plus bot lifecycle. Preserve argument identity, order, synchronous return values, errors, and promise return identity through the baseline executor. Runtime guards reject stale bot/game ownership. Logging is bounded, safe to export as JSON, and must not prevent gameplay if serialization or a display subscriber fails.

Validate with Node tests for selection/replay, failed strategies, immutable snapshots, bounded traces, async outcomes, and sync compatibility. Compare original and instrumented behavior classes in VM fixtures: same commands, parameters, order, and state for baseline scenarios. Verify complete sink coverage and deterministic standalone build. Live match performance is not established by these tests.
