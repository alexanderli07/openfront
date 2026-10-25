# Attack routing and targeted boats

Continue the authorized centralization with original defaults. After the unchanged
opening/random attack gates, expose `attack-route`: land when bordering, targeted
boat for players, nearby free-land boat for nonplayers, and wait. A boat route can
be selected for a bordering target, but a land route requires the original border
predicate. Route selection does not retry another route on failure.

Normal targeted boats retain feature/unit gates, border loading, original shore
pair, one reachability probe, amount formula, emoji/cap/dispatch order and return
values. Expose the original destination plus at most 78 other supplied target
shores, and original/smaller viable troop amounts. Legacy selects the original
destination only; an unreachable destination returns false without searching.
Original probe minima above army size remain possible. Smaller alternatives must
fit current troops and preserve probe/bot minimum force. Bot quotes retain their
baseline wave accounting on real failures; policy holds restore that attempt.

Keep parent IDs in local async state. Install active runtime scope only during
synchronous helper/command execution. Holds/errors stop enclosing waves with no
policy or route fallback. Probe errors propagate, stale controllers cannot emit.
Actual game transport spawn choice remains the game's reachability service; the
source shore in the candidate describes the baseline geometry, not a forced spawn.

The adjacent nearby free-land path still had a local probe loop despite previous
tactical/opportunistic boat work. Include `free-boat-site`/`free-boat-allocation`
in this increment: retain original geometry/cap, try remaining sites only after
unreachable probes, stop after the first launch attempt, and retain original /5
versus win-fix probe formulas. Install no shared parent during its awaits.

Verify actual generated class parity, route alternatives/holds, boat destination
and amount alternatives, bookkeeping, bounded candidates, async ancestry and
stale probes. No live-game strength claim.
