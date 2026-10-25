# Strike player ranking migration

Move four MIRV selectors (counter, victory denial, steamroll, win-fix) and three
nuke selectors (density, FFA crown, strongest team) into a pure-candidate adapter.
Keep all eligibility, thresholds, alive/team/friend checks, and original tie rules.
Team max-troop ties choose the last player; other ordered ranks keep first ties.
Only eligible candidates are exposed; at most 79 plus wait, sorted before truncation
so the original winner is always visible. Return original live player identities.

Use domains mirv-target and nuke-player with a mode in the snapshot. Candidate facts
explain the existing ranking. Scoped synchronous lookups join parent purposes to
rank decisions. Policy hold/error on a nonempty ranking stops the enclosing purpose
pass without consuming reserves or running later searches. Empty default rankings
continue original fallback. Restore stop and parent scope on return or exception.

Test boundaries, first/last ties, alternate choices, >79 players, null guards,
original/generated parity, nested holds and recovery, parent links/replay. Review,
then full suite, 1.84.12 build, syntax and source consistency verification. No tuning.
