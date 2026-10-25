# Engine/client API compatibility audit

Goal: restore integration after engine-only config methods disappeared from the
browser Config. Live console confirms boatMaxNumber throws inside the earlier
opportunistic-boat phase, preventing ordinary attack and donation execution.

Audited upstream commit: 420f27a33a0e321a4258062558da38554eea1661.
Sources downloaded under work/diagnostics from packages/engine-lib Config,
packages/engine EngineConfig, client Transport/InputHandler/GameView/PlayerView/
UnitView and engine-api types. A read-only console inventory independently
confirmed the relevant methods are undefined in the loaded game.

Compatibility uses the upstream constants/rules only when the native method is
absent; native methods keep their receiver and arguments. Cover boatMaxNumber,
trainStationMinRange, defaultSamRange, defaultNukeTargetableRange, nukeSpeed,
warshipTargettingRange, warshipShellAttackRate, warshipRetreatHealthPercent,
warshipVeterancyShellDamageBonus and minDistanceBetweenPlayers. Restore starting
gold host-cheat and tribe handling according to EngineConfig as well.

Command event constructors retain their field signatures. Unit costs moved to
EngineConfig too, but the bot already uses its own structure/warship formulas and
worker buildable quotes for strikes, so do not add a speculative cost replacement.
GameView/PlayerView coordinate/unit/border/buildable interfaces used here remain
compatible. GameView exposes gameOver rather than getWinner; the old wrapper
already treats absent getWinner as null. Record this separate limitation.

- [x] Failing generated-config regressions and interrupted attack-chain regression.
- [x] Implement source adapter with upstream-backed compatibility functions.
- [x] Check current event constructor discovery and native argument preservation.
- [x] Full suite, comparison, syntax, review and generated freshness; release 1.84.43.
- [ ] Live verification after the user installs the generated script (pending).

No automatic commands, live policy changes, or installs are used for inspection.

Independent implementation review found no actionable defects and passed all 11
config compatibility tests. A side-effect-free live probe of the helper succeeds
against the currently loaded client; actual new-version dispatch remains pending.

Release verification: 1,620 passing tests; nine comparison scenarios with four
existing intentional differences and zero unexpected outcomes; syntax and build
freshness pass. The browser was returned to the game after read-only inspection.
