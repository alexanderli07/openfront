# Shared panel design

Use Auto-Bot as the visual reference for Helper, Auto Join and its settings dialog.
Keep existing control identifiers, saved preferences, panel dragging and resizing,
and gameplay decisions. Preserve include/exclude colours and disabled states.

One scoped stylesheet supplies surface, radius, typography, header, section,
button, field, focus and motion rules. Install it through every panel's existing
style installer so opening order does not affect appearance. Keep Auto-Bot's
280 by 431 frame; constrain the other floating panels to the viewport without
overriding persisted sizing. The larger settings dialog retains its map grid.

Round section headers, place disclosure arrows after labels, use quieter nested
rows, hide vertical scrollbars while preserving scrolling, and prevent horizontal
overflow. Use brief fade/slide motion and respect reduced-motion preferences.

Verify generated style installation in isolated DOM fixtures, retain existing
filter/control tests, and inspect a local browser preview without changing a live
game or saved settings.
