# OpenFront Helper: decision framework

Install `openfront-helper.user.js` (1.84.62) in Violentmonkey. It is a standalone build of the original 1.84.0 bot with a central turn coordinator plus structure planning and placement, attack purposes, player/bot and geographic targets, alliance decisions, ally assistance, betrayal, opportunistic naval actions, distant landing-site selection, warship decisions and main strike planning. It provides one command decision interface and structured tracing. The active `adaptive-v1` policy adds a safe two-team opening: finish reachable wilderness before country attacks, build two physical ports and one city, then reserve for the first SAM. Factory/landlocked starts require two physical cities and one factory; disabled buildings are excluded. Later economic buildings group on owned or allied factory lines. Other decisions retain the established rules through `legacy-v1`. The previous economy experiment is archived and excluded from the build.

## Install and update (1.84.62)

[Install or update OpenFront Helper](https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.user.js) with Violentmonkey enabled. Existing manually pasted or locally imported copies need this URL install once to acquire update metadata. Keep the same script name and namespace; the manager can replace the existing entry. Do not delete the old entry first. This migration does not change the bot's site-local settings.

After installation, Violentmonkey's **Check for updates** / refresh control fetches the lightweight metadata and downloads the full userscript when its version increases. Enable update checking for the script in its manager settings. A custom update/download URL override can take precedence over metadata; clear any old override or point it to this repository. The published endpoints are:

- Metadata: https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.meta.js
- Script: https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.user.js

Use GitHub's raw install link, not its file-view page or a local copy. Reload an OpenFront game tab after updating to run the new script. GitHub may briefly cache recently published content. Both endpoints must show the same version before announcing a release. No gameplay rules changed in 1.84.62.

## Reject enclosed-water ports (1.84.61)

Every bot port candidate must have a verified water connection to open sea. The guard applies to random shores, factory-line samples and rear placement before scores are compared. It rechecks the actual worker-quoted location and final build or upgrade site, including explicit legacy-strategy selection. A high safety or factory-line score cannot override invalid water access. Direct ocean shores and verified sea-connected rivers qualify; enclosed lakes and unproven topology do not. Manual game controls are unaffected.

The water observer shares bounded incremental component searches: up to512water tiles per call and2,048per game tick, with at most16,384visited tiles per component and64cached components. Completed negative results refresh after40ticks; unfinished searches survive cache pressure from other lakes. A temporarily unresolved connection holds the port purchase rather than guessing.

Lake-only spawns use the city/factory opening, and existing enclosed-water ports do not satisfy the useful-port count. Existing ports are not removed or moved. Tests cover high-scoring lake candidates, native quote relocation, final new-build/upgrade guards, sea-connected rivers, unknown water and cache starvation. Live placement remains unverified.

## Nearby wilderness river crossings (1.84.60)

The adaptive two-team opening can send a small neutral crossing before its normal wilderness land wave, so free land on the current bank no longer prevents crossing a river. The same local crossing check runs before distant enemy probes later. Each boat sends floor(current troops / 100), without the old 8,000-troop minimum or army-fill gate. It does not trigger a large beachhead reinforcement. Automatic transport capacity and home conservation still apply.

A bounded search samples up to 24 owned shores, follows water for up to 12 steps, and requires at least eight free non-fallout land tiles on the destination bank. It excludes locally connected same-bank wilderness and prefers shorter crossings. Up to two worker spawn checks run per attempt with 500ms timeouts; the actual spawn must be within 24 Manhattan tiles of the target. Failed shores back off for 30 ticks and crossing attempts are spaced ten ticks. This local search and spawn-distance check do not guarantee an exact maximum travel time around obstacles.

Ownership, feature permissions, troop amount, threat posture and transport capacity are checked again after asynchronous lookup. A failed crossing leaves the land wave available. Confirming that a requested landing is now owned resumes the saved early expansion checkpoints; unrelated later wilderness does not reset them. Compact Match summary records crossing submissions and confirmed landings. Offline tests pass; live river-crossing behavior still needs testing.

## Safe rear support and home conservation (1.84.59)

Adaptive two-team support becomes available after reachable wilderness is cleared, without waiting for economic buildings. While home is safe, keep 25% troop capacity and donate useful top-ups to teammates in combat or on an enemy border below 65% capacity. Gifts stop at the recipient's 65% line; smaller chunks of about 1% donor capacity are allowed. Donation checks can submit once per second and run before potentially slow opportunistic transport searches. Shared pending troop commitments prevent donations and boats from spending the same army twice.

Enemy 1% probes precede larger beachhead reinforcements while home is safe; opportunistic checks can run every 600ms. The two automatic transport slots, manual third slot, destination deduplication, reachability checks and retry backoff remain. A short-lived failed search still cannot establish a reachable landing, and filled transport slots limit dispatches regardless of throttle.

The home observer anchors on the oldest owned SAM, city or port, falling back to an initial border. It inspects borders within 220 Manhattan tiles, exact enemy adjacency, and sampled hostile land up to 48 tiles away. Incoming hostile attacks and enemy transports within 60 tiles of a landing in this home area pause automatic donations and transports; ordinary land attacks/counters continue. The observer holds for 50 ticks after danger, while the existing incoming-attack donation guard may retain its longer recovery hold. This is a bounded home-area approximation; it does not compute the entire connected mainland. Remote colonies do not automatically mark home threatened. Missing required geometry conserves. Other game modes retain their existing support rules. Match summary records posture transitions and aggregates conservation holds. Alliance settings are unaffected.

## One-SAM focus and emergency funding (1.84.58)

Exposed buildings no longer raise the planned SAM level or hold savings. Preparation focuses on the highest-level owned launcher: level two after development, then the remembered salvo-capacity target. Emergency upgrades still consider whether extra range makes an incoming atom or hydro interceptable, including targets on neighbouring land within the launcher's current/next-level area.

A useful emergency upgrade can spend the 3m reserve: a 3m quote needs 3m available cash, plus any pending purchase commitments. The 6m threshold applies to a 3m planned purchase that must leave 3m afterward. Emergency candidate logs include actual cash, cost, protected reserve and pending commitments. Already-defendable in-range strikes do not trigger unnecessary emergency purchases. Extra upgrade capacity starts cooling rather than providing an instant missile.

Competing nukes no longer cause an unconditional rejection. The predictor reserves a full slot for every other potentially reachable strike and requires enough remaining capacity and time for the identified target; hydros are considered first. This can establish a useful upgrade for one threat without claiming the entire salvo is defended. Unknown trajectories remain conservative holds.

## Planned SAM upgrades (1.84.57; building-coverage triggers superseded in 1.84.58)

After the developed economy reaches its reserve stage, the central defense planner prepares the main existing SAM to level two. It increases the target when higher levels would cover exposed owned cities, ports, factories or silos, or when recent incoming salvos require more capacity. Allied SAM coverage counts for geometry. Coverage planning searches through level eight and skips unreachable sites rather than endlessly upgrading; observed salvo size is remembered for 1,800 ticks and capped at eight slots. Upgrades happen one level at a time and pause during an existing range ramp. Manual upgrades satisfy the same targets.

