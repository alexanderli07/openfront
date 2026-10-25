# Config simplification

Approved direction: simplify the visible settings immediately.
UI-only change: preserve all existing settings, defaults, storage keys and
bindings. Main action controls remain in Controls. Config shows allowed building
types and automatic warship construction. Existing strategy switches and numeric
tuning move into one native details element, collapsed by default.

Implementation: scripts/config-panel.js transforms the immutable vendor panel
at build time; scripts/build.js includes it. Rename ambiguous labels only inside
the panel. Keep shared query selectors and event handlers unchanged.

Verify: generated panel has every original bound control exactly once; only the
warship purchase toggle remains outside Advanced; details is closed by default;
all gameplay modules remain unchanged. Build, suite, comparisons, syntax, and
final generated-source freshness. No Git actions.
