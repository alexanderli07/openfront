# Outgoing ship response ownership

Centralize transport loss and trade capture target/response choices with 79
unchecked targets plus wait. Keep exact original lazy predicates, getter order,
transport disabled gate and observation scans. Original responses: transport
active keep, lost forget or retaliate-and-forget; trade absent/inactive forget,
own keep, captured retaliate-and-forget. Offer defer for mutations.

Retaliation remains fire-and-forget. Default removal occurs immediately after
requesting retaliation even when a build fails normally. Nested policy holds
prevent removal, late command declines restore only the same provisional entry.
Per-actor per-mode per-unit tokens protect newer observations and responses.
No asynchronous parent scope is retained. Target/response/retaliation/command
trace ancestry is explicit. A central tracking phase loop owns transport, trade
and incoming order; synchronous holds stop later phases and reset next call.
Observation adds may occur before a hold; observation is distinct from response.

Verify original/generated parity, disabled transport continuation, multi-target
iteration, root/nested/late holds, ordinary failures, token races, ancestry and
windows. Full tests, comparison, syntax and generated freshness are required.