Planned upgrades leave the fixed 3m emergency reserve intact. While an upgrade is needed, optional purchases also preserve up to 3m for its next quoted cost, so continued development cannot consume the savings. A 3m planned upgrade therefore needs 6m cash, including pending purchases. Useful emergency upgrades can still use the emergency reserve. Uncertain state or an unproven multi-strike interception never becomes a claim of guaranteed defense. No extra SAM construction is introduced by this release.

The previous multi-strike coverage check could credit the same ammunition independently to several nukes. Such salvos now remain uncertain for emergency purchases and feed preparation instead. Compact match history preserves upgrade mode, target and reason; repeated saving checks stay aggregated. Offline tests establish these decision rules, not live match strength.

## Staged economy and reactive SAM defense (1.84.56)

Safe coastal starts build two ports and one city, then complete their first SAM, then develop toward four ports and three cities. Landlocked starts use two cities and one factory before the SAM, then four cities and three factories. Economic buildings under construction count toward physical goals; upgrades do not replace those goals. Disabled building types are excluded. After development, preserve a fixed **3,000,000 gold** reserve and buy optional buildings, warships or weapons only from surplus. Actual quotes and pending purchase commitments determine affordability. Reserve protection survives economic losses and a new frontline; a destroyed SAM can be replaced using the reserve without unlocking it for unrelated purchases.

SAM upgrades require a central reactive decision: a currently incoming hostile strike must become interceptable in time because of that upgrade. Existing own/allied coverage and active interceptors prevent unnecessary spending. Prediction accounts for the native range ramp, missile cooldown and travel time; a new level adds a cooling slot rather than an immediately ready missile. Late, unknown or competing trajectories are skipped conservatively. MIRV carriers are not interceptable; their released warheads can be assessed. These checks reduce speculative spending but do not guarantee a live interception or handle every salvo. Match summary includes useful upgrade decisions and aggregates reasons for holding.

Automatic transport sources share destination reservations and increasing retry cooldowns when no matching ship appears; duplicate active destinations are blocked. Same-tick donations to the same ally are deduplicated. These operational holds allow later attack/donation work to continue. Island fleet saving no longer freezes the staged economy. The 20% opening expansion schedule remains in place. Manual transport requests retain their reserved third slot.

Version 1.84.44 implements the first two-team opening increment. An enemy human/nation land border or incoming attack retains the existing front-line rules. Safe openings prefer port → city → second port → first SAM; an optional third port/second city is purchased only when its cost leaves the SAM budget. Buildings under construction count physically; upgrades do not satisfy additional-building goals. The wilderness gate covers country and boat landing routes regardless of the old phased-opening toggle. Decisions include opening stage, border/wilderness facts and building counts.

Version 1.84.45 adds all three geography increments for adaptive two-team games:

- Group/coastal spawning measures connected local expansion room, useful water, teammate distance, hostile distance and map edges. Companion overrides and team spawn bounds remain authoritative.
- Front-line cities, ports and factories receive additional rear placement candidates; rear safety bands outrank factory routes, then route/SAM benefits decide within a band. Safe-start placement retains its existing pre/post-SAM behavior.
- Confirmed island fronts target two defensive warships, or three under incoming transport threat. Land connectivity is scanned incrementally; peninsulas and unrelated enclaves do not trigger island spending. Deployment preserves the next economy/SAM purchase, uses worker quotes, retries bounded alternate sites and tracks pending builds. After opening protection, ordinary spending can hold to fund the fleet.
- Healthy ships intercept hostile transports landing on same-team land before trade hunting. Retreat, evasion and nearby enemy-warship combat retain precedence. Island patrols add connected-water approaches to team ports.

The central trace records spawn score components, rear distance/bands, topology readiness, fleet targets, economy reserves and decisions. Native feature toggles remain in effect; legacy-v1 stays available for explicit comparison. Automated checks do not establish live gameplay strength. See the [geography specification](docs/superpowers/specs/2026-10-20-team-geography-design.md) and [opening specification](docs/superpowers/specs/2026-10-20-two-team-opening.md).

Version 1.84.47 removes all 26 internal strategy switches, including the separate warship purchase override. Controls has one permission per action; “Warship automation” governs warships. Config contains the building allow-list and a collapsed Advanced tuning section with numeric settings only. Internal rules use their existing recommended defaults, and saved overrides for removed switches are ignored when loading. Saved action permissions, building choices, numeric tuning and panel preferences are retained.

Version 1.84.49 updates the safe factory opening to two physical cities → one factory → first SAM. Established factory economies prefer existing owned/allied factory routes even before their first SAM, while rear safety remains first on threatened fronts. Coastal SAM placement favors close sites near the least-protected owned ports; factory-mode SAMs favor cities. Nearby owned-land samples supplement the normal pool. A bounded SAM quote search spans distance bands and compares actual quoted construction tiles, including native relocations; trace decisions include anchor distance/protection. See the [placement design](docs/superpowers/specs/2026-10-20-economy-sam-placement.md).

Version 1.84.50 repairs stale transport reservations, filters trade-hunting targets by reachable water before ranking, and separates important trace history from repetitive detail. The changes are covered by regression tests; live match behavior still needs confirmation.

Version 1.84.51 adds an adaptive post-opening enemy-probe purpose: after reachable wilderness is cleared, try a reachable distant hostile destination before disconnected/nearby grabs. Beachhead reinforcement remains first. These probes send floor(current troops / 100), without the local-grab troop minimum or fill threshold. Existing opening vetoes, spacing, reachability, throttling and the two automatic transport slots still apply; frontline starts retain their existing order. The original strategy retains its action order.

Version 1.84.52 fixes the adaptive enemy-probe destination: use actual hostile coastline on shared water rather than inland player labels, matching the current worker spawn lookup. Up to four coast alternatives per enemy feed the existing bounded reachability search and centralized 1% launch path. A full automatic transport capacity no longer cancels the later donation/main phases; explicit policy holds still stop their scopes. Donation dispatch now returns false for absent event constructors or failed emission, avoiding false success cooldowns. Recipient threshold (below 65% at the front) and donor reserves remain unchanged. Donation phase outcomes distinguish opening/disabled/throttle holds from command submission.

## Earlier opening expansion (1.84.54)

Safe two-team wilderness expansion now uses scheduled 20%-of-current-army waves instead of waiting above the old capacity reserve. The first wave starts at 20% capacity, then rebuilds to 4k, 5k, 6k, 8k and three 10k waves in total. A first wave that already reaches a checkpoint satisfies it rather than immediately sending twice. There is a ten-game-tick minimum spacing. Afterward, fewer than 512 reachable free tiles maintains the 10k rhythm; more room raises rebuild targets by roughly 25%. A bounded 1,024-tile flood measures the remaining room, and rebuild thresholds are capped at 80% of current capacity.

