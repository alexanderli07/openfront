# Embargo and relation response centralization

Continue the authorized incremental migration with baseline gameplay unchanged.
Expose nonself player targets in original order in bounded windows. Evaluate the
selected target using the exact lazy baseline branch, then expose start, stop,
keep and wait. Start/stop eligibility follows that original branch; keep skips
the target and continues, wait/error stops the pass and an enclosing turn.
Policies can change target order or decline a proposed state change without
bypassing original team/alliance/trade feasibility rules.

For incoming embargo relation effects, centralize target and response. Preserve
original condition order and fixed -20/+20 effects. Track applied penalties using
the existing set, only after the selected updateRelation call. Keep/wait must
not mark a penalty applied/reversed. No alternative effect amount is introduced,
since the set cannot track partial penalties correctly.

Retain original trade-station/land-share helper, null-player return, difficulty
and team branch, outgoing command helper labels and actual emitter-failure
semantics. Command policy holds skip labels and stop the pass; no fallback.
Use synchronous parent scopes and per-turn stop scope with next-turn reset.
Direct calls stop only their own pass. No changes to unrelated turn domains.

Verify generated-class baseline matrices, target reordering, keep/hold/error,
relation bookkeeping, command ancestry, >79 targets, failed emitters, nested
turn stop/reset and stale controllers. Preserve vendor and regenerate artifact.
