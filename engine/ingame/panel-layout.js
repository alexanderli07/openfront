// Default panel layout — seeds sensible first-run positions into localStorage
// so panels don't all stack in one corner on a fresh install. Runs ONCE (guarded
// by a version flag) and never overwrites a position the user has already set, so
// dragging a panel is respected forever after.
//
// Loaded EARLY (right after runtime.js) so the auto-bot's settings blob is seeded
// before auto-bot/core.js reads it. All positions are clamped by each panel's own
// applyStored…Position(), so they stay on-screen at any resolution.
//
// Requested layout:
//   left column  : Player stats → Team build → Auto-bot
//   right of it  : Advisor (beside Player)
//   right column : Boats → Estates → Alliances

  (function seedDefaultPanelLayout() {
    const SEED_FLAG = "openfront-helper-layout-seeded-v1";
    let ls;
    try {
      ls = window.localStorage;
      if (ls.getItem(SEED_FLAG)) return; // already seeded this install
    } catch (_error) {
      return; // no storage → nothing to seed
    }

    const PAD = 14;
    const W = window.innerWidth || 1280;

    // Estimated panel widths (right-column panels are right-anchored so their
    // right edges line up; exact heights are unknown so vertical gaps are typical).
    const PLAYER_W = 340;
    const BOAT_W = 260;
    const ESTATE_W = 178;
    const ALLIANCE_W = 258;

    // Left column (fixed x).
    const leftX = PAD;
    // Right column (right-anchored, edges aligned).
    const boatX = Math.max(PAD, W - BOAT_W - PAD);
    const estateX = Math.max(PAD, W - ESTATE_W - PAD);
    const allianceX = Math.max(PAD, W - ALLIANCE_W - PAD);
    // Advisor sits just to the right of the player panel.
    const advisorX = leftX + PLAYER_W + PAD;

    // { localStorage key : {left, top} } for panels that store a plain JSON pos.
    const seeds = {
      "openfront-helper-top-gpm-pos": { left: leftX, top: PAD }, // Player stats
      "openfront-helper-team-build-stats-pos": { left: leftX, top: 314 }, // below player
      "openfront-helper-advisor-panel-pos": { left: advisorX, top: PAD }, // beside player
      openfrontHelperBoatPanelPos: { left: boatX, top: PAD }, // top-right
      openfrontHelperEstatePanelPos: { left: estateX, top: 300 }, // below boats
      "openfront-helper-alliance-request-panel-pos": { left: allianceX, top: 520 }, // below estates
      "openfront-helper-quick-panel-pos": { left: W - 286, top: PAD }, // top-right, Quick Panel 270px wide
    };

    for (const key in seeds) {
      try {
        if (ls.getItem(key) == null) {
          ls.setItem(key, JSON.stringify(seeds[key]));
        }
      } catch (_error) {
        /* ignore individual failures */
      }
    }

    // Auto-bot stores its position inside its settings blob under `pos`. Merge a
    // default (below the team-build panel, left column) without clobbering the
    // rest of the blob or an existing user position.
    try {
      const BOT_KEY = "openfront-helper-autobot-v1";
      const raw = ls.getItem(BOT_KEY);
      const blob = raw ? JSON.parse(raw) : {};
      if (blob && typeof blob === "object" && (blob.pos == null)) {
        blob.pos = { left: leftX, top: 540 };
        ls.setItem(BOT_KEY, JSON.stringify(blob));
      }
    } catch (_error) {
      /* ignore */
    }

    try {
      ls.setItem(SEED_FLAG, "1");
    } catch (_error) {
      /* ignore */
    }
  })();
