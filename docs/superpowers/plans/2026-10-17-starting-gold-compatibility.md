# Starting gold compatibility fix

Confirmed live error: `this.game.config(...).startingGold is not a function`.
The original config proxy binds native methods but supplies no compatibility
method when the browser config lacks this server-side function. The only legacy
consumer is the high-starting-gold structure check.

Plan: preserve native startingGold when available. Otherwise read the explicit
startingGold scalar from config/gameConfig; the optional match modifier defaults
to zero when absent. Convert valid nonnegative integer values to bigint, reject
malformed values explicitly, and never use the player's current gold balance.
Preserve maxTroops unwrapping and native method receiver binding. No policy or
placement changes. Test through the generated createGameApi, not a stubbed config.

- [x] Write failing generated-adapter regression and compatibility cases.
- [x] Add source helper and checked builder integration; preserve vendor baseline.
- [x] Run tests, independent review, comparison, syntax, build freshness.
- [x] Release generated userscript 1.84.41 with live-validation limitation.

Six regressions cover the actual generated API, native receiver/argument behavior,
maxTroops unwrapping, zero/ordinary/high gold, malformed values, and the real
structure-opening predicate. The opening fixture initializes its cache to null,
matching the production constructor. Independent implementation review found no
actionable issues. Live installation and post-fix trace validation remain pending.

Evidence: work/diagnostics/2026-10-16-live-api-failure.json. Upstream match modifier
schema exposes optional startingGold:
https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/game/Game.ts
