// Shared player, team, overlay, and formatting helpers used across bridge features.

// Hover-intent delay for every helper/auto-bot tooltip, in ms. Declared here because
// shared-utils.js is emitted at position #5, ahead of both auto-bot/panel.js (#28) and
// quick-panel.js (#38), so the value is assigned before either can read it.
// Long enough that moving the cursor across a control on the way to clicking it does
// not pop a card over the thing you are aiming at.
var OFH_TIP_DELAY_MS = 800;

// Total height of the helper and auto-bot panels, in px. BOTH panels set this as an
// explicit height and let their body flex to fill whatever the header and tab row do
// not use — so they are the same size BY CONSTRUCTION, whatever those chrome elements
// measure. Previously the helper's body carried a hand-measured px value derived from
// the auto-bot's chrome, which meant the two could silently drift apart whenever a
// padding or font-size changed. Change this one number to resize both.
// Two independent floors constrain this:
//   auto-bot  41 head + 37.4 tabs + 19 .ab-body padding + 340 pane  = 437.4  (its size
//             before this constant existed — must not shrink)
//   helper    39 head + 41 tabs + 362 Config content               = 442    (below this
//             the Config tab gets a scrollbar — the binding constraint)
// 426 is set from what the panels actually look like on screen, which beats both floors
// above — those were computed from a REPRODUCTION of the markup, and that estimate has
// been wrong repeatedly (an earlier value of 420 came from a probe that omitted
// .ab-body's padding, which is how the auto-bot once ended up 17px short). If the Config
// tab starts scrolling or the Controls pane feels cramped, raise this; the two panels
// move together either way.
var OFH_PANEL_HEIGHT_PX = 431;

// ── Overlay design tokens ──────────────────────────────────────────────────────
// ONE source of truth for how everything drawn on the map looks. Before this, the
// overlays shared nothing: four different font stacks, three unrelated palettes, pill
// padding of 3px/4px/5px, background alpha of 0.6/0.72/0.82, and the panel's "Overlay
// Opacity" slider reached NONE of them.
//
// Colour and alpha are PUSHED in here by quick-panel's theme funnel (_applyTheme and
// _themeFromSettings) rather than pulled: getComputedStyle appears nowhere in this repo
// and forces a style recalc, which is exactly the per-frame DOM cost the map-overlay
// scheduler exists to avoid — and rainbow mode repaints at 12.5Hz. The literals below are
// the pre-theme fallbacks, used until the first push lands.
var OFH_OVERLAY_STYLE = {
  // One family for every surface. This is the stack the scheduler, both panels and the
  // DOM alerts already share; the losers were two `, monospace` tails, which is the real
  // damage — on a machine without Aptos a build timer resolved to Consolas while the money
  // pill beside it resolved to Segoe UI. That is the "different fonts on one map" look.
  family: '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif',
  // 700, not 900. The overlay canvas is deliberately 1x CSS pixels with no
  // devicePixelRatio, so there are no subpixels to recover letter counters with; at 10-11px
  // a synthesised 900 face fills its own bowls and smears. Contrast comes from the pill
  // and the halo instead.
  weight: 700,
  sizeSm: 10, // rank digits
  sizeMd: 11, // every fixed-size map label
  sizeMin: 11, // floor for the one zoom-scaled label (the money pill)
  sizeMax: 18, // ...and its ceiling
  padX: 6,
  padY: 3,
  minH: 14,
  gap: 6,
  surfaceRgb: "7, 12, 18",
  surfaceA: 0.82, // beats bright terrain; 0.6 went muddy over snow/desert
  outlineA: 0.45, // separates the chip from dark water, where a dark fill has no contrast
  textA: 0.98,
  haloRgba: "rgba(0, 0, 0, 0.55)",
  haloW: 2,
  lineW: 2,
  dashComputed: [6, 5], // a real solved path
  dashGuess: [2, 6], // a straight-line fallback / inferred path
  routeA: 0.85,
  accent: "#00ff66",
  accentR: 0,
  accentG: 255,
  accentB: 102,
  alpha: 1, // the panel's Overlay Opacity slider
};

