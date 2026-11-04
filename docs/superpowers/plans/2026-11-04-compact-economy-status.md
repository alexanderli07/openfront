# Compact economy status

Add two approved read-only indicators: rolling income/min beside gold and one next-purchase line. No troop-fill display or new controls.

Income uses native cumulative `goldEarned()` over up to600game ticks, with at least10ticks for a usable sample. This is gross received gold, including trade and conquest; spending cannot reduce it. Missing telemetry displays an em dash. State resets on match/player changes and tick rewind.

Next purchase observes central structure decisions and command quotes. Show the current target, savings progress including required reserves, or a brief waiting/disabled state. Use planner estimates until an actual quote exists; do not run planners from rendering, reserve money, or promise a purchase. Successful build dispatch clears the old target. Ignore stale sessions and show the live gold balance. Preserve the compact three-resource/two-row counter layout.

Test income across purchases, session changes, missing samples, staged first-SAM targets, planned SAM plus3Mreserve, real quotes, completion, and UI rendering. Run full suite, review, bump and publish selected artifacts, verify raw files. Live visual layout needs a browser check if a game window is available.
