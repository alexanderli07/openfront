# OpenFront economy planner, first iteration

Approved direction: replace economic decision making incrementally, preserve game integration and combat, retain the original as a benchmark. This folder has no Git repository; the original userscript is preserved byte-for-byte under vendor/.

The new default planner compares new structures and upgrades using live build quotes. Trade return estimates use cumulative ship/train revenue where available, discounted for exposure and construction time. Unobserved trade gets a small, explicitly heuristic exploration allowance only when a potential connection exists. Cities use troop-cap pressure rather than pretending their value is direct trade income. SAMs and defense posts respond to threats. Spending on existing nuke and warship tactics must leave the planner's selected investment/reserve affordable.

Keep strategy separate from the browser: a pure ranking/income/budget module, a game adapter, and a deterministic build script that inserts both into the preserved original. The shipped userscript is standalone. Add an in-panel toggle for the original strategy and a read-only diagnostic/export API for private-game comparisons.

Income counters distinguish total receipts (includes donations/conquest) from recurring ship/train revenue. Missing counters are unknown, never inferred from wallet changes. All gold authorization uses bigint. Only one purchase may be pending; release on observed unit change or a bounded game-tick timeout. Validate enabled/private-game/current-player state again after asynchronous quotes. Do not remove the public-lobby gate or change combat targeting in this iteration.

Scope limits: this is a heuristic economic planner, not an exact simulator or learned policy. Marginal trade estimates assume approximate scaling from recent per-level production; connection/path estimates do not prove future delivery. Keep uncertainty visible. Actual strength needs paired private matches.

Validation: Node built-in tests for ranking, counter accounting, budget races, resets, adapter requests, settings, disabled units, and failed/stale actions; syntax-check and deterministic rebuild of the distributed userscript. No dependency installation required.