Actual country combat, counterattacks, enemy fronts and active/sticky combat reserves retain their existing rules. Clearing reachable wilderness retires the opening schedule. Failed/held submissions do not advance it. Central `opening-expansion` choices and result records show current troops, thresholds, stage, amount and measured room; Match summary aggregates its holds and plans. This is a tested heuristic, not a live performance guarantee.

## Full-match history (1.84.53)

Open **Log → Match summary** to download the compact full-game JSON to share. It keeps actual command outcomes and explanations, building location changes/upgrades/losses, repeated errors, and counts/time ranges for repeated plans and holds. Getter calls, unchanged embargo bookkeeping and routine warship movement detail are omitted; counters still reflect received engine events. Commands are client submissions, not confirmed server acceptance. Repeated plans are aggregates, not a replay of every thought.

History autosaves locally in IndexedDB every five seconds, keyed by game and player IDs. Version 1.84.55 rechecks the live player identity on each save when it was unavailable at bot creation, then enables persistence without discarding early events. Refreshing and reattaching to the same match resumes it, including records captured while loading. **Match summary** also exports the latest saved match before a bot is attached. Summaries for different matches stay separate. Nothing is uploaded. Browser storage is finite and can be cleared/evicted; closing or crashing can lose the most recent unsaved seconds. Hidden-page/page-close flushes are best effort. Storage failures produce a log warning and a `persistence.error` in the export; memory export remains usable. Missing identity uses memory only. Unsupported stored formats are preserved rather than overwritten. Old detailed records already evicted cannot be recovered.

**Detailed trace** exports the existing bounded recent candidates/calculations and protected debug history. It remains in memory and does not claim full-match coverage. The compact history has no debug ring eviction; its size grows with meaningful actions and distinct aggregate reasons. For scripting: `OpenFrontBrain.matchSummary()` returns a promise, `downloadSummary()` downloads it, and `saveHistory()` flushes pending history.

## Viewing decisions

Version 1.84.43 repairs the broader engine/client config split: absent transport,
SAM/rail-placement, nuclear-speed and warship methods now use verified current
engine rules through the compatibility adapter. The live `boatMaxNumber` failure
was aborting the sequence before donation and main attacks. See the
[API audit](docs/game-api-compatibility-audit-2026-10-18.md) for checked interfaces,
source provenance, live read-only evidence and remaining validation limits.

Version 1.84.41 fixes the observed `startingGold is not a function` building
failure. The game config adapter preserves a native `startingGold` method when
available; browser configs without it use the configured initial-gold value.
The adapter never substitutes the player's current balance. This change is
covered by generated-adapter and structure-opening regressions; the updated
userscript still needs verification in a live match.

With the active `adaptive-v1` policy, troop donations go only to teammates below
65% capacity who are fighting or share a border with a living enemy. Active combat
takes priority, then lower troop fill. Rear teammates receive no automatic
donations. Lower configured cutoffs are honored; old saved 80% values are capped
at 65%. Opening, donor defense/reserve, minimum amount and throttle rules remain
unchanged. When nobody qualifies, the bot keeps its troops and continues the
attack pass. The selected recipient or skip and its reason are traced centrally.

Automatic transport launches are capped at two active owned transports, including
manually launched ships in that count, leaving the third slot for manual use.
Existing trips continue. Submitted launches waiting to appear in game state also
reserve capacity; a read-only launch listener also counts pending manual requests.
Failed automatic submissions release their reservation. Unacknowledged automatic
and manual requests expire after 40 game ticks; matching newly observed ships are
reconciled before expiry. Unresolved asynchronous submissions stay reserved, and
the acknowledgement window starts again when submission settles. Active ships
always count toward capacity. Expiry and acknowledgement events are traced.

In the Auto-Bot panel, open **Log → Detailed trace** to download JSON. Version 1.84.48 separates this action button from log-filter chips, so exporting preserves the selected filter and uses transient hover/focus feedback. The trace combines up to 1,500 recent sampled records with a protected history of up to 3,500 command, construction, spawn and error records, including available decision ancestors. It exports their union in sequence order. Repetitive checks are sampled once per signature per 100 game ticks; `retention.counts` counts every event and `suppressedRecords` counts omitted repetitions. `droppedRecords` counts removals from recent detail; `retention.evictedImportantRecords` separately reports protected-history evictions. Both histories are bounded, so this is not an unlimited full-match recording. Export during the match before reloading or creating a new bot.

- `observation`: a bounded game snapshot at a later tick.
- `infrastructure-change`: protected building counts and up to 80 actual building locations whenever structures are added, lost, upgraded or finish construction; trade-ship churn does not create milestones. Counts alone do not establish the cause of a loss.
- `rule-call` / `rule-result`: actual arguments and results of instrumented behavior methods, joined by `callId`.
- `decision`: strategy ID/version, snapshot, candidates, selected ID, and explanation.
- `dispatch`: submission result, joined to a decision by `decisionId`. Submitted does not mean the server accepted the command.
- `plan-result`: a selected structure routine completed or failed, or a bot-target attack was attempted/skipped/threw. The actual command candidate's `parentDecisionId` links it to this plan decision.
- `plan-blocked`: a policy selected an ineligible plan; no placement was attempted.
- `structure-placement-result`: selected tile, failed buildability probe, wait, cancellation, exhaustion or exception, linked to the placement decision.
- `building-result`: building phase/action outcomes, upgrade selection and defense-placement probe results, linked to their decision IDs.
- `plan-wave-result`: why a bot-target wave stopped, attempts used and the original troop-allocation counter. That counter can include failed submissions; it is not confirmation of troops sent.
- `attack-gate`: original reserve and trigger/random gate results before normal attack purposes.
- `attack-stop`: a nested counter-readiness or combat-diplomacy policy stopped the enclosing attack pass. The stop resets at the end of that pass.
- `attack-sequence-result`: outer attack phase and disconnected takeover outcomes, including skips, unsuccessful attempts, holds, stale stops and exceptions. A completed helper is not confirmation of server acceptance.
- `boat-detail-result`: shore selection, sampled/nearby/crater destination results, troop allocation, reachability failures, holds and launch submissions.
- `bot-allocation-result` / `land-allocation-result`: chosen troop amounts and insufficient-force or dispatch outcomes. Reserve, bot amount and final force decisions are linked to the attack command. A policy hold restores the attempt's bot budget; actual failed dispatches retain original accounting.
- `attack-routing-result`: selected land/boat route, targeted or free-land destination probes and troop allocations. Targeted boats retain one selected probe; free-land boats retain their ordered retry loop for unreachable sites. Parent IDs persist across awaits without leaving an active parent installed.
- `embargo-result`: outgoing embargo target/action or incoming relation-response result. Keep leaves state unchanged; wait/error stops the pass and its enclosing turn. Relation penalties/reversals update the original tracking set only after the selected effect runs.
- `spawn-result`: companion/source availability, heatmap/nearby selection and random sites. Spawn holds/errors restore check tick/top key; real dispatch failures preserve original spawn bookkeeping. Scored pools retain distinct alternatives and the original best tile.
- `attack-geography-result`: pocket or island selection, empty search, cache reuse, policy stop, or stale async termination. The selected decision links its attack purpose to the resulting command.
- `landing-probe`: selected tile, decision ID, probe/timeout counts, and reachability outcome (reachable, unreachable, timeout, already targeted, stale or threw). Reachable is not a boat dispatch.
- `naval-action-result`: a selected naval purpose found no target, held for army fill, attempted a launch, waited, stopped or threw. Launch submission is not server acceptance.
- `naval-stop`: a nested landing-policy wait/error stopped the enclosing opportunistic naval pass; cancellation is scoped to that pass.
- `warship-combat-result`: wait, held destination, stale stop or movement attempt. Original cooldown updates follow actual movement attempts, not server acceptance; command policy holds/errors do not update cooldown.
- `warship-retaliation-result`: wait, reposition attempt, stale stop, probe exception or response completion. Completion includes an `outcome` distinguishing build attempts, unbuildable/menu fallbacks, command decline and helper failure.
- `warship-deployment-result`: wait, no site, unbuildable destination, stale stop, build attempt, unsuccessful ready-build check or exception.
- `warship-infestation-result`: wait, stale stop, exception or response completion. Completion identifies build attempts, unbuildable/menu movement fallbacks and command declines.
- `strike-result`: MIRV purpose/reserve results, nuke weapon eligibility, site probes and final strike action outcomes. `attempt-completed` preserves the original helper-return meaning; it does not confirm a launch or hit. Use the linked command dispatch records to inspect submissions.
- `strike-target-result`: nuke target-search results, SAM plan failures/salvo attempts, and silo-upgrade attempts or stale stops. Selected targets identify the player; helper attempts do not confirm a server action.
- `strike-ranking-result`: selected player, ranking mode and whether a wait stops the enclosing purpose. Candidate decisions expose original scores, eligibility facts and tie ordering.
- `diplomacy-rule-result`: whether a selected alliance rule matched, accepted or rejected. The final rule decision links to the matching incoming, renewal or outgoing command.
- `diplomacy-combat-result`: whether a selected ally-assistance or betrayal step completed, fell through or stopped. Nested decisions and resulting commands retain their parent decision IDs.
- `turn-plan-result`: whether a selected top-level phase completed, was skipped by its original feature gate, stopped or threw. Nested planners and commands retain the selected turn decision as their ancestor.
- `blocked`, `strategy-error`, `telemetry-error`: explicit failures or missing telemetry.

