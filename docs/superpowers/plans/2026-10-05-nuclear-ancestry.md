# Nuclear ancestry implementation

1. Add failing generated/runtime tests for selected target, weapon, schedule and
   command ancestry.
2. Capture synchronous lookup IDs and invocation-local output IDs; attach private
   object provenance and pass it explicitly through generated nuke delivery.
3. Test all branch types, overlap, reset, replay and return parity. Independent
   review; fix actionable findings.
4. Version/docs update, rebuild, full tests/comparison/syntax/freshness.

Completed in 1.84.33 (legacy 1.84.0-plans.30). Five initial ancestry tests
failed before implementation. All 16 focused tests and 1,259 full-suite tests
pass. Coverage includes direct/salvo/SAM command parents, MIRV ranked-player
handoff, every player-search source, scope reset, unchanged return shapes,
private result provenance, replay and same-actor generated passes finishing
in reverse order. The overlap fixture delays only launch quotes, not probes.

Independent review found no actionable issues and passed 219 related regressions.
The build test was updated to verify the new explicit parent arguments. Seven
comparison scenarios have two intentional differences and zero unexpected
outcomes; syntax and artifact freshness pass. No live match was run.