function ofhOverlayAlpha() {
  const a = Number(OFH_OVERLAY_STYLE.alpha);
  return Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
}

/** "700 11px \"Aptos\", ..." — the only place an overlay font string is built. */
function ofhOverlayFont(px) {
  const size = Number(px);
  const n = Number.isFinite(size) && size > 0 ? Math.round(size) : OFH_OVERLAY_STYLE.sizeMd;
  return OFH_OVERLAY_STYLE.weight + " " + n + "px " + OFH_OVERLAY_STYLE.family;
}

/** Any colour, scaled by the user's overlay opacity. */
function ofhOverlayRgba(r, g, b, a) {
  const alpha = (Number.isFinite(Number(a)) ? Number(a) : 1) * ofhOverlayAlpha();
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha.toFixed(3) + ")";
}

/** The accent as rgba. NOTE: never string-concat an alpha suffix onto
 *  OFH_OVERLAY_STYLE.accent — the hue slider and rainbow mode set it to hsl(...), not a
 *  hex, so "#rrggbb" + "2b" would silently produce garbage. That is why the channels are
 *  stored separately. */
function ofhOverlayAccentRgba(a) {
  return ofhOverlayRgba(
    OFH_OVERLAY_STYLE.accentR,
    OFH_OVERLAY_STYLE.accentG,
    OFH_OVERLAY_STYLE.accentB,
    a,
  );
}

/** The shared dark chip background. */
function ofhOverlaySurface(a) {
  const base = Number.isFinite(Number(a)) ? Number(a) : OFH_OVERLAY_STYLE.surfaceA;
  return "rgba(" + OFH_OVERLAY_STYLE.surfaceRgb + ", " + (base * ofhOverlayAlpha()).toFixed(3) + ")";
}

/** Theme push targets. Both are TOTAL — every input is validated and the previous value
 *  kept on bad input — because a throw in here is swallowed by the layer's try/catch and
 *  would silently kill rainbow mode. Both mark the canvas dirty so a slider drag or a
 *  rainbow tick repaints even with a stationary camera. */
function ofhSetOverlayAccent(css, r, g, b) {
  const rr = Number(r);
  const gg = Number(g);
  const bb = Number(b);
  if (Number.isFinite(rr) && Number.isFinite(gg) && Number.isFinite(bb)) {
    OFH_OVERLAY_STYLE.accentR = rr;
    OFH_OVERLAY_STYLE.accentG = gg;
    OFH_OVERLAY_STYLE.accentB = bb;
  }
  if (typeof css === "string" && css) OFH_OVERLAY_STYLE.accent = css;
  if (typeof markMapOverlayDirty === "function") markMapOverlayDirty();
}

function ofhSetOverlayAlpha(a) {
  const v = Number(a);
  if (Number.isFinite(v)) OFH_OVERLAY_STYLE.alpha = Math.max(0, Math.min(1, v));
  if (typeof markMapOverlayDirty === "function") markMapOverlayDirty();
}

// ── Developer diagnostics ──────────────────────────────────────────────────────────
// OFF by default. Several of these fire once per DECISION — every boat attempt, every
// donate pass, every build gate, every anti-AFK ping — which floods the console during
// normal play and buries anything that actually matters. Enable at runtime with
//   window.__OFH_DEBUG = true
// from the console; no rebuild and no reload needed. console.warn / console.error are
// deliberately NOT routed through here: those report real faults and should always show.
function ofhDebug() {
  try {
    if (!window.__OFH_DEBUG) return;
    console.log.apply(console, arguments);
  } catch (_e) {
    /* never let logging break a caller */
  }
}

