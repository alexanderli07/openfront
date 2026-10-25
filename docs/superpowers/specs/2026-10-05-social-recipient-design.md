# Social phases and recipients

Centralize casual social phase order and recipient choices without changing
message selection or cooldown rules in this increment. Keep the gameOver entry
gate, original eight-phase order, lazy method chance/eligibility checks, and
continuation through later phases when congratulateWinner sets gameOver.
Random recipient selection consumes the original draw before proposing its
sample first, then other pool entries through bounded windows. Winner-national
ranking remains original; selection now crosses the policy boundary. Small
attack observation iteration uses bounded unchecked target windows with exact
original eligibility and message probability checks after selection.

Wait/error stops the social pass, before later phases or cooldown mutation on
the held recipient path. Standalone lookups return null on hold and reset their
scope. Synchronous selected-recipient provenance parents the selected action.
No live players reach policy candidates. Original sendEmoji implementation and
gameOver/cooldown response semantics remain explicit follow-up work.

Validate baseline random calls/target/message order, gameOver behavior, empty
and large pools, alternate selection, policy failures and scope/parent reset.
