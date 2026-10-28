# Custom lobby filtering and reward claim recovery

Add a Custom games chip to the existing off/include/exclude filter UI. Use the native lobby.custom flag, with hosted lobby type recognized as custom too. Defaults remain off; other map/team/modifier filters still apply. Custom-only forecasts depend on actual observed matches because scheduled synthetic scenarios do not represent hosted/custom availability.

Reward investigation against released v0.35.6 confirms the native Claim control remains data-xp-claim inside game-xp-panel. Fix the coordinator timing: a long provisional/calculating phase must not permanently suppress a later confirmed result, and a reused visible modal must reset when a new result arrives. Keep two native click attempts and bounded automatic navigation hold, inspect native claimed state and expose diagnostic phase/attempts. Pick the latest visible result modal instead of a potentially stale hidden first match. Never claim provisional rewards or held/account/login rewards.

Tests cover custom/native-hosted/featured flags, includes/excludes, late confirmed rewards, same-modal reuse, native busy/claimed states, retries, navigation holds and forecast availability. Rebuild, run regression tests and publish with truthful live-validation limits.
