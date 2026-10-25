# Finish social and alliance event ownership

Complete message/pool and attack-emoji selection, cooldown eligibility/commit,
winner marking, incoming event materialization, request/renewal response and bot
event-ignore bookkeeping. Preserve original random draws, lazy predicates,
created-at fallbacks, button callbacks, exception boundaries and default updates.
The pasted sendEmoji method samples but emits no command; retain that behavior.

Scoped social requests commit baseline cooldown/gameOver updates provisionally;
nested policy holds undo only their own updates and stop later casual phases.
Normal eligibility/chance failures retain baseline state. Policies cannot enable
otherwise invalid targets. Event loops use bounded target/response choices;
wait/error stops the pass before actioned marks or later responses. Existing
alliance rules and callbacks remain shared and explicitly parented.

Audit all eight generated behavior classes, including direct helper and callback
paths. Distinguish measurements/observations from action decisions. Full parity,
hold/failure/ancestry tests and independent review required. Build, comparison,
syntax and freshness required. Live-match trace review requires a real exported
trace, never synthetic test output; report any outstanding source limitation.
