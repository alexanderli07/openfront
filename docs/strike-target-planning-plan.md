# Nuke target search and SAM subdecisions

Continue centralization without tuning. Replace findBestNukeTarget's ordered search
with lazy purpose candidates: duel, incoming attack, density, majority leader,
allied target, hostile relation, FFA crown, strongest team. Return original live
player or null synchronously. Preserve each branch's truthiness/null rules and
strength thresholds. Existing density/crown/team scoring helpers stay original.
An explicit nested incoming-target wait must end this lookup; scope and restore
the attack actor's stop/parent context synchronously.

Replace the SAM scan after original unit/cost/silo gates with bounded candidate
windows preserving ascending SAM-level order. Failed plans fall through; remember
the first plan needing more silos. A viable plan sends the original paced salvo;
otherwise offer the remembered upgrade action. Policy waits stop all fallback.
Upgrade selection preserves reachable-silo capacity checks, maximum levels,
friendly-SAM coverage score and first tie. Probe only the selected silo with the
original async helper and explicit decision ID. Preserve undefined return values.

Tests: failing pure cases, original/generated target and SAM/upgrade parity,
wait/error policy and nested-stop recovery, parent links, stale continuations,
replay, bounded batches. Review before full tests and 1.84.11 build validation.
MIRV target-player ranking and remaining strike ranking helpers remain separate
follow-up work; this increment migrates nuke search order and SAM subdecisions.
