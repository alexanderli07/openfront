# Restore post-opening distant enemy probes

The user's reported regression is consistent with the native opportunistic order: disconnected/nearby searches precede distant enemies, and the first selected ordinary destination ends the pass even on a failed launch. Low fill and an 8,000-troop floor further differ from a small 1% scouting launch.

Approved scope: restore automatic distant 1% enemy probing after the opening, within the central decision system. Add an adaptive-only enemy-probe purpose following beachhead reinforcement and preceding local grabs. In two-team starts it is eligible only after connected wilderness is exhausted and borders are known (frontline defense keeps existing rules). Reuse hostile distant search, spacing, native opening veto, reachability and command capacity. Exact allocation is floor(current troops / 100), minimum one troop; do not apply the local-grab fill gate. An unreachable search may fall through; explicit policy holds still stop the pass. Preserve original strategy actions.

- [x] Reproduce starvation with a reachable distant enemy, an earlier local target, low fill and a large old minimum.
- [x] Implement policy, context, purpose and allocation changes; verify skip/hold/fallback behavior.
- [x] Rebuild 1.84.51; run full tests, scenarios, syntax, audit and freshness; document live verification limit.

Validation: 1,692 tests pass. Added allocation boundary cases (99/100 troops, rounding), post-opening priority, search exhaustion, allocation hold, wilderness/survey and frontline cases. 23 strategy scenarios have zero unexpected outcomes. Original action parity remains covered by the native fixtures. No browser/game control was used; live launch acceptance and the user's installed version remain unverified.
