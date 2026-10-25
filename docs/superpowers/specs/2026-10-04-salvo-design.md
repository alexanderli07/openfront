# Salvo planning ownership

Move planSaturationSalvo into the existing strike target planner. Keep SAM
coverage, original silo eligibility, arc probes, and up-direction flight length
measurements in a generated helper. Preserve nearest-silo sorting and first ties.
The game's launch queue constrains silo/slot order: approve its ordered queue as
a single candidate rather than offer speculative reordering.

Expose salvo-order, salvo-window, salvo-count and salvo-schedule plus wait.
Windows are the original sliding flight-time intervals of half SAM cooldown,
ranked largest first with first ties. Empty/insufficient capacity returns the
original needsMoreSilos result. Counts range from original required bombs to
the selected window capacity; baseline takes the minimum. Select slots in the
original queue order and fire its prefix through the last selected slot.
Schedule candidates contain original staggered waits and arc flags in chunks of
at most 79 launches. Every chunk must be approved before any executable plan is
returned; a tail hold discards the whole plan. Chunk decisions chain their parents
and expose firstBomb so telemetry's 80-item array limit hides no schedule tail.
Preserve gold/spend gates after timing.

Hold/error/stale returns an explicit stopped plan so every enclosing caller
aborts without trying another site or upgrade. Bound candidates to 79 plus wait,
always retaining the baseline winner. Link order -> window -> count -> schedule
under the enclosing site/SAM. Preserve successful return shapes and no shared
async scope. Full player-to-delivery ancestry remains the next increment.
