# Warship threat source decisions

Expose invasion, loss-zone and trade-lane candidates to the central policy.
Keep original gates and measurements: nearest eligible inbound transport with
first ties, largest valid water loss cluster with first ties, and latest raid
only (an invalid latest raid must not fall back to an older raid by default).
Keep exact original winner bookkeeping and getter/probe order, including a
throwing invasion winner's distance update and skipped validation of loss ties.
Alternative tile/centroid validation is lazy after explicit policy selection.
Rank before bounded windows of 78 sites, next-window and wait; offer next-window for
policies to examine later alternatives. Default selects the original winner.
Empty measurements return null without stopping other sources. Policy wait,
invalid choice or exception stops the enclosing patrol before further source
lookup, movement or service marking. Standalone lookups restore their scope.
Keep observation tracking and throttle updates in the original method.
Record selected-source provenance on patrol site candidates. Do not retain live
objects in telemetry. Outgoing retaliation responses are outside this increment.

Validate original/generated parity, ties, gates, holds/errors and scope reset,
alternate selection and bounded windows, plus full suite/build verification.
