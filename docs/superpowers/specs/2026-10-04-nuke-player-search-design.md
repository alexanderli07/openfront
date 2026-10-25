# Remaining nuclear player searches

Expose ally request sources/players and hostile-relation players through bounded
79-plus-wait windows, preserving original order and lazy eligibility checks.
Ally targets getter retains its original length check and second enumeration only
after relation >= Friendly. Requested targets exclude self/friendly players.
Hostile search computes own capacity once, checks exact Hostile then friendly,
then requires own capacity <2*target capacity. No new same-team, alive, Bot or
deduplication restrictions. First eligible player ends default search; later
predicates must not run by default. A selected unchecked candidate is evaluated
and skipped when ineligible; waits/errors stop the entire target-purpose search.

Also centralize the single duel-opponent and qualifying majority-leader choices;
retain two-player difficulty gate, leader ordering, majority >.5 and friendly/self
checks. Empty/ineligible searches still fall through to later original purposes.
Link purposes -> ally source -> requested player, or purpose -> other player,
using explicit parent IDs. Direct lookup stop is local and resets next lookup.

This increment changes player search ownership only. Nuclear weapon/site/arc and
delivery ancestry remain their existing paths; detailed delivery migration follows.
Verify generated-class parity, alternative selections, no-fallback holds/errors,
lazy checks, boundaries, large windows, parent IDs/replay, and stale controllers.
