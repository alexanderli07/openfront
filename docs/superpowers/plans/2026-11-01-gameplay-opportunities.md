# Expansion, donation value, and threat-aware development

**Goal:** Implement the three approved gameplay improvements through existing central planners.

**Scope and limits:** Preserve opening troop-wave amounts, wilderness-before-donation gating, own-home conservation, two automatic transport slots, native worker reachability, initial economy/first-SAM milestones, main-SAM upgrade priority, emergency interception checks, and the3M emergency reserve. No extra UI controls. Measurements are bounded and explain uncertainty. Visible infrastructure is capability, not knowledge of enemy weapons or intentions.

## Expansion

Measure more of each neutral river destination's connected land pocket and its narrow entrance, owned contact, and competition. Exclude already land-reachable and tiny pockets. Present measured opportunities to the central landing decision so a slightly longer crossing into a large or contested pocket can beat a nearby scrap. Apply the two-probe budget after ranking river opportunities, while preserving original distant/disconnected landing semantics. A neutral land attack expands under native game rules; do not claim it can be aimed at a specific land tile.

## Donations

Measure current recipient headroom, observable hostile incoming troops, recipient outgoing attacks, own available donation budget, and whether a donation plausibly closes a defensive gap or supports an advance. Prefer useful front-line recipients over a blanket lowest-fill rule; unknown troop telemetry must not falsely classify a recipient as hopeless. Keep candidate priority for legacy comparison, and apply the measured ranking in adaptive strategy. Quantitative facts and amount reasons belong in the trace. Final existing spending/expansion/home-defense checks remain authoritative.

## Development

Observe active hostile nuclear infrastructure, bounded per scan. Use modest threat-driven planned targets on the existing main SAM after developed-economy milestones, capped separately from economic and observed-salvo target floors. Preserve confidence and construction/cooldown data. No new launcher spam, reserve reductions, stockpile assumptions, or skipped opening milestones.

## Verification and release

- Write failing cases for large versus small landing pockets, actual adaptive selection/probe budgets, meaningful defense versus idle donation targets, uncertain telemetry, visible hostile versus allied infrastructure, safe opening, and emergency/budget invariants.
- Integrate independent module changes centrally; run focused tests, full suite, and strategy scenarios. Review the resulting diff.
- Bump userscript and strategy versions, publish selected files, and verify public script/meta bytes. Distinguish offline checks from live-game outcomes.
