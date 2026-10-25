# Building decision centralization

Alexander authorized the recommended next step: building upgrades and emergency defense, preserving gameplay rules while making meaningful choices replaceable and traceable.

Use one focused building planner, with four domains: structure-phase (emergency, normal, optional defense), structure-action (upgrade or new construction), structure-upgrade (eligible existing buildings), and defense-placement (prepared front tiles).

Extracting these choices into a planner is preferred to wrapping the final command, which would hide alternatives, or rewriting economic rules now, which would mix gameplay changes into migration. Original gates supply eligibility facts; geography and timing remain measurement helpers. Each selected action or target records an outcome and commands retain the selected decision as parent. Wait stops the affected pass; stale async work cannot submit or change counters.

Preserve defense timing decline semantics, normal-only structure cooldown/count updates, density upgrade restrictions, probing order, random draw cadence, original scoring and first ties. Candidate windows contain at most 79 targets plus wait and include the original winner. Quotes and units stay internal, never in decision candidates.

Scope excludes attack/naval/strike migration and changes to investment ratios. Tests cover original ordering, defense fallthrough, upgrade ranking, explicit holds, exceptions, bounded windows, cancellation and generated wiring. Release is 1.84.19 with fresh full tests, syntax and deterministic artifact checks. This directory has no Git repository.
