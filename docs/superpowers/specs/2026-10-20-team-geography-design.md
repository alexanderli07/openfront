# Two-team geography and naval defense

Approved by user: implement all three remaining gameplay increments together.

Scope: exactly two non-tribe teams, adaptive-v1. Explicit companion spawn
selections retain authority. Legacy-v1 remains the comparison benchmark.

Spawn: collect a bounded pool from heatmap neighborhoods and random valid sites
inside native team spawn bounds. Measure reachable local unclaimed land,
useful water access, nearest same-team group and nearest hostile player.
The central strategy ranks safety/open space first, then group/coastal benefits;
minimum spawn spacing stays mandatory. Ignore isolated ponds. Log each score.

Placement: measure distance to live hostile human/nation borders or approaching
attacks. Supplement existing pools with bounded owned interior/coastal samples.
On threatened fronts prefer rear distance bands (cities stricter), then existing
factory routes and SAM protection within a band. Preserve pre-SAM spread and
post-SAM grouping for safe starts. Expose deep candidates within decision limits.

Naval: incrementally flood the local land component with bounded work per tick.
Do not call a peninsula an island merely because a straight line crosses water.
Require completed land separation and a water component shared with a hostile
port for island prioritization. Retain existing handling while topology unknown.
For island games, target two active/construction warships, up to three when
incoming transports threaten same-team land. Require a usable own port and leave
one next opening-economy purchase or the first SAM budget, plus ordinary economy
headroom after opening. Run this deployment before routine construction in the
full turn; refresh facts after every build and recheck after asynchronous quotes.
Preserve native ship toggles, worker validation and all central command gateways.

Prioritize hostile transports landing on owned/same-team land over trade hunting,
while retreat/evasion and unsafe enemy warship engagements retain priority.
Only chase targets in the same water component and bounded interception radius.
Add same-team coastal approach patrol sites for island fleets; never choose water
from another component. Existing invasion/loss/trade sites remain alternatives.

Tests cover scoring tradeoffs, team scope, bounds, candidate visibility,
front changes, topology work limits, peninsula exclusions, pending fleets,
budget reservation, stale quotes, friendly/retreating transports and legacy parity.
Automated fixtures do not establish real gameplay strength. No Git actions.