// ── Game tick rate ────────────────────────────────────────────────────────────────
// Every countdown the helper shows is computed in GAME TICKS and then converted to
// seconds. Those conversions all assumed a fixed 10 ticks/sec, which is only true at 1x:
// OpenFront's speed control multiplies the real interval between ticks, so at 2x a
// 300-tick build completes in 15 real seconds while a /10 label still reads "30s". Every
// predictor was therefore wrong by exactly the speed multiplier — the tick arithmetic was
// fine, only the units were wrong.
//
// game.config().msPerTick() looks like the answer and is not: upstream it is literally
// `return 100`, a parameterless constant with no speed dependence, so it is numerically
// identical to the /10 it would replace.
//
// The auto-bot already measures the real rate (auto-bot/helpers.js updateSpeedFactor into
// state.speed.factor) but that is unusable here: its only caller is botTick, which returns
// early when the bot is disabled or the lobby is public, so the factor sits frozen at 1 for
// anyone not running the bot. Wiring the overlays to it would apply a 0% correction and look
// like a fix. Hence a meter of our own.
//
// It starts at the documented 10/s baseline, so behaviour is unchanged until a measurement
// lands, and a measured rate is right whether or not the game is actually speed-capped.
var OFH_TICK_BASELINE = 10;
var OFH_TICK_RATE = { lastTick: null, lastMs: 0, perSec: OFH_TICK_BASELINE, seeded: false };

/** Measured game ticks per real second. Self-sampling: every caller that wants a duration
 *  also feeds the estimate, so no separate polling loop is needed. */
function ofhTickRate(game) {
  const s = OFH_TICK_RATE;
  try {
    const t = Number(game.ticks());
    if (!Number.isFinite(t)) return s.perSec;
    const ms = Date.now();
    if (s.lastTick === null || t < s.lastTick) {
      // First sample, or ticks ran backwards — a new game restarted the clock.
      s.lastTick = t;
      s.lastMs = ms;
      return s.perSec;
    }
    const dms = ms - s.lastMs;
    // A window shorter than this straddles too few tick boundaries to mean anything: two
    // samples 30ms apart read either 0/s or 1000/s depending where the boundary fell.
    if (dms >= 500) {
      const dt = t - s.lastTick;
      if (dt > 0) {
        const raw = (dt / dms) * 1000;
        // Band, step cap and first-reading snap, in that order:
        //  - 2..60/s is the plausible range for real game speeds. The old 0.5..400 band
        //    accepted a tick-replay burst after a refocus or reconnect (150 ticks in one
        //    500ms window reads 300/s), and a single accepted burst pulled the estimate up
        //    several-fold, compressing every countdown until it decayed back.
        //  - the 2x step cap blunts any burst that still sneaks under the ceiling.
        //  - the first real reading SNAPS instead of blending, because blending starts from
        //    the 10/s baseline: in a 2x lobby every countdown was wrong for the couple of
        //    seconds it took to converge, and a nuke anchored in that window kept its wrong
        //    ETA for the whole flight (the anchor is taken once).
        if (raw >= 2 && raw <= 60) {
          const capped = Math.min(raw, s.perSec * 2);
          s.perSec = s.seeded ? s.perSec * 0.7 + capped * 0.3 : raw;
          s.seeded = true;
        }
      }
      // Re-anchor either way — a paused stretch must not dilute the next window.
      s.lastTick = t;
      s.lastMs = ms;
    }
  } catch (_e) {
    /* keep the last known rate */
  }
  return s.perSec > 0 ? s.perSec : OFH_TICK_BASELINE;
}

/** Game ticks -> real seconds. THE one conversion; every countdown goes through it. */
function ofhTicksToSeconds(game, ticks) {
  const v = Number(ticks);
  if (!Number.isFinite(v)) return 0;
  const r = ofhTickRate(game);
  return v / (r > 0 ? r : OFH_TICK_BASELINE);
}


function normalizeEconomyHeatmapIntensity(value) {
  const intensity = Number(value);
  if (!Number.isFinite(intensity)) {
    return 1;
  }
  return Math.max(0, Math.min(2, Math.round(intensity)));
}

