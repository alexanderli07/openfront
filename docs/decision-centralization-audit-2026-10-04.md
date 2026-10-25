# Decision centralization audit

Audited the generated **1.84.25** userscript against the current source planners
and immutable vendor baseline on October 4, 2026. This is a source audit; live
playing strength and runtime performance remain unverified.

## Finding

Command gating is in place, but complete decision centralization is not finished.
The builder verifies integration of 17 baseline event-intent sites, 9 build sites
and 3 alliance callbacks. Inspection of the eight generated behavior classes found
no remaining raw `emitIntent(...)` or `.sendBuildOrUpgrade(...)` calls there.
This does not cover every direct relation/emoji mutation, and it does not make
every upstream choice a policy decision.

The central engine can accept or hold a supplied command. A helper that has already
chosen one troop amount, spawn tile or arc still restricts the policy to that
proposal. A rule trace showing its return value is observation, not selection.

## Already centralized

- Main full/build-only turn phases and outer attack sequence.
- Structure phases, build versus upgrade, upgrade targets, defense sites and
  economic placement; first-SAM reservation and owned/allied factory-line policy.
- Attack purposes, player/bot targets, incoming attackers, pockets/islands,
  assistance and betrayal targets.
- Tactical/opportunistic boat origins, searches, destinations and allocations.
- Warship deployment, infestation fleets/units, home ports/water tiles, patrol
  zones/ships, combat targets, retreat/escape destinations and nuke evasion.
- MIRV/nuke purposes, weapon, ranked MIRV/density/crown/team player choices,
  strike site, SAM target and silo upgrade. Allied-request/hostile-relation nuke
  searches still select their first matching player locally (see below).
- Alliance evaluation rules, donation recipients/amounts and normal/far outreach.

These domains still use baseline formulas and feasibility checks unless the
adaptive placement/SAM policy explicitly changes ranking. They do not implement
a new general investment or combat algorithm.

## Remaining choices, in recommended order

Progress after the audit: **1.84.26** centralizes land reserve, final land force,
forced initial attack force and bot difficulty allocation. Default formulas and
failed-emitter accounting remain unchanged; policy holds restore bot budget and
stop an enclosing attack pass. The original bot quote remains the wave budget
charge even if the final force is capped or reduced, matching original counter
attack accounting.

**1.84.27** completes the standard dispatch group: land/boat routing, targeted
destination/amount and nearby free-land probe/amount choices now cross the engine.
Targeted boats retain one chosen shore probe; free-land boats retain their original
unreachable-site retries. Async ancestry and policy holds use captured local
scopes. The actual transport spawn remains the game's reachability service.

**1.84.28** centralizes embargo target/action and incoming relation target/response
choices. Original lazy team/difficulty/trade rules supply start/stop eligibility;
keep defers the change and wait/error stops the pass and enclosing turn. Fixed
-20/+20 effects retain the original tracking set and mutation order. Actual
failed emitters retain original label behavior; command-policy holds skip labels.

**1.84.29** centralizes spawn action/cadence, source, companion, heatmap spot,
nearby adjustment and random site choices. It preserves first-valid geometry,
ordinary first-valid sampling and all 1,000 smart trials with first score ties.
Distinct bounded scored pools retain the original winner; untested nearby
alternatives are checked only when selected. Policy holds restore tick/key and
stop source fallthrough. The geometry scan does not log a choice per invalid
coordinate. Existing score/validity/top-key helpers remain measurements.

**1.84.30** centralizes the remaining nuclear player searches: ally sources,
requested players, hostile relations, duel opponents and majority leaders.
Original first-eligible ordering, relation/capacity thresholds and lazy checks
remain. Bounded windows can scan beyond 79 inputs; explicit waits/errors stop
fallback and reset next lookup. Player search decisions link to their purpose
and ally source. Launch choices and delivery ancestry remain the next increment.

**1.84.31** centralizes nuclear arc probes with lazy up/down and upgrade-margin
ordering. Wait/error/stale results propagate through sampling, salvo site scans,
SAM clearing and helpful-silo searches; explicit site/SAM/upgrade parents reach
their arc probes. Trajectory/interception and flight measurements remain local.
Salvo ordering, counts, launch slots/timing and full delivery ancestry remain.

**1.84.32** centralizes salvo planning: original silo queue approval, arrival
window choice, supported bomb count and complete staggered schedule approval.
Default first ties, slot prefix, waits, costs and failure shapes remain. Empty or
insufficient measurements retain normal capacity fallback; explicit policy
stops abort enclosing site/SAM scans. Planning parents form order -> window ->
count -> schedule. Full player-to-launch ancestry remains.

**1.84.33** connects selected player -> weapon -> site -> approved schedule ->
action -> launch commands. Sampled arcs share the weapon parent; explicit
selected-site-arc links identify their contribution to the selected site. SAM
launches inherit their final schedule chunk, and MIRVs inherit ranked-player
decisions. Local invocation collectors and result-object provenance preserve
return shapes and separate overlapping passes; synchronous lookup scopes reset.

**1.84.34** centralizes early tracking/retaliation, dodge, patrol and combat phase
selection. Original outer gates and default order remain; per-phase settings are
lazy and the smart block's entry is remembered exactly once. Phase waits/errors
stop the maintenance pass while ordinary cadence stays available. Temporary
synchronous warship command parents restore afterward. Nested action holds,
threat-source ranking and handled/service-state response ownership remain.

