# Attack sequence centralization

Under Alexander's authorization to continue centralizing gameplay choices, migrate the outer `maybeAttack` shortcut/maintenance sequence without changing combat rules.

Add `attack-sequence` for takeover, opening bot attack, opportunistic boat, donation, far alliances, open land, tactical random boat, enemy alliance requests and main attack planning. Add `takeover-target` for disconnected neighbors with the original weakest-first ordering, including friendly players as the original does. Preserve original observation collection, opening-pass reset, lazy checks, RNG cadence, exact early returns and undefined public result. Donation timing and opening conditions retain the original settings and clock.

Prefer an extracted sequence planner over command-only wrappers, which omit alternatives, or a new combat policy, which would conflate migration with gameplay changes. Primitive candidates expose eligibility or unchecked readiness. Selected phases record outcomes and commands retain phase/target ancestry. Windows are bounded to 79 plus wait with the original takeover winner visible. Nested holds/errors and stale async completion stop the attack pass; the next pass recovers.

Detailed random boat geometry and troop allocation are deferred to the following increment. This release is 1.84.20. Validate phase/target choices, failover, holds, async cancellation, original/generated parity and final generated artifact.
