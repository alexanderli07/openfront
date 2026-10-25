# Warship deployment and infestation planning

Continue the approved incremental migration, preserving the original algorithm.

- Initial deployment retains disabled-unit and chance gates in the original method.
  A deployment decision exposes port/fleet eligibility and the original strict gold
  check. Port selection and water search remain lazy and random after selection.
  Await buildability without a shared parent scope; check current owner before commit.
- Infestation retains the original difficulty, global fleet, affordability, port,
  owned fleet and rich-player gates. FFA candidates are hostile fleets above 10.
  Team candidates represent the strongest player (first tie) on each hostile team
  above 15 ships, with that player's fleet above 3. Keep insertion ordering.
  Expose up to 79 eligible candidates plus wait; default winner is always included.
  Only the selected fleet consumes a random ship draw. No retry after a selected
  target's failed build: the original movement fallback is preserved.
- Synchronous lookup methods continue returning live target pairs or null; traces
  contain only identifiers/counts. Full counter action links build/fallback commands
  to the target decision and returns undefined. Deployment retains boolean return.
- Extract original ready-build tails once, retaining existing command gateways,
  stats and messages. Do not hold async parent scopes across independent probes.

Plan: failing planner tests; implementation/runtime/build integration; original vs
generated scenario tests; policy wait/error, async stale work and parent/replay tests;
independent review; full test suite, build and syntax/consistency verification.
Release 1.84.9. Geographic ship placement, tracking, battle simulation and fallback
ship selection remain original internals; strategic economy comparison remains pending.
