# OpenFront client API audit and repair — 1.84.43

The main failure was the engine/client configuration split, not renamed attack
event fields. The live console showed `boatMaxNumber is not a function` inside
`maybeOpportunisticBoat`. That stage precedes donation and ordinary attacks, so
its exception aborts both even when their own commands remain compatible.

The loaded client's read-only inventory independently confirmed the missing ship,
placement and nuclear methods; remaining rules were checked against upstream.
The compatibility adapter now supplies the current engine
rules when a native method is absent. Existing native methods retain their
receiver and arguments, and native config objects are not modified.

| Area | Engine rules restored |
| --- | --- |
| Transports | `boatMaxNumber`: 3, or 0 when transports are disabled |
| Placement | `trainStationMinRange`: 15; `defaultSamRange`: 70 |
| Spawn | `minDistanceBetweenPlayers`: 30 |
| Nukes | Targetable range 150; atom/hydrogen speed 10, MIRV 15, warhead 22 |
| Warships | Targeting range 130, shell interval 20 ticks, retreat health 75%, shell veterancy bonus 20% |
| Match modifiers | Water nukes and gold multiplier from match settings |
| Starting gold | Configured base plus host bonus; tribes receive zero |

The prior missing-method warship fallback was only 8 tiles, versus the current
engine's 130. Restoring this method corrects that observation range as well as
preventing hard failures in the transport and placement paths.

Source: public upstream commit `420f27a33a0e321a4258062558da38554eea1661`:

- [Client configuration](https://github.com/openfrontio/OpenFrontIO/blob/420f27a33a0e321a4258062558da38554eea1661/packages/engine-lib/src/configuration/Config.ts)
- [Engine configuration](https://github.com/openfrontio/OpenFrontIO/blob/420f27a33a0e321a4258062558da38554eea1661/packages/engine/src/configuration/EngineConfig.ts)
- [Command event definitions](https://github.com/openfrontio/OpenFrontIO/blob/420f27a33a0e321a4258062558da38554eea1661/src/client/Transport.ts)

## Other interfaces checked

Generated event discovery passes against constructor fixtures transcribed from
the current upstream source for attack, spawn, boat, warship movement, troop
donation, embargo, emoji and target events. Their identifying field signatures
remain compatible. This does not confirm a server accepted any action.

The used PlayerView border/buildable/transport-probe methods, unit accessors and
GameView geometry interfaces remain compatible with the adapter. Unit costs also
moved into EngineConfig, but the bot already uses local structure/warship formulas
and worker buildable quotes for strikes; no speculative cost shim was added.

GameView has `gameOver()` rather than `getWinner()`. The existing wrapper returns
null when getWinner is absent. Winner identity and replay/end-of-game automation
handling remain a separate limitation; this repair does not invent a winner.

## Evidence and limits

`work/diagnostics/2026-10-18-live-compatibility-probe.txt` records a side-effect-free
probe against the loaded game: boat cap 3, SAM range 70, rail minimum 15, warship
range 130, shell interval 20 and MIRV speed 15. The original native boat method
remained undefined, confirming no runtime patch was installed during inspection.
The page was in replay when this probe was run; it is API-read validation only.

The attack-chain regression uses the real generated AttackBehavior: raw client
config throws at the transport step, while adapted config reaches both donation
and the main attack. Tests also cover disabled transports, native receiver
preservation, weapon types and host starting-gold rules.

Install `openfront-helper.user.js` version 1.84.43 and export a fresh trace in a
live private match to verify actual actions. The running old script was not
replaced or made to emit commands during this audit.
