// Auto-Bot — constants, shared state, settings persistence.
// Loaded FIRST: declares UNIT, the `state` object (its initializer calls
// loadSettings at load time) and every tuning constant the other modules read.

"use strict";

  // ---- UnitType string constants (src/core/game/Game.ts UnitType enum) ----
  const UNIT = {
    City: "City",
    Port: "Port",
    Factory: "Factory",
    SAMLauncher: "SAM Launcher",
    MissileSilo: "Missile Silo",
    DefensePost: "Defense Post",
    TransportShip: "Transport",
    TradeShip: "Trade",
    Warship: "Warship",
    AtomBomb: "Atom Bomb",
    HydrogenBomb: "Hydrogen Bomb",
    MIRV: "MIRV",
    MIRVWarhead: "MIRV Warhead",
  };

  const PANEL_ID = "openfront-helper-auto-bot-panel";
  const STYLE_ID = "openfront-helper-auto-bot-styles";
  const STORAGE_KEY = "openfront-helper-autobot-v1";

  // ---- defaults, mirroring NationExecution Impossible ranges ----
  const DEFAULTS = {
    enabled: true, // auto-bot ON by default (runs in public lobbies too — the
    // isPublicLobby gate is disabled; see helpers.js)
    // Which difficulty of the in-game Nation AI to faithfully replicate. The bot
    // ports ALL FOUR difficulty branches (Easy/Medium/Hard/Impossible); this
    // selects which one drives strategy order / ratios / probabilities. Default
    // Impossible = the strongest, smartest src Nation.
    difficulty: "Impossible", // "Easy" | "Medium" | "Hard" | "Impossible"
    features: {
      spawn: true,
      expand: true,
      build: true,
      boat: true,
      nuke: true,
      warship: true,
      alliance: true,
      embargo: true, // auto-stop trading (embargo) hostile nations — src-faithful default
      donate: true,
      betray: true, // ON = faithful (the bot may betray an ally to grab a weak/MIRVed
      // one or break a stalemate). Turn OFF to keep the bot LOYAL — it never initiates a
      // betrayal (defensive retaliation against someone already attacking us still works).
    },
    // Which structure types auto-build is allowed to place (user-configurable in
    // the popup). A type set false is never built/upgraded by the bot.
    buildStructures: {
      [UNIT.City]: true,
      [UNIT.Port]: true,
      [UNIT.Factory]: true,
      [UNIT.DefensePost]: true,
      [UNIT.SAMLauncher]: true,
      [UNIT.MissileSilo]: true,
    },
    // ── WIN-FIXES (user-authorised DEVIATIONS from the pure 1:1 src port, to let
    //    the bot snowball to an 80% victory AND play more ACTIVELY than a pure
    //    faithful Nation, which is conservative/turtle by design). Toggle winFixes
    //    OFF to restore the exact 1:1 src port. ──
    winFixes: true,
    // DIVERGENCE (opt-in, NOT in src): economy-first play. Raises the income-structure
    // targets, removes src's per-owned perceived-cost tax, and replaces the ~30M
    // MIRV+Hydrogen war chest with a small SAM-cracking reserve so gold compounds.
    economyFirst: true,
    // DIVERGENCE (opt-in, NOT in src): allow SAM-battery cracking at ANY difficulty
    // (src restricts it to Impossible) and prefer it over spending a warhead on a
    // zero-value target. Sizing/pacing is unchanged — see maybeDestroyEnemySam.
    samCrack: true,
    // DIVERGENCE (opt-in, NOT in src): threat-scaled air defence. src fixes the SAM
    // target at a per-city ratio by difficulty, blind to how much nuclear threat
    // actually exists. samDefense instead sizes it from hostile Missile Silo levels
    // and the map-wide average SAM level per player, prioritises SAMs in the build
    // order while behind, always uses coverage-gap weighting when placing, and
    // upgrades the launcher guarding the most asset value.
    samDefense: true,
    // DIVERGENCE (opt-in, NOT in src): proactive Defense Posts. src only builds them
    // reactively, once incoming land attacks exceed 35% of our troops — by which time
    // the attack has already landed. defensePosts builds them whenever we share a land
    // border with a hostile player, and sizes the count from our estimated gold/min.
    defensePosts: true,
    // DIVERGENCE: smart spawn scoring — scores candidate tiles by land density,
    // plains ratio, distance from enemies, and edge avoidance, then picks the
    // best instead of the first valid random tile. Toggle OFF to restore the
    // faithful random spawn (SpawnExecution.getSpawn).
    smartSpawn: true,
    combatCadenceScale: 0.6, // <1 shrinks the attack-tick interval → the bot makes
    // attack/expand decisions MORE often (more aggressive / less "gentle"; the pure
    // faithful Nation only decides once per attackRate ≈ every 3–5s). 1 = faithful.
    sizeReserveScale: 1.5, // hold back (mapShare × this) troops as we grow (anti-collapse)
    sizeReserveCap: 0.6, // cap on the size-aware reserve
    mirvLeaderShare: 0.4, // once we own ≥ this share, proactively MIRV the strongest rival
    mirvPreemptFrac: 0.85, // pre-empt-MIRV a rival once their gold ≥ this × MIRV price
    // MIRV target rule (user): only MIRV a genuine DOMINANT leader — a nation that owns
    // > mirvTargetMinShare of the map AND ranks in the top mirvTargetTopN by owned tiles.
    mirvTargetMinShare: 0.35, // target must own > 35% of the land
    mirvTargetTopN: 3, // target must be in the top 1–3 by owned tiles
    mirvEarlyGameTicks: 6000, // before this game-tick (≈10 min @ 10 ticks/s) do NOT hoard
    // gold for a MIRV — let the bot fire small atom/hydrogen nukes freely instead
    teamWonShare: null, // OPTIONAL override of the team-win share. Default null = use the
    // game's REAL threshold (Config.percentageTilesOwnedToWin → 0.95 in Team mode). Set a
    // fraction (e.g. 0.9) to switch to "build economy/SAM, stop MIRV-hoarding" a bit early.
    factoryRailShare: 0.75, // once OUR side (team in Team mode, just us in FFA) owns > this
    // fraction of the live map, auto-build STOPS suppressing coastal factories and fills
    // them in → train stations → rail linking ports↔cities (more factories ⇒ higher
    // train-spawn rate ⇒ more trade income). Deliberately BELOW the 0.95 win line: the
    // game ENDS at 95% team share, so factories built that late never run trains. At 0.75
    // the strongest enemy is < 25% (< the 35% MIRV-target floor), so MIRV-hoarding is
    // already off → the factories are funded, not starved. winFixes-gated.
    // ── OPPORTUNISTIC AMPHIBIOUS LANDINGS (NOT in src) ──────────────────────────
    // Faithful Nations boat rarely (chance 5–10% per attack tick, troops/5) and the
    // dominance guard suppresses random boats once we're big — so a dominating bot
    // stops expanding overseas. This winFix adds an ACTIVE landing loop: send CHEAP
    // probe boats (boatProbeFrac of troops) at weak / freshly-MIRV'd overseas nations;
    // if the probe LANDS (we own a tile near the drop), pour a bigger surge force in.
    // A shot-down probe only costs boatProbeFrac troops — the user's key insight.
    boatProbeFrac: 0.01, // the INITIAL probe + every TRANSIT boat carries just 1% of troops:
    // a warship can only sink 1% mid-sea, so crossing the water is cheap/safe. The user
    // wants every boat to CROSS at 1%.
    boatProbeMinTroops: 1000, // tiny floor so a 1% boat is never literally 0 troops
    boatSurgeFrac: 0.25, // …BUT once a probe LANDS and we hold the beachhead (the route is
    // now proven safe), the follow-up "surge" pours in a BIG reinforcement — 25% of troops —
    // to actually CONQUER outward from the beachhead. The user's design: "gửi 1% an toàn khi
    // di chuyển, nhưng tăng nhiều quân để chinh phạt khi đã cập bến." Gated by surplus fill
    // (boatSurplusFill) so it never drains home defence — raise for a harder push.
    oppBoatThrottleMs: 350, // min real-time gap between landing attempts (lower = the bot
    // keeps sending 1% landings far more continuously instead of sitting idle)
    maxConcurrentBoats: 3, // keep up to this many opportunistic transport ships in flight
    // AT ALL TIMES — relaunch the moment one lands/sinks so the bot never sits idle
    boatSpreadRadius: 30, // probes skip a target within this (manhattan) of where one of
    // our boats is ALREADY heading → the 3 boats fan out to different opportunities
    // instead of piling onto one spot (raise to spread wider, lower to allow doubling up)
    mirvBoatWindowTicks: 150, // ticks after our MIRV we keep boating into its crater
    donateThrottleMs: 1200, // min real-time gap between proactive team-donations (winFix) —
    // lowered so the bot donates its above-keep-line excess to teammates far more often
    donateNeedThreshold: 0.8, // donate to any teammate below this fraction of their max
    // troops (i.e. one that actually needs help); pick the neediest first
    donateKeepFrac: 0.45, // keep this fraction of maxTroops when donating to a teammate.
    // The game's troop growth = (10 + troops^0.73/4)·(1 − troops/maxTroops) PEAKS at
    // troops ≈ 0.42·maxTroops, so keeping ~45% means we only give away the "excess"
    // above the fastest-regrowth point — donating barely dents our generation rate.
    // ── SMART DIPLOMACY (winFix) ──────────────────────────────────────────────────
    // The bot allies FAR nations (ones it does NOT border) freely while still expanding.
    // A far nation can't threaten us by land, so the alliance is pure DEFENCE — it keeps
    // a distant nation from turning hostile and raiding our (longest, most lucrative)
    // trade routes. (Trade itself is embargo-gated, NOT alliance-gated, so this secures
    // existing trade rather than creating it.) NEAR nations stay the faithful case-by-
    // case decision. Once we're DOMINANT (state.dominant, driven by factoryRailShare)
    // the bot STOPS reaching out, so the betray/conquer logic can close out the win.
    farAllyThrottleMs: 4000, // min real-time gap between proactive far-ally requests
    // ── SMART WARSHIP PATROL (winFix) ─────────────────────────────────────────────
    // Repositions our EXISTING idle warships to the top naval threat each pass (invasion
    // of our land > a fresh trade-raid lane > a persistent open-water boat-loss lane),
    // instead of the faithful AI's build-first habit. Tiny-pool-safe via throttle +
    // per-warship cooldown + a distance cap.
    warshipPatrolThrottleMs: 1500, // min real-time gap between patrol passes
    warshipMoveMaxDist: 160, // don't drag a warship farther than this (manhattan) to a threat
    warshipMoveCooldownTicks: 60, // a warship just tasked won't be re-tasked for this many ticks
    warshipLossMinDist: 25, // a lost boat counts as an open-water loss only if it died >this
    // (manhattan) from its target — nearer = it landed at the coast (noise, not a kill)
    warshipLossWindowTicks: 900, // remember boat-loss events this long when finding a lane
    warshipRaidWindowTicks: 400, // remember trade-raid tiles this long (raider may move on)
    warshipLossZoneMin: 2, // need ≥ this many losses clustered before committing a ship
    warshipLossZoneRadius: 35, // losses within this (manhattan) form one loss-lane cluster
    warshipRetreatHealthPct: 50, // retreat when HP < this % of max (Blon port)
    warshipHuntTrade: true, // hunt enemy trade ships when no enemies nearby (Blon port)
    warshipCombatThrottleMs: 800, // min gap between combat passes
    warshipAutoSpawn: true, // auto-build new warships (toggle OFF to only control existing ones)
    warshipEvade: true, // evade when battle sim says we lose
    warshipNukeDodge: true, // auto-dodge nuke blast zones
    warshipServiceCellSize: 40, // quantize a threat to a grid cell of this size for the
    // per-ZONE debounce (so a tiny pool doesn't re-task another ship to a lane already
    // being raced to — distinct from the per-warship cooldown)
    warshipZoneServiceTicks: 90, // don't send a 2nd ship to the same zone cell within this
    // ── WARSHIP NUKE AUTO-DODGE (winFix, NOT in src) ───────────────────────────────
    // Điều warship ra khỏi vùng nổ của nuke đang bay (bất kể chủ nhân — một quả nuke
    // giết warship dù ai bắn). Pure movement, chạy mỗi tick TRƯỚC smartWarshipPatrol,
    // gated bởi winFixes. Composes với patrol qua smartState.cooldown dùng chung.
    warshipNukeDodgeMargin: 8, // cộng vào nukeMagnitudes(type).outer để có bán kính "nguy hiểm"
    warshipNukeDodgeBuffer: 20, // đẩy ship ra ngoài bán kính thêm chừng này khi tìm ô né
    warshipNukeDodgeSamples: 8, // số góc lấy mẫu khi tìm ô né (radial + xoay quanh)
    warshipNukeDodgeRings: 3, // số vòng bán kính lấy mẫu khi tìm ô né (xử lý vùng nuke phủ rộng)
    donateMinExcessFrac: 0.05, // only donate when the excess above the keep line is ≥
    // this × maxTroops (avoids spammy micro-donations of a few troops)
    donateMinDonatePct: 0.2, // minimum % of current troops to donate — only fire when
    // the donation amount ≥ this × currentTroops (e.g. 0.2 = wait until we can send
    // a meaningful 20% chunk, dồn lực thay vì rải rác)
    boatWeakTroopFrac: 0.6, // the nearest-target sweep also grabs OWNED coastal land if
    // its owner has < (our troops × this) — i.e. any clearly-weaker nation, per the
    // user's "đất có chủ cũng được, miễn nước đó yếu hơn". Raise → grab near-peers too.
    distantBoatProbeMax: 12, // max enemies probed when hunting a FAR boat target
    boatSurplusFill: 0.4, // only land overseas when troops/maxTroops ≥ this (use SURPLUS
    // only — under land pressure we keep every soldier for defence; this self-regulates
    // the landing aggression so it never bleeds the army that holds our territory).
    // ── NEAREST-ISLAND SWEEP (NOT in src) ──────────────────────────────────────
    // Actively scan for the closest unowned (TerraNullius) islands across water and
    // boat over to grab them — free real estate the faithful AI only reaches by a
    // rare random boat. Free islands don't fight back, so they fire at a LOW fill.
    boatIslandFill: 0.15, // grab a FREE island whenever troops/maxTroops ≥ this (vs the
    // higher boatSurplusFill for contested landings) → keeps landing near-continuous
    islandScanRadius: 40, // half-size (tiles) of the box scanned around each shore point
    islandScanStep: 2, // scan stride (tiles) — 2 still catches small islands, bounds cost
    islandScanSamples: 6, // shore launch points sampled per sweep (rotates each tick)
    islandProbeMax: 4, // max bestTransportShipSpawn probes down the nearest-first list
    tickMs: 200, // engine poll interval (ms); the bot gates on game-ticks internally
    minimized: false,
    hidden: false, // X button hides the whole panel; re-show from the popup Auto Bot tab.
    statusOpen: false, // Control tab: the status + stats block (collapsible).
    featsOpen: true, // Control tab: the 8 auto on/off toggles start EXPANDED
    // compact "🎛 Auto toggles" group (expandable) so status/stats lead the panel.
    pos: null, // {left, top}
  };

  // Throttles (ms) so we don't spam the worker / re-issue intents every tick.
  // Combat decision cadence is now derived per-difficulty in combatCadenceMs()
  // to match the bot's attackRate. Build runs ~3× per combat cycle (economy
  // keeps growing between the slower, defensive attack decisions).
  const MAX_DEFENSE_RESERVE = 0.8; // never hold back more than this for defense
  // Min fraction of ACTUAL troops to commit when grabbing SAFE empty land (no
  // bordering enemies). The maxTroops-based reserve has a ~100k floor while we
  // start with ~25k troops, so it would send only ~18% of our army — far slower
  // than a real nation's opening burst (forceSendAttack troops/2). Terra-nullius
  // doesn't fight back and unspent troops return, so committing ~60% when no
  // enemy borders us is low-risk and fixes the "expand too slow → small → eaten
  // fast in the early game" loss. Drops back to the defensive reserve the moment
  // an enemy borders us.
  const EARLY_EXPAND_COMMIT = 0.6;
  const BUILD_THROTTLE_MS = 1800;
  const NUKE_THROTTLE_MS = 6000;
  // MIRV (late-game super-weapon vs a too-strong enemy): per-target cooldown + the
  // dominance thresholds that mark an enemy "too strong to ignore" (mirror
  // NationMIRVBehavior, Hard tier). All tunable.
  const MIRV_COOLDOWN_MS = 30000; // don't re-MIRV the same target within ~30s
  const MIRV_DOMINANCE_SHARE = 0.5; // enemy controlling ≥50% of land ⇒ MIRV-worthy
  const MIRV_STEAMROLL_MIN_CITIES = 10; // runaway city-leader floor
  const MIRV_STEAMROLL_GAP = 1.25; // leader cities ≥ 1.25× second place
  const WARSHIP_THROTTLE_MS = 4000;
  const ALLIANCE_THROTTLE_MS = 2000;
  const BORDER_CACHE_MS = 2200;

  // Incoming-troops / own-troops ratio above which we start building defense posts.
  const UNDER_ATTACK_RATIO = 0.35;

  const state = {
    settings: loadSettings(),
    tickTimer: null,
    tickIntervalMs: 0,
    tickInFlight: false,
    tickStartedAt: 0,
    lastCombatMs: 0,
    // DIVERGENCE (defensePosts): src has no income signal. Rolling positive-gold-delta
    // accumulator, sampled from structureBehavior; see estimatedGoldPerMinute().
    income: { lastGold: null, earned: 0, samples: [] },
    lastPlayerAttackMs: 0,
    lastRetaliateMs: 0,
    lastBuildMs: 0,
    lastNukeMs: 0,
    lastWarshipMs: 0,
    lastWarshipMoveMs: 0,
    lastWarshipPatrolMs: 0, // proactive pre-positioning of idle ships at weak points
    lastAllianceMs: 0,
    lastEmbargoMs: 0,
    lastDonateMs: 0,
    beachhead: null, // { tile, at, surged } — recent probe-boat drop we surge into once it LANDS
    recentMirvHits: [], // [{ sid, tile, at }] — crater centres of nations we MIRV'd, to boat into
    lastOppBoatMs: 0, // throttle for opportunistic amphibious landings (winFix)
    lastNuker: null, // { sid, at } — player who recently nuked us (retaliate!)
    recentNukes: [], // [{ tile, at }] — tiles WE recently nuked, to avoid re-hitting
    // the same cluster while the first bomb is still in flight (mirrors the game
    // bot's recentlySentNukes / −1M penalty). Pruned by age in nuke.js.
    hostility: new Map(), // smallID -> accumulated aggression score (relation proxy)
    nukeReserveGold: 0, // gold the build loop keeps in reserve for the next nuke
    nukeWantSlots: null, // { need, at } — silo slots wanted to saturate an enemy SAM
    lastMirv: null, // { sid, at } — last MIRV target+time (per-target cooldown)
    navalThreatAt: 0, // ts of last enemy ship/transport near our ports (build extra hulls)
    // Game-speed tracking: the game's tick rate changes with the speed setting.
    // We measure real ticks/sec vs the ~10/s baseline and shrink our real-time
    // cadences accordingly, so the bot acts on the same GAME-TICK schedule as the
    // built-in bots at any speed (max speed included).
    speed: { lastTick: null, lastMs: 0, factor: 1 },
    border: { tiles: null, atMs: 0 },
    // smallIDs of enemies we share a LAND border with (set each combat tick).
    // Warship patrol excludes these as naval-invasion sources — a land border
    // means the threat comes overland, not by sea, so no warship needed there.
    landBorderEnemySids: new Set(),
    // Empty until the first watcher tick sets a localized status (i18n's t() is
    // not available at load time — this module is evaluated before the bundle
    // arrives, so we can't translate here).
    status: "",
    lastAction: "—",
    stats: { spawns: 0, attacks: 0, builds: 0, nukes: 0 },
    live: { troops: 0, gold: 0, tiles: 0, fill: 0 },
    // In-memory action history (newest first) for the "Log" tab. Not persisted —
    // a fresh game starts with an empty log.
    log: [], // [{ t: epochMs, cat, text }]
    activeTab: "control", // "control" | "log"
    logFilter: "all", // "all" | one of LOG_CATS keys
  };

  // Action-log categories: { key: { label, emoji } }. `label` is an i18n key
  // (English source text), translated via t() at render time. The order here is
  // the order the filter chips render in.
  const LOG_CATS = {
    spawn: { label: "Spawn", emoji: "🏁" },
    combat: { label: "Combat", emoji: "⚔️" },
    naval: { label: "Naval", emoji: "🚢" },
    build: { label: "Building", emoji: "🏗️" },
    nuke: { label: "Strikes", emoji: "☢️" },
    diplo: { label: "Diplomacy", emoji: "🤝" },
  };
  const LOG_CAP = 200; // ring-buffer size for the action history

  // =========================================================================
  // Settings persistence (page localStorage; survives reloads, no chrome dep)
  // =========================================================================
  function loadSettings() {
    // PERSISTED_KEYS is declared LOCALLY (not module-level) ON PURPOSE: `state.settings
    // = loadSettings()` runs BEFORE a module-level `const` further down would be
    // initialised, so referencing it there hit the temporal dead zone → this whole
    // function threw → the catch below swallowed it → EVERY persisted setting (pos,
    // enabled, difficulty, …) was silently lost and bare DEFAULTS were used. Declaring
    // it here initialises it exactly when it is needed.
    // Only these USER-FACING keys are restored from localStorage; every other DEFAULT
    // (tuning: boat/donate/mirv fractions, throttles…) always comes from the code, so an
    // old saved value (e.g. boatProbeMinTroops=8000) can't mask a new default (1000).
    const PERSISTED_KEYS = [
      "enabled",
      "difficulty",
      "winFixes",
      "economyFirst",
      "samCrack",
      "samDefense",
      "defensePosts",
      "smartSpawn",
      "minimized",
      "hidden",
      "statusOpen",
      "featsOpen",
      "pos",
      "tickMs",
      // Donate tuning
      "donateKeepFrac",
      "donateNeedThreshold",
      "donateThrottleMs",
      "donateMinDonatePct",
      // Warship tuning
      "warshipRetreatHealthPct",
      "warshipHuntTrade",
      "warshipCombatThrottleMs",
      "warshipAutoSpawn",
      "warshipEvade",
      "warshipNukeDodge",
      "warshipPatrolThrottleMs",
    ];
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of PERSISTED_KEYS) {
          if (parsed[k] !== undefined) s[k] = parsed[k];
        }
        s.features = { ...DEFAULTS.features, ...(parsed.features || {}) };
        s.buildStructures = {
          ...DEFAULTS.buildStructures,
          ...(parsed.buildStructures || {}),
        };
      }
    } catch (error) {
      console.warn("[AutoBot] failed to load settings:", error);
    }
    return s;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (error) {
      console.warn("[AutoBot] failed to save settings:", error);
    }
  }