Decisions with `snapshot.domain === 'structure-plan'` compare city, port, factory, SAM and silo plans against waiting. Candidates carry original ordinal priorities, eligibility and reasons. Special opening attempts have separate IDs, even when they target the same type. Only the selected plan runs affordability, placement and upgrade checks. On failure, eligibility is refreshed and the engine selects again; each stage can be attempted once per pass. These priorities are ordering rules, not calculated economic returns.

When the original structure target says the first owned SAM is due, `adaptive-v1` reserves spendable gold for it. An affordable SAM is selected before ports and factories; an unaffordable SAM produces a deliberate wait so another structure cannot consume its budget. Failed placement keeps that budget reserved and retries on the next pass. The reserve ends as soon as one owned SAM level exists, including construction.

Ordinary city, port, factory, SAM and silo tiles now use `structure-placement`. Before the first owned SAM, the original spread and safety score remains primary. Afterwards, cities, ports and factories prefer valid train routes to owned or allied factories, then own SAM coverage, allied SAM coverage and the original safety score. Factory ties additionally prefer connections across more rail clusters and more sampled owned space for future routes. Selected unbuildable tiles fall through to another decision; exhaustion returns the original no-build result. The trace chain is `structure-plan -> structure-placement -> command`.

Building choices also use `structure-phase` (emergency defense, ordinary structures, optional frontier defense), `structure-action` (upgrade versus new construction), `structure-upgrade` (existing building selection) and `defense-placement` (prepared frontier tiles). Original cooldowns, defense timing, density restrictions, SAM protection scores, random draws and ties are preserved. Only successful ordinary structures update the ordinary cooldown and placement count. Upgrade and defense quotes link their commands to the selected target decision. A policy hold stops the current building pass, including optional defense; the next pass starts fresh. Defense threat/timing measurements and target-ratio formulas remain original helpers, rather than new gameplay policies.

Decisions with `snapshot.domain === 'bot-target'` compare nearby hostile bots. Candidates expose target ID, initial troop count, land area, structure presence, troop density and original rank. The default prioritizes structures, then lower troop density, and retains the original difficulty-based attempt limit. Each selection calls the original `sendAttack`; failed attempts consume a slot. A target that became friendly, non-Bot or dead is skipped and logged. The target selection is linked to its command through `parentDecisionId`.

Bot-target decisions show up to 79 remaining targets plus wait, refilling after each attempt. `snapshot.botTargets` reports visible/hidden/remaining counts and the attempt budget. Alternative policies compare this visible window, not the entire pool when it exceeds 79. Ranking and candidate troop/land fields describe the initial wave; the command executor reads current game state for troop allocation.

Decisions with `snapshot.domain === 'attack-plan'` select a purpose in the main attack routine. The original preflight order is a structured-bot opportunity followed by an optional priority counterattack, before the reserve/trigger gates. The normal phase retains the original difficulty-specific order and crater relocation setting. Purpose candidates say `readiness: 'unchecked'`: selecting one runs its checks and searches, rather than running every possible action while comparing plans. Success stops the pass; a failed purpose advances to remaining purposes. Deliberate policy wait or a policy error stops this attack pass.

Decisions with `snapshot.domain === 'attack-target'` select incoming attackers, traitors, victims already under pressure, very weak enemies, disconnected players, hostile relations, or the original weakest-neighbor candidate. `facts` records measurements and exact thresholds; excluded targets have reasons. Lists retain the original player types (not exclusively humans). Incoming selection uses the largest individual positive attack, with first tie, rather than summed attacks per player. The existing absorb-then-counter timing, shield rule and troop calculations remain in the original methods. Priority counters use the original opening/reserve bypass; normal counters retain their original opening veto.

Attack-target windows show at most 79 targets plus wait, arranging eligible candidates first so the legacy winner remains visible. `snapshot.attack` reports the target mode and total/visible/hidden counts. A no-eligible-target result advances to the next purpose; choosing wait despite eligible targets stops the pass. Nested decisions expose `snapshot.parentDecisionId`: purpose → target selection → command. Counter-readiness lookups are decisions without a dispatch of their own.

Pocket and nearest-island searches use `attack-geography`. Pocket candidates expose the original land-share and sealed-perimeter facts, preserve first ties, and retain the 100-tick selected-target cache. Island candidates preserve center-distance order and the original scan of up to two reachable enemies. Searches and transport probes run only after their attack purpose is selected. Policy waits, invalid selections, errors, and stale continuations stop the current attack pass. The nested chain is `turn-plan -> attack-plan -> attack-geography -> command`.

