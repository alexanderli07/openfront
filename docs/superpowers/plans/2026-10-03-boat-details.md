# Boat Details Implementation Plan

**Goal:** Centralize boat origins/destinations and troop allocations with default parity.

**Architecture:** New boat planner; runtime adapters and shared naval stop scope; original random sampling and launch executors retained by builder; opportunistic planner delegates nearby choices and launches.

**Tech stack:** JavaScript and Node tests, generated userscript.

- [x] Write failing boat planner tests for origin, destination retries/owner suppression, nearby caps and allocations.
- [x] Implement boat planner and legacy domains.
- [x] Wire runtime, bootstrap, tactical builder and opportunistic callbacks with ancestry/cancellation.
- [x] Add generated parity and integration regressions, independent review and fixes.
- [x] Update docs/version, rebuild and run full tests, comparison, syntax and freshness checks.

Execute inline under ongoing authorization. No Git repository is present.
