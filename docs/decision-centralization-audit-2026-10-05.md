# Final centralization audit: 1.84.39

The active Auto-Bot decision migration is implemented. This audit covers the
generated Emoji, Alliance, MIRV, Warship, Structure, Attack, Nuke and NationBot
classes and their live integration helpers. It completes the remaining groups
listed in the October 4 audit. It does not establish stronger gameplay or live
browser performance.

## Decision ownership

Social messages, message pools, attack-message choices, cooldown permission,
winner bookkeeping and the live MIRV reaction now have central decisions.
Alliance event targets, responses and direct accept/reject/renew callbacks also
have central decisions. Request provenance persists from collection to callback.
Selected effects own event marks. Nested callback or command holds prevent marks;
scoped social holds restore only their affected bookkeeping. Ordinary failed
chance checks, permission checks and callbacks retain baseline behavior.

The original emoji sender samples a message without emitting a command. That
behavior is preserved rather than adding an unsolicited gameplay change.

The source audit found no raw event-intent or build submissions inside the eight
behavior classes. The builder checks 17 event gateways, nine build gateways and
three alliance callback gateways. Gateway counts alone do not prove decision
ownership: selection and bookkeeping paths were inspected separately, and tests
exercise alternate selections, holds, errors, nested stops and parent ancestry.

## Remaining local code

Local helpers still measure eligibility, distance, threat, health, affordability,
reachability and baseline scores. Candidate preparation retains original random
draws and ordering; central policies select the resulting actions or candidates.
The remaining sorts and samples were classified as follows:

| Class | Local work retained |
| --- | --- |
| Emoji | Brag leaderboard eligibility; winner ranking feeds central recipient selection |
| Warship | Wealth eligibility and battle-health simulation facts |
| Structure | Frontier candidate preparation; cache fingerprints and speed/median measurements |
| Attack | Geographic candidate preparation feeding central destinations |
| Nuke/MIRV | Candidate and silo preparation feeding central strike choices |
| NationBot | Initial ratio and cadence configuration |

Private effect executors intentionally apply an already selected action. The
retained `respondToEmoji` integration helper and `attackRandomTarget` method have
no active callers; `getNeighborTraitorToAttack` is referenced only by that inactive
method. They are inactive baseline code, not policy-error fallbacks. Reactivating
them would require another ownership review.

Run `node scripts/audit-decisions.js` to reproduce the class/gateway inventory and
the remaining sort/sample locations. Its automated inventory supports this manual
classification; it cannot prove ownership on its own.

## Verification and live review

The full suite passes 1,587 tests, including baseline parity and policy hold/error
regressions. Independent social and alliance-event reviews completed after their
findings were fixed. The seven fixed comparison scenarios have two intentional
placement/SAM differences and zero unexpected outcomes. Generated JavaScript
syntax passes; release verification also checks generated build freshness.

No genuine exported live trace was found in the workspace or Downloads. Live
review remains outstanding:

1. Replace the installed Violentmonkey script with `openfront-helper.user.js`
   version 1.84.39 from this folder.
2. Run a private match through economic growth and late-game activity.
3. In Auto-Bot, open **Log → Export trace** before reloading or replacing the bot.
   Export during relevant periods: the buffer retains the latest 5,000 records.
4. Attach the JSON for review of decision ancestry, blocked/error paths, first-SAM
   saving, owned/allied factory-route placement and late-game actions.

Fixture replay compares recorded choices; it does not simulate game outcomes.
Gameplay tuning can use the centralized interfaces now, with live evidence used
to judge whether the bot actually plays better.
