# Two-team opening, first increment

Approved direction: safe-spawn and front-line openings for two-team games.
Wilderness means usable unclaimed land directly reachable from current territory
by land. Distant islands and fallout do not delay country attacks. Before that
land is exhausted, safe spawns must not attack any country, including tribes or
disconnected players. Incoming attacks or an enemy human/nation land border
switch to front-line handling; neutral tribes alone do not count as the front.

This increment implements opening facts, country-expansion gating and early
construction. Group/coastal spawn scoring, rear placement and anti-transport
fleet priorities are subsequent increments of the user's overall plan.

Measure facts from game/player adapters and expose scalar facts to the existing
central policy. Limit to Team mode with exactly two non-tribe teams. Keep legacy
policy behavior as the explicit comparison baseline. Invalid policy decisions
still stop the affected pass; do not silently select another algorithm.

For safe spawns without an owned SAM: target two physical ports and one physical
city before reserving for the first SAM. Prefer port, city, second port. Disabled
or unavailable ports do not deadlock landlocked openings: use one factory plus
one city where enabled. Construction counts toward the goal; upgrades do not.
The first SAM is required only when silos/SAMs/nukes are enabled. Extend toward
three ports/two cities only when the purchase leaves the quoted SAM budget.
After an owned SAM exists, return to ordinary development. Front-line spawns
retain existing emergency-defense and threat-reserve behavior in this increment.

Country gating is applied both to the outer attack sequence and the opening veto
used by individual routes. Safe wilderness passes select only land expansion,
then finish even if an expansion attempt is unavailable or fails; they cannot
fall through to countries or distant boats. Once wilderness is exhausted, the
new gate replaces the old five-city opening veto for safe two-team spawns.

Opening construction candidates use original affordability/build settings and
placement checks. Selected opening plans force new construction through the
central structure-action boundary, with scoped cleanup on success/error/hold.
Early safe construction suppresses optional/proactive defense spending, but
front-line transitions preserve existing defensive behavior. Trace stage,
wilderness status, counts, selected plan and reasons.