| Group | Concrete source evidence | Why command gating is insufficient | Next boundary |
| --- | --- | --- | --- |
| Standard attack dispatch (completed in 1.84.27) | `AttackBehavior.sendAttack`, `sendLandAttack`, `forceSendAttack`, `calculateBotAttackTroops`, `sendBoatAttack`, `sendBoatAttackToNearbyTerraNullius` | The audited local routing, reserve, allocation and shore choices now expose central candidates. Original gates and measurements remain local facts. | Next gameplay changes can use these domains; no further standard routing/allocation migration is planned. |
| Embargo and relation responses (completed in 1.84.28) | `NationBot.handleEmbargoesToHostileNations`, `embargoIsWorthIt`, `updateRelationsFromEmbargos` | Target/start/stop/keep and incoming penalty/restoration/keep are now central choices. Original lazy rule helpers supply eligibility, and the selected effect owns tracking updates. | Next gameplay changes can use these domains; no further embargo loop migration is planned. |
| Spawn selection (completed in 1.84.29) | `NationBot.pickSpawnCenter`, `currentSpawnTopKey`, `doSpawn`, spawn section of `tick` | Spawn action, source, heatmap/nearby and random selections now expose central candidates while score, validity and top-key helpers retain original measurements. | Next gameplay changes can use these domains; no further spawn selection migration is planned. |
| Nuclear player searches (completed in 1.84.30) | `strike-target-planner.js` duel, majority, allied-target and hostile searches | Duel/majority single choices, ally sources, requested players and hostile relations now expose central candidates. Original eligibility checks remain lazy facts; waits/errors stop the whole lookup. | Delivery ancestry and detailed launch choices remain separate work. |
| Nuclear delivery ancestry (completed in 1.84.33) | `NukeBehavior.maybeSendNuke`; `strike-planner.js` selected-salvo execution | Player/weapon/site/schedule/action/command decisions are linked with explicit parents; selected arc provenance is an explicit source edge. | Trace review can now follow the selected player through delivery. No further ancestry migration is planned for these paths. |
| Warship maintenance phases (completed in 1.84.34) | Early warship block in `NationBot.tick` | Tracking/retaliation, dodge, patrol and combat now expose central phase candidates before ordinary cadence. | Threat-source/response decisions remain separate work. |
| Incoming transport responses (completed in 1.84.35) | `trackIncomingTransportsAndRetaliate`, `warship-transport-planner.js` | Central target and response decisions own tracked/handled state changes. Nested holds prevent marking, and late declines revoke only the same provisional request. Original failures retain baseline marks. | No further incoming-loop migration is planned. |
| Warship patrol source ranking (completed in 1.84.36) | `findInvasionThreat`, `findLossZone`, trade-lane lookup in `smartWarshipPatrol` | Invasion/loss/trade choices now expose central candidates and source provenance. A policy hold/error stops the enclosing patrol; empty measurements still permit later sources. | Original observation/measurement helpers remain local facts. |
| Outgoing warship responses (completed in 1.84.37) | `trackShipsAndRetaliate`, `trackTransportShipsAndRetaliate`, `trackTradeShipsAndRetaliate` | Central phase/target/response choices own removal. Nested holds prevent removal; late declines restore only the same per-unit request. Original observation scans, gates and ordinary failure behavior remain. | No further outgoing-loop migration is planned; observations remain local facts. |
| Casual social phases and recipients (completed in 1.84.38) | `EmojiBehavior.maybeSendCasualEmoji`, ally/traitor/rat/nearby and winner-national recipient selection, small-attack loop | Central phase and recipient decisions preserve original random order and gates. Holds/errors stop the pass. Recipient and small-attack action ancestry is explicit. | Message samples and response bookkeeping remain separate work. |
| Social messages and event handling, for literal all-behavior centralization | `EmojiBehavior.sendEmoji`, `maybeSendEmoji`, `maybeSendAttackEmoji`, `shouldSendEmoji`, `congratulateWinner`; incoming/renewal event loops and `handleAllianceRequestsFromBots` | Message samples/attack-emoji choices, cooldown/gameOver responses and some event-ignore/actioned bookkeeping remain local. Incoming/renewal acceptance rules and command callbacks already cross the engine. | Message/cooldown/winner responses first, then event-response ownership. |

## Helpers that can remain local

Reading ownership, health, troop capacity, income, cooldown timestamps, unit state,
water components, distance, build quotes and transport reachability does not need
another decision domain. Neither does maintaining a cache of observations.

Trajectory, interception and battle simulation can stay local while returning
facts for policy candidates. Existing configurable thresholds can remain baseline
facts during migration. A helper that returns only the preferred target, amount,
arc or action needs a selection boundary; it is not merely a measurement.

## Completion criterion

For each gameplay choice above: expose its meaningful alternatives and wait to
the engine, preserve default behavior, link child decisions and commands, and
ensure holds/errors cannot update action bookkeeping or invoke another algorithm.
Keep baseline/generated parity and alternate-policy tests for the migrated paths.
Do not equate a nonempty `coverage.rules` list with complete decision ownership.

The next implementation should cover **social messages/cooldowns/winner responses, then event-response bookkeeping**. After the remaining
groups, perform another source audit and a private live-match trace review before
claiming full implementation or stronger gameplay.

The remaining implementation groups were completed in 1.84.39. See the
[October 5 final audit](decision-centralization-audit-2026-10-05.md) for the current
ownership assessment and outstanding live-match validation. The verification
below describes the original October 4 audit snapshot.

## Verification for this audit

- Generated userscript matches source modules (`node scripts/build.js --check`).
- JavaScript syntax check passed (`node --check openfront-helper.user.js`).
- Read-only inspection found no raw event-intent/build calls inside the eight
  generated behavior classes; the checked builder still verifies baseline counts.
- No gameplay source changed during this audit; the userscript remains 1.84.25.
