# Attack Sequence Implementation Plan

**Goal:** Centralize outer attack shortcuts and disconnected takeover targets while preserving behavior.

**Architecture:** New attack-sequence planner, runtime scope/ancestry adapter, bootstrap injection, builder replaces only the tail of maybeAttack. Existing planners handle nested domains.

**Tech stack:** JavaScript, Node tests and deterministic userscript generation.

- [x] Add failing tests for sequence order, early returns, targets, random branching, holds and stale continuations.
- [x] Implement attack-sequence and takeover-target domains and legacy ordering.
- [x] Wire runtime/bootstrap/builder, preserve nested cancellation and ancestry.
- [x] Compare actual baseline/generated maybeAttack across fixed scenarios; verify runtime integration.
- [x] Review, document remaining naval internals, update version, rebuild and verify full suite/syntax/artifact.

Work inline following the existing incremental migration authorization. No Git repository is available.
