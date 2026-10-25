# Warship combat destinations

Continue the approved centralization in place. Add warship-target for enemy/trade
selection, warship-destination for returning home, and warship-waypoint for escape
tiles. Preserve weakest-health and nearest-distance ranking, first ties and the
existing water-component BFS of depth 30. Preserve the escape score: enemy distance
capped at 15 times 50, minus home distance (home tile zero remains falsy as in the
baseline), minus (4 - water-neighbor count) times 15.

Expose at most 79 ranked candidates plus wait, always including the original
winner. Policy waits/errors stop that combat action; movement gates remain after
selection. Commands link to the target/waypoint decision underneath combat purpose.
No asynchronous parent scope is added. Preserve return values, original cooldown
updates after attempted dispatch, and exception behavior. Feasibility, combat
simulation, home-port choice, threat tracking and nuke evasion are outside scope.

Command-policy holds/errors do not count as dispatch attempts and must not update
cooldown. An actual emit returning false still retains the original cooldown.
Optional telemetry getters cannot prevent the original selected target's move.

Verify actual baseline/generated target and waypoint parity, alternate choices,
holds/errors, ancestry, replay, bounds and complete build/test checks.
