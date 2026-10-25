# Match-summary coverage and delayed identity

Input: `openfront-match-2026-10-25T18-07-55-700Z.json.zip`, actual JSON 250,969 bytes, ZIP member compressed to 22,040 bytes. The `__MACOSX/._...` resource-fork member was ignored.

Coverage: first tick 6, last tick 12,988. First observed state has zero owned tiles; last has 51,113 tiles, 7 cities, 6 ports, 3 factories and one SAM. The summary contains 826 compact events, including 549 client command outcomes and 78 infrastructure deltas. It spans the beginning through export, with no evidence in this format establishing whether the match had ended. Commands report submission rather than server acceptance. This is version 1.84.53, before the 1.84.54 opening waves.

Persistence failure confirmed in export: playerId null, storage memory, restored false, lastSavedAt null, unsavedChanges true, error "Game/player identity unavailable; memory-only session". The exported summary is intact, but this recorder would not survive refresh. Bootstrap resolved identity once during bot creation and the archive never retried it.

Fixed in 1.84.55: bootstrap supplies a live identity resolver using the current game player. Autosave/export retries incomplete identities, then restores and merges any existing matching history before enabling serialized writes. The in-memory early events are preserved. Concurrent flushes wait for identity restoration, foreign game identities are rejected, and unsupported stored schemas cannot be overwritten. No gameplay algorithm changes.

Validation: three delayed-identity regressions plus existing persistence/summary tests; full suite 1,720 tests passing. 25 strategy scenarios, zero unexpected outcomes; syntax, gateway audit and build freshness pass. The fix is automated-test verified, not live-browser persistence verified. Install on the computer actually running the game.
