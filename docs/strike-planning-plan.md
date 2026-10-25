# Strike planning migration

Continue centralization without gameplay tuning. Integrate MIRV purpose/reserve flow,
nuke weapon selection, ranked strike-site selection and final strike action.
Existing target-player search, score formulas, terrain/arc scans, cooldowns, SAM
saturation calculations and geographic targeting remain original helpers.

MIRV order: optional win-fix target/reserve branch, then affordable counter, victory
denial and steamroll prevention. Preserve true after attempting maybeSendMIRV even
if that helper emits nothing. Preserve early-game reserve threshold and clear rules.
Do not run later searches when an earlier purpose succeeds or the policy waits.

Nuke order: hydrogen eligibility/spend check, then atom conditions. Keep scored site
order and strict value > -1 threshold, sequential probes, intercepted-site atom
probe + saturation-plan requirement, and original score-dependent direct/SAM fallback.
Explicit site/action wait stops the pass; exhausted sites may still lead to SAM clearing.
Use windows of 79 sites plus wait, with failed sites removed and windows replenished.

Carry decision IDs as explicit optional parameters through original async launch,
SAM clearing and helpful-silo methods. Scope only the synchronous build gateway,
never an entire async strike. Check current owner after awaits and between salvo
attempts. No game objects or executable callbacks enter the policy snapshots.

Verification: failing pure planner tests; original/generated scenario comparisons;
real runtime wait/error, parent links, replay and stale async cancellation; independent
review; full suite, standalone build, syntax and source consistency checks. Version 1.84.10.
