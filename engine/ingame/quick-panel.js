// Quick Panel — a compact tabbed floating control panel (slate-glass style) for
// fast settings toggles and WS-injected actions. Mirrors the Helpers popup sections
// plus adds Combat/Theme/Config tabs from Project Blon.
//
// Style is consistent with the existing in-game panel system (advisor-panel.js,
// gold-per-minute.js). Uses the shared makeGoldStatPanelDraggable pattern for drag.
// Fully themeable via CSS custom properties on :root.
//
// Constants (QUICK_PANEL_ID, QUICK_PANEL_STYLE_ID, QUICK_PANEL_POS_KEY,
// quickPanelEnabled) are defined in runtime.js (loaded first).

  var quickPanelActiveTab = "actions";
  var _quickPanelSettingsCache = null;
  var _langDropdownCloseBound = false;

  // Popover — uses unique class (.qp-feat-tip) to avoid being removed by
  // auto-bot panel's rebuild cycle (which cleans up .ab-feat-tip elements).
  var _qpPopoverEl = null;
  var _qpPopoverTimer = null;
  var _QP_POPOVER_DELAY = 100; // ms before popover appears
  function _showQpPopover(el, html, delay) {
    if (delay === undefined) delay = _QP_POPOVER_DELAY;
    _hideQpPopover(); // cancel any pending timer
    var timer = setTimeout(function() {
      // Guard: if the element was removed from DOM (e.g. by auto-bot cleanup),
      // recreate it.
      if (_qpPopoverEl && !_qpPopoverEl.parentNode) {
        _qpPopoverEl = null;
      }
      if (!_qpPopoverEl) {
        _qpPopoverEl = document.createElement("div");
        _qpPopoverEl.className = "qp-feat-tip";
        document.body.appendChild(_qpPopoverEl);
      }
      _qpPopoverEl.innerHTML = html;
      var r = el.getBoundingClientRect();
      _qpPopoverEl.style.left = (r.left + r.width / 2) + "px";
      _qpPopoverEl.style.top = (r.top - 6) + "px";
      _qpPopoverEl.classList.add("show");
    }, delay);
    _qpPopoverTimer = timer;
  }
  function _hideQpPopover() {
    if (_qpPopoverTimer) { clearTimeout(_qpPopoverTimer); _qpPopoverTimer = null; }
    if (_qpPopoverEl) _qpPopoverEl.classList.remove("show");
  }

  // Feature tips — [label, detailed description] for hover tooltips.
  // Descriptions based on actual code implementation.
  var QP_FEATURE_TIPS = {
    // === Actions Tab - Section Headers ===
    "Kill Shot": ["Kill Shot", "One-click attack on the tile under your cursor. Auto-calculates the exact troop amount needed (110% of enemy) to guarantee a kill. If tile is empty, sends 10% to conquer."],
    "Embargo": ["Embargo", "Block or allow trade with all non-allied human players. 'Embargo All' stops exports to enemies; 'Trade All' lifts all embargoes."],
    "Silo Tracker": ["Silo Tracker", "Scans all Missile Silos on the map and lists hostile silos with owner, coordinates, level, and build status. Plays audio ping when new enemy silo detected."],
    "SAM Tracker": ["SAM Tracker", "Scans all SAM Launchers and lists hostile SAMs. Each row has a nuke button to fire at that SAM's location. Helps identify SAM coverage gaps."],
    "Auto Donate Troops": ["Auto Donate Troops", "Automatically donate troops to the neediest teammate in combat. Runs every 3s when your troops exceed the keep threshold. Finds ally with lowest troop percentage."],
    "Auto Donate Gold": ["Auto Donate Gold", "Automatically donate gold to the poorest ally when your gold exceeds the threshold. Runs every 3s. Finds ally with lowest gold amount (can donate to allies, not just teammates)."],
    "Atom batch-fire": ["Atom Batch-fire", "Fire a sequence of nukes at a target. Configure atoms-per-burst and delay between shots. Can overwhelm SAM defenses with decoy nukes."],

    // === Actions Tab - Toggle Keys ===
    killShotInstantSend: ["Instant Send", "Bypass the attack ratio slider and fire troops immediately when the kill shot hotkey is pressed. No confirmation dialog — sends 110% of enemy troops directly."],
    combatSiloPanel: ["Silo Tracker Panel", "Show/hide the floating silo tracker panel listing all hostile Missile Silos."],
    combatSiloShowAll: ["Show All Silos", "Show silos from all players including allies and teammates (spectator mode)."],
    combatSiloBuildingOnly: ["Building Only", "Only show silos that are currently under construction, not placed ones."],
    combatSiloAudioAlert: ["Audio Ping", "Play a sound when a new enemy silo is first detected being placed."],
    combatSiloOneClickFire: ["One-click Fire", "When enabled, the nuke button fires the recommended atom salvo immediately instead of opening the batch-fire dialog. Shows a toast with the reason when firing isn't possible right now."],
    combatSiloAutoFireBuilding: ["Auto Fire Building", "Automatically nukes enemy Missile Silos that are still under construction, denying them before they ever fire a nuke. A Silo can't intercept, so — unlike the SAM version — it fires as soon as it's affordable/achievable (same check as one-click fire), with no race against construction time. Capped by \"Max nuke auto fire\"."],
    combatSamTracker: ["SAM Tracker Panel", "Show/hide the floating SAM tracker panel listing all hostile SAM Launchers."],
    combatSamShowAll: ["Show All SAMs", "Show SAMs from all players including allies and teammates (spectator mode)."],
    combatSamBuildingOnly: ["Building Only SAMs", "Only show SAMs that are currently under construction, not placed ones."],
    combatSamOneClickFire: ["One-click Fire", "When enabled, the nuke button fires the recommended atom salvo immediately instead of opening the batch-fire dialog. Shows a toast with the reason when firing isn't possible right now."],
    combatSamAutoFireBuilding: ["Auto Fire Building", "Automatically nukes enemy SAM Launchers that are still under construction, undefended, and not covered by another SAM's range — only when a shot is guaranteed to land before construction finishes. Capped by \"Max nuke auto fire\"."],
    autoDonateEnabled: ["Enable Troop Donation", "Automatically donate troops to specifically named players (from the recipient list) who are in combat, picking the one with lowest troop percentage."],
    autoDonateGoldEnabled: ["Enable Gold Donation", "Automatically donate gold to specifically named players (from the recipient list) when your gold exceeds threshold, picking the poorest."],
    lastHydrogen: ["Final Shot → Hydrogen", "Convert the last nuke in a batch to a Hydrogen Bomb for maximum damage."],

    // === Helpers Tab - Section Keys ===
    panels: ["Panels", "Toggle floating panels: stats, trade, advisor, boat, estate, alliance, script users, auto-bot, auto-join."],
    map: ["Map Overlays", "Toggle visual overlays on the map: troop bars, money, threats, nuke prediction, heatmaps, spawn markers."],
    combat: ["Combat & Automation", "Toggle combat features: retaliation HUD, nuke suggestions, SOS defense, attack hotkey, right-click conquest, enemy intent."],
    alerts: ["Alerts", "Toggle alert notifications: game-time alert, incoming boat warning."],
    tools: ["Tools", "Toggle utility tools: hide ads, round logger, network logger, mark bot nations red."],

    // === Helpers Tab - Toggle Keys (Panels) ===
    showTopGoldPerMinute: ["Player Stats Panel", "Sortable table of all players — rank, name, owned tiles, gold, gold/min, and max troops. Click the + button to also show per-player structure counts (City, Port, Factory, Defense Post, SAM Launcher, Missile Silo). Click a column header to sort; hovering a player's row on the map pins it at the bottom. Draggable."],
    showGoldPerMinute: ["Highlight Hovered Player", "Shows a gold-per-minute badge for the player currently under your cursor. Also highlights the hovered player's row in the Player Stats panel with a pinned footer."],
    showTeamBuildStats: ["Team Build Stats", "Lists each team's structure counts (City, Port, Factory, SAM, Silo) with economy stats. Alerts when enemy builds first Missile Silo."],
    showTradeBalances: ["Trade Balances", "Shows trade data when hovering a player: imports, exports, ROI, break-even time, and top 5 trade partners."],
    showAdvisorPanel: ["Advisor Panel", "Strategic summary: economy state, troops vs max, growth efficiency, safe-to-spend, and top 6 enemy threats ranked by danger."],
    showBoatPanel: ["Boat Panel", "Lists all transport boats (sent and incoming) with live ETA. Click to pan camera; hover to highlight route on map."],
    showEstatePanel: ["Estates Panel", "Lists each separate connected parcel of land you own with tile count. Click to pan camera to that parcel."],
    showAllianceRequestsPanel: ["Alliance Requests", "Shows pending alliance requests with accept/reject buttons and countdown timers. Includes auto-renew toggle for expiring alliances."],
    showHelperUsers: ["Script Users", "Detects other players running the same script via emoji broadcast handshake. Shows detected users with name, color, and relation."],
    showAutoBotPanel: ["Auto-Bot Panel", "Floating control panel with master on/off, auto-toggles (spawn, expand, nuke, etc.), config, and action log."],
    showFloatingAutoJoinPanel: ["Auto-Join Panel", "On-page auto-join toggle with game-found notifications and lobby forecast display."],

    // === Helpers Tab - Toggle Keys (Map Overlays) ===
    showPlayerMapOverlays: ["Player Overlays (Master)", "Master toggle for all player name overlays. Individual sub-overlays only render when this is enabled."],
    showMapTroopCounts: ["Troop Bar", "Horizontal bar above each player's name showing troops/max ratio. Green = home troops, orange = troops in combat."],
    showMapMoney: ["Money Overlay", "Gold pill above each player's name showing current gold ($K/$M format). Combines with troop bar when both enabled."],
    showThreatIndicators: ["Threat Indicators", "Colored marks near enemies: nuke icon if nuke-capable, red dot if stronger (>=1.35x), amber dot if weak (<=10% max)."],
    markHoveredAlliesGreen: ["Ally Markers", "When hovering a nation, allied players get a green highlight to distinguish them from enemies on the map."],
    showAttackHighlight: ["Attack Highlight", "Pulsing red rings around attackers with dashed lines to your territory. Shows total incoming troop count. Skips teammates."],
    showNukePrediction: ["Nuke Prediction", "Landing zone markers for in-flight nukes with crosshairs, nuke type, count, and time-to-impact ETA. Colored by relation."],
    showNukeTrajectory: ["Trajectory Line", "Dashed parabolic flight path from each nuke to its landing tile. Uses exact game physics for accurate arc rendering."],
    showBoatPrediction: ["Boat Prediction", "Landing markers for incoming transport ships with owner name and ETA. Click to pan camera to the boat."],
    showWarshipRoutes: ["Warship Routes", "Dashed route lines and destination markers for all warships. Colored by relation (blue=self, red=enemy)."],
    showEconomyHeatmap: ["Economy Heatmap", "Radial gradient heatmap of economic activity. Intensity based on gold revenue from City, Port, and Factory structures."],
    showExportPartnerHeatmap: ["Export Partner Heatmap", "Shows where your trade exports originate from when hovering a player. Teal-yellow-blue gradient. Mutually exclusive with economy heatmap."],
    showSpawnHeatmap: ["Spawn Heatmap", "Full-screen heatmap scoring every grid cell by spawn quality. Considers land density, player proximity, and spawn intents."],
    showSpawnMarkers: ["Spawn Markers", "Colored markers on the map at each player's chosen spawn location during the spawn phase."],
    showBuildTimers: ["Build Timers", "Construction countdown timers above Missile Silos and SAM Launchers. Shows remaining build time and missile cooldown."],

    // === Helpers Tab - Toggle Keys (Combat & Automation) ===
    showRetaliationHud: ["Retaliation HUD", "Center-screen alert when enemy nuke targets your territory. Shows attacker name with 'Focus' button to pan camera to launch source."],
    showNukeSuggestions: ["Nuke Suggestions", "Hover-target nuke strike suggestions for optimal targets. Includes economic nuke suggestions and SAM burn logic."],
    sosDefense: ["SOS Defense", "Auto-sends distress emoji (🆘) to allies/teammates when under attack and marks attackers in allied HUDs. SOS emoji rate-limited to 12s; attacker targeting every 16s."],
    attackRatioHotkey: ["Attack Ratio Hotkey", "Shift+1 through Shift+0 to set attack ratio slider to 10%-100%. Finds the slider in shadow DOM and updates it."],
    rightClickConquest: ["Right-click Conquest", "Right-click context menu near enemy shows capture assessment (easy/moderate/risky), one-click attack, and alliance policy buttons."],
    showEnemyIntent: ["Enemy Intent Warning", "Polls incomingAttacks() to maintain 15-second TTL warnings for enemy attacks. Shared data layer consumed by attack-highlight overlay and advisor panel. Does NOT detect boats."],

    // === Helpers Tab - Toggle Keys (Alerts) ===
    showGameTimeAlert: ["Game-time Alert", "One-shot center-screen notice when match reaches configurable time (default 5 minutes). Blue info-toned design."],
    warnIncomingBoats: ["Incoming Boat Warning", "Alert when new enemy transport detected heading for your territory. Shows attacker name with 'Focus' button. Auto-dismisses after 9s."],

    // === Helpers Tab - Toggle Keys (Tools) ===
    hideAds: ["Hide Ads", "Injects a style tag to hide game ad containers (Google Ads, iframes, ad wrappers) using multiple CSS techniques: display:none, visibility:hidden, zero-sizing, and pointer-events:none."],
    antiAfk: ["Anti-AFK", "Prevents AFK detection when tab is in background. Uses Web Worker to send periodic WebSocket pings."],
    roundLogger: ["Round Logger", "Records game events (match start, large troop changes, network activity) as a JSON timeline in localStorage, flushed every 5s. Useful for debugging bot behavior and match analysis."],
    networkLogger: ["Network Logger", "Hooks XMLHttpRequest to record network metadata (URL, method, status, timing). Max 500 entries. Does NOT capture response bodies."],
    markBotNationsRed: ["Mark Bot Nations Red", "Draws red glowing dots on the map above AI-controlled nations to distinguish them from human players."],

    // === Config Tab - Section Headers ===
    "Theme": ["Theme Settings", "Customize panel colors with presets (green, blue, red, etc.) or custom hex/HSL. Adjusts accent color, opacity, and rainbow mode."],
    "Language": ["Language", "Change the script's display language. Supports multiple languages via i18n system. Triggers full panel re-render."],
    "Skin Unlocker (all skins)": ["Skin Unlocker", "Unlocks all available skins. May require page reload. Can cause slight lag in-game on weaker devices."],
    "Low lag mode": ["Low Lag Mode", "Throttles overlays to ~20fps for weaker devices. Reduces scan frequencies and disables non-essential animations."],
    "Reset all settings": ["Reset All Settings", "Resets all settings to defaults. Reloads the page to apply changes."],

    // === Config Tab - Toggle Keys ===
    rainbowMode: ["Rainbow Mode", "Cycles through all accent colors automatically for a rainbow effect on all panels and overlays."],
    skinUnlocker: ["Skin Unlocker", "Unlocks all available skins. May require page reload. Can cause slight lag in-game on weaker devices."],
    lowLagMode: ["Low Lag Mode", "Throttles overlays to ~20fps for weaker devices. Reduces scan frequencies and disables non-essential animations."],
  };

  // ---- Theme engine ----

  var _themePresets = {
    green:  "#00ff66",
    blue:   "#2962ff",
    red:    "#ff3333",
    yellow: "#ffcc00",
    purple: "#cc44ff",
    cyan:   "#44ddff",
    orange: "#ff6600",
    gray:   "#aaaaaa",
  };

  function _hexToRgb(hex) {
    var s = String(hex || "").trim();
    // Handle HSL: hsl(h,s%,l%)
    var hsl = s.match(/^hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i);
    if (hsl) {
      var h = Number(hsl[1]) / 360;
      var sl = Number(hsl[2]) / 100;
      var l = Number(hsl[3]) / 100;
      var r, g, b;
      if (sl === 0) { r = g = b = l; } else {
        var q = l < 0.5 ? l * (1 + sl) : l + sl - l * sl;
        var p = 2 * l - q;
        r = _hue2rgb(p, q, h + 1/3);
        g = _hue2rgb(p, q, h);
        b = _hue2rgb(p, q, h - 1/3);
      }
      return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }
    // Handle hex
    var c = s.replace(/^#/, "");
    if (!/^[0-9a-f]{3,6}$/i.test(c)) return null;
    if (c.length === 3) c = c.split("").map(function(ch){return ch+ch;}).join("");
    return {
      r: parseInt(c.substring(0,2), 16),
      g: parseInt(c.substring(2,4), 16),
      b: parseInt(c.substring(4,6), 16),
    };
  }

  function _hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }

  function _applyTheme(accentHex) {
    var rgb = _hexToRgb(accentHex);
    if (!rgb) return;
    var root = document.documentElement;
    root.style.setProperty("--oh-accent", accentHex);
    root.style.setProperty("--oh-accent-r", rgb.r);
    root.style.setProperty("--oh-accent-g", rgb.g);
    root.style.setProperty("--oh-accent-b", rgb.b);
    // Derive a muted accent for switch backgrounds
    root.style.setProperty("--oh-accent-muted", "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.6)");
    root.style.setProperty("--oh-accent-soft", "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.15)");
    _ensureThemeOverrides();
  }

  function _ensureThemeOverrides() {
    var id = "openfront-helper-theme-overrides";
    if (document.getElementById(id)) return;
    var s = document.createElement("style");
    s.id = id;
    // Override key colors on all floating panels using CSS vars. The !important
    // is needed because panel-specific styles use IDs (high specificity).
    s.textContent = [
      // All floating panels, badges, containers, stats, dialogs, menus + popup.
      '[id^="openfront-helper-"][id$="-panel"],',
      '[id^="openfront-helper-"][id$="-badge"],',
      '[id^="openfront-helper-"][id$="-container"],',
      '[id^="openfront-helper-"][id$="-stats"],',
      '[id^="openfront-helper-"][id$="-menu"],',
      '[id^="openfront-helper-"][id$="-dialog"],',
      '[id="openfront-helper-popup"] {',
      "  border-color: var(--oh-panel-border, rgba(148,163,184,0.34)) !important;",
      "  background: var(--oh-panel-bg, rgba(12,18,20,0.92)) !important;",
      "}",
      // Popup switch/accent elements — use blue slate fallbacks.
      '[id="openfront-helper-popup"] .ofh-switch.on {',
      "  background: var(--oh-accent-muted, rgba(96,165,250,0.6)) !important;",
      "}",
      '[id="openfront-helper-popup"] .ofh-tab.active {',
      "  color: var(--oh-panel-text, #e2e8f0) !important;",
      "  background: var(--oh-accent-soft, rgba(96,165,250,0.14)) !important;",
      "  border-color: var(--oh-accent-muted, rgba(96,165,250,0.28)) !important;",
      "}",
      '[id="openfront-helper-popup"] .ofh-btn {',
      "  border-color: var(--oh-accent-muted, rgba(96,165,250,0.3)) !important;",
      "  background: var(--oh-accent-soft, rgba(96,165,250,0.16)) !important;",
      "}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function _themeFromSettings() {
    var accent = _getSetting("guiAccentColor", "#00ff66") || "#00ff66";
    var opacity = Number(_getSetting("guiOpacity", 1) || 1);
    var ovOpacity = Number(_getSetting("overlayOpacity", 1) || 1);
    var root = document.documentElement;
    _applyTheme(accent);
    root.style.setProperty("--oh-panel-opacity", String(opacity));
    root.style.setProperty("--oh-overlay-opacity", String(ovOpacity));
    root.style.setProperty("--oh-panel-bg", "rgba(12,18,20," + (0.92 * opacity).toFixed(2) + ")");
    root.style.setProperty("--oh-panel-border", "rgba(148,163,184," + (0.34 * opacity).toFixed(2) + ")");
    root.style.setProperty("--oh-panel-text", "rgba(226,232,240," + String(opacity) + ")");
    root.style.setProperty("--oh-panel-text-dim", "rgba(148,163,184," + (0.85 * opacity).toFixed(2) + ")");
    root.style.setProperty("--oh-panel-header-border", "rgba(148,163,184," + (0.18 * opacity).toFixed(2) + ")");
    _applyThemeToAllPanels();
  }

  // Apply the current theme to every openfront-helper DOM element via inline
  // !important styles. This is the most reliable way to override hardcoded panel
  // colors regardless of specificity, loading order, or CSS architecture.
  var _lastPanelTheme = "";
  var _panelThemeTimer = null;
  function _applyThemeToAllPanels() {
    var bg = "var(--oh-panel-bg, rgba(12,18,20,0.92))";
    var border = "var(--oh-panel-border, rgba(148,163,184,0.34))";
    var key = bg + "|" + border;
    var els = document.querySelectorAll('[id^="openfront-helper-"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === "STYLE" || el.tagName === "CANVAS" || el.tagName === "SVG") continue;
      if (el.id.indexOf("-layer") !== -1 || el.id.indexOf("-styles") !== -1) continue;
      // Transparent, pointer-events:none full-viewport overlays (aiming rings,
      // range previews) are not themed panels — forcing an opaque panel
      // background onto a position:fixed;inset:0 element blankets the whole
      // screen. Excluded by id, same as -layer/-styles above.
      if (el.id.indexOf("-range") !== -1) continue;
      el.style.setProperty("background", bg, "important");
      el.style.setProperty("border-color", border, "important");
    }
    // Keep running periodically to catch newly created panels (lazy init).
    if (!_panelThemeTimer) {
      _panelThemeTimer = setInterval(function() {
        _applyThemeToAllPanels();
      }, 2000);
    }
  }

  // ---- Styles (CSS-var-driven, slate-glass base) ----

  function ensureQuickPanelStyles() {
    if (document.getElementById(QUICK_PANEL_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = QUICK_PANEL_STYLE_ID;
    style.textContent = [
      "#" + QUICK_PANEL_ID + " {",
      "  position:fixed; z-index:8000;",
      "  width:270px; max-height:520px; display:none;",
      "  border:1px solid var(--oh-panel-border); border-radius:8px;",
      "  background:var(--oh-panel-bg); color:var(--oh-panel-text);",
      "  font:700 11px/1.15 'Aptos','Trebuchet MS','Segoe UI',sans-serif;",
      "  box-shadow:0 10px 26px rgba(0,0,0,0.4),0 0 16px var(--oh-accent-soft);",
      "  pointer-events:auto; user-select:none; overflow:hidden; flex-direction:column;",
      "}",
      "#" + QUICK_PANEL_ID + "[data-visible='true'] { display:flex; }",
      "#" + QUICK_PANEL_ID + "[data-minimized='true'] .ohqp-tabs,",
      "#" + QUICK_PANEL_ID + "[data-minimized='true'] .ohqp-body { display:none; }",
      ".ohqp-header {",
      "  display:flex; align-items:center; gap:6px; padding:6px 8px;",
      "  border-bottom:1px solid var(--oh-panel-header-border); cursor:grab;",
      "  touch-action:none; flex-shrink:0;",
      "}",
      ".ohqp-header:active { cursor:grabbing; }",
      ".ohqp-title {",
      "  flex:1; font-size:10px; font-weight:900; text-transform:uppercase;",
      "  letter-spacing:0.4px; color:var(--oh-panel-text-dim);",
      "}",
      ".ohqp-conn { font-size:8px; margin-right:2px; }",
      ".ohqp-conn[data-status='connected'] { color:#4ade80; }",
      ".ohqp-conn[data-status='disconnected'] { color:#f87171; }",
      ".ohqp-min-btn {",
      "  display:inline-flex; align-items:center; justify-content:center;",
      "  width:20px; height:20px; border:1px solid var(--oh-panel-border);",
      "  border-radius:6px; background:rgba(15,23,42,0.5); color:var(--oh-panel-text);",
      "  font-size:12px; font-weight:800; cursor:pointer;",
      "}",
      ".ohqp-min-btn:hover { background:var(--oh-accent-soft); }",
      ".ohqp-tabs {",
      "  display:flex; background:rgba(0,0,0,0.25);",
      "  border-bottom:1px solid var(--oh-panel-header-border); flex-shrink:0;",
      "}",
      ".ohqp-tabs button {",
      "  flex:1; padding:5px 0; text-align:center; font-size:12px; cursor:pointer;",
      "  background:rgba(148,163,184,0.08); border:1px solid rgba(148,163,184,0.15);",
      "  border-radius:8px; color:var(--oh-panel-text-dim);",
      "  transition:background 0.14s, border-color 0.14s;",
      "}",
      ".ohqp-tabs button:hover { background:rgba(148,163,184,0.15); border-color:var(--oh-accent-muted); }",
      ".ohqp-tabs button.active {",
      "  background:var(--oh-accent-soft); border-color:var(--oh-accent-muted);",
      "  color:var(--oh-panel-text);",
      "}",
      ".ohqp-body {",
      "  flex:1; overflow-y:auto; overflow-x:hidden; padding:8px 10px;",
      "}",
      ".ohqp-body > div { display:none; }",
      ".ohqp-body > div.active { display:block; }",
      ".ohqp-sec { margin-bottom:6px; }",
      ".ohqp-sec-h {",
      "  display:flex; align-items:center; gap:4px; padding:4px 6px;",
      "  background:rgba(148,163,184,0.08); border:1px solid rgba(148,163,184,0.15);",
      "  border-radius:8px; cursor:pointer; font-size:10px; font-weight:900;",
      "  text-transform:uppercase; letter-spacing:0.3px; color:var(--oh-panel-text-dim);",
      "  transition:opacity 0.14s, background 0.14s, border-color 0.14s;",
      "}",
      ".ohqp-sec-h:hover { background:rgba(148,163,184,0.15); border-color:var(--oh-accent-muted); }",
      ".ohqp-sec-h.open {",
      "  background:var(--oh-accent-soft); border-color:var(--oh-accent-muted);",
      "}",
      ".ohqp-sec-h .ohqp-chevron { font-size:9px; transition:transform 0.15s; }",
      ".ohqp-sec-h.open .ohqp-chevron { transform:rotate(90deg); }",
      ".ohqp-sec-b { display:none; padding:3px 0 3px 2px; }",
      ".ohqp-sec-b.open { display:block; }",
      ".ohqp-row {",
      "  display:flex; align-items:center; justify-content:space-between;",
      "  padding:2px 4px; gap:8px;",
      "}",
      ".ohqp-row .ohqp-label {",
      "  font-size:10px; color:var(--oh-panel-text); flex:1; overflow:hidden;",
      "  text-overflow:ellipsis; white-space:nowrap;",
      "}",
      ".ohqp-tip-icon {",
      "  display:inline-flex; align-items:center; justify-content:center;",
      "  width:14px; height:14px; border-radius:50%;",
      "  border:1px solid rgba(148,163,184,0.35);",
      "  font-size:9px; font-weight:700; cursor:help;",
      "  color:var(--oh-panel-text-dim); flex-shrink:0; margin-right:4px;",
      "  transition:background 0.14s, border-color 0.14s, color 0.14s;",
      "}",
      ".ohqp-tip-icon:hover {",
      "  background:var(--oh-accent-soft); border-color:var(--oh-accent-muted);",
      "  color:var(--oh-accent);",
      "}",
      ".ohqp-sec-h .ohqp-tip-icon {",
      "  margin-left:auto; margin-right:0;",
      "}",
      ".ohqp-sw {",
      "  width:26px; height:14px; border-radius:7px; flex-shrink:0; cursor:pointer;",
      "  background:rgba(148,163,184,0.25); position:relative;",
      "}",
      ".ohqp-sw.on { background:var(--oh-accent-muted); }",
      ".ohqp-sw::after {",
      "  content:''; position:absolute; width:10px; height:10px; border-radius:50%;",
      "  background:#e2e8f0; top:2px; left:2px; transition:left 0.15s;",
      "}",
      ".ohqp-sw.on::after { left:14px; }",
      ".ohqp-btn {",
      "  padding:4px 8px; background:rgba(15,23,42,0.5);",
      "  border:1px solid var(--oh-panel-border); border-radius:4px;",
      "  color:var(--oh-panel-text); font:700 10px/1.15 'Aptos','Trebuchet MS','Segoe UI',sans-serif;",
      "  cursor:pointer;",
      "}",
      ".ohqp-btn:hover { background:var(--oh-accent-soft); }",
      ".ohqp-btn.danger { border-color:rgba(248,113,113,0.4); color:#fca5a5; }",
      ".ohqp-btn.danger:hover { background:rgba(248,113,113,0.15); }",
      ".ohqp-input {",
      "  width:100%; background:rgba(0,0,0,0.3); border:1px solid var(--oh-panel-border);",
      "  border-radius:3px; color:var(--oh-panel-text); padding:2px 4px;",
      "  font:10px monospace; box-sizing:border-box;",
      "}",
      ".ohqp-select {",
      "  width:100%; background:rgba(0,0,0,0.3); border:1px solid var(--oh-panel-border);",
      "  border-radius:3px; color:var(--oh-panel-text); padding:2px 4px;",
      "  font:10px monospace; box-sizing:border-box;",
      "}",
      ".ohqp-range { flex:1; min-width:40px; height:4px; accent-color:var(--oh-accent); }",
      ".ohqp-presets { display:grid; grid-template-columns:repeat(4,1fr); gap:3px; margin-bottom:8px; }",
      ".ohqp-presets button {",
      "  padding:4px 2px; border-radius:3px; font:700 9px monospace; cursor:pointer;",
      "  border:1px solid var(--oh-panel-border); background:rgba(0,0,0,0.3);",
      "  color:var(--oh-panel-text);",
      "}",
      ".ohqp-divider { margin:6px -10px; border-top:1px solid var(--oh-panel-header-border); }",
      ".ohqp-label-sm { font-size:9px; color:var(--oh-panel-text-dim); margin-bottom:2px; display:block; }",
      ".ohqp-lang-btn {",
      "  width:100%; padding:5px 8px; border-radius:5px; cursor:pointer; text-align:left;",
      "  font:700 10px/1.15 'Aptos','Trebuchet MS','Segoe UI',sans-serif;",
      "  border:1px solid var(--oh-panel-border); background:transparent; color:var(--oh-panel-text);",
      "  transition:all 0.15s; display:flex; justify-content:space-between; align-items:center;",
      "}",
      ".ohqp-lang-btn:hover { border-color:var(--oh-accent-muted); }",
      ".ohqp-lang-wrap { position:relative; }",
      ".ohqp-lang-menu {",
      "  position:absolute; top:100%; left:0; right:0; z-index:10;",
      "  max-height:140px; overflow-y:auto; margin-top:2px;",
      "  border:1px solid var(--oh-panel-border); border-radius:5px;",
      "  background:var(--oh-panel-bg); box-shadow:0 8px 20px rgba(0,0,0,0.5);",
      "}",
      ".ohqp-lang-item {",
      "  padding:5px 8px; cursor:pointer; font-size:10px; color:var(--oh-panel-text-dim);",
      "  transition:background 0.1s;",
      "}",
      ".ohqp-lang-item:hover { background:var(--oh-accent-soft); color:var(--oh-panel-text); }",
      ".ohqp-lang-item.active { background:var(--oh-accent-muted); color:var(--oh-panel-text); font-weight:900; }",
      // Popover tooltip — same style as auto-bot's .ab-feat-tip but with unique
      // class so auto-bot's rebuild cleanup doesn't remove it.
      ".qp-feat-tip {",
      "  position:fixed; z-index:9000;",
      "  transform:translate(-50%,-100%);",
      "  padding:7px 10px; border-radius:8px;",
      "  pointer-events:none;",
      "  background:var(--oh-panel-bg,rgba(12,18,20,0.98));",
      "  border:1px solid var(--oh-accent-muted,rgba(96,165,250,0.35));",
      "  color:var(--oh-panel-text,#e2e8f0);",
      "  font:500 11px/1.4 'Aptos',system-ui,sans-serif;",
      "  white-space:normal; max-width:220px; text-align:center;",
      "  box-shadow:0 8px 22px rgba(0,0,0,0.5);",
      "  opacity:0; transition:opacity 0.12s;",
      "}",
      ".qp-feat-tip b { color:var(--oh-accent,#60a5fa); font-weight:800; }",
      ".qp-feat-tip.show { opacity:1; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- Settings bridge ----

  // Generic panel animation (scale from Quick Panel center)
  var _panelAnimTimers = {};
  function _animatePanelToggle(panelId, show) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    if (show) {
      // Animate in: scale 0.3 → 1
      panel.dataset.visible = "true";
      panel.style.opacity = "0";
      panel.style.transform = "scale(0.3)";
      // Set origin to Quick Panel center
      var qp = document.getElementById(QUICK_PANEL_ID);
      if (qp) {
        var qr = qp.getBoundingClientRect();
        var pr = panel.getBoundingClientRect();
        var cx = qr.left + qr.width / 2;
        var cy = qr.top + qr.height / 2;
        panel.style.transformOrigin = (cx - pr.left) + "px " + (cy - pr.top) + "px";
      }
      if (_panelAnimTimers[panelId]) clearTimeout(_panelAnimTimers[panelId]);
      // Small delay to let the panel render dimensions
      setTimeout(function() {
        var anim = panel.animate(
          [{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
        );
        anim.onfinish = function() {
          try { anim.cancel(); } catch(e) {}
          panel.style.transform = "";
          panel.style.opacity = "";
        };
      }, 16);
    } else {
      // Animate out: scale 1 → 0.3
      var qp = document.getElementById(QUICK_PANEL_ID);
      if (qp) {
        var qr = qp.getBoundingClientRect();
        var pr = panel.getBoundingClientRect();
        var cx = qr.left + qr.width / 2;
        var cy = qr.top + qr.height / 2;
        panel.style.transformOrigin = (cx - pr.left) + "px " + (cy - pr.top) + "px";
      }
      var anim = panel.animate(
        [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.3)", opacity: 0 }],
        { duration: 180, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" }
      );
      anim.onfinish = function() {
        panel.dataset.visible = "false";
        try { anim.cancel(); } catch(e) {}
        panel.style.transform = "";
        panel.style.opacity = "";
      };
    }
  }

  // Panel ID mapping for animation
  var _PANEL_IDS = {
    showAdvisorPanel: "openfront-helper-advisor-panel",
    showGoldPerMinute: "openfront-helper-gold-per-minute-container",
    showTopGoldPerMinute: "openfront-helper-top-gold-per-minute",
    showTeamBuildStats: "openfront-helper-team-build-stats",
    showTradeBalances: "openfront-helper-trade-balances",
    showBoatPanel: "openfront-helper-boat-panel",
    showEstatePanel: "openfront-helper-estate-panel",
    showAllianceRequestsPanel: "openfront-helper-alliance-requests-panel",
    showHelperUsers: "openfront-helper-users-container",
    showAutoBotPanel: "openfront-helper-autobot-panel",
    showFloatingAutoJoinPanel: "openfront-helper-floating-autojoin",
    showRetaliationHud: "openfront-helper-retaliation-container",
    showGameTimeAlert: "openfront-helper-game-time-alert",
  };

  // Rainbow mode — cycle accent hue every 100ms
  var _rainbowTimer = null;
  var _rainbowHue = 0;
  var _savedAccentColor = null;

  function _toggleRainbowMode(on) {
    if (_rainbowTimer) { clearInterval(_rainbowTimer); _rainbowTimer = null; }
    if (on) {
      _savedAccentColor = _getSetting("guiAccentColor", "#00ff66");
      _rainbowHue = Number(_getSetting("guiAccentHue", 150)) || 0;
      _rainbowTimer = setInterval(function() {
        _rainbowHue = (_rainbowHue + 2) % 360;
        var hex = "hsl(" + _rainbowHue + ",100%,55%)";
        _applyTheme(hex);
      }, 80);
    } else {
      // Restore saved color
      if (_savedAccentColor) {
        _applyTheme(_savedAccentColor);
      } else {
        _themeFromSettings();
      }
    }
  }

  function _notifySettingChanged(key, value) {
    try {
      window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
        detail: { key: key, value: value }
      }));
    } catch (e) {}
  }

  function _getSetting(key, fallback) {
    if (_quickPanelSettingsCache && key in _quickPanelSettingsCache)
      return _quickPanelSettingsCache[key];
    // Fallback: read from DEFAULT_SETTINGS if cache is empty
    try {
      var defs = window.OpenFrontHelperSettings && window.OpenFrontHelperSettings.DEFAULT_SETTINGS;
      if (defs && key in defs) return defs[key];
    } catch (e) {}
    return fallback;
  }

  function _setAndNotify(key, value) {
    if (_quickPanelSettingsCache) _quickPanelSettingsCache[key] = value;
    _notifySettingChanged(key, value);
    _applySettingLocally(key, value);
  }

  // Setter resolver: key → setter FUNCTION. Setters are top-level functions in
  // the engine IIFE's SHARED SCOPE — NOT on window (the build wraps each layer
  // in an IIFE). window[fnName] returns undefined for all of them, so we must
  // reference the bare names directly with typeof guards.
  function _resolveSetter(key) {
    switch (key) {
      case "showAdvisorPanel":       return typeof setAdvisorPanelEnabled === "function" ? setAdvisorPanelEnabled : null;
      case "showGoldPerMinute":      return typeof setGoldPerMinuteEnabled === "function" ? setGoldPerMinuteEnabled : null;
      case "showTopGoldPerMinute":   return typeof setTopGoldPerMinuteEnabled === "function" ? setTopGoldPerMinuteEnabled : null;
      case "showTeamBuildStats":     return typeof setTeamBuildStatsEnabled === "function" ? setTeamBuildStatsEnabled : null;
      case "showTradeBalances":      return typeof setTradeBalancesEnabled === "function" ? setTradeBalancesEnabled : null;
      case "showBoatPanel":          return typeof setBoatPanelEnabled === "function" ? setBoatPanelEnabled : null;
      case "showEstatePanel":        return typeof setEstatePanelEnabled === "function" ? setEstatePanelEnabled : null;
      case "showAllianceRequestsPanel": return typeof setAllianceRequestsPanelEnabled === "function" ? setAllianceRequestsPanelEnabled : null;
      case "showHelperUsers":        return typeof setHelperUsersEnabled === "function" ? setHelperUsersEnabled : null;
      case "markBotNationsRed":      return typeof setBotMarkersEnabled === "function" ? setBotMarkersEnabled : null;
      case "markHoveredAlliesGreen": return typeof setAllyMarkersEnabled === "function" ? setAllyMarkersEnabled : null;
      case "showNukePrediction":     return typeof setNukePredictionEnabled === "function" ? setNukePredictionEnabled : null;
      case "showNukeTrajectory":     return typeof setNukeTrajectoryEnabled === "function" ? setNukeTrajectoryEnabled : null;
      case "showBoatPrediction":     return typeof setBoatPredictionEnabled === "function" ? setBoatPredictionEnabled : null;
      case "showWarshipRoutes":      return typeof setWarshipRoutesEnabled === "function" ? setWarshipRoutesEnabled : null;
      case "showNukeSuggestions":    return typeof setNukeSuggestionsEnabled === "function" ? setNukeSuggestionsEnabled : null;
      case "showEconomyHeatmap":     return typeof setEconomyHeatmapEnabled === "function" ? setEconomyHeatmapEnabled : null;
      case "showExportPartnerHeatmap": return typeof setExportPartnerHeatmapEnabled === "function" ? setExportPartnerHeatmapEnabled : null;
      case "showAttackHighlight":    return typeof setAttackHighlightEnabled === "function" ? setAttackHighlightEnabled : null;
      case "showRetaliationHud":     return typeof setRetaliationEnabled === "function" ? setRetaliationEnabled : null;
      case "hideAds":                return typeof setHideAdsEnabled === "function" ? setHideAdsEnabled : null;
      case "antiAfk":                return typeof setAntiAfkEnabled === "function" ? setAntiAfkEnabled : null;
      case "attackRatioHotkey":      return typeof setAttackRatioHotkeyEnabled === "function" ? setAttackRatioHotkeyEnabled : null;
      case "rightClickConquest":     return typeof setRightClickMenuEnabled === "function" ? setRightClickMenuEnabled : null;
      case "roundLogger":            return typeof setRoundLoggerEnabled === "function" ? setRoundLoggerEnabled : null;
      case "networkLogger":          return typeof setNetworkLoggerEnabled === "function" ? setNetworkLoggerEnabled : null;
      case "showBuildTimers":        return typeof setBuildTimerEnabled === "function" ? setBuildTimerEnabled : null;
      case "showEnemyIntent":        return typeof setEnemyIntentEnabled === "function" ? setEnemyIntentEnabled : null;
      case "showSpawnHeatmap":       return typeof setSpawnHeatmapEnabled === "function" ? setSpawnHeatmapEnabled : null;
      case "showSpawnMarkers":       return typeof setSpawnMarkersEnabled === "function" ? setSpawnMarkersEnabled : null;
      case "sosDefense":             return typeof setSosDefenseEnabled === "function" ? setSosDefenseEnabled : null;
      case "showGameTimeAlert":      return typeof setGameTimeAlertEnabled === "function" ? setGameTimeAlertEnabled : null;
      case "showPlayerMapOverlays":  return typeof setPlayerMapOverlaysEnabled === "function" ? setPlayerMapOverlaysEnabled : null;
      case "showMapTroopCounts":     return typeof setMapTroopCountsEnabled === "function" ? setMapTroopCountsEnabled : null;
      case "showThreatIndicators":   return typeof setThreatIndicatorsEnabled === "function" ? setThreatIndicatorsEnabled : null;
      case "showMapMoney":           return typeof setMapMoneyEnabled === "function" ? setMapMoneyEnabled : null;
      case "skinUnlocker":           return typeof _setSkinUnlockerEnabled === "function" ? _setSkinUnlockerEnabled : null;
      case "warnIncomingBoats":      return typeof setBoatIncomingWarningEnabled === "function" ? setBoatIncomingWarningEnabled : null;
    }
    return null;
  }

  function _applySettingLocally(key, value) {
    var v = !!value;
    // Standard setter-based panels (with animation)
    var setter = _resolveSetter(key);
    if (setter) {
      try { setter(v); } catch (e) {}
      // Animate the panel if it has a known ID
      if (_PANEL_IDS[key]) {
        setTimeout(function() { _animatePanelToggle(_PANEL_IDS[key], v); }, 30);
      }
    }
    // Special cases
    if (key === "showAutoBotPanel") {
      try { if (window.__OFH_autobot && window.__OFH_autobot.set) window.__OFH_autobot.set({ hidden: !v }); } catch(e) {}
      if (_PANEL_IDS[key]) {
        setTimeout(function() { _animatePanelToggle(_PANEL_IDS[key], v); }, 30);
      }
    }
    // Silo/SAM tracker — direct panel control
    if (key === "combatSiloPanel") {
      var siloPanel = document.getElementById("openfront-helper-silo-panel");
      if (v) {
        try { if (typeof window.__OFH_updateSiloSamTracker === "function") window.__OFH_updateSiloSamTracker(); } catch(e) {}
      } else if (siloPanel) {
        siloPanel.dataset.visible = "false";
        siloPanel.style.setProperty("display", "none", "important");
      }
    }
    if (key === "combatSamTracker") {
      var samPanel = document.getElementById("openfront-helper-sam-panel");
      if (v) {
        try { if (typeof window.__OFH_updateSiloSamTracker === "function") window.__OFH_updateSiloSamTracker(); } catch(e) {}
      } else if (samPanel) {
        samPanel.dataset.visible = "false";
        samPanel.style.setProperty("display", "none", "important");
      }
    }
    if (["combatSiloShowAll","combatSiloBuildingOnly","combatSiloAudioAlert",
         "combatSiloOneClickFire","combatSiloAutoFireBuilding",
         "combatSamBuildingOnly","combatSamShowAll",
         "combatSamOneClickFire","combatSamAutoFireBuilding"].indexOf(key) !== -1) {
      try { if (typeof window.__OFH_updateSiloSamTracker === "function") window.__OFH_updateSiloSamTracker(); } catch(e) {}
    }
    // Auto-donate: sync with auto-bot's donate feature
    if (key === "autoDonateEnabled" || key === "autoDonateGoldEnabled") {
      try {
        if (window.__OFH_autobot && window.__OFH_autobot.set) {
          window.__OFH_autobot.set({ features: { donate: !v } });
        }
      } catch(e) {}
      if (v) {
        _toast("🎁 " + _tr("Auto-donate ON — bot donate OFF"));
      } else {
        _toast("🎁 " + _tr("Auto-donate OFF — bot donate ON"));
      }
    }
    // Theme changes → apply immediately.
    if (key === "guiAccentColor" || key === "guiAccentHue" || key === "guiOpacity" || key === "overlayOpacity") {
      _themeFromSettings();
    }
    // Rainbow mode — cycle accent hue
    if (key === "rainbowMode") {
      _toggleRainbowMode(v);
    }
  }

  function setQuickPanelSettings(settings) {
    var prevLang = _quickPanelSettingsCache ? _quickPanelSettingsCache.language : null;
    _quickPanelSettingsCache = settings || {};
    _themeFromSettings();
    // Only re-render when language actually changed (not on every setting sync).
    var newLang = _quickPanelSettingsCache.language;
    if (prevLang !== newLang && quickPanelEnabled && document.getElementById(QUICK_PANEL_ID)) {
      _renderActiveTab();
    }
  }

  // ---- Panel shell ----

  function ensureQuickPanel() {
    ensureQuickPanelStyles();
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = QUICK_PANEL_ID;

    // Header
    var hdr = document.createElement("div");
    hdr.className = "ohqp-header";
    var conn = document.createElement("span");
    conn.id = "ohqp-connection";
    conn.className = "ohqp-conn";
    conn.dataset.status = "disconnected";
    conn.textContent = "●";
    conn.title = "WebSocket status";
    var title = document.createElement("div");
    title.className = "ohqp-title";
    var _ver = (window.__OFH_ASSETS && window.__OFH_ASSETS.version) ? window.__OFH_ASSETS.version : "dev";
    title.textContent = "⚙ OpenFront Helper v" + _ver;
    var minBtn = document.createElement("button");
    minBtn.type = "button";
    minBtn.className = "ohqp-min-btn";
    minBtn.textContent = "▾";
    minBtn.title = "Minimize / Restore";
    minBtn.addEventListener("click", function() {
      var p = document.getElementById(QUICK_PANEL_ID);
      if (!p) return;
      var isMin = p.dataset.minimized === "true";
      p.dataset.minimized = isMin ? "false" : "true";
      minBtn.textContent = isMin ? "▾" : "▴";
    });
    var xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "ohqp-min-btn";
    xBtn.textContent = "×";
    xBtn.title = "Close";
    xBtn.addEventListener("click", function() {
      var p = document.getElementById(QUICK_PANEL_ID);
      if (p) _animateClose(p);
    });
    hdr.appendChild(conn);
    hdr.appendChild(title);
    hdr.appendChild(minBtn);
    hdr.appendChild(xBtn);
    panel.appendChild(hdr);

    // Tab bar (4 tabs — no Lobby, auto-join panel handles that)
    var tabs = document.createElement("div");
    tabs.className = "ohqp-tabs";
    var TAB_DEFS = [
      { id: "actions", emoji: "⚔️", title: "Actions", tip: "Quick actions: Kill Shot, Embargo, Silo/SAM trackers, Auto Donate, Atom Batch-fire" },
      { id: "helpers", emoji: "⚙️", title: "Helpers", tip: "Toggle panels, map overlays, combat features, alerts, and tools" },
      { id: "config",  emoji: "🔧", title: "Config", tip: "Theme, language, skin unlocker, low lag mode, and reset settings" },
    ];
    for (var i = 0; i < TAB_DEFS.length; i++) {
      var tb = document.createElement("button");
      tb.type = "button";
      tb.dataset.tab = TAB_DEFS[i].id;
      tb.textContent = TAB_DEFS[i].emoji;
      if (TAB_DEFS[i].id === quickPanelActiveTab) tb.classList.add("active");
      tb.addEventListener("click", _onTabClick);
      // Popover on hover (uses .qp-feat-tip, safe from auto-bot cleanup).
      (function(tabDef) {
        tb.addEventListener("mouseenter", function() {
          _showQpPopover(this, "<b>" + _tr(tabDef.title || "") + "</b><br>" + _tr(tabDef.tip || ""), 800);
        });
        tb.addEventListener("mouseleave", _hideQpPopover);
      })(TAB_DEFS[i]);
      tabs.appendChild(tb);
    }
    panel.appendChild(tabs);

    // Body
    var body = document.createElement("div");
    body.className = "ohqp-body";
    for (var i = 0; i < TAB_DEFS.length; i++) {
      var pnl = document.createElement("div");
      pnl.dataset.panel = TAB_DEFS[i].id;
      if (TAB_DEFS[i].id === quickPanelActiveTab) pnl.classList.add("active");
      body.appendChild(pnl);
    }
    panel.appendChild(body);

    // Clean up stale popovers from previous builds.
    document.querySelectorAll(".qp-feat-tip").forEach(function(t) { t.remove(); });
    _qpPopoverEl = null;

    (document.body || document.documentElement).appendChild(panel);

    if (typeof makeGoldStatPanelDraggable === "function") {
      makeGoldStatPanelDraggable(panel, hdr, QUICK_PANEL_POS_KEY);
      applyStoredGoldStatPanelPosition(panel, QUICK_PANEL_POS_KEY);
    }

    _renderActiveTab();
    _themeFromSettings();
    return panel;
  }

  function _onTabClick(e) {
    quickPanelActiveTab = e.currentTarget.dataset.tab;
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (!panel) return;
    var tabBtns = panel.querySelectorAll(".ohqp-tabs button");
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].classList.toggle("active", tabBtns[i].dataset.tab === quickPanelActiveTab);
    }
    var bodies = panel.querySelectorAll(".ohqp-body > div");
    for (var i = 0; i < bodies.length; i++) {
      bodies[i].classList.toggle("active", bodies[i].dataset.panel === quickPanelActiveTab);
    }
    _renderActiveTab();
  }

  function _renderActiveTab() {
    var saved = _saveAccordionState();
    switch (quickPanelActiveTab) {
      case "actions": _renderActionsTab(); break;
      case "helpers": _renderHelpersTab(); break;
      case "config":  _renderConfigTab(); break;
    }
    _restoreAccordionState(saved);
  }

  // ---- i18n helper (tr() is from auto-bot/i18n.js) ----
  function _tr(key) {
    return (typeof tr === "function") ? tr(key) : key;
  }
  function _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  // Hotkey code → human-readable label
  function _hotkeyLabel(code) {
    if (!code) return "—";
    var parts = code.split("+");
    var labels = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === "Shift") labels.push("⇧");
      else if (p === "Ctrl") labels.push("Ctrl");
      else if (p === "Alt") labels.push("Alt");
      else if (p === "Meta") labels.push("⌘");
      else if (p.startsWith("Key")) labels.push(p.replace("Key", ""));
      else if (p.startsWith("Digit")) labels.push(p.replace("Digit", ""));
      else labels.push(p);
    }
    return labels.join("+");
  }

  // Kill shot hotkey listener
  var _killShotListening = false;
  function _installKillShotHotkey() {
    document.addEventListener("keydown", function(e) {
      if (_killShotListening) return; // don't fire while rebinding
      var code = _getSetting("killShotHotkey", "Shift+KeyK");
      if (!code) return;
      // Build actual code from event
      var parts = [];
      if (e.shiftKey) parts.push("Shift");
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.metaKey) parts.push("Meta");
      parts.push(e.code);
      var pressed = parts.join("+");
      if (pressed === code) {
        e.preventDefault();
        e.stopPropagation();
        _doKillShot();
      }
    });
  }
  _installKillShotHotkey();

  function _resetAllSettings() {
    if (!confirm(_tr("Reset all settings to default? This will reload the page."))) return;
    try {
      // Clear all openfront-helper keys from localStorage
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf("openfront-helper") !== -1 || k.indexOf("ofh:") !== -1 || k.indexOf("cext_") !== -1)) {
          keysToRemove.push(k);
        }
      }
      for (var i = 0; i < keysToRemove.length; i++) {
        localStorage.removeItem(keysToRemove[i]);
      }
    } catch (e) {}
    // Reload page
    location.reload();
  }

  function _startHotkeyCapture(settingKey) {
    _killShotListening = true;
    // Find the button that triggered this
    var actionName = settingKey === "killShotHotkey" ? "setKillShotHotkey" : "setAtomHotkey";
    var btn = document.querySelector('[data-qp-action="' + actionName + '"]');
    if (btn) {
      btn.textContent = _tr("Press any key...");
      btn.style.color = "var(--oh-accent)";
      btn.style.borderColor = "var(--oh-accent)";
    }
    function onKey(e) {
      // Ignore standalone modifier keys — wait for the actual key
      if (e.code === "ShiftLeft" || e.code === "ShiftRight" ||
          e.code === "ControlLeft" || e.code === "ControlRight" ||
          e.code === "AltLeft" || e.code === "AltRight" ||
          e.code === "MetaLeft" || e.code === "MetaRight") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener("keydown", onKey, true);
      _killShotListening = false;
      // Build code string
      var parts = [];
      if (e.shiftKey) parts.push("Shift");
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.metaKey) parts.push("Meta");
      parts.push(e.code);
      var code = parts.join("+");
      _setAndNotify(settingKey, code);
      var icon = settingKey === "killShotHotkey" ? "☄️" : "☢️";
      _toast(icon + " " + _hotkeyLabel(code));
      _renderActiveTab();
    }
    document.addEventListener("keydown", onKey, true);
  }

  // ---- Mini switch helper ----
  function _swHtml(key, checked, disabled, label) {
    return '<label class="ohqp-row"><span class="ohqp-label">' + _esc(_tr(label)) + '</span>' +
           '<span class="ohqp-sw' + (checked ? ' on' : '') + '" data-qp-key="' + key + '"></span></label>';
  }

  // Like _swHtml but includes a small "?" icon that shows a detailed popover on hover.
  // Accepts same (key, checked, disabled, label) signature as _swHtml.
  function _swHtmlWithTip(key, checked, disabled, label) {
    if (label === undefined) { label = disabled; }
    return '<label class="ohqp-row"><span class="ohqp-label">' + _esc(_tr(label)) + '</span>' +
           '<span class="ohqp-tip-icon" data-qp-tip-key="' + key + '">?</span>' +
           '<span class="ohqp-sw' + (checked ? ' on' : '') + '" data-qp-key="' + key + '"></span></label>';
  }

  // ---- Tab: Actions (WS-injected) ----
  function _renderActionsTab() {
    var el = document.querySelector("#" + QUICK_PANEL_ID + " [data-panel='actions']");
    if (!el) return;
    var h = [];

    // Kill Shot — hotkey + instant toggle
    var ksKey = _getSetting("killShotHotkey", "Shift+KeyK");
    var ksLabel = _hotkeyLabel(ksKey);
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h open" data-qp-tip-key="Kill Shot">☄️ ' + _tr('Kill Shot') + '<span class="ohqp-tip-icon" data-qp-tip-key="Kill Shot">?</span></div><div class="ohqp-sec-b open">');
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">');
    h.push('<span class="ohqp-label-sm" style="flex:1;">' + _tr("Hotkey") + '</span>');
    h.push('<button class="ohqp-btn" data-qp-action="setKillShotHotkey" style="font-family:monospace;min-width:80px;">' + _esc(ksLabel) + '</button>');
    h.push('</div>');
    h.push(_swHtmlWithTip("killShotInstantSend", _getSetting("killShotInstantSend", false), false, "Instant send (no slider)"));
    h.push('</div></div>');

    // Embargo
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h open" data-qp-tip-key="Embargo">🚫 ' + _tr('Embargo') + '<span class="ohqp-tip-icon" data-qp-tip-key="Embargo">?</span></div><div class="ohqp-sec-b open">');
    h.push('<div style="display:flex;gap:4px;margin-bottom:4px;">');
    h.push('<button class="ohqp-btn" data-qp-action="embargoAll" style="flex:1;">' + _tr('Embargo All') + '</button>');
    h.push('<button class="ohqp-btn" data-qp-action="liftEmbargo" style="flex:1;">' + _tr('Trade All') + '</button>');
    h.push('</div></div></div>');

    // Silo Tracker — single toggle controls both notification + panel
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h open" data-qp-tip-key="Silo Tracker">🚀 ' + _tr('Silo Tracker') + '<span class="ohqp-tip-icon" data-qp-tip-key="Silo Tracker">?</span></div><div class="ohqp-sec-b open">');
    h.push(_swHtmlWithTip("combatSiloPanel", _getSetting("combatSiloPanel", false), false, "Silo tracker panel"));
    h.push(_swHtmlWithTip("combatSiloShowAll", _getSetting("combatSiloShowAll", false), false, "Show all (spectator)"));
    h.push(_swHtmlWithTip("combatSiloBuildingOnly", _getSetting("combatSiloBuildingOnly", false), false, "Building only"));
    h.push(_swHtmlWithTip("combatSiloAudioAlert", _getSetting("combatSiloAudioAlert", false), false, "Audio ping on silo"));
    h.push(_swHtmlWithTip("combatSiloOneClickFire", _getSetting("combatSiloOneClickFire", false), false, "One-click fire"));
    h.push(_swHtmlWithTip("combatSiloAutoFireBuilding", _getSetting("combatSiloAutoFireBuilding", false), false, "Auto fire building"));
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:110px;">' + _tr('Max nuke auto fire') + '</span>');
    h.push('<input class="ohqp-input" type="number" min="1" step="1" data-qp-input="combatSiloAutoFireMaxQty" value="' + (_getSetting("combatSiloAutoFireMaxQty", 1) || 1) + '" style="flex:1;">');
    h.push('</div>');
    h.push('</div></div>');

    // SAM Tracker — single toggle
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h" data-qp-tip-key="SAM Tracker">🛡️ ' + _tr('SAM Tracker') + '<span class="ohqp-tip-icon" data-qp-tip-key="SAM Tracker">?</span></div><div class="ohqp-sec-b">');
    h.push(_swHtmlWithTip("combatSamTracker", _getSetting("combatSamTracker", false), false, "SAM tracker panel"));
    h.push(_swHtmlWithTip("combatSamShowAll", _getSetting("combatSamShowAll", false), false, "Show all (spectator)"));
    h.push(_swHtmlWithTip("combatSamBuildingOnly", _getSetting("combatSamBuildingOnly", false), false, "Building only"));
    h.push(_swHtmlWithTip("combatSamOneClickFire", _getSetting("combatSamOneClickFire", false), false, "One-click fire"));
    h.push(_swHtmlWithTip("combatSamAutoFireBuilding", _getSetting("combatSamAutoFireBuilding", false), false, "Auto fire building"));
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:110px;">' + _tr('Max nuke auto fire') + '</span>');
    h.push('<input class="ohqp-input" type="number" min="1" step="1" data-qp-input="combatSamAutoFireMaxQty" value="' + (_getSetting("combatSamAutoFireMaxQty", 1) || 1) + '" style="flex:1;">');
    h.push('</div>');
    h.push('</div></div>');

    // Auto Donate Troops
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h" data-qp-tip-key="Auto Donate Troops">💪 ' + _tr('Auto Donate Troops') + '<span class="ohqp-tip-icon" data-qp-tip-key="Auto Donate Troops">?</span></div><div class="ohqp-sec-b">');
    h.push(_swHtmlWithTip("autoDonateEnabled", _getSetting("autoDonateEnabled", false), false, "Enable"));
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:55px;">' + _tr('Keep') + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="autoDonateKeepPct" min="10" max="90" step="5" value="' + (_getSetting("autoDonateKeepPct", 40) || 40) + '" style="flex:1;">');
    h.push('<span class="ohqp-label-sm" style="width:30px;text-align:right;">' + (_getSetting("autoDonateKeepPct", 40) || 40) + '%</span>');
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:55px;">' + _tr('Donate') + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="autoDonatePercentage" min="1" max="100" step="5" value="' + (_getSetting("autoDonatePercentage", 25) || 25) + '" style="flex:1;">');
    h.push('<span class="ohqp-label-sm" style="width:30px;text-align:right;">' + (_getSetting("autoDonatePercentage", 25) || 25) + '%</span>');
    h.push('</div>');
    h.push('<div style="margin:2px 0 2px 0;"><span class="ohqp-label-sm">' + _tr('Targets (comma-separated names)') + '</span></div>');
    h.push('<input class="ohqp-input" type="text" data-qp-input-str="autoDonateTargets" value="' + _esc(_getSetting("autoDonateTargets", "")) + '" placeholder="Player1, Player2, [TAG]" style="width:100%;">');
    h.push('</div></div>');

    // Auto Donate Gold
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h" data-qp-tip-key="Auto Donate Gold">💰 ' + _tr('Auto Donate Gold') + '<span class="ohqp-tip-icon" data-qp-tip-key="Auto Donate Gold">?</span></div><div class="ohqp-sec-b">');
    h.push(_swHtmlWithTip("autoDonateGoldEnabled", _getSetting("autoDonateGoldEnabled", false), false, "Enable"));
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:55px;">' + _tr('Max gold') + '</span>');
    h.push('<input class="ohqp-input" type="number" data-qp-input="autoDonateGoldThreshold" value="' + (_getSetting("autoDonateGoldThreshold", 5000000) || 5000000) + '" style="flex:1;">');
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span class="ohqp-label-sm" style="width:55px;">' + _tr('Donate') + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="autoDonateGoldPercentage" min="1" max="100" step="5" value="' + (_getSetting("autoDonateGoldPercentage", 25) || 25) + '" style="flex:1;">');
    h.push('<span class="ohqp-label-sm" style="width:30px;text-align:right;">' + (_getSetting("autoDonateGoldPercentage", 25) || 25) + '%</span>');
    h.push('</div>');
    h.push('<div style="margin:2px 0 2px 0;"><span class="ohqp-label-sm">' + _tr('Targets (comma-separated names)') + '</span></div>');
    h.push('<input class="ohqp-input" type="text" data-qp-input-str="autoDonateGoldTargets" value="' + _esc(_getSetting("autoDonateGoldTargets", "")) + '" placeholder="Player1, Player2, [TAG]" style="width:100%;">');
    h.push('</div></div>');

    // Atom Batch Fire
    var atomCfg = _atomGetCfg();
    var atomGap = _atomGapMs(atomCfg.batchSize, atomCfg.delayMs);
    var atomRate = (1000 / atomGap).toFixed(1);
    var atomKey = _getSetting("atomBatchHotkey", "Backslash");
    var atomKeyLabel = _hotkeyLabel(atomKey);
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h" data-qp-tip-key="Atom batch-fire">☢️ ' + _tr('Atom batch-fire') + '<span class="ohqp-tip-icon" data-qp-tip-key="Atom batch-fire">?</span></div><div class="ohqp-sec-b">');
    h.push('<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">');
    h.push('<span class="ohqp-label-sm" style="flex:1;">' + _tr("Hotkey") + '</span>');
    h.push('<button class="ohqp-btn" data-qp-action="setAtomHotkey" style="font-family:monospace;min-width:80px;">' + _esc(atomKeyLabel) + '</button>');
    h.push('</div>');
    h.push('<div style="font-size:9px;color:var(--oh-panel-text-dim);margin-bottom:6px;line-height:1.4;">');
    h.push(_tr("Aim at a target and press the hotkey to open the batch-fire dialog.") + '</div>');
    h.push('<div class="ohqp-row"><span class="ohqp-label">' + _tr("Atoms per burst") + '</span>');
    h.push('<input class="ohqp-input" type="number" data-qp-atom="batchSize" min="1" step="1" value="' + atomCfg.batchSize + '" style="width:60px;"></div>');
    h.push('<div class="ohqp-row"><span class="ohqp-label">' + _tr("Delay (ms)") + '</span>');
    h.push('<input class="ohqp-input" type="number" data-qp-atom="delayMs" min="0" step="10" value="' + atomCfg.delayMs + '" style="width:60px;"></div>');
    h.push(_swHtmlWithTip("lastHydrogen", atomCfg.lastHydrogen, false, "Final shot → Hydrogen"));
    h.push('<div class="ohqp-row"><span class="ohqp-label">' + _tr("Effective fire rate") + '</span>');
    h.push('<span style="font-family:monospace;color:var(--oh-accent);font-size:10px;">≈ ' + atomRate + ' ' + _tr("shots/sec") + '</span></div>');
    h.push('<button class="ohqp-btn" data-qp-action="resetAtom" style="width:100%;margin-top:4px;">' + _tr("Reset to safe defaults") + '</button>');
    h.push('</div></div>');

    el.innerHTML = h.join("");
    _bindEvents(el);
    _bindAtomEvents(el);
  }

  // Atom config helpers (bridge to engine's __OFH_atomBatch)
  var _ATOM_DEFAULTS = { batchSize: 10, delayMs: 150, lastHydrogen: false };
  function _atomGetCfg() {
    try {
      if (window.__OFH_atomBatch && typeof window.__OFH_atomBatch.get === "function")
        return window.__OFH_atomBatch.get();
    } catch (e) {}
    return _ATOM_DEFAULTS;
  }
  function _atomSetCfg(patch) {
    try {
      if (window.__OFH_atomBatch && typeof window.__OFH_atomBatch.set === "function")
        window.__OFH_atomBatch.set(patch);
    } catch (e) {}
  }
  function _atomGapMs(batchSize, delayMs) {
    try {
      if (window.__OFH_atomBatch && typeof window.__OFH_atomBatch.effectiveGapMs === "function")
        return window.__OFH_atomBatch.effectiveGapMs(batchSize, delayMs);
    } catch (e) {}
    var perShot = batchSize >= 1 ? (delayMs || 0) / batchSize : delayMs || 0;
    return Math.max(140, perShot); // 140ms = server-safe floor
  }
  function _bindAtomEvents(el) {
    var inputs = el.querySelectorAll("[data-qp-atom]");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("change", function() {
        var key = this.dataset.qpAtom;
        var v = Math.floor(Number(this.value));
        if (!isFinite(v) || v < 0) v = 0;
        _atomSetCfg({ [key]: v });
        _renderActiveTab();
      });
    }
    var hydroSw = el.querySelector('[data-qp-key="lastHydrogen"]');
    if (hydroSw) {
      hydroSw.addEventListener("click", function(e) {
        e.preventDefault();
        var cfg = _atomGetCfg();
        var next = !cfg.lastHydrogen;
        _atomSetCfg({ lastHydrogen: next });
        this.classList.toggle("on", next);
      });
    }
    var resetBtn = el.querySelector('[data-qp-action="resetAtom"]');
    if (resetBtn) {
      resetBtn.addEventListener("click", function() {
        _atomSetCfg({ batchSize: _ATOM_DEFAULTS.batchSize, delayMs: _ATOM_DEFAULTS.delayMs });
        _renderActiveTab();
      });
    }
  }

  // ---- Tab: Helpers (mirror of popup HELPER_SECTIONS) ----
  function _renderHelpersTab() {
    var el = document.querySelector("#" + QUICK_PANEL_ID + " [data-panel='helpers']");
    if (!el) return;
    var sections = [
      {
        key: "panels", title: _tr("Panels"), toggles: [
          ["showTopGoldPerMinute", _tr("Player stats panel")],
          ["showGoldPerMinute", _tr("Highlight hovered player")],
          ["showTeamBuildStats", _tr("Team build stats")],
          ["showTradeBalances", _tr("Trade balances")],
          ["showAdvisorPanel", _tr("Advisor panel")],
          ["showBoatPanel", _tr("Boat panel")],
          ["showEstatePanel", _tr("Estates panel")],
          ["showAllianceRequestsPanel", _tr("Alliance requests")],
          ["showHelperUsers", _tr("Script users")],
          ["showAutoBotPanel", _tr("Auto-Bot panel")],
          ["showFloatingAutoJoinPanel", _tr("Auto-Join panel")],
        ]
      },
      {
        key: "map", title: _tr("Map overlays"), toggles: [
          ["showPlayerMapOverlays", _tr("Player overlays (master)")],
          ["showMapTroopCounts", _tr("Troop bar")],
          ["showMapMoney", _tr("Money")],
          ["showThreatIndicators", _tr("Threat indicators")],
          ["markHoveredAlliesGreen", _tr("Ally markers on hover")],
          ["showAttackHighlight", _tr("Attack highlight")],
          ["showNukePrediction", _tr("Nuke prediction")],
          ["showNukeTrajectory", _tr("Trajectory line")],
          ["showBoatPrediction", _tr("Boat prediction")],
          ["showWarshipRoutes", _tr("Warship routes")],
          ["showEconomyHeatmap", _tr("Economy heatmap")],
          ["showExportPartnerHeatmap", _tr("Export partner heatmap")],
          ["showSpawnHeatmap", _tr("Spawn heatmap")],
          ["showSpawnMarkers", _tr("Spawn markers")],
          ["showBuildTimers", _tr("Build timers")],
        ]
      },
      {
        key: "combat", title: _tr("Combat & Automation"), toggles: [
          ["showRetaliationHud", _tr("Retaliation HUD")],
          ["showNukeSuggestions", _tr("Nuke suggestions")],
          ["sosDefense", _tr("SOS defense")],
          ["attackRatioHotkey", _tr("Attack ratio hotkey")],
          ["rightClickConquest", _tr("Right-click conquest")],
          ["showEnemyIntent", _tr("Enemy intent warning")],
        ]
      },
      {
        key: "alerts", title: _tr("Alerts"), toggles: [
          ["showGameTimeAlert", _tr("Game-time alert")],
          ["warnIncomingBoats", _tr("Incoming boat warning")],
        ]
      },
      {
        key: "tools", title: _tr("Tools"), toggles: [
          ["hideAds", _tr("Hide ads")],
          ["antiAfk", _tr("Anti-AFK")],
          ["roundLogger", _tr("Round logger")],
          ["networkLogger", _tr("Network logger")],
          ["markBotNationsRed", _tr("Mark bot nations red")],
        ]
      },
    ];

    var h = [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var open = !_getSetting("collapsedHelperCategories." + sec.key, false);
      h.push('<div class="ohqp-sec"><div class="ohqp-sec-h' + (open ? ' open' : '') + '" data-qp-section="' + sec.key + '">');
      h.push('<span class="ohqp-chevron">▸</span> ' + _esc(sec.title));
      h.push('<span class="ohqp-tip-icon" data-qp-tip-key="' + sec.key + '">?</span>');
      h.push('</div><div class="ohqp-sec-b' + (open ? ' open' : '') + '">');
      for (var j = 0; j < sec.toggles.length; j++) {
        var t = sec.toggles[j];
        h.push(_swHtmlWithTip(t[0], _getSetting(t[0], false), t[1]));
      }
      h.push('</div></div>');
    }
    el.innerHTML = h.join("");
    _bindEvents(el);
  }

  // ---- Tab: Theme ----
  function _renderThemeTab() {
    var el = document.querySelector("#" + QUICK_PANEL_ID + " [data-panel='theme']");
    if (!el) return;
    var presets = _themePresets;
    var h = [];
    h.push('<div class="ohqp-label-sm">' + _tr('Presets') + '</div>');
    h.push('<div class="ohqp-presets">');
    var pkeys = Object.keys(presets);
    for (var i = 0; i < pkeys.length; i++) {
      var hex = presets[pkeys[i]];
      var name = pkeys[i].charAt(0).toUpperCase() + pkeys[i].slice(1);
      h.push('<button data-qp-theme="' + hex + '" style="border-color:' + hex + ';color:' + hex + ';">' + name + '</button>');
    }
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;"><span class="ohqp-label-sm">' + _tr('Accent Hue') + '</span>');
    h.push('<input type="color" data-qp-color="guiAccentColor" value="' + (_getSetting("guiAccentColor", "#00ff66") || "#00ff66") + '" style="width:24px;height:20px;border:none;padding:0;cursor:pointer;">');
    h.push('<input class="ohqp-range" type="range" data-qp-range="guiAccentHue" min="0" max="360" step="1" value="' + (_getSetting("guiAccentHue", 150) || 150) + '">');
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;"><span class="ohqp-label-sm">' + _tr('GUI Opacity') + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="guiOpacity" min="0.1" max="1" step="0.01" value="' + (_getSetting("guiOpacity", 1) || 1) + '">');
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;"><span class="ohqp-label-sm">' + _tr('Overlay Opacity') + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="overlayOpacity" min="0.1" max="1" step="0.01" value="' + (_getSetting("overlayOpacity", 1) || 1) + '">');
    h.push('</div>');
    h.push(_swHtmlWithTip("rainbowMode", _getSetting("rainbowMode", false), false, "Rainbow mode"));
    h.push('<div class="ohqp-divider"></div>');
    h.push('<div style="display:flex;gap:4px;">');
    h.push('<button class="ohqp-btn" data-qp-action="resetColors" style="flex:1;">' + _tr('Reset Colors') + '</button>');
    h.push('<button class="ohqp-btn" data-qp-action="resetLayout" style="flex:1;">' + _tr('Reset Layout') + '</button>');
    h.push('</div>');

    el.innerHTML = h.join("");
    _bindThemeEvents(el);
  }

  function _bindThemeEvents(el) {
    var presets = el.querySelectorAll("[data-qp-theme]");
    for (var i = 0; i < presets.length; i++) {
      presets[i].addEventListener("click", function() {
        var hex = this.dataset.qpTheme;
        _setAndNotify("guiAccentColor", hex);
        _applyTheme(hex);
        _renderActiveTab();
      });
    }
    // NOTE: switches are handled by _bindEvents (called first) — do NOT rebind here.
    var ranges = el.querySelectorAll("[data-qp-range]");
    for (var i = 0; i < ranges.length; i++) {
      ranges[i].addEventListener("input", function() {
        var val = Number(this.value);
        _setAndNotify(this.dataset.qpRange, val);
        if (this.dataset.qpRange === "guiAccentHue") {
          // Convert hue to hex and apply.
          var h = ((val % 360) + 360) % 360;
          var c = "hsl(" + h + ",100%,55%)";
          _setAndNotify("guiAccentColor", c);
          _applyTheme(c);
        }
        if (this.dataset.qpRange === "guiOpacity" || this.dataset.qpRange === "overlayOpacity") {
          _themeFromSettings();
        }
      });
    }
    var pickers = el.querySelectorAll("[data-qp-color]");
    for (var i = 0; i < pickers.length; i++) {
      pickers[i].addEventListener("input", function() {
        _setAndNotify(this.dataset.qpColor, this.value);
        _applyTheme(this.value);
      });
    }
    var btns = el.querySelectorAll("[data-qp-action]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function() {
        if (this.dataset.qpAction === "resetColors") _resetColors();
        if (this.dataset.qpAction === "resetLayout") _resetLayout();
      });
    }
  }

  function _resetColors() {
    _setAndNotify("guiAccentColor", "#00ff66");
    _setAndNotify("guiAccentHue", 150);
    _setAndNotify("guiOpacity", 1);
    _setAndNotify("overlayOpacity", 1);
    _setAndNotify("rainbowMode", false);
    _applyTheme("#00ff66");
    _themeFromSettings();
    _renderActiveTab();
  }

  function _resetLayout() {
    try { localStorage.removeItem(QUICK_PANEL_POS_KEY); } catch (e) {}
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (panel) { panel.style.left = ""; panel.style.top = ""; panel.style.right = "16px"; }
  }

  // ---- Tab: Config ----
  function _renderConfigTab() {
    var el = document.querySelector("#" + QUICK_PANEL_ID + " [data-panel='config']");
    if (!el) return;
    var presets = _themePresets;
    var pkeys = Object.keys(presets);
    var h = [];

    // ---- Theme section ----
    h.push('<div class="ohqp-sec"><div class="ohqp-sec-h" data-qp-tip-key="Theme">🎨 ' + _tr("Theme") + '<span class="ohqp-tip-icon" data-qp-tip-key="Theme">?</span></div><div class="ohqp-sec-b">');
    h.push('<div class="ohqp-presets">');
    for (var i = 0; i < pkeys.length; i++) {
      var hex = presets[pkeys[i]];
      var name = pkeys[i].charAt(0).toUpperCase() + pkeys[i].slice(1);
      h.push('<button data-qp-theme="' + hex + '" style="border-color:' + hex + ';color:' + hex + ';">' + name + '</button>');
    }
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><span class="ohqp-label-sm" style="width:55px;">' + _tr("Accent") + '</span>');
    h.push('<input type="color" data-qp-color="guiAccentColor" value="' + (_getSetting("guiAccentColor", "#00ff66") || "#00ff66") + '" style="width:22px;height:18px;border:none;padding:0;cursor:pointer;">');
    h.push('<input class="ohqp-range" type="range" data-qp-range="guiAccentHue" min="0" max="360" step="1" value="' + (_getSetting("guiAccentHue", 150) || 150) + '" style="flex:1;">');
    h.push('</div>');
    h.push('<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><span class="ohqp-label-sm" style="width:55px;">' + _tr("Opacity") + '</span>');
    h.push('<input class="ohqp-range" type="range" data-qp-range="guiOpacity" min="0.1" max="1" step="0.01" value="' + (_getSetting("guiOpacity", 1) || 1) + '" style="flex:1;">');
    h.push('</div>');
    h.push(_swHtmlWithTip("rainbowMode", _getSetting("rainbowMode", false), false, "Rainbow mode"));
    h.push('<div style="display:flex;gap:4px;margin-top:4px;">');
    h.push('<button class="ohqp-btn" data-qp-action="resetColors" style="flex:1;font-size:9px;">' + _tr("Reset Colors") + '</button>');
    h.push('</div>');
    h.push('</div></div>');

    // ---- Language ----
    var curLang = _getSetting("language", "en") || "en";
    var availLangs = [];
    try {
      if (window.__OFH_ASSETS && window.__OFH_ASSETS.locales) {
        var lc = window.__OFH_ASSETS.locales;
        for (var k in lc) {
          if (lc.hasOwnProperty(k) && k.length === 2) {
            availLangs.push({ code: k, name: (lc[k].languageName || k) });
          }
        }
      }
    } catch (e) { availLangs = [{ code: "en", name: "English" }, { code: "vi", name: "Tiếng Việt" }]; }
    if (availLangs.length === 0) availLangs = [{ code: "en", name: "English" }];
    var curName = curLang.toUpperCase();
    for (var li = 0; li < availLangs.length; li++) {
      if (availLangs[li].code === curLang) { curName = availLangs[li].name; break; }
    }

    h.push('<div class="ohqp-divider"></div>');
    h.push('<div class="ohqp-label-sm">' + _tr("Language") + '</div>');
    h.push('<div class="ohqp-lang-wrap">');
    h.push('<button class="ohqp-lang-btn" id="ohqp-lang-cur">' + _esc(curName) + ' <span style="font-size:8px;">▾</span></button>');
    h.push('<div class="ohqp-lang-menu" id="ohqp-lang-menu" style="display:none;">');
    for (var li = 0; li < availLangs.length; li++) {
      var l = availLangs[li];
      h.push('<div class="ohqp-lang-item' + (l.code === curLang ? ' active' : '') + '" data-qp-lang="' + l.code + '">' + _esc(l.name) + '</div>');
    }
    h.push('</div></div>');

    // ---- Scan Intervals ----

    // ---- Misc ----
    h.push('<div class="ohqp-divider"></div>');
    h.push(_swHtmlWithTip("skinUnlocker", _getSetting("skinUnlocker", false), false, "🎨 Skin Unlocker (all skins)"));
    h.push(_swHtmlWithTip("lowLagMode", _getSetting("lowLagMode", false), false, "⚡ Low lag mode"));

    h.push('<div class="ohqp-divider"></div>');
    h.push('<button class="ohqp-btn danger" data-qp-action="resetAllSettings" style="width:100%;">🔄 ' + _tr("Reset all settings") + '</button>');

    h.push('<div class="ohqp-divider"></div>');
    h.push('<div style="text-align:center;padding:4px 0;">');
    h.push('<a href="https://github.com/nguyenvancaokyfpt/openfront-helper-userscript" target="_blank" rel="noopener" style="color:var(--oh-accent);font-size:9px;text-decoration:none;opacity:0.7;">⭐ GitHub — OpenFront Helper</a>');
    h.push('</div>');

    el.innerHTML = h.join("");
    _bindEvents(el);
    _bindThemeEvents(el);
  }

  // ---- Event binding ----

  function _saveAccordionState() {
    var states = {};
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (!panel) return states;
    // Only save sections in the active tab — other tabs' sections are untouched.
    var tabEl = panel.querySelector(".ohqp-body > div.active");
    if (!tabEl) return states;
    var secs = tabEl.querySelectorAll(".ohqp-sec-h");
    for (var i = 0; i < secs.length; i++) {
      var id = secs[i].dataset.qpSection || ("sec_" + quickPanelActiveTab + "_" + i);
      states[id] = secs[i].classList.contains("open");
    }
    return states;
  }

  function _restoreAccordionState(states) {
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (!panel) return;
    var tabEl = panel.querySelector(".ohqp-body > div.active");
    if (!tabEl) return;
    var secs = tabEl.querySelectorAll(".ohqp-sec-h");
    for (var i = 0; i < secs.length; i++) {
      var id = secs[i].dataset.qpSection || ("sec_" + quickPanelActiveTab + "_" + i);
      if (states[id]) {
        secs[i].classList.add("open");
        var body = secs[i].nextElementSibling;
        if (body) body.classList.add("open");
      } else {
        secs[i].classList.remove("open");
        var body = secs[i].nextElementSibling;
        if (body) body.classList.remove("open");
      }
    }
  }

  function _bindEvents(el) {
    var switches = el.querySelectorAll(".ohqp-sw[data-qp-key]");
    for (var i = 0; i < switches.length; i++) {
      switches[i].addEventListener("click", function(e) {
        e.preventDefault();
        var key = this.dataset.qpKey;
        var cur = _getSetting(key, false);
        _setAndNotify(key, !cur);
        this.classList.toggle("on", !cur);
        // Only re-render when the toggle controls sub-toggles that need to
        // show/hide (e.g. parent toggles in the Actions or Helpers tabs).
        // For other toggles, the visual change is enough.
        var needsSubRefresh = (
          key === "combatSiloIndicator" ||
          key === "autoDonateEnabled" || key === "autoDonateGoldEnabled" ||
          key === "showPlayerMapOverlays"
        );
        if (needsSubRefresh) {
          _renderActiveTab();
        }
      });
      // Popover on hover for toggle switches
      (function(swEl) {
        swEl.addEventListener("mouseenter", function() {
          var tip = QP_FEATURE_TIPS[this.dataset.qpKey];
          if (tip) {
            _showQpPopover(this, "<b>" + _tr(tip[0]) + "</b><br>" + _tr(tip[1]));
          }
        });
        swEl.addEventListener("mouseleave", _hideQpPopover);
      })(switches[i]);
    }
    // Tip icon hover — "?" next to Helpers tab toggles
    var tipIcons = el.querySelectorAll(".ohqp-tip-icon[data-qp-tip-key]");
    for (var i2 = 0; i2 < tipIcons.length; i2++) {
      (function(icon) {
        icon.addEventListener("mouseenter", function() {
          var tip = QP_FEATURE_TIPS[this.dataset.qpTipKey];
          if (tip) {
            _showQpPopover(this, "<b>" + _tr(tip[0]) + "</b><br>" + _tr(tip[1]));
          }
        });
        icon.addEventListener("mouseleave", _hideQpPopover);
      })(tipIcons[i2]);
    }
    var ranges = el.querySelectorAll("[data-qp-range]");
    for (var i = 0; i < ranges.length; i++) {
      ranges[i].addEventListener("input", function() {
        _setAndNotify(this.dataset.qpRange, Number(this.value));
      });
    }
    var inputs = el.querySelectorAll("[data-qp-input]");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("change", function() {
        _setAndNotify(this.dataset.qpInput, Number(this.value));
      });
    }
    // String inputs (comma-separated names, etc.)
    var strInputs = el.querySelectorAll("[data-qp-input-str]");
    for (var i = 0; i < strInputs.length; i++) {
      strInputs[i].addEventListener("change", function() {
        _setAndNotify(this.dataset.qpInputStr, this.value);
      });
    }
    var selects = el.querySelectorAll("[data-qp-select]");
    for (var i = 0; i < selects.length; i++) {
      selects[i].addEventListener("change", function() {
        _setAndNotify(this.dataset.qpSelect, this.value);
      });
    }
    // Action buttons
    var btns = el.querySelectorAll("[data-qp-action]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function() {
        _handleAction(this.dataset.qpAction);
      });
      // Popover on hover for action buttons
      (function(btnEl) {
        btnEl.addEventListener("mouseenter", function() {
          var tip = QP_FEATURE_TIPS[this.dataset.qpAction];
          if (tip) {
            _showQpPopover(this, "<b>" + _tr(tip[0]) + "</b><br>" + _tr(tip[1]));
          }
        });
        btnEl.addEventListener("mouseleave", _hideQpPopover);
      })(btns[i]);
    }
    // Section accordions — match ALL section headers, not just Helpers tab.
    var secs = el.querySelectorAll(".ohqp-sec-h");
    for (var i = 0; i < secs.length; i++) {
      secs[i].addEventListener("click", function() {
        this.classList.toggle("open");
        var body = this.nextElementSibling;
        if (body) body.classList.toggle("open");
        if (this.dataset.qpSection) {
          _setAndNotify("collapsedHelperCategories." + this.dataset.qpSection, !this.classList.contains("open"));
        }
      });
    }
    // Language dropdown.
    var langBtn = el.querySelector(".ohqp-lang-btn");
    var langMenu = el.querySelector(".ohqp-lang-menu");
    if (langBtn && langMenu) {
      langBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var open = langMenu.style.display === "block";
        langMenu.style.display = open ? "none" : "block";
      });
      var langItems = langMenu.querySelectorAll("[data-qp-lang]");
      for (var j = 0; j < langItems.length; j++) {
        langItems[j].addEventListener("click", function(e) {
          e.stopPropagation();
          var lang = this.dataset.qpLang;
          langMenu.style.display = "none";
          // Force re-render Config tab with new language BEFORE notifying
          // (setQuickPanelSettings only re-renders if language changed,
          //  but we need the dropdown text to update immediately)
          _setAndNotify("language", lang);
          // Re-render the active tab now so dropdown shows new language
          setTimeout(function() { _renderActiveTab(); }, 50);
        });
      }
    }
    // Close dropdown on outside click.
    if (!_langDropdownCloseBound) {
      _langDropdownCloseBound = true;
      document.addEventListener("click", function() {
        var menu = document.getElementById("ohqp-lang-menu");
        if (menu) menu.style.display = "none";
      });
    }
  }

  // ---- WS Actions ----

  function _toast(msg, color) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9000;padding:8px 16px;border-radius:6px;font:700 13px/1.3 'Aptos','Trebuchet MS',sans-serif;color:#fff;background:" + (color || "rgba(0,180,80,0.92)") + ";box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;opacity:1;transition:opacity 0.4s;";
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = "0"; }, 1200);
    setTimeout(function() { t.remove(); }, 1700);
  }

  function _handleAction(action) {
    switch (action) {
      case "setKillShotHotkey":
        _startHotkeyCapture("killShotHotkey");
        break;
      case "setAtomHotkey":
        _startHotkeyCapture("atomBatchHotkey");
        break;
      case "resetAllSettings":
        _resetAllSettings();
        break;
      case "killShot":
        _doKillShot();
        break;
      case "embargoAll":
        if (typeof sendGamePacket === "function") {
          sendGamePacket({ type: "embargo_all", action: "start" });
          _toast("🚫 " + _tr("Embargo All") + " ✓");
        } else {
          _toast("✗ WS not connected", "rgba(220,40,40,0.92)");
        }
        break;
      case "liftEmbargo":
        if (typeof sendGamePacket === "function") {
          sendGamePacket({ type: "embargo_all", action: "stop" });
          _toast("✅ " + _tr("Trade All") + " ✓");
        } else {
          _toast("✗ WS not connected", "rgba(220,40,40,0.92)");
        }
        break;
    }
  }

  // Track mouse position for kill shot (tile under cursor, not last click)
  var _ksMouseX = 0, _ksMouseY = 0;
  document.addEventListener("mousemove", function(e) { _ksMouseX = e.clientX; _ksMouseY = e.clientY; });

  function _getTileUnderCursor() {
    try {
      var ctx = getOpenFrontGameContext();
      if (!ctx || !ctx.transform) return null;
      var w = ctx.transform.screenToWorldCoordinates(_ksMouseX, _ksMouseY);
      if (!w) return null;
      var x = Math.floor(w.x);
      var y = Math.floor(w.y);
      var game = ctx.game;
      if (typeof game.ref === "function") return game.ref(x, y);
    } catch (e) {}
    return null;
  }

  function _doKillShot() {
    // Get tile under cursor (realtime), fallback to last known tile
    var tile = _getTileUnderCursor();
    if (tile == null && getLastKnownTile) tile = getLastKnownTile();
    if (tile == null) {
      _toast("✗ " + _tr("No target selected"), "rgba(220,40,40,0.92)");
      return;
    }
    try {
      var ctx = getOpenFrontGameContext();
      if (!ctx || !ctx.game) {
        _toast("✗ " + _tr("No game state"), "rgba(220,40,40,0.92)");
        return;
      }
      var game = ctx.game;
      var me = game.myPlayer ? game.myPlayer() : null;
      if (!me) { _toast("✗ Not in game", "rgba(220,40,40,0.92)"); return; }

      // Get owner of the tile
      var target = null;
      try { target = game.owner ? game.owner(tile) : null; } catch (e) {}

      // Debug: show what we found
      if (!target) {
        _toast("✗ " + _tr("No enemy at tile"), "rgba(220,40,40,0.92)");
        return;
      }

      // Check if it's our own tile
      try {
        var myId = me.id ? String(me.id()) : null;
        var targetId = target.id ? String(target.id()) : null;
        if (myId && targetId && myId === targetId) {
          _toast("✗ " + _tr("That's your tile"), "rgba(220,40,40,0.92)");
          return;
        }
      } catch (e) {}

      var myTroops = Number(me.troops ? me.troops() : 0);
      var enemyTroops = Number(target.troops ? target.troops() : 0);
      if (myTroops <= 0) { _toast("✗ " + _tr("No troops"), "rgba(220,40,40,0.92)"); return; }
      if (enemyTroops <= 0) {
        // Target has no troops — send 10% to conquer
        var targetId = target.id ? target.id() : null;
        var ctors = (typeof discoverCtors === "function") ? discoverCtors(getEventBus ? getEventBus() : null) : null;
        var sent = false;
        if (ctors && ctors.attack && typeof emitIntent === "function") {
          sent = emitIntent(ctors.attack, targetId, Math.floor(myTroops * 0.1));
        }
        if (!sent && typeof sendGamePacket === "function") {
          sent = sendGamePacket({ type: "attack", targetID: String(targetId), troops: Math.floor(myTroops * 0.1) });
        }
        if (sent) _toast("☄️ Kill Shot → conquer");
        else _toast("✗ Failed to send", "rgba(220,40,40,0.92)");
        return;
      }

      var needed = Math.ceil(enemyTroops * 1.1);
      var pct = Math.min(100, Math.max(1, Math.ceil(needed / myTroops * 100)));
      var amount = Math.max(1, Math.floor(myTroops * pct / 100));
      // Troops are 10x internally — divide for display
      var displayAmt = Math.max(1, Math.floor(amount / 10));

      var targetId = target.id ? target.id() : null;
      // Use emitIntent like the auto-bot — goes through game's event bus
      var ctors = (typeof discoverCtors === "function") ? discoverCtors(getEventBus ? getEventBus() : null) : null;
      var sent = false;
      if (ctors && ctors.attack && typeof emitIntent === "function") {
        sent = emitIntent(ctors.attack, targetId, amount);
      }
      // Fallback to sendGamePacket if emitIntent not available
      if (!sent && typeof sendGamePacket === "function") {
        sent = sendGamePacket({ type: "attack", targetID: String(targetId), troops: amount });
      }
      if (sent) {
        _toast("☄️ Kill Shot → " + displayAmt.toLocaleString() + " troops");
      } else {
        _toast("✗ " + _tr("Failed to send"), "rgba(220,40,40,0.92)");
      }
    } catch (e) {}
  }

  function _setGameAttackRatio(pct) {
    try {
      var sliders = document.querySelectorAll('control-panel input[type="range"]');
      for (var i = 0; i < sliders.length; i++) {
        sliders[i].value = String(pct);
        sliders[i].valueAsNumber = pct;
        sliders[i].dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
        sliders[i].dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
    } catch (e) {}
  }

  // ---- Lifecycle ----

  // Toggle with animation (inspired by CourseraHelperEx)
  var _qpInTransition = false;

  function _getLauncherRect() {
    var icon = document.getElementById("openfront-helper-launcher");
    if (!icon) return null;
    return icon.getBoundingClientRect();
  }

  function _setOriginToLauncher(panel) {
    var lr = _getLauncherRect();
    if (!lr) return;
    var pr = panel.getBoundingClientRect();
    var cx = lr.left + lr.width / 2;
    var cy = lr.top + lr.height / 2;
    panel.style.transformOrigin = (cx - pr.left) + "px " + (cy - pr.top) + "px";
  }

  // Smart placement — ported from CourseraHelperEx placePanel().
  // Positions panel next to launcher icon, choosing the side with most space.
  // NEVER covers the icon.
  function _placePanel(panel) {
    var lr = _getLauncherRect();
    if (!lr) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var margin = 10;
    var gap = 12;
    var pw = panel.offsetWidth || 270;
    var ph = panel.offsetHeight || 400;
    var bcx = lr.left + lr.width / 2;
    var bcy = lr.top + lr.height / 2;
    var fitsBelow = lr.bottom + gap + ph <= vh - margin;
    var fitsAbove = lr.top - gap - ph >= margin;

    var left, top;
    if (fitsBelow || fitsAbove) {
      // Vertical: prefer below if fits & icon in top half, otherwise above
      var openDown = fitsBelow && (!fitsAbove || bcy < vh / 2);
      var openRight = bcx < vw / 2; // icon on left half → align left edge
      left = openRight ? lr.left : lr.right - pw;
      top = openDown ? lr.bottom + gap : lr.top - gap - ph;
    } else {
      // Panel too tall for above/below → place BESIDE icon
      var roomRight = vw - lr.right - gap - margin;
      var roomLeft = lr.left - gap - margin;
      var openRight = roomRight >= pw ? true : roomLeft >= pw ? false : roomRight >= roomLeft;
      left = openRight ? lr.right + gap : lr.left - pw - gap;
      top = bcy - ph / 2;
    }
    // Clamp within viewport
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - pw - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, vh - ph - margin));
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function _animateOpen(panel) {
    if (_qpInTransition) return;
    _qpInTransition = true;
    panel.style.display = "flex";
    panel.style.opacity = "0";
    panel.style.transform = "scale(0.18)";
    panel.dataset.visible = "true";
    // Measure then place (panel needs display:flex to have dimensions)
    _renderActiveTab();
    _themeFromSettings();
    _placePanel(panel);
    _setOriginToLauncher(panel);
    var anim = panel.animate(
      [{ transform: "scale(0.18)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
    anim.onfinish = function() {
      try { anim.cancel(); } catch(e) {}
      panel.style.transform = "";
      panel.style.opacity = "";
      _qpInTransition = false;
    };
  }

  function _animateClose(panel) {
    if (_qpInTransition) return;
    _qpInTransition = true;
    _setOriginToLauncher(panel);
    var anim = panel.animate(
      [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.18)", opacity: 0 }],
      { duration: 200, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" }
    );
    anim.onfinish = function() {
      panel.style.display = "none";
      panel.dataset.visible = "false";
      quickPanelEnabled = false;
      // Notify lobby so syncQuickPanelHelper won't re-show it
      _notifySettingChanged("showQuickPanel", false);
      try { anim.cancel(); } catch(e) {}
      panel.style.transform = "";
      panel.style.opacity = "";
      _qpInTransition = false;
    };
  }

  // Listen for toggle event from launcher icon
  window.addEventListener("ofh-toggle-quick-panel", function() {
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (!panel) {
      // First time: create panel then animate open
      quickPanelEnabled = true;
      _notifySettingChanged("showQuickPanel", true);
      ensureQuickPanel();
      var p = document.getElementById(QUICK_PANEL_ID);
      if (p) _animateOpen(p);
      return;
    }
    var isVisible = panel.dataset.visible === "true";
    if (isVisible) {
      _animateClose(panel);
    } else {
      quickPanelEnabled = true;
      _notifySettingChanged("showQuickPanel", true);
      _animateOpen(panel);
    }
  });

  function setQuickPanelEnabled(enabled) {
    quickPanelEnabled = !!enabled;
    var panel = document.getElementById(QUICK_PANEL_ID);
    if (!quickPanelEnabled) {
      if (panel && panel.dataset.visible === "true" && !_qpInTransition) _animateClose(panel);
      return;
    }
    ensureQuickPanel();
    panel = document.getElementById(QUICK_PANEL_ID);
    if (panel && panel.dataset.visible !== "true" && !_qpInTransition) {
      _notifySettingChanged("showQuickPanel", true);
      _animateOpen(panel);
    }
  }