function escapeCssIdentifier(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getPlayerSmallId(player, fallbackIndex = 0) {
  try {
    return Number(player?.smallID?.() ?? player?.data?.smallID ?? fallbackIndex);
  } catch (_error) {
    return Number(fallbackIndex);
  }
}

function getPlayerDisplayName(player) {
  try {
    return String(
      player?.displayName?.() ??
        player?.name?.() ??
        player?.data?.displayName ??
        player?.data?.name ??
        "Unknown",
    );
  } catch (_error) {
    return "Unknown";
  }
}

function getPlayerRelationToMyPlayer(game, player) {
  let myPlayer = null;
  try {
    myPlayer = game?.myPlayer?.();
    if (!player?.isPlayer?.() || !myPlayer?.isPlayer?.()) {
      return null;
    }
  } catch (_error) {
    return null;
  }

  const playerId = getPlayerSmallId(player, NaN);
  const myPlayerId = getPlayerSmallId(myPlayer, NaN);
  if (Number.isFinite(playerId) && playerId === myPlayerId) {
    return "self";
  }

  try {
    if (player.isFriendly?.(myPlayer) || myPlayer.isFriendly?.(player)) {
      return "ally";
    }
  } catch (_error) {
    return "enemy";
  }

  return "enemy";
}

function getPlayerTeamName(player) {
  try {
    const team = player?.team?.();
    return team == null ? null : String(team);
  } catch (_error) {
    return null;
  }
}

// Color resolution for teams and individual players.
//
// v0.32 moved the game's theme out of core into a client-side ThemeProvider that
// page scope cannot reach — game.config().theme() no longer exists, so the old
// path silently fell through to a stale palette (and for 8+ teams, where the
// game names teams "Team 1".."Team N", that palette has no entry → every team
// collapsed to one fallback color). The live, per-player resolved color IS still
// readable: PlayerView.territoryColor() returns a colord color we can .toHex().
//   • getPlayerColor(player) → that player's exact in-game color (reflects team
//     shade, cosmetics, and colorblind mode), falling back to the team palette.
//   • getTeamColor(team)     → the color of a representative living member of the
//     team (lowest smallID, for stability), so every team is distinct — including
//     8+-team "Team N" — falling back to the palette, then a deterministic color.
// Every path degrades safely if territoryColor() is unavailable on a given build.

function _playerTerritoryHex(player) {
  try {
    const hex = player?.territoryColor?.()?.toHex?.();
    if (typeof hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(hex)) {
      return hex;
    }
  } catch (_error) {
    // PlayerView.territoryColor() unavailable on this build → palette fallback.
  }
  return null;
}

// team name -> color of its representative (lowest-smallID alive member),
// rebuilt once per (game, tick). Lowest smallID (not iteration-order-first)
// keeps a team's swatch stable when a member dies, avoiding render churn.
let _teamRepColorGame = null;
let _teamRepColorTick = -1;
const _teamRepColors = new Map();
const _teamRepSmallIds = new Map();

function _ensureTeamRepColors(game) {
  let tick = Number.NaN;
  try {
    tick = Number(game?.ticks?.());
  } catch (_error) {
    tick = Number.NaN;
  }
  if (
    game === _teamRepColorGame &&
    Number.isFinite(tick) &&
    tick === _teamRepColorTick
  ) {
    return _teamRepColors;
  }
  _teamRepColorGame = game;
  _teamRepColorTick = Number.isFinite(tick) ? tick : -1;
  _teamRepColors.clear();
  _teamRepSmallIds.clear();
  for (const player of getCachedPlayerViews(game)) {
    let alive = false;
    try {
      alive = Boolean(player?.isAlive?.());
    } catch (_error) {
      alive = false;
    }
    if (!alive) {
      continue;
    }
    const team = getPlayerTeamName(player);
    if (!team || team === "Bot") {
      continue;
    }
    const smallId = getPlayerSmallId(player, Number.MAX_SAFE_INTEGER);
    const prevId = _teamRepSmallIds.get(team);
    if (prevId !== undefined && prevId <= smallId) {
      continue;
    }
    const hex = _playerTerritoryHex(player);
    if (hex) {
      _teamRepColors.set(team, hex);
      _teamRepSmallIds.set(team, smallId);
    }
  }
  return _teamRepColors;
}

// Exact in-game color for one player. Returns null (rather than a palette
// guess) for a teamless player when no live color is readable, so callers can
// keep their "no accent" behavior for FFA players on builds without
// territoryColor() — only team players fall back to the shared team color.
function getPlayerColor(player, game = null) {
  const hex = _playerTerritoryHex(player);
  if (hex) {
    return hex;
  }
  const team = getPlayerTeamName(player);
  return team ? getTeamColor(team, game) : null;
}

// Per-game cache for the palette/generated fallback path (rep colors are cached
// separately, per tick). Avoids re-running the lower-case index lookup per row.
let _cachedTeamColorGame = null;
const _cachedTeamColors = new Map();
let _teamColorsLowerCaseIndex = null;

function _getTeamColorsLowerCaseIndex() {
  if (_teamColorsLowerCaseIndex !== null) {
    return _teamColorsLowerCaseIndex;
  }
  _teamColorsLowerCaseIndex = new Map();
  for (const [name, color] of Object.entries(TEAM_COLORS)) {
    _teamColorsLowerCaseIndex.set(name.toLowerCase(), color);
  }
  return _teamColorsLowerCaseIndex;
}

// HSL (h:0-360, s/l:0-100) -> #rrggbb. Standalone so the generated team colors
// below don't depend on any other module's color helpers.
function _hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v) => {
    const n = Math.round((v + m) * 255);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Deterministic distinct color for a team name not in TEAM_COLORS (the game's
// unnamed "Team 1".."Team N" for 8+ teams), so the 8th+ teams never collapse to
// one color even when no live member color is readable. For the "Team N" form we
// spread hues by the golden angle keyed on N, which keeps even adjacent teams
// well separated; any other name falls back to a stable FNV-1a hue.
function _generateTeamColor(name) {
  const str = String(name ?? "");
  const numbered = /(\d+)\s*$/.exec(str);
  if (numbered) {
    const n = Number(numbered[1]);
    return _hslToHex(Math.floor((n * 137.508) % 360), 68, 60);
  }
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = h % 360;
  const sat = 62 + ((h >>> 9) % 18); // 62..79%
  const light = 56 + ((h >>> 17) % 12); // 56..67%
  return _hslToHex(hue, sat, light);
}

function _computeTeamColor(team) {
  const teamKey = String(team ?? "");
  const directMatch = _getTeamColorsLowerCaseIndex().get(teamKey.trim().toLowerCase());
  if (directMatch) {
    return directMatch;
  }
  if (!teamKey) {
    return "#4ade80";
  }
  return _generateTeamColor(teamKey);
}

function getTeamColor(team, game = null) {
  // Primary: the live color of a representative living team member — correct for
  // any team count and tracks colorblind mode. Must run BEFORE the per-game
  // palette cache so an early-game palette color can't shadow it once players
  // spawn and their real colors become readable.
  if (game) {
    const rep = _ensureTeamRepColors(game).get(String(team ?? ""));
    if (rep) {
      return rep;
    }
  }
  // Fallback: palette match, else a deterministic generated color.
  if (game !== _cachedTeamColorGame) {
    _cachedTeamColorGame = game;
    _cachedTeamColors.clear();
  }
  const cacheKey = String(team ?? "");
  const cached = _cachedTeamColors.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const color = _computeTeamColor(team);
  _cachedTeamColors.set(cacheKey, color);
  return color;
}

function getTeamColorBackground(team, game = null) {
  const color = getTeamColor(team, game);
  return `${color}2b`;
}

function isNationBotPlayer(player) {
  try {
    const playerType = player?.type?.() ?? player?.data?.playerType;
    return playerType === "NATION";
  } catch (_error) {
    return false;
  }
}

function getPlayerMarkerId(player, fallbackIndex) {
  try {
    return String(
      player?.id?.() ??
        player?.smallID?.() ??
        player?.data?.id ??
        player?.displayName?.() ??
        fallbackIndex,
    );
  } catch (_error) {
    return String(fallbackIndex);
  }
}

function getPlayerGoldNumber(player) {
  try {
    const gold = player?.gold?.();
    if (typeof gold === "bigint") {
      return Number(gold);
    }
    return Number(gold);
  } catch (_error) {
    return NaN;
  }
}

let _cachedInfoOverlayEl = null;

function getHoveredPlayerInfoOverlay() {
  if (!_cachedInfoOverlayEl?.isConnected) {
    _cachedInfoOverlayEl = document.querySelector("player-info-overlay") ?? null;
  }
  const overlay = _cachedInfoOverlayEl;
  if (!overlay?.player) {
    return null;
  }

  const visible = overlay._isInfoVisible ?? overlay.isInfoVisible;
  if (visible === false) {
    return null;
  }

  return overlay;
}

function getPlayerInfoPanelRect(overlay) {
  const panel =
    overlay.querySelector('[class*="bg-gray-800"]') ??
    overlay.querySelector('[class*="backdrop-blur"]') ??
    overlay;
  const rect = panel.getBoundingClientRect?.();
  if (rect && (rect.width > 0 || rect.height > 0)) {
    return rect;
  }

  return null;
}

function normalizeTradeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findPlayerByTradeName(players, name) {
  const normalizedName = normalizeTradeName(name);
  if (!normalizedName) {
    return null;
  }

  return (
    players.find(
      (player) => normalizeTradeName(getPlayerDisplayName(player)) === normalizedName,
    ) ?? players.find((player) => normalizeTradeName(player?.name?.()) === normalizedName) ?? null
  );
}

// Shared per-tick cache for game.playerViews(). Avoids spawning a new
// Array.from(...) snapshot on every helper render across multiple features.
let _cachedPlayerViewsGame = null;
let _cachedPlayerViewsTick = -1;
let _cachedPlayerViewsArray = [];

function getCachedPlayerViews(game) {
  if (!game) {
    return [];
  }

  let currentTick = Number.NaN;
  try {
    currentTick = Number(game.ticks?.());
  } catch (_error) {
    currentTick = Number.NaN;
  }

  if (
    game === _cachedPlayerViewsGame &&
    Number.isFinite(currentTick) &&
    currentTick === _cachedPlayerViewsTick &&
    _cachedPlayerViewsArray.length > 0
  ) {
    return _cachedPlayerViewsArray;
  }

  _cachedPlayerViewsGame = game;
  _cachedPlayerViewsTick = Number.isFinite(currentTick) ? currentTick : -1;
  try {
    _cachedPlayerViewsArray = Array.from(game.playerViews?.() || []);
  } catch (_error) {
    _cachedPlayerViewsArray = [];
  }
  return _cachedPlayerViewsArray;
}

// FNV-1a-ish 32-bit numeric hash. Used to replace JSON.stringify-based
// render-signature comparison in trade-balances.
function mixHashNumber(hash, value) {
  let h = hash >>> 0;
  let n = value | 0;
  if (n < 0) {
    n = (n + 0x100000000) >>> 0;
  }
  h = (h ^ (n & 0xff)) >>> 0;
  h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  h = (h ^ ((n >>> 8) & 0xff)) >>> 0;
  h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  h = (h ^ ((n >>> 16) & 0xff)) >>> 0;
  h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  h = (h ^ ((n >>> 24) & 0xff)) >>> 0;
  h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  return h;
}

function mixHashString(hash, value) {
  const str = String(value ?? "");
  let h = hash >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}
