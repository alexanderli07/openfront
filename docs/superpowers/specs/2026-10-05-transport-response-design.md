# Incoming transport responses

Expose tracked incoming transport order in windows of 79 plus wait, then the
original lazy response: forget vanished/inactive/retreating inputs, keep already
handled/allied inputs, mark near/covered threats handled, or request retaliation.
Each response offers the original action and optional defer plus wait. Default
gates, two observation scans, zero-target truthiness, <20 distance, defense
coverage predicates and first retaliation break remain unchanged.

Policy holds/errors stop the pass before response mutations. Spawn/retaliation/
movement/command holds must prevent the handled mark. Async requests preserve the
original immediate provisional handled mark, but a later policy decline revokes
it only if its per-ship request token is still current. Ordinary failed quotes,
emit failures or probability skips retain baseline bookkeeping. Observation sets
can still learn the current scan. Use synchronous scopes and explicit per-request
decline callbacks; no parent scope spans an await. Protect newer handled marks
and forgotten/recreated inputs from old async callbacks.

This increment covers incoming transport responses, not outgoing loss/trade
retaliation or invasion/loss/trade source ranking. Verify actual generated loops,
default parity, alternate order/defer, windows, nested/late holds, token races,
parents/replay and reset/stale behavior.
