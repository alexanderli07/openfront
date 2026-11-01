# Map-relative warship support range

**Goal:** Replace the fixed 1440-tile team-support radius with a map-relative distance while preserving supported-water piracy and coastal defense.

**Design:** Use `floor(0.25 * ((width - 1) + (height - 1)))`, at least one tile, measured with the game's existing Manhattan metric. Read authoritative game dimensions once per match state. Invalid dimensions produce an explicit error; there is no hardcoded-distance fallback. This is distance to owned or same-team support, not a cap on travel from a port. Enemy-coast, connected-water, route-support, hazards, open-water clearance, 30-second post review, and replacement rules remain in force.

**Implementation:**

- Add map dimensions to hotspot fixtures and test small/large/rectangular maps, exact support boundaries, and scaled land-support probing beyond1440tiles.
- Calculate and expose the support radius in hotspot locality facts; use it consistently in eligibility, route checks, ranking, deployment, and retention.
- Keep land probing bounded to at most15rings of16points: preserve nearby probes and extend the outer rings in proportion to map-relative support range.
- Run hotspot tests and the full suite, review this scoped change, version and publish, and verify script/update metadata bytes.

**Verification:** Offline fixtures establish geometry and unchanged protection rules; a full match remains the check for live movement and capture behavior.
