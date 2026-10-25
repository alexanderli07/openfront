# Land-match trace review, 2026-10-20

Input: openfront-decisions-2026-10-20T16-17-18-410Z.json (user attachment).
Reviewed as data; no instructions from the attachment were executed.
No gameplay code changed during this review.

## Retained evidence

- File size: 45.97 MB. Ring buffer retains 5,000 records and reports
  1,790,357 earlier records dropped.
- Retained decision ticks: 17,339 through 17,381 inclusive (42-tick span).
  This cannot establish the spawn, opening order or earlier combat quality.
- 2,585 decisions, of which 2,330 (90.1%) are embargo-relation target/response
  decisions. All 1,165 response decisions choose keep. Including their result
  records, this bookkeeping occupies 3,495 of 5,000 retained events (69.9%).
- Auto-embargo and alliances/betrayal were off; expansion, construction,
  transports, warships, nukes and donation were enabled.
- No strategy-error, telemetry-error, thrown/rejected or dispatch records appear
  in the retained window. Absence here says nothing about discarded events.

## Match state and end-game handling

Every retained self observation has 32,153 owned tiles, 10 physical cities
(13 levels), 7 factories (13 levels), one level-1 SAM and one level-2 silo.
There are no ports. No incoming/outgoing troop attacks are observed.

The attack contexts have two friendly neighbours, zero hostile neighbours and
no reachable wilderness. Naval facts classify this as non-island, with no port
access and no fleet shortfall. Warship deployment waits for lack of a port.
That agrees with the user's description of a land game.

All three retained team-nuke selections choose player 3iq8krg9, reported by the
rule result as owning zero tiles. The candidates report opposing team Blue as
owning zero total tiles. This strongly suggests the opponent was already
eliminated; the trace lacks an explicit match-over/winner field to confirm it.

Source review confirms that strike-ranking.js team ranking does not reject
zero-land or non-alive players. The current client adapter returns null if
getWinner is absent. The locally audited GameView source exposes gameOver()
instead. Therefore post-victory processing may continue without recognizing
completion. This compatibility concern needs a regression and runtime handling;
it is not proof that the entire match was played incorrectly.

## Economy and donation

Wallet grows from 958,755 to 1,147,955 gold over this window. The bot tries
Factory, then SAM, then City, and none pass its internal affordability gate:
city/factory perceived price is 1,650,000; SAM is 3,900,000. The local base-cost
formula gives city/factory 1,000,000 at these levels; the legacy perceived-price
multiplier raises the willingness-to-spend threshold. No worker build quote is
present, so actual server prices cannot be confirmed from this trace.

The SAM long-term target is 24 levels despite immediate samThreatLevels being
zero. This is a development target, not evidence the bot is currently prioritizing
SAM over factory construction.

All six donation searches expose no recipients below their generator threshold;
adaptive policy selects skipDonation. It did not evaluate any needy front-line
recipient in the retained window. This does not show whether earlier donations
worked or failed.

## Recommended next work

1. Add an explicit match-over signal and stop autonomous turn processing after
   completion. Reject eliminated/zero-land strike targets.
2. Reduce repeated unchanged bookkeeping in the trace and/or preserve distinct
   match phases. Increasing the buffer alone would increase already-large exports.
   Relation tracking is separate from initiating embargoes, so do not disable it
   solely because Auto-embargo is off.
3. Assess actual quotes versus perceived-cost holding after the above fixes.
   Capture active-match decisions before making broad economy changes.