Decisions with `snapshot.domain === 'naval-landing'` choose destinations within the original distant/disconnected-player search pool. Original filters, nearest-first sorting and the destination cap remain. A taken destination uses a rank slot without issuing a probe; failed probes move to another candidate. Distant timeouts remain distinct from unreachable results for the original diagnostic counters. The disconnected search retains its original false timeout fallback and player filter. A stopped or stale owner cannot return a landing from an outstanding probe.

Landing decisions show up to 79 remaining capped destinations plus wait, refilling as needed. `snapshot.navalLanding` reports total targets, those outside the original cap, and those hidden by the current window. A standalone landing-policy wait/error stops that lookup. Inside the new opportunistic naval planner, deliberate waiting with available candidates or an error also stops the enclosing naval pass. An exhausted search still permits normal fallback. The landing decision ID links to its reachability probe; the enclosing action decision links to the boat command.

Decisions with `snapshot.domain === 'naval-action'` choose reinforcement, disconnected-player grab, nearby island/weak coast, MIRV crater, random unowned/Bot target, random enemy target, or distant target. The default keeps that exact order. Searches and RNG run only after selection. Original boat cap, throttle, disabled-unit and shore gates run before these decisions. A failed reinforcement launch permits fallback. Once any other plan finds a target, low army fill or a failed launch ends the pass. Only successful dispatch updates the timestamp and beachhead. These are original rules, not new naval weights.

Warship patrol zones now use the `warship-patrol` decision domain: invasion, trade lane, then loss zone. Candidates expose service-cell cooldown eligibility; unsuccessful moves fall through and successful moves service the cell. `warship-patrol-result` records waits and move results, with movement commands linked to their parent decision. Tracking and threat generation retain their original logic. Ship selection now uses the nested `warship-unit` domain. A move result reflects the local helper return, not server confirmation.

Warship combat uses `warship-combat` to choose retreat, evade, engage or trade hunting under the original eligibility rules. Battle simulation, range, throttle and movement gates remain original. Enemy/trade target selection now uses `warship-target`; `warship-destination` chooses home when retreating without nearby danger; `warship-waypoint` chooses an escape tile. `warship-retaliation` chooses build/reposition after the original fleet cap and difficulty roll. Unavailable builds still fall back to movement. Policies may hold eligible actions; changing eligibility or target ranking requires changing the planner. Async retaliation probes do not hold a shared parent scope, so concurrent completions retain their own decision links. Stopped bots cannot act on late probes.

Combat target candidates preserve weakest-health or nearest-trade ranking and first ties. Escape candidates come from the original same-component water search of depth 30, scored by capped enemy distance, home distance and surrounding water. Up to 79 ranked choices plus wait include the original winner. The baseline treats home tile zero as absent for its distance score; that behavior remains. Target/waypoint waits and errors end that ship's combat action without movement or cooldown. The command links to its selected destination underneath the combat purpose. Optional target metadata cannot abort the original action. Home-port selection and nuke evasion also cross the policy boundary.
Home selection uses `warship-home` for the nearest active own/same-team port measured from the first active ship, then `warship-home-tile` for its first water neighbor (or original dry-port fallback). Holds/errors stop that combat pass; having no eligible port retains combat with null home. Combat purpose decisions descend from the selected home tile.

Nuke scanning and ETA-cache maintenance stay original. Endangered ships use `warship-nuke-dodge`, then `warship-nuke-threat` for the nearest blast center and `warship-nuke-escape` for ring/angular samples. Defaults retain configured sample order, highest safety ETA, shortest travel distance and first ties. The original improved-ETA and already-safer-patrol gates still apply. Sampling adds no water-component filter. Holds/errors stop that ship's action, leaving later ships available. Command holds prevent movement, cooldown and label updates; actual emit failures retain baseline cooldown/label bookkeeping. Candidate lists are bounded to 79 plus wait while retaining the original winner. Result records use each domain name plus `-result`, and movement links through dodge -> threat -> escape -> command.
Donation recipients use `donation-target`: original same-team and need filters, frontline first, then lowest troop fill with first ties. `donation-amount` retains the reserve, excess and minimum-chunk gates and defaults to full excess. Half excess and the minimum chunk are optional supplied alternatives when valid. Actual failed emits retain the original true return and resulting donation throttle; central holds/errors return false and do not advance the throttle.

`outreach-target` selects each normal alliance target before its original random roll and alliance checks, processing original order by default through bounded windows. The command links through the matched `alliance-rule` decision to that target. `far-outreach-target` consumes one original draw over the eligible array and includes its winner before up to 78 alternatives. Its veto remains after selection. Holds/errors stop the relevant pass, including its enclosing attack sequence when present. Actual failed emits retain original labels/timestamps, while command holds skip them. Result records use each domain name plus `-result`; scopes restore on return or exception.
Initial warship deployment uses `warship-deployment` after the original disabled-unit and random-chance gates. It preserves the port requirement, empty fleet and strict gold-above-cost rule; only a selected build samples a port and searches for water. `warship-infestation` selects among hostile fleets above ten ships in FFA, or the strongest fleet above three ships on each hostile team totaling more than fifteen. Team order and first ties remain original. Only the selected fleet samples a ship. Batches show at most 79 eligible fleets plus wait; the original first choice is always included. Remaining eligibility and rich-player gates run before counter planning. Failed counter builds still attempt the original movement fallback without selecting another fleet.

Warship details use `warship-port`, `warship-placement` and `warship-unit`. Port and hostile-ship pools consume exactly one original random draw, put that winner first, and offer up to 78 alternatives plus wait. Spawn placement accepts the first water sample by default; policy may resample within the original fifty coordinate pairs or wait. Friendly ships retain nearest-first order, first ties and original patrol filters. Smart patrol also checks state, water component, cooldown and travel distance. A detail or command hold ends the current patrol pass without updating ship cooldown or zone service; unavailable ships and actual emit failures retain next-zone fallthrough. Result records use the domain name plus `-result`. Deployment traces link deployment -> port -> placement -> command; infestation links fleet -> unit -> command. Local parent IDs survive build probes without holding a shared async scope.
Strike planning now exposes `mirv-plan`, `nuke-weapon`, `nuke-site` and `nuke-action`. MIRV purposes preserve win-fix reserve handling, counter, victory-denial and steamroll ordering. Weapon selection retains hydrogen-before-atom checks. Sites preserve descending original scores and sequential reachability/salvo probes, in windows of 79 plus wait. Exhaustion may lead to SAM clearing; an explicit policy wait stops the strike pass. Direct strikes, salvos and SAM-clearing attempts carry an explicit decision ID into async launch helpers, including helpful silo upgrades. Only the synchronous build gateway sets the command parent, avoiding cross-talk between concurrent strikes. Stale continuations cannot submit builds or update shared post-launch bookkeeping after delayed cost lookups.

