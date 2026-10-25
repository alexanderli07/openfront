# Diplomacy Centralization Design

## Goal

Move the OpenFront helper's diplomacy choices into the existing central decision engine without changing the legacy bot's behavior. The migration must make each decision inspectable, replayable, and replaceable by another strategy while keeping live game objects outside policy snapshots.

## Scope

The work is split into two independently verified passes.

### Pass 1: alliance decisions

Centralize the choices made when the bot:

- accepts or rejects an incoming alliance request;
- accepts or ignores an alliance renewal;
- decides whether to send an alliance request to a supplied player.

The planner will expose immutable candidates and facts for the rules currently evaluated by `getAllianceDecision`. It must preserve rule order, short-circuiting, random-call order and bounds, difficulty behavior, far-nation and dominance checks, relation checks, alliance-count limits, and emoji side effects. Existing event discovery, button selection, action callbacks, constructor discovery, and event emission remain executor responsibilities.

Each evaluated request receives a decision record linked to its resulting callback or event command. A policy wait or error stops that request without falling through to an unapproved accept, reject, renewal, or outgoing request. Processing of later independent requests follows the legacy loop unless ownership becomes stale.

### Pass 2: combat diplomacy

Centralize ally assistance and betrayal decisions used by the attack planner.

Assistance candidates retain the original ally order and each ally's target order. Eligibility records the relation, self-target, friendly-target, and attack-attempt checks. The existing emoji and relation-update effects occur only in the executor and in their original order.

Betrayal candidates retain the original supplied ally order. The planner records the exact difficulty-specific weakness, human-player, traitor, and player-count conditions currently implemented by `maybeBetray`. The actual betrayal event and subsequent attack remain executor work and retain their current return values.

## Architecture

Add a focused diplomacy planner module alongside the existing attack, naval, warship, and strike planners. It will receive only stable dependency functions and will communicate through runtime hooks matching the existing `allowed`, `choose`, `execute`, and `record` pattern.

New policy domains will distinguish alliance-rule decisions, request actions, assistance targets, and betrayal targets. The legacy strategy selects the lowest-priority eligible candidate so the original rule and iteration order remain unchanged. Candidate windows stay bounded, while sorting ensures the legacy winner remains visible when more candidates exist than the trace limit permits.

The runtime owns temporary parent scopes so request actions and combat commands link to the decision that authorized them. Scopes must restore synchronously or in `finally` blocks and must never retain players, events, buttons, or other live game objects in trace records.

The build script will replace only the decision portions of the minified baseline. Event discovery, UI action wrappers, messages, statistics, and game API calls remain in the generated userscript as legacy executors.

## Failure behavior

Serialization and telemetry failures remain fail-open for logging. Strategy errors, explicit waits, stale ownership, and disabled features fail closed for the affected diplomacy action. Original gameplay exceptions are rethrown after recording, consistent with the existing runtime.

## Verification

Tests are written before implementation and must first fail because the diplomacy planner or integration is absent. Verification covers:

- exact parity with the original alliance rule order and random draws;
- incoming accept/reject, renewal, and outgoing-request behavior;
- assistance and betrayal ordering, ties, side effects, and return values;
- policy wait, policy error, and stale-owner cancellation;
- parent decision links and scope restoration;
- bounded candidate handling with the legacy winner outside the first raw window;
- generated-script parity, build anchors, syntax, and the full test suite.

Live gameplay remains a separate manual validation step and is not implied by automated parity tests.
