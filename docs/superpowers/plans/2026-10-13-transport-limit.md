# Transport limit implementation plan

Goal: Reserve the third transport slot for manual control.
Architecture: runtime command eligibility plus per-controller reservations;
bootstrap supplies transport unit type and boat intent identification.
Non-Git workspace; no commits or worktrees.

- [x] Add runtime regression tests and confirm they fail.
- [x] Implement gateway limit/reservation reconciliation and bootstrap bindings.
- [x] Verify failure/hold/arrival semantics and generated integration.
- [x] Update version/docs; run suite, comparison, syntax and freshness checks.

Release 1.84.40. Review found and fixed same-destination manual/pending ambiguity
using a read-only launch observer. Independent follow-up review found no further
actionable defects. Full suite: 1,596 passing tests. Seven comparison scenarios:
two intentional existing differences, zero unexpected outcomes. Live browser
EventBus integration is not yet tested. Original vendor author-only drift was
preserved in a metadata-edited backup and restored from the hash-verified paste.