Nuke search ordering now uses `nuke-target`: duel opponent, incoming attacker, high density, majority leader, allied target, hostile relation, FFA crown and strongest team. Searches remain lazy. `nuke-request-ally` and `nuke-request-player` expose allied requests, and `nuke-hostile-player` exposes hostile relations through windows of 79 plus wait. Eligibility is checked only after selection, preserving original relation/capacity gates and first eligible input. `nuke-duel-player` and `nuke-majority-player` expose the qualifying single-player choices. These decisions link to their search purpose; requested players link through their ally. Holds/errors stop the whole lookup and reset for the next call. An incoming-target policy hold stops the nuke lookup and restores its synchronous scope afterward. `sam-target` tries enemy SAMs in ascending level order through bounded windows; the first plan requiring capacity is remembered for `sam-upgrade` if no salvo works. `strike-silo` selects the reachable, upgradeable silo with greatest friendly-SAM coverage, preserving first ties. Its command links through the upgrade request to the enclosing strike. An explicit policy wait prevents fallback and further probes.

`mirv-target` ranks counter-MIRV, victory denial, steamroll and win-fix players; `nuke-player` handles density, FFA crown and strongest-team players. The snapshot's `strike.mode` identifies the ranking. Existing eligibility thresholds and tie rules are preserved, including last-player ties for strongest-team capacity. Rankings expose at most 79 eligible players plus wait, sorted before truncation so the legacy winner is visible. Nested policy holds/errors stop the enclosing purpose without changing reserves or falling through; an empty default ranking retains original fallback. Rankings link to their purpose decisions and restore their synchronous scope afterward.

Alliance choices now use `alliance-rule`. The rules remain lazy and preserve the original short-circuit order: regular Bot, confusion, traitor, far-nation win fix, alliance cap, threat, team rejection, negative relation, friendly relation, existing-alliance limit, early game and similarly strong. Only a selected rule performs its random draw or emoji effect. Incoming accept/reject, renewal and outgoing-request loops remain original executors. Explicit waits and strategy errors suppress the affected action; a later request starts with a fresh scope. Matching callback or event commands carry the final rule's decision ID.

Combat diplomacy uses `assist-ally`, `assist-target` and `betray-target`. Assistance retains ally order, relation checks, self/friendly-target emojis, failed-attack fallback, relation updates and acceptance emojis. Betrayal retains the original difficulty, capacity, traitor and sole-opponent conditions with their exact boundaries. Candidate windows contain at most 79 choices plus wait and refill in original order. The decision chain is attack purpose â†’ ally â†’ target â†’ command. A policy wait, strategy error or stale owner stops the current attack pass. The next pass starts with a fresh scope.

Full cadence decisions now use `turn-plan` to expose casual maintenance, diplomacy, MIRV, structures, warship deployment, embargoes, attacks, infestation response and ordinary nukes through one policy boundary. The build-only cadence exposes its secondary structure pass through the same domain. The legacy strategy repeatedly selects phases in original order, so one tick may still perform multiple actions. Feature gates are checked lazily at the selected phase, and a wait, invalid choice, policy error or stale owner stops only that turn pass. The hierarchy is `turn-plan -> domain plan -> target or rule -> command`. This migration adds the comparison boundary but enables no new investment or combat weights.

The outer `maybeAttack` choices now use `attack-sequence`: disconnected takeover, early bot attack, opportunistic boats, donation, far alliances, open-land expansion, tactical random boats, neighboring alliance requests and the main attack planner. Gates and random draws remain lazy and retain their original order. `takeover-target` exposes disconnected neighbors in ascending troop order with stable ties and no added friendly/strength exclusion. A successful random boat still ends the pass only when hostile neighbors exist. Nested main-attack, bot-target, naval or alliance-rule policy holds stop the enclosing attack pass; a later pass resets its scope. Takeover command ancestry is `turn-plan -> attack-sequence -> takeover-target -> command`; outreach commands retain the sequence phase through their alliance-rule decision.

Boat details use `boat-origin`, `boat-search`, `boat-destination` and `boat-allocation`. Legacy keeps the original random shore winner, free-before-enemy tactical searches, sampled random site order, failed-owner suppression, nearby probe slots and newest-first MIRV crater targets. Geography sampling and candidate filtering remain measurement helpers. Allocations expose original, half and double amounts; only a policy explicitly choosing an alternative changes the amount. Original tactical `/5`, probe fraction/minimum and surge fraction are preserved, including fractional troops and probe minima above the current army. Destination decisions parent allocation decisions, which parent launch commands. Holds/errors stop the naval pass without changing beachhead or throttle state; failed surge submissions retain their original fallback.

Remaining work includes new policies that compare attacks versus investments through the shared turn boundary. Strike score formulas, trajectories and saturation calculations still use their original helpers. Warship tracking, blast-radius/ETA measurement and build-feasibility helpers retain their original rules. Home-port selection and nuke-dodge action/escape choices now cross the policy boundary. Combat targets and escape tiles now cross the policy boundary while their score calculations remain original. Port, spawn-site and patrol/fallback ship choices now cross the policy boundary. Boat geography sampling and feasibility predicates retain their original calculations; tactical search, nearby/random/crater destination selection and troop allocation now cross the central policy boundary. Donation recipient/amount and outreach target choices now cross the policy boundary. Structure target formulas and remaining measurement/feasibility helpers retain their existing calculations. Rule traces expose actual checks, not every internal branch. Exported `coverage` lists hooked and unavailable methods. Large/deep data is truncated; no live game objects are retained. Errors while serializing telemetry must not alter original actions or returns.

`nuke-arc` selects up/down probes, retaining the original optional upgrade-margin pass before normal SAM levels and up-first default. Down is offered only when rotation is enabled and supported. A clear trajectory ends the search; intercepted probes retain the original fallback to normal levels. Waits/errors/stale owners explicitly abort site sampling, salvo planning, SAM searches and helpful-silo scans. These stops cannot be mistaken for ordinary interception or trigger another site/upgrade fallback. Selected site/SAM/upgrade parents are passed explicitly into arc planning. Interception and flight-path calculations remain original measurements.

Salvo planning now exposes `salvo-order`, `salvo-window`, `salvo-count` and `salvo-schedule`. Order approves the original nearest-silo queue with first ties; alternative arrival windows and supported bomb counts are selectable. The default chooses the largest window within half SAM cooldown, then the original minimum required count. Slot selection retains queue order and launches its prefix through the last selected slot, including intervening slots. Schedule approves the original staggered waits and arc flags in chunks of at most 79 launches, all approved before returning an executable plan; this keeps long schedule tails visible to the policy and trace. Gold/spend gates include the entire prefix cost. Holds/errors/stale owners return an explicit stopped plan, preventing another site, SAM or upgrade fallback. The planning decisions link order -> window -> count -> schedule under the selected site/SAM, chaining additional schedule chunks. Coverage, arc and flight-length measurement remain original; completed schedules carry private provenance into launch decisions.

Nuclear provenance now connects selected players to weapon, site, approved salvo schedule, action and launch command decisions. Sampled arcs and sites share the weapon parent; `strike-link` records identify each selected site's arc source. SAM launches inherit the final approved schedule chunk. MIRV launches inherit their ranked-player decision. Invocation-local output objects and private result-object provenance preserve original return shapes and keep overlapping passes separate, including passes using the same player/tile and completing in reverse order. Synchronous nested lookup scopes reset after each search.

