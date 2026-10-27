# Post-match rewards implementation plan

Goal: Add a persisted, default-off Auto claim post-match rewards control beside Auto Join.

Use the native game-xp-panel data-xp-claim control only after a confirmed result. Never claim account/login rewards. Poll once per second; pause automatic leave/join for at most 60 seconds. Respect native busy state, retry at most twice with five seconds between attempts, and use native claimed state as confirmation. Manual navigation remains available.

1. Add focused tests for disabled, calculating, busy, success, retry, timeout and no-reward states.
2. Add isolated reward coordinator and guarded builder integration for settings, floating panel, polling, auto-leave and auto-join.
3. Build and verify generated syntax, focused tests and full regression suite. Increment release and publish selected files using existing release checkout.
