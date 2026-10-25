# Central bot-target selection

Next authorized migration: attackBots chooses among explicit bot targets through the existing decision engine. This is a bounded part of attack planning, not the full attackBestTarget chain or all land attacks.

Extracting this routine produces concrete alternatives without eagerly running counterattack, diplomacy or naval routines with side effects. Keep the original eligibility filter (nearby player, unfriendly, Bot), structure-first/density ordering, difficulty/random parallelism call, botAttackTroopsSent reset, and sendAttack executor. The selected live player object remains outside strategy inputs. The legacy policy selects the lowest original rank; each attempted target consumes one difficulty slot even if sendAttack returns false. The result remains botAttackTroopsSent > 0, not executor truthiness.

Candidates include target ID, troops, tiles, structure presence, density and original rank. Wait stops the wave. A policy can choose another candidate without changing troop allocation or sendAttack. After awaited attempts, skip targets that became friendly, non-Bot or explicitly dead, recording the reason; they consume a slot. Retain initial priority order rather than reranking mid-wave, matching the original precomputed list. Current actor/game ownership and enabled state are checked before any attempt.

The engine permits 80 candidates: show up to 79 remaining targets plus wait in original priority order. Snapshot records total remaining targets, window size, hidden count, initial attempt limit and attempts consumed. Refill the window after each attempt; do not truncate the entire wave. Policies compare the visible window only. Original policies can complete an Impossible-difficulty 100-target wave.

Use runtime activePlans for parentDecisionId linkage from selection to command; execution retains existing command checks. Plan results distinguish selected target attempted, skipped, exception and wait, without claiming a server-accepted attack. Empty target sets produce an explicit wait decision without resetting the prior botAttackTroopsSent value, as in the original early return.

Validate pure ordering, alternate policy, wait, target identity, failed attempts, stale owner/target, exceptions, replay and >79-target waves. Compare original and rebuilt attackBots using the real class and sendAttack fixtures, including difficulty/random-call and troop bookkeeping parity. No game-rule changes or improved strength claims. Existing structure planning remains covered by the full regression suite.
