# Warship maintenance phases

First increment in the audited warship group: expose the early NationBot.tick
maintenance block as warship-maintenance phases: tracking, dodge, patrol, combat.
Preserve the outer initialized/alive/feature/difficulty/port/unit gates exactly.
Default order remains tracking -> dodge -> patrol -> combat. Evaluate per-phase
auto-spawn, winFixes and nuke-dodge settings lazily after selection, preserving
false-vs-falsy semantics. Phases execute synchronously, matching the original
block; do not await originally fire-and-forget retaliation work.

Policy wait/error/invalid/null/stale stops this maintenance pass before later
phases, but does not cancel the independent ordinary tick/cadence. Exceptions
still exit the block and reach its existing error handler. Use temporary
synchronous command parents on the warship actor, restoring them in finally.
No shared async parent scope is added. Candidate phase alternatives allow custom
ordering. Existing domain-specific holds retain their current scopes; broad
nested hold propagation and incoming-transport handled-state rules belong to
the subsequent threat-source/response increment.

Verify generated tick parity for settings and outer gates, custom phase order,
wait/error/stale behavior, exceptions, command parent/restoration and replay.
