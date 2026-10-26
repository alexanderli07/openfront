# Warship trade-hotspot patrol design

## Problem
The current combat planner chooses the nearest hostile trade ship's current tile. The patrol planner separately responds to invasion, trade-loss and transport-loss sites. These destinations do not represent a persistent productive trade area, so movement can follow transient ship positions rather than hold a shipping lane.

## Recommended behavior
Use a shared trade-hotspot observer for adaptive automatic deployment and movement. Collect only native-capturable hostile trade ships, bucket recent observations by water area, and score sustained traffic density with distance and danger penalties. Decay old observations so abandoned routes stop attracting the fleet. Use bounded samples and per-tick shared measurements.

Assign each warship a stable water tile within a useful hotspot in its reachable water component. Spread ships across productive areas when extra ships add little coverage to an occupied one. Keep the assignment while travelling and while the lane stays productive; change only for a materially better hotspot, sustained inactivity or safety. Patrol anchors are actual water tiles, not geometric centroids that may land on shore.

Retreat, nuclear evasion, enemy warship combat and transport interception take priority. After the threat clears, return to the trade area. Individual passing trade ships do not repeatedly replace the assigned patrol center; native local capture handles traffic within reach.

Use the same areas to choose the appropriate owned port/water component for automatic deployment, while retaining existing fleet caps and economy/SAM reserves. Do not increase fleet size just because a transient cluster appears. With no useful traffic, retain an existing valid assignment for a grace period and otherwise hold or perform defensive patrols.

All assignments, scores, holds, changes and commands go through the central decision maker and trace. Manual controls and existing switches remain available; no new configuration pills are needed. Legacy strategy remains the benchmark.

## Alternatives
1. Recommended: stable areas from observed recent traffic. Responds to actual traffic, needs bounded history.
2. Fixed nearby port/chokepoint patrols. Stable but may camp an empty lane.
3. Smoothed individual-ship chasing. Smaller change but retains the moving-target problem.

## Validation
Cover dense cluster versus nearby single ship, stable assignment while traffic moves, delayed reassignment, dry-land centroid avoidance, separate water components, friendly/protected trade exclusion, fleet distribution, safety overrides, reserve-preserving deployment, central policy holds, failed emissions, and return after interruptions. Use the current native capture rules as the reference. Offline tests cannot prove live routing or capture yield.

Status: user approved; implementation and regression verification completed.

## Verified browser API constraint
Current UnitView exposes targetUnitId(), resolved against port ownership. It does not expose isSafeFromPirates(); engine-backed views can expose that getter. Exclude known protection when available and report unobservable protection in area facts. Native capture continues to enforce hidden immunity. Do not reject all traffic merely because the browser omits the engine-only getter.
