// Companion Bot — core: constants, pure math helpers, settings blob, boss
// resolution and the public bridge.
//
// Classic-script shared-global scope (no IIFE), exactly like the auto-bot
// modules: every top-level name here is visible to the sibling companion files
// AND to the rest of the in-game bundle, so all of them carry a `companion` /
// `COMPANION_` prefix to stay unique.
//
// NOTHING in this file may run at load time. Settings are initialised lazily via
// companionSettings(); that keeps a corrupt localStorage blob from throwing
// during concatenation (which would kill every feature after it in the same
// try/catch IIFE) and lets test/companion.mjs load the file in plain Node.

"use strict";

  const COMPANION_STORAGE_KEY = "openfront-helper-companion-v1";
  const COMPANION_PANEL_ID = "openfront-helper-companion-panel";
  const COMPANION_STYLE_ID = "openfront-helper-companion-styles";
  const COMPANION_PANEL_POS_KEY = "openfront-helper-companion-pos";

  // ---------------------------------------------------------------------------
  // Pure math
  // ---------------------------------------------------------------------------

  // TileRef → map coordinates. The game stores tiles row-major, so this is plain
  // arithmetic. (The multitab original split the tile id's DIGIT STRING in half,
  // which only lands on the right tile when the map width happens to be a power
  // of ten — on every other map it aims somewhere unrelated.)
  function companionTileToXY(ref, width) {
    const w = Number(width) || 1;
    const r = Number(ref) || 0;
    return { x: r % w, y: Math.floor(r / w) };
  }

  function companionTileFromXY(x, y, width) {
    const w = Number(width) || 1;
    return Math.floor(y) * w + Math.floor(x);
  }

  // A percentage of a gold/troop amount, as a plain Number. Gold is a bigint and
  // the wire schema wants z.number(), so bigints are divided in bigint space
  // first (keeping precision past 2^53) and only then converted.
  function companionPercentAmount(value, percent) {
    let pct = Number(percent);
    if (!Number.isFinite(pct)) pct = 0;
    pct = Math.max(1, Math.min(100, pct));
    if (typeof value === "bigint") {
      if (value <= 0n) return 0;
      const out = (value * BigInt(Math.round(pct))) / 100n;
      return Number(out > 0n ? out : 1n);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(1, Math.floor((n * pct) / 100));
  }

  // Every integer offset whose distance falls inside the [minR, maxR] annulus,
  // sorted nearest-first so a caller can take the first valid tile and stay as
  // close to the boss as the terrain allows.
  function companionRingOffsets(minR, maxR) {
    const lo = Number(minR) || 0;
    const hi = Number(maxR) || 0;
    if (!(hi >= lo) || hi <= 0) return [];
    const out = [];
    const r = Math.ceil(hi);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < lo || d > hi) continue;
        out.push({ dx: dx, dy: dy, d: d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => ({ dx: o.dx, dy: o.dy }));
  }
