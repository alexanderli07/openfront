# Warship patrol implementation plan

Continue the approved incremental central-decider migration, preserving original behavior.
Move only the zone-selection tail of smartWarshipPatrol into a synchronous planner.
Keep threat generation, tracking, throttle, service expiry, ship selection and movement original.
Candidates expose tile, purpose, service cell and eligibility. Legacy priority is invasion,
trade lane, then loss zone. Failed movement falls through; success services the cell and ends.
Policy wait ends the pass. Runtime guards and synchronous parent scope protect dispatch.

1. Add failing planner tests for order, service boundaries, wait and alternate selection.
2. Implement planner and runtime hook; replace only the original selection loop in builder.
3. Compare original and generated patrol behavior; verify parent links and replay.
4. Run all tests, rebuild, syntax check, document exact coverage and remaining work.