Early warship maintenance now uses `warship-maintenance`: tracking/retaliation, nuke dodge, patrol and combat. Defaults retain that order and the original outer feature/alive/difficulty/port gates. Auto-spawn and dodge disable only on literal false; the original `winFixes` block entry is remembered for its three smart phases. Phase waits/errors stop this early pass, leaving ordinary cadence available. Phases execute synchronously with temporary warship command parents restored afterward; originally asynchronous retaliation remains unawaited.

Incoming transports now use `warship-transport-target` windows of 79 plus wait and `warship-transport-response` choices for forgetting, keeping, marking or requesting retaliation, with defer where state would change. Defaults preserve scan order, lazy predicates and immediate provisional handled marks. Nested placement, retaliation, ship-selection and command holds prevent the mark; late command declines revoke only the same request's mark. Ordinary build failures retain baseline bookkeeping. Explicit parents link target, response, placement, retaliation and command without retaining a parent scope across asynchronous work. Results appear as `warship-transport-response-result`.

Warship patrol sources now use `warship-invasion-source`, `warship-loss-source` and `warship-trade-source`. Defaults retain nearest eligible transport, largest valid water cluster with first ties, and latest raid only. Ranked source windows contain up to 78 sites, next-window when needed, and wait (at most 80 candidates). A source hold/error stops the enclosing patrol before movement and service marking; an empty source permits the next source. `warship-threat-source-result` records selection and patrol candidates retain `sourceDecisionId` provenance. Observation tracking and throttle updates retain the original rules.

Outgoing ship responses now use `warship-transport-outgoing-target` / `warship-transport-outgoing-response` and `warship-trade-outgoing-target` / `warship-trade-outgoing-response`. Original tracked order and lazy predicates remain; target windows contain 79 plus wait. Response choices keep, forget, request retaliation then forget, or defer a mutation. Defaults remove entries immediately after requesting retaliation, retaining original behavior for ordinary build failures. Nested holds prevent removal, and late command declines restore only their own provisional entry. Per-unit tokens protect newer observations and responses. `warship-tracking` owns transport/trade/incoming phase order; synchronous holds stop later phases. Disabled transport tracking still permits trade and incoming phases. Explicit parents link phase, target, response, retaliation and command.

Casual social sequencing uses `social-phase`. The eight original methods retain their lazy eligibility/chance checks; gameOver gates pass entry while a winner detected mid-pass still permits its remaining phases. `social-recipient` owns ally, traitor, rat, nearby-player and winner-national choices, preserving the original random draw or highest-ranked nation by default. Recipient windows contain 78 entries, optional next-window and wait; the original sampled recipient is offered first. `social-small-attack-target` exposes every incoming attack through windows of 79 plus wait and retains lazy eligibility/message checks. Policy holds/errors stop later social phases. `social-result` records choices; selected recipient actions and small-attack actions use explicit command parents.

Social message samples, pools, attack-emoji choices, cooldowns, winner responses and the live MIRV reaction now cross the central boundary. Scoped bookkeeping restores the affected cooldown/gameOver mark on a policy hold or stale continuation; ordinary permission/chance failures retain original behavior. The pasted baseline's `sendEmoji` samples a message but emits no command, and this build preserves that behavior.

Alliance event collection, requests, renewals, bot-event bookkeeping and direct accept/reject/renew callbacks use `alliance-event-target`, `alliance-event-response` and `alliance-event-action`. Queue provenance links later callbacks to the collected request. Nested policy or command holds stop subsequent marking; ordinary callback failures preserve baseline semantics.

The [final October 5 audit](docs/decision-centralization-audit-2026-10-05.md) completes the implementation audit for active Auto-Bot paths. The remaining validation is a genuine private-match trace review, described in the audit. Gameplay policies can now be changed through the central interfaces; test parity does not establish playing strength.

## Architecture

`turn-plan -> domain plan -> target or rule -> command decision -> dispatch -> trace`

| File | Purpose |
| --- | --- |
| `src/brain/engine.js` | Strategy selection, immutable inputs, dispatch records, bounded trace and replay |
| `src/brain/legacy-strategy.js` | Baseline policy preserving original selections; errors do not invoke another policy |
| `src/brain/adaptive-strategy.js` | First-SAM saving and economic placement policy; other domains delegate to legacy |
| `src/brain/turn-planner.js` | Top-level cadence phases, lazy feature gates, multi-action progression and outcomes |
| `src/brain/structure-planner.js` | Competing structure plans, original eligibility rules, retry handling |
| `src/brain/building-planner.js` | Structure phases, upgrade versus build, upgrade targets and defense-post sites |
| `src/brain/structure-placement-planner.js` | Central tile candidates, factory-line and SAM facts, buildability retries |
| `src/brain/bot-target-planner.js` | Competing hostile bot targets, original ordering/attempt budget, bounded windows |
| `src/brain/attack-planner.js` | Attack purposes, player target predicates, counter priorities and reserve gates |
| `src/brain/attack-allocation-planner.js` | Land reserves, land/forced amounts, bot allocations and guarded accounting |
| `src/brain/attack-routing-planner.js` | Land/boat routing, normal targeted boats and nearby free-land sites/amounts |
| `src/brain/attack-sequence-planner.js` | Outer attack shortcuts, maintenance phases and disconnected takeover targets |
| `src/brain/attack-geography-planner.js` | Sealable-pocket and reachable-island target candidates, caching and outcomes |
| `src/brain/diplomacy-details-planner.js` | Donation recipients/amounts, normal and far outreach targets |
| `src/brain/embargo-planner.js` | Embargo target/start/stop/keep choices and incoming relation responses |
| `src/brain/spawn-planner.js` | Spawn action/cadence, sources, heatmap/nearby and random site choices |
| `src/brain/diplomacy-planner.js` | Lazy alliance rules, ally assistance and betrayal with original ordering and outcomes |
| `src/brain/naval-landing-planner.js` | Distant/disconnected landing probes, nearest-first capped candidates and outcomes |
| `src/brain/naval-action-planner.js` | Opportunistic naval purpose selection, reinforcement and fallback/launch outcomes |
| `src/brain/boat-planner.js` | Boat origin/search/destination choices, tactical orchestration and troop allocations |
| `src/brain/warship-details-planner.js` | Sampled spawn-site choice, friendly ship selection and guarded movement |
| `src/brain/warship-patrol-planner.js` | Patrol-zone priority, service cooldowns and movement results |
| `src/brain/warship-safety-planner.js` | Home ports and water tiles, nuke threats, escape sites and guarded dodge actions |
| `src/brain/warship-combat-planner.js` | Combat purposes, retaliation build/reposition choice and outcomes |
| `src/brain/warship-deployment-planner.js` | Initial deployment and infestation fleet selection, guarded build completion |
| `src/brain/strike-planner.js` | MIRV purpose/reserve flow, nuke weapon, scored site and final strike choices |
| `src/brain/strike-target-planner.js` | Nuke search ordering, SAM clearing and helpful silo selection |
| `src/brain/strike-ranking.js` | MIRV and nuke player eligibility, ranked candidates and tie rules |
| `src/brain/runtime.js` | Game snapshots, rule instrumentation, and command gateways |
| `src/brain/bootstrap.js` | Connection to the existing bot, export button and browser API |
| `scripts/build.js` | Verified integration into the immutable original userscript |
| `vendor/openfront-helper-1.84.0.user.js` | Exact original, also usable to restore the baseline |

