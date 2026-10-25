# Economy-specific SAM placement

User requested: factory games open with two cities and one factory, then favor
existing factory lines; SAMs sit close to cities. Coastal games put SAMs as close
to ports as feasible. Continue existing two-team safe/front-line distinction.

Safe factory opening: city, second physical city, factory, then first SAM.
Upgrades do not count as extra cities. Disabled building types are excluded.
Coastal safe opening stays port, city, second port, then SAM. Determine factory
mode from absence of usable shared port water, respecting the structure pass's
known shared-water result. Existing urgent front-line defense remains available.

Economic placement: after the factory minimum is established, existing owned or
allied completed factory routes outrank spread before as well as after the first
SAM. Rear safety still takes priority on threatened fronts. Prefer factories
that create connections/new buildable route capacity within the same safety tier.

SAM placement: use active owned ports when present, otherwise active owned cities.
Prefer the least SAM-protected anchors, then minimum anchor distance; aggregate
coverage of unrelated structures is only a tie-break. Add bounded owned-land
samples near anchors, and keep top anchor candidates visible alongside legacy
samples. A central SAM search plan measures at most 12 requests across distance bands.
Worker quotes enforce native constraints and may relocate a request: the final
central choice ranks the actual quoted construction tile, not the request. Under-construction
primary economy buildings count as anchors; incomplete SAMs do not count as
protection. If no priority anchors exist, retain existing placement behavior.
Decisions log anchor type/tile, protection and distance, plus economic mode.

Explicit legacy-v1 stays the comparison benchmark. No logging redesign or
end-game fixes in this gameplay increment. No Git actions.
