# Building placement delay implementation plan

**Goal:** Apply the approved random 0–3 second pacing to ordinary automatic building orders, with immediate proven emergency SAM upgrades.

**Design:** One pacing slot belongs to each bot controller, shared by all building behaviors. A synchronous gate samples a deadline once and returns an operational hold until due. It retains no executable callback, quote, target, or gold reservation. Existing planners retry with fresh quotes; the final gateway rechecks permissions and spending before dispatch. Ordinary structures and upgrades share pacing; ships and nuclear launches are excluded. Emergency SAM quotes bypass pacing without consuming the ordinary slot. No settings switch is added.

**Implementation:**

- Add `src/brain/build-pacing.js` with injectable monotonic time and randomness; test inclusive delay bounds, single sampling while held, and resetting after a successful order.
- Inject one pacing instance per controller in `runtime.js` and production bootstrap. Gate only valid building requests, clear the slot only on actual dispatch, and record scheduled delay and remaining wait in central tracing. Preserve synchronous return values and caller bookkeeping.
- Test runtime delays across actors, fresh quotes, changed funds/permissions, stopped/stale bots, and immediate emergency SAM defense. Add the module to the standalone build.
- Run focused tests, full suite, build consistency and syntax checks; review the changed integration. Bump release metadata, publish selected files, and byte-verify public artifacts.

**Timing:** The deadline is 0–3000 ms; dispatch occurs on the next normal bot opportunity after that deadline. No background timer dispatches an old order.

**Verification limit:** Offline tests prove pacing and final guards; browser/game acceptance remains a live check.