All 17 Auto-Bot event submissions, 9 build calls and 3 alliance callbacks go through the gateway. The original lobby predicate is unchanged: the pasted baseline implements `isPublicLobby()` as constant `false`, so it does **not** enforce a public-lobby restriction. Runtime tests exercise a supplied predicate, not an effective restriction in that baseline.

## Changing algorithms

A strategy supplies `id`, `version`, and a synchronous `decide(snapshot, candidates)` method. Return `{ selectedId, reason, evaluations }`, selecting a supplied candidate ID or `null` to wait. `evaluations` can carry the concrete scores and rules used by the new algorithm. Invalid choices or exceptions block that proposal and produce a strategy-error record.

Register future strategies through the runtime's `strategies` dependency in `bootstrap.js`, including their source in the builder's module list. Keep game actions out of `decide`. Handle `snapshot.domain === 'turn-plan'` to compare or reorder top-level structure, attack, diplomacy, naval and strike phases. A candidate marked `readiness: 'unchecked'` still runs its original feature gate and may produce a skipped result. Delegate nested domains to the legacy policy until the strategy also controls their detailed choices.

Run `node scripts/compare-strategies.js` to compare `adaptive-v1` with `legacy-v1` across the fixed early-, mid- and late-game scenarios in `tests/fixtures/strategy-scenarios.json`. The report distinguishes intentional expected differences from unexpected outcomes. A gameplay change should add or update a focused scenario showing the intended decision difference.

For a building policy, handle the structure phase, plan, action, upgrade and placement domains as needed, choosing a supplied eligible candidate or `$wait`. Delegate other domains until they have their own policy. The central interfaces expose choices while original formulas and feasibility gates still supply facts; this migration adds no investment-return scoring.

For a bot-target policy, handle `snapshot.domain === 'bot-target'` and return the chosen candidate's `id` as `selectedId`, or `$wait`. Use `targetId` to identify the player in your evaluation, not as the selection ID. Selecting another target changes selection only; the original opening veto, troop allocation, land/boat dispatch logic and final command decision still apply. No new combat scoring policy is enabled by this migration.

Attack amounts use `land-reserve`, `bot-allocation`, `land-allocation` and
`forced-allocation`. Original amounts rank first; conservative alternatives apply
only when selected explicitly. Reduced final forces respect the original human
minimum and non-Easy bot viability floor; original counter caps remain unchanged.
Bot wave accounting charges the selected bot quote before the final force cap,
as in the baseline. Holds/errors stop the current wave and restore the attempt's
budget; actual failed emitters retain it.

Routing uses `attack-route`, with land eligibility based on the original border
predicate. Player boat details use `targeted-boat-site` and
`targeted-boat-allocation`; nearby free-land boats use `free-boat-site` and
`free-boat-allocation`. Default selection preserves original sites, probe order,
troop formulas and gates. Targeted boats never retry another shore automatically.
Alternative destination pools are bounded to 79 plus wait. Holds stop enclosing
attack passes; async probes retain local decision ancestry and check ownership
before continuing. The game still chooses the actual transport spawn.

Embargo policies use `embargo-target` / `embargo-action` for outgoing trade
restrictions and `embargo-relation-target` / `embargo-relation-response` for
incoming penalty/reversal handling. Original rule helpers supply start/stop or
penalty/restore eligibility; keep defers a change while continuing the player
loop. Wait, invalid selection and policy error stop that pass and an enclosing
turn, with a fresh scope next turn. Fixed -20/+20 relation effects update the
existing tracking set only after the chosen response executes. No partial
penalty amounts or new trade valuation rules are enabled.

Spawn uses `spawn-action`, `spawn-source`, `spawn-companion`,
`spawn-heatmap-spot`, `spawn-neighborhood` and `spawn-random`. Default selection
keeps companion authority, heatmap order, the first valid nearby tile and the
original random draw counts. Smart random searches retain the best of 1,000
trials with first ties; ordinary searches can accept or explicitly resample a
valid trial. Nearby alternatives remain unchecked until selected, and invalid
geometry is measured without producing a decision per coordinate. Holds/errors
stop the spawn pass and restore check tick/top key; normal unavailable sources,
duplicate tiles, missing constructors and real failed emits keep their baseline
semantics. The six-tick and changed-top-key gates remain in force.

For player/counter policies, handle `attack-plan` to change purpose ordering and `attack-target` to change target ranking. Preserve delegation to the legacy policy for other domains. Choose candidate `id` values, not player IDs. An attack-target policy is also used by the pure lookup inside counter-readiness; a deliberate stop there propagates through the current main attack pass. No new counter timing or combat weights are enabled by default.

For landing policies, handle `naval-landing` and choose a supplied candidate `id` or `$wait`. Candidates represent untested destinations within the original capped search. A selected destination is checked for boat assignment and then reachability; your policy does not send the boat. Only the default original distance ordering is enabled by this migration.

For opportunistic naval policies, handle `naval-action` and select a purpose candidate `id` or `$wait`. Delegate landing and command domains to the legacy policy until you implement them. Plans marked `readiness: 'unchecked'` must still pass their original search and launch checks. A selected purpose is trace-linked to its nested landing choices and boat command; nested scopes restore the parent and clear cancellation on return or exception.

The userscript exposes `window.OpenFrontBrain` within its execution context:

```js
OpenFrontBrain.inspect()
OpenFrontBrain.download()
OpenFrontBrain.strategies()
OpenFrontBrain.useStrategy('legacy-v1')
OpenFrontBrain.replay('legacy-v1', savedTrace)
```

Console access depends on the userscript sandbox; the export button works without console access. Replay compares decisions using recorded inputs and never executes game commands. It is not a simulation of subsequent game outcomes.

## Build and verify

Requires Node.js; no dependencies to install. Run from this folder:

```powershell
node --test tests/*.test.js
node scripts/build.js
node --check openfront-helper.user.js
node scripts/build.js --check
```

Edit source modules, then rebuild; direct edits to the generated userscript are overwritten. The builder verifies the original SHA256 before patching. Updates point only to this fork on the minimal branch. The builder generates openfront-helper.user.js and a matching lightweight openfront-helper.meta.js; commit both after every version bump. It also synchronizes the bundled UI version.

Tests compare original and instrumented commands, state changes and scheduling in controlled fixtures, and verify selection, replay, failures and return compatibility. Live browser matches and runtime performance have not been validated; this framework makes future algorithm changes inspectable, but does not establish improved playing strength.
