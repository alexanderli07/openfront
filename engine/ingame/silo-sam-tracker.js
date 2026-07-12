// Silo Tracker + SAM Tracker — ported from Project Blon Openfront.js.
// Silo: notification bar + popout panel listing silos under construction / placed.
// SAM:  popout panel listing hostile building SAMs with vulnerability analysis
//       (which of our silos can nuke them before they finish) + ☢ nuke button.
//
// Style uses CSS custom properties (slate-glass) like every other panel.
// Settings are read from the Quick Panel settings cache (_quickPanelSettingsCache).

  var SILO_PANEL_ID = "openfront-helper-silo-panel";
  var SAM_PANEL_ID = "openfront-helper-sam-panel";
  var SILO_STYLE_ID = "openfront-helper-silo-styles";
  var _knownSiloIds = {};
  var _lastGameObj = null;
  var _lastAudioAlertMs = 0;
  var _samAutoFiredIds = {}; // unitId -> true (fired) | "pending" (awaiting recommendQty)
  var _samAutoFireLastGameObj = null;
  var SAM_AUTO_FIRE_SAFETY_MARGIN_TICKS = 10; // ~1s buffer so the nuke lands well before completion

  // ---- Settings bridge (reads from Quick Panel cache, loaded before us) ----

  function _cfg(key, fallback) {
    try {
      if (typeof _quickPanelSettingsCache === "object" && _quickPanelSettingsCache && key in _quickPanelSettingsCache)
        return _quickPanelSettingsCache[key];
    } catch (e) {}
    // Fallback: read from DEFAULT_SETTINGS if cache is empty
    try {
      var defs = window.OpenFrontHelperSettings && window.OpenFrontHelperSettings.DEFAULT_SETTINGS;
      if (defs && key in defs) return defs[key];
    } catch (e) {}
    return fallback;
  }

  // ---- Helpers (NOTE: _esc() and _tr() are defined in quick-panel.js, shared scope) ----

  function _safeOwner(unit, game) {
    if (!unit || !game) return null;
    try {
      var ownerID = null;
      if (unit.state && typeof unit.state.ownerID === "number") {
        ownerID = unit.state.ownerID;
      } else if (typeof unit.ownerID === "number") {
        ownerID = unit.ownerID;
      } else if (typeof unit.ownerID === "function") {
        ownerID = unit.ownerID();
      }
      if (ownerID === null || ownerID === void 0) return null;
      if (ownerID === 0) {
        return typeof unit.owner === "function" ? unit.owner() : null;
      }
      // Check if this ID is registered in the game
      var registered = false;
      if (game.smallIDToID && typeof game.smallIDToID.has === "function" && game.smallIDToID.has(ownerID)) {
        registered = true;
      } else if (game._playerStates && typeof game._playerStates.has === "function" && game._playerStates.has(ownerID)) {
        registered = true;
      }
      if (!registered) return null;
      return typeof unit.owner === "function" ? unit.owner() : null;
    } catch (e) {
      return null;
    }
  }

  function _isAlly(unit, myPlayer, game) {
    if (!myPlayer || !unit) return false;
    var owner = _safeOwner(unit, game);
    if (!owner) return false;
    try {
      return myPlayer.isAlliedWith ? myPlayer.isAlliedWith(owner) : false;
    } catch (e) { return false; }
  }

  function _getTileCoords(game, unit) {
    try {
      var tile = typeof unit.tile === "function" ? unit.tile() : unit.tile;
      if (tile === null || tile === void 0) return null;
      if (typeof game.x !== "function" || typeof game.y !== "function") return null;
      return { x: game.x(tile), y: game.y(tile) };
    } catch (e) { return null; }
  }

  function _playerLabel(player, myPlayer) {
    if (!player) return "Unknown";
    try {
      if (myPlayer && typeof player.smallID === "function" && typeof myPlayer.smallID === "function") {
        if (player.smallID() === myPlayer.smallID()) return _tr("You");
      }
    } catch (e) {}
    return (typeof getPlayerDisplayName === "function") ? getPlayerDisplayName(player) : ("Player " + (typeof player.smallID === "function" ? player.smallID() : "?"));
  }

  function _playerColor(player, game) {
    try {
      return typeof getPlayerColor === "function" ? getPlayerColor(player, game) || "" : "";
    } catch (e) { return ""; }
  }

  // ---- Silo unit collection ----

  function _getSiloConstructionInfo(game) {
    try {
      if (typeof game.unitStates === "function" && typeof game.unit === "function") {
        var states = game.unitStates();
        if (states && typeof states.values === "function") {
          var it = states.values();
          var entry = it.next();
          while (!entry.done) {
            var state = entry.value;
            if (state.unitType === "Missile Silo" && state.underConstruction === true) {
              var unit = game.unit(state.id);
              if (unit) return unit;
            }
            entry = it.next();
          }
        }
      }
      var silos = (typeof game.units === "function" ? game.units("Missile Silo") : []) || [];
      for (var i = 0; i < silos.length; i++) {
        if (typeof silos[i].isUnderConstruction === "function" && silos[i].isUnderConstruction()) return silos[i];
      }
    } catch (e) {}
    return null;
  }

  function _getAllSilos(game) {
    var list = [];
    try {
      if (typeof game.units === "function") {
        var silos = game.units("Missile Silo") || [];
        for (var i = 0; i < silos.length; i++) {
          if (silos[i] && list.indexOf(silos[i]) === -1) list.push(silos[i]);
        }
      }
      if (typeof game.unitStates === "function" && typeof game.unit === "function") {
        var states = game.unitStates();
        if (states && typeof states.values === "function") {
          var it = states.values();
          var entry = it.next();
          while (!entry.done) {
            var state = entry.value;
            if (state && state.unitType === "Missile Silo") {
              var unit = game.unit(state.id);
              if (unit && list.indexOf(unit) === -1) list.push(unit);
            }
            entry = it.next();
          }
        }
      }
    } catch (e) {}
    return list;
  }

  // ---- SAM unit collection ----

  function _getSAMTrackerUnits(game) {
    var units = [];
    var seen = {};

    function include(unit) {
      if (!unit) return;
      try {
        var id = null;
        if (typeof unit.id === "function") id = unit.id();
        else if (unit.id !== void 0) id = unit.id;
        else if (unit.state && unit.state.id !== void 0) id = unit.state.id;
        if (id !== null && id !== void 0) {
          if (seen[id]) return;
          seen[id] = true;
        }
        units.push(unit);
      } catch (e) {}
    }

    try {
      if (typeof game.unitStates === "function" && typeof game.unit === "function") {
        var states = game.unitStates();
        if (states && typeof states.values === "function") {
          var it = states.values();
          var entry = it.next();
          while (!entry.done) {
            var state = entry.value;
            if (state && state.unitType === "SAM Launcher") {
              if (state.markedForDeletion === false || state.markedForDeletion === void 0 || state.markedForDeletion === null) {
                var unit = game.unit(state.id);
                if (unit) include(unit);
              }
            }
            entry = it.next();
          }
        }
      }
    } catch (e) {}
    try {
      if (typeof game.units === "function") {
        var sams = game.units("SAM Launcher") || [];
        for (var i = 0; i < sams.length; i++) include(sams[i]);
      }
    } catch (e) {}
    return units;
  }

  // ---- Distance & trajectory ----

  function _euclideanDistSq(game, tileA, tileB) {
    try {
      if (typeof game.euclideanDistSquared === "function") return game.euclideanDistSquared(tileA, tileB);
      var ax = game.x(tileA), ay = game.y(tileA);
      var bx = game.x(tileB), by = game.y(tileB);
      if (ax === void 0 || ay === void 0 || bx === void 0 || by === void 0) return Infinity;
      var dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy;
    } catch (e) { return Infinity; }
  }

  function _getNukeTrajectory(game, fromTile, toTile) {
    try {
      if (fromTile === null || fromTile === void 0 || toTile === null || toTile === void 0) return [];
      if (typeof game.x !== "function" || typeof game.y !== "function") return [];
      var p0 = { x: game.x(fromTile), y: game.y(fromTile) };
      var p3 = { x: game.x(toTile), y: game.y(toTile) };
      if (p0.x === void 0 || p0.y === void 0 || p3.x === void 0 || p3.y === void 0) return [];
      var dx = p3.x - p0.x, dy = p3.y - p0.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) return [fromTile];
      var mapWidth = typeof game.width === "function" ? game.width() : 512;
      var mapHeight = typeof game.height === "function" ? game.height() : 512;
      var refFn = typeof game.ref === "function" ? function(x,y){return game.ref(x,y);} : null;
      if (!refFn) return [fromTile, toTile];

      var maxHeight = Math.max(distance / 3, 50);
      var p1 = { x: Math.max(0, Math.min(mapWidth - 1, p0.x + dx / 4)), y: Math.max(0, Math.min(mapHeight - 1, p0.y + dy / 4 - maxHeight)) };
      var p2 = { x: Math.max(0, Math.min(mapWidth - 1, p0.x + dx * 3 / 4)), y: Math.max(0, Math.min(mapHeight - 1, p0.y + dy * 3 / 4 - maxHeight)) };

      var points = [];
      var precision = 0.002;
      var increment = 3;
      var t = 0, cumulative = 0;
      var prev = { x: p0.x, y: p0.y };
      points.push(prev);
      while (t < 1) {
        t = Math.min(t + precision, 1);
        var T = 1 - t, TT = T * T, TTT = TT * T;
        var tt = t * t, ttt = tt * t;
        var cx = TTT * p0.x + 3 * TT * t * p1.x + 3 * T * tt * p2.x + ttt * p3.x;
        var cy = TTT * p0.y + 3 * TT * t * p1.y + 3 * T * tt * p2.y + ttt * p3.y;
        var segX = cx - prev.x, segY = cy - prev.y;
        cumulative += Math.sqrt(segX * segX + segY * segY);
        if (cumulative >= increment) {
          points.push({ x: cx, y: cy });
          cumulative = 0;
        }
        prev = { x: cx, y: cy };
      }
      points.push({ x: p3.x, y: p3.y });

      var tiles = [];
      for (var i = 0; i < points.length; i++) {
        var px = Math.max(0, Math.min(mapWidth - 1, Math.floor(points[i].x)));
        var py = Math.max(0, Math.min(mapHeight - 1, Math.floor(points[i].y)));
        tiles.push(refFn(px, py));
      }
      return tiles;
    } catch (e) {
      // Fallback: linear interpolation
      try {
        var list = [];
        var steps = 50;
        var x0 = game.x(fromTile), y0 = game.y(fromTile);
        var x1 = game.x(toTile), y1 = game.y(toTile);
        for (var i = 0; i <= steps; i++) {
          var pct = i / steps;
          list.push(game.ref(Math.floor(x0 + (x1 - x0) * pct), Math.floor(y0 + (y1 - y0) * pct)));
        }
        return list;
      } catch (e2) { return [fromTile, toTile]; }
    }
  }

  function _getSamRange(game, sam) {
    try {
      var level = typeof sam.level === "function" ? sam.level() : 1;
      if (typeof game.config === "function" && typeof game.config().samRange === "function") {
        return game.config().samRange(level);
      }
      return 150 - 480 / (level + 5);
    } catch (e) { return 70; }
  }

  // ---- Silo notification (shown inside Quick Panel) ----

  function updateSiloNotification() {
    var panelEnabled = _cfg("combatSiloPanel", false);
    if (!panelEnabled) return;

    var ctx;
    try { ctx = (typeof getOpenFrontGameContext === "function" ? getOpenFrontGameContext() : null); } catch (e) {}
    if (!ctx || !ctx.game) return;

    var silo = _getSiloConstructionInfo(ctx.game);
    if (!silo) {
      // No building silo found — still update the panel
      updateSiloPanel();
      return;
    }
    var owner = _safeOwner(silo, ctx.game);
    var me = ctx.game.myPlayer ? ctx.game.myPlayer() : null;
    var ownerLabel = _playerLabel(owner, me);
    var msg = ownerLabel === _tr("You") ? _tr("You are placing a silo") : (ownerLabel + " " + _tr("is placing a silo"));
    // Store notification text for Quick Panel to render
    window.__OFH_siloNotification = msg;
  }

  // ---- Styles ----

  function _ensureStyles() {
    if (document.getElementById(SILO_STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = SILO_STYLE_ID;
    s.textContent = [
      // Shared popout panel base
      "#" + SILO_PANEL_ID + ", #" + SAM_PANEL_ID + " {",
      "  position:fixed; z-index:9000; width:250px; max-height:380px; display:none; flex-direction:column;",
      "}",
      "  border:1px solid var(--oh-panel-border, rgba(148,163,184,0.34)); border-radius:8px;",
      "  background:var(--oh-panel-bg, rgba(12,18,20,0.92)); color:var(--oh-panel-text, #e2e8f0);",
      "  font:700 11px/1.15 'Aptos','Trebuchet MS','Segoe UI',sans-serif;",
      "  box-shadow:0 10px 26px rgba(0,0,0,0.4),0 0 16px var(--oh-accent-soft, rgba(0,255,102,0.15));",
      "  pointer-events:auto; user-select:none; overflow:hidden; flex-direction:column;",
      "}",
      "#" + SILO_PANEL_ID + "[data-visible='true'], #" + SAM_PANEL_ID + "[data-visible='true'] { display:flex; }",
      ".ohss-header {",
      "  display:flex; align-items:center; gap:6px; padding:6px 8px;",
      "  border-bottom:1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));",
      "  cursor:grab; touch-action:none; flex-shrink:0;",
      "}",
      ".ohss-header:active { cursor:grabbing; }",
      ".ohss-title {",
      "  flex:1; font-size:10px; font-weight:900; text-transform:uppercase;",
      "  letter-spacing:0.4px; color:var(--oh-panel-text-dim, rgba(148,163,184,0.85));",
      "}",
      ".ohss-x {",
      "  display:inline-flex; align-items:center; justify-content:center;",
      "  width:20px; height:20px; border:1px solid var(--oh-panel-border, rgba(148,163,184,0.25));",
      "  border-radius:6px; background:rgba(15,23,42,0.5); color:var(--oh-panel-text, #e2e8f0);",
      "  font-size:12px; font-weight:800; cursor:pointer;",
      "}",
      ".ohss-x:hover { background:var(--oh-accent-soft, rgba(0,255,102,0.15)); }",
      ".ohss-min-btn {",
      "  display:inline-flex; align-items:center; justify-content:center;",
      "  width:20px; height:20px; border:1px solid var(--oh-panel-border, rgba(148,163,184,0.25));",
      "  border-radius:6px; background:rgba(15,23,42,0.5); color:var(--oh-panel-text, #e2e8f0);",
      "  font-size:12px; font-weight:800; cursor:pointer; margin-right:2px;",
      "}",
      ".ohss-min-btn:hover { background:var(--oh-accent-soft, rgba(0,255,102,0.15)); }",
      "#" + SILO_PANEL_ID + "[data-minimized='true'] .ohss-body,",
      "#" + SAM_PANEL_ID + "[data-minimized='true'] .ohss-body { display:none; }",
      ".ohss-body {",
      "  flex:1; overflow-y:auto; overflow-x:hidden; padding:4px 0 4px 6px;",
      "  scrollbar-gutter:stable;",
      "}",
      ".ohss-row {",
      "  padding:5px 6px; border-bottom:1px solid rgba(255,255,255,0.08);",
      "  cursor:pointer; position:relative; transition:background 0.12s;",
      "}",
      ".ohss-row:hover { background:rgba(255,255,255,0.06); }",
      ".ohss-row-inner { padding-right:32px; pointer-events:none; }",
      ".ohss-row-top { display:flex; justify-content:space-between; gap:6px; align-items:center; }",
      ".ohss-row-name { color:var(--oh-panel-text, #e2e8f0); font-size:11px; font-weight:700; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      ".ohss-row-status { font-size:10px; font-weight:700; padding:1px 4px; border-radius:3px; }",
      ".ohss-row-status.building { color:#00ccff; background:rgba(0,204,255,0.12); }",
      ".ohss-row-status.placed { color:#ffcc66; background:rgba(255,204,102,0.12); }",
      ".ohss-row-meta { display:flex; gap:8px; align-items:center; margin-top:2px; font-size:9px; color:var(--oh-panel-text-dim, rgba(148,163,184,0.85)); }",
      ".ohss-row-meta .ohss-tag { padding:0 3px; border-radius:2px; background:rgba(148,163,184,0.1); }",
      ".ohss-row-meta .ohss-time { color:#00ccff; }",
      ".ohss-nuke-btn {",
      "  position:absolute; right:6px; top:50%; transform:translateY(-50%);",
      "  background:#1a0000; border:1px solid #cc2200; color:#ff4400;",
      "  font-size:16px; width:28px; height:28px; border-radius:4px;",
      "  cursor:pointer; display:flex; align-items:center; justify-content:center;",
      "  padding:0; line-height:1; z-index:10;",
      "  transition:background 0.15s,color 0.15s,border-color 0.15s;",
      "}",
      ".ohss-nuke-btn:hover { background:#cc2200; color:#fff; border-color:#ff4400; }",
      ".ohss-empty { color:rgba(148,163,184,0.72); font-size:10px; text-align:center; padding:5px 0; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- Silo panel ----

  function _buildSiloRow(item) {
    var row = document.createElement("div");
    row.className = "ohss-row";
    row.setAttribute("data-unit-key", item.unitKey);

    var inner = document.createElement("div");
    inner.className = "ohss-row-inner";

    // Line 1: Name | Status badge
    var topRow = document.createElement("div");
    topRow.className = "ohss-row-top";

    var nameEl = document.createElement("span");
    nameEl.className = "ohss-row-name";
    nameEl.setAttribute("data-ss-name", "1");
    nameEl.style.color = item.ownerColor || "#e2e8f0";
    nameEl.textContent = item.ownerName;

    var statusEl = document.createElement("span");
    statusEl.className = "ohss-row-status " + (item.isBuilding ? "building" : "placed");
    statusEl.setAttribute("data-ss-status", "1");
    statusEl.textContent = item.isBuilding ? _tr("Building") : _tr("Placed");

    topRow.appendChild(nameEl);
    topRow.appendChild(statusEl);

    // Line 2: Coord | Level | Time
    var metaRow = document.createElement("div");
    metaRow.className = "ohss-row-meta";

    var coordEl = document.createElement("span");
    coordEl.setAttribute("data-ss-coord", "1");
    coordEl.textContent = item.posLabel;

    var levelEl = document.createElement("span");
    levelEl.className = "ohss-tag";
    levelEl.setAttribute("data-ss-level", "1");
    levelEl.textContent = "Lv." + item.level;

    metaRow.appendChild(coordEl);
    metaRow.appendChild(levelEl);

    if (item.isBuilding && item.timeLabel) {
      var timeEl = document.createElement("span");
      timeEl.className = "ohss-time";
      timeEl.setAttribute("data-ss-time", "1");
      timeEl.textContent = item.timeLabel;
      metaRow.appendChild(timeEl);
    }

    inner.appendChild(topRow);
    inner.appendChild(metaRow);
    row.appendChild(inner);

    // Nuke button — opens atom batch-fire dialog with the enemy silo's tile pre-filled
    var nukeBtn = document.createElement("button");
    nukeBtn.className = "ohss-nuke-btn";
    nukeBtn.textContent = "☢";
    nukeBtn.title = _tr("Atom batch-fire to Silo");
    nukeBtn.onclick = function(e) {
      e.stopPropagation();
      if (row._blonTile == null) return;
      try {
        if (window.__OFH_atomBatch && typeof window.__OFH_atomBatch.openDialog === "function") {
          window.__OFH_atomBatch.openDialog(row._blonTile);
        } else if (typeof sendGamePacket === "function") {
          // Fallback: direct fire
          sendGamePacket({ type: "build_unit", unit: "Atom Bomb", tile: row._blonTile });
        }
      } catch (err) {}
    };
    row.appendChild(nukeBtn);

    row._blonCoords = item.coords;
    row._blonTile = item.tile;

    row.addEventListener("click", function() {
      if (item.coords) _centerCameraOnTile(item.coords.x, item.coords.y);
    });

    return row;
  }

  function _updateSiloRow(row, item) {
    var nameEl = row.querySelector("[data-ss-name]");
    var statusEl = row.querySelector("[data-ss-status]");
    var coordEl = row.querySelector("[data-ss-coord]");
    var levelEl = row.querySelector("[data-ss-level]");
    var timeEl = row.querySelector("[data-ss-time]");
    if (nameEl && nameEl.textContent !== item.ownerName) nameEl.textContent = item.ownerName;
    if (nameEl && nameEl.style.color !== (item.ownerColor || "#e2e8f0")) nameEl.style.color = item.ownerColor || "#e2e8f0";
    if (statusEl) {
      var txt = item.isBuilding ? _tr("Building") : _tr("Placed");
      if (statusEl.textContent !== txt) statusEl.textContent = txt;
      statusEl.className = "ohss-row-status " + (item.isBuilding ? "building" : "placed");
    }
    if (coordEl && coordEl.textContent !== item.posLabel) coordEl.textContent = item.posLabel;
    if (levelEl) levelEl.textContent = "Lv." + item.level;
    if (item.isBuilding && item.timeLabel) {
      if (!timeEl) {
        timeEl = document.createElement("span");
        timeEl.className = "ohss-time";
        timeEl.setAttribute("data-ss-time", "1");
        row.querySelector(".ohss-row-meta").appendChild(timeEl);
      }
      timeEl.textContent = item.timeLabel;
    } else if (timeEl) {
      timeEl.remove();
    }
    row._blonCoords = item.coords;
    row._blonUnit = item.unit;
    row._blonTile = item.tile;
  }

  function updateSiloPanel() {
    var panelEnabled = _cfg("combatSiloPanel", false);
    console.log("[SiloSAM] updateSiloPanel:", panelEnabled);
    if (!panelEnabled) {
      _removePanel(SILO_PANEL_ID);
      return;
    }
    _ensureStyles();
    var panel = _ensurePanel(SILO_PANEL_ID, "Silo Tracker", "combatSiloPanel");
    var content = panel.querySelector(".ohss-body");
    if (!content) return;

    var ctx;
    try { ctx = (typeof getOpenFrontGameContext === "function" ? getOpenFrontGameContext() : null); } catch (e) {}
    if (!ctx || !ctx.game) {
      _setEmpty(content, _tr("No game state available"));
      return;
    }

    // Use _getAllSilos — same proven approach as audio alert
    var allSilos = _getAllSilos(ctx.game);
    var me = ctx.game.myPlayer ? ctx.game.myPlayer() : null;
    var buildingOnly = _cfg("combatSiloBuildingOnly", false);
    var showAll = _cfg("combatSiloShowAll", false);

    // Filter
    var filtered = [];
    for (var i = 0; i < allSilos.length; i++) {
      var silo = allSilos[i];
      if (me) {
        try {
          var mySid = me.smallID ? me.smallID() : null;
          var owner = _safeOwner(silo, ctx.game);
          var ownerSid = owner && owner.smallID ? owner.smallID() : null;
          // Skip own silos (always)
          if (mySid !== null && ownerSid !== null && mySid === ownerSid) continue;
          if (!showAll) {
            // Skip allied silos
            var isAlly = _isAlly(silo, me, ctx.game);
            var myTeam = me.team ? me.team() : null;
            var ownerTeam = owner && owner.team ? owner.team() : null;
            var isSameTeam = myTeam !== null && ownerTeam !== null && myTeam === ownerTeam;
            if (isAlly || isSameTeam) continue;
          }
        } catch (e) { continue; }
      }
      // Building only filter
      if (buildingOnly) {
        var isBuilding = typeof silo.isUnderConstruction === "function" && silo.isUnderConstruction();
        if (!isBuilding) continue;
      }
      filtered.push(silo);
    }

    if (filtered.length === 0) {
      _setEmpty(content, _tr("No matching missile silos found"));
      return;
    }

    filtered.sort(function(a, b) {
      var aUnder = (typeof a.isUnderConstruction === "function" && a.isUnderConstruction()) ? 0 : 1;
      var bUnder = (typeof b.isUnderConstruction === "function" && b.isUnderConstruction()) ? 0 : 1;
      return aUnder - bUnder;
    });

    var currentTick = typeof ctx.game.ticks === "function" ? ctx.game.ticks() : 0;
    var items = [];
    for (var i = 0; i < filtered.length; i++) {
      var unit = filtered[i];
      var id = typeof unit.id === "function" ? unit.id() : String(unit);
      var owner = _safeOwner(unit, ctx.game);
      var ownerName = _playerLabel(owner, me);
      var ownerColor = _playerColor(owner, ctx.game);
      var coords = _getTileCoords(ctx.game, unit);
      var tile = null;
      try { tile = typeof unit.tile === "function" ? unit.tile() : unit.tile; } catch (e) {}
      var isBuilding = typeof unit.isUnderConstruction === "function" && unit.isUnderConstruction();
      var level = typeof unit.level === "function" ? unit.level() : 1;
      var posLabel = coords ? ("@" + coords.x + "," + coords.y) : "@unknown";

      // Construction time remaining
      var timeLabel = "";
      if (isBuilding) {
        var buildTicks = 100; // silo default
        try {
          var info = typeof ctx.game.unitInfo === "function" ? ctx.game.unitInfo("Missile Silo") : null;
          if (info && info.constructionDuration != null) buildTicks = info.constructionDuration;
        } catch (e) {}
        var startTick = unit.state && unit.state.constructionStartTick != null ? unit.state.constructionStartTick : null;
        if (startTick !== null) {
          var remaining = Math.max(0, buildTicks - (currentTick - startTick));
          timeLabel = (remaining / 10).toFixed(1) + "s";
        }
      }

      items.push({
        unit: unit, unitKey: String(id), ownerName: ownerName, ownerColor: ownerColor,
        coords: coords, tile: tile, isBuilding: isBuilding, level: level, posLabel: posLabel, timeLabel: timeLabel
      });
    }

    // Clear empty message if present
    var emptyEl = content.querySelector(".ohss-empty");
    if (emptyEl) emptyEl.remove();

    // Diff update — preserve existing rows
    var existingRows = {};
    var children = content.querySelectorAll("[data-unit-key]");
    for (var i = 0; i < children.length; i++) {
      existingRows[children[i].getAttribute("data-unit-key")] = children[i];
    }
    var newKeys = {};
    for (var i = 0; i < items.length; i++) newKeys[items[i].unitKey] = true;
    for (var key in existingRows) {
      if (existingRows.hasOwnProperty(key) && !newKeys[key]) existingRows[key].remove();
    }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var row = existingRows[item.unitKey];
      if (!row) {
        row = _buildSiloRow(item);
        content.appendChild(row);
      } else {
        _updateSiloRow(row, item);
      }
      if (content.children[i] !== row) {
        content.insertBefore(row, content.children[i] || null);
      }
    }
  }

  function _setEmpty(content, msg) {
    if (content.children.length !== 1 || !content.querySelector(".ohss-empty")) {
      content.innerHTML = '<div class="ohss-empty">' + _esc(msg) + '</div>';
    }
  }

  function _samFireFailureMessage(res) {
    var reason = res && res.reason;
    if (reason === "no-silo") return _tr("Cannot build atom here (no silo / disabled / unreachable).");
    if (reason === "too-slow") return _tr("Too slow — SAMs reload before impact. Lower the Delay in the Atom settings tab.");
    if (reason === "too-strong") return _tr("Too many SAM levels here — atoms can't overwhelm them even at full speed. Use MIRV.");
    if (reason === "gold") return _tr("Not enough gold to fire the recommended salvo.");
    if (reason === "silo") return _tr("Not enough silos ready to fire the recommended salvo.");
    return _tr("Cannot fire right now.");
  }

  function _samAutoFireAttempt(id, samTile, owner, me, maxQty) {
    _samAutoFiredIds[id] = "pending";
    window.__OFH_atomBatch.recommendQty(samTile).then(function(rec) {
      if (!rec || !rec.ok || rec.recommended > maxQty) {
        delete _samAutoFiredIds[id];
        return;
      }
      return window.__OFH_atomBatch.fireNow(samTile, rec.recommended).then(function(res) {
        _samAutoFiredIds[id] = true;
        var label = _playerLabel(owner, me);
        _toast("🚀 " + _tr("Auto-fired") + " " + res.fired + " " + _tr("atom bomb(s)") + " → " + label + "'s SAM", "rgba(0,150,80,0.92)");
      });
    }).catch(function() {
      delete _samAutoFiredIds[id];
    });
  }

  function _runSamAutoFireBuilding(ctx) {
    if (!_cfg("combatSamTracker", false) || !_cfg("combatSamAutoFireBuilding", false)) return;
    if (!ctx || !ctx.game) return;
    var game = ctx.game;

    if (game !== _samAutoFireLastGameObj) {
      _samAutoFireLastGameObj = game;
      _samAutoFiredIds = {};
      return; // fresh game — re-evaluate from next tick
    }

    if (!window.__OFH_atomBatch || typeof window.__OFH_atomBatch.estimateFlightTicks !== "function") return;
    var me = game.myPlayer ? game.myPlayer() : null;
    if (!me) return;

    var maxQty = Math.max(1, Math.floor(Number(_cfg("combatSamAutoFireMaxQty", 1))) || 1);
    var allSams = _getSAMTrackerUnits(game);
    var currentTick = typeof game.ticks === "function" ? game.ticks() : 0;

    for (var i = 0; i < allSams.length; i++) {
      var sam = allSams[i];
      var isBuilding = typeof sam.isUnderConstruction === "function" && sam.isUnderConstruction();
      if (!isBuilding) continue;

      var id = null;
      if (typeof sam.id === "function") id = sam.id();
      else if (sam.id !== void 0) id = sam.id;
      else if (sam.state && sam.state.id !== void 0) id = sam.state.id;
      if (id === null || id === void 0) continue;
      if (Object.prototype.hasOwnProperty.call(_samAutoFiredIds, id)) continue;

      var owner = _safeOwner(sam, game);
      if (!owner) continue;
      try {
        var mySid = me.smallID ? me.smallID() : null;
        var ownerSid = owner.smallID ? owner.smallID() : null;
        if (mySid !== null && ownerSid !== null && mySid === ownerSid) continue;
        var isAlly = (me.isAlliedWith && me.isAlliedWith(owner)) || false;
        var myTeam = me.team ? me.team() : null;
        var ownerTeam = owner.team ? owner.team() : null;
        var isSameTeam = myTeam !== null && ownerTeam !== null && myTeam === ownerTeam;
        if (isAlly || isSameTeam) continue;
      } catch (e) { continue; }

      var samTile = typeof sam.tile === "function" ? sam.tile() : sam.tile;
      if (samTile == null) continue;

      var buildTicks = 300;
      try {
        var info = typeof game.unitInfo === "function" ? game.unitInfo("SAM Launcher") : null;
        if (info && info.constructionDuration != null) buildTicks = info.constructionDuration;
      } catch (e) {}
      var startTick = sam.state && sam.state.constructionStartTick != null ? sam.state.constructionStartTick : null;
      if (startTick === null) continue;
      var remainingTicks = Math.max(0, buildTicks - (currentTick - startTick));

      var flightTicks = window.__OFH_atomBatch.estimateFlightTicks(samTile);
      if (flightTicks == null || flightTicks >= remainingTicks - SAM_AUTO_FIRE_SAFETY_MARGIN_TICKS) continue;

      _samAutoFireAttempt(id, samTile, owner, me, maxQty);
    }
  }

  // ---- SAM panel ----

  function updateSAMTrackerPanel() {
    var enabled = _cfg("combatSamTracker", false);
    if (!enabled) {
      _removePanel(SAM_PANEL_ID);
      return;
    }
    _ensureStyles();
    var panel = _ensurePanel(SAM_PANEL_ID, "SAM Tracker", "combatSamTracker");
    var content = panel.querySelector(".ohss-body");
    if (!content) return;

    var ctx;
    try { ctx = (typeof getOpenFrontGameContext === "function" ? getOpenFrontGameContext() : null); } catch (e) {}
    if (!ctx || !ctx.game) {
      content.innerHTML = '<div class="ohss-empty">' + _tr("No game state available.") + '</div>';
      return;
    }

    var allSams = _getSAMTrackerUnits(ctx.game);
    var me = ctx.game.myPlayer ? ctx.game.myPlayer() : null;
    var buildingOnly = _cfg("combatSamBuildingOnly", false);
    var showAll = _cfg("combatSamShowAll", false);
    var filteredSams = [];
    for (var i = 0; i < allSams.length; i++) {
      var sam = allSams[i];
      var owner = _safeOwner(sam, ctx.game);
      if (!owner) continue;
      if (me) {
        try {
          var mySid = me.smallID ? me.smallID() : null;
          var ownerSid = owner.smallID ? owner.smallID() : null;
          // Skip own SAMs (always)
          if (mySid !== null && ownerSid !== null && mySid === ownerSid) continue;
          if (!showAll) {
            // Skip allied SAMs
            var isAlly = (me.isAlliedWith && me.isAlliedWith(owner)) || false;
            // Also check team
            var myTeam = me.team ? me.team() : null;
            var ownerTeam = owner.team ? owner.team() : null;
            var isSameTeam = myTeam !== null && ownerTeam !== null && myTeam === ownerTeam;
            if (isAlly || isSameTeam) continue;
          }
        } catch (e) { continue; }
      }
      // Filter: building only
      if (buildingOnly) {
        var isBuilding = typeof sam.isUnderConstruction === "function" && sam.isUnderConstruction();
        if (!isBuilding) continue;
      }
      filteredSams.push(sam);
    }

    if (filteredSams.length === 0) {
      content.innerHTML = '<div class="ohss-empty">' + _tr("No matching SAMs found.") + '</div>';
      return;
    }

    var currentTick = typeof ctx.game.ticks === "function" ? ctx.game.ticks() : 0;
    var items = [];

    for (var i = 0; i < filteredSams.length; i++) {
      var sam = filteredSams[i];
      var samTile = typeof sam.tile === "function" ? sam.tile() : sam.tile;
      if (samTile == null) continue;
      var samCoords = { x: 0, y: 0 };
      try { samCoords.x = ctx.game.x(samTile); samCoords.y = ctx.game.y(samTile); } catch (e) { continue; }

      var owner = _safeOwner(sam, ctx.game);
      var ownerName = _playerLabel(owner, me);
      var ownerColor = _playerColor(owner, ctx.game);
      var level = typeof sam.level === "function" ? sam.level() : 1;
      var isBuilding = typeof sam.isUnderConstruction === "function" && sam.isUnderConstruction();

      var timeLabel = "";
      if (isBuilding) {
        var buildTicks = 300;
        try {
          var info = typeof ctx.game.unitInfo === "function" ? ctx.game.unitInfo("SAM Launcher") : null;
          if (info && info.constructionDuration != null) buildTicks = info.constructionDuration;
        } catch (e) {}
        var startTick = sam.state && sam.state.constructionStartTick != null ? sam.state.constructionStartTick : null;
        if (startTick !== null) {
          var remaining = Math.max(0, buildTicks - (currentTick - startTick));
          timeLabel = (remaining / 10).toFixed(1) + "s";
        }
      }

      items.push({
        sam: sam, tile: samTile, coords: samCoords, ownerName: ownerName,
        ownerColor: ownerColor, level: level, isBuilding: isBuilding,
        posLabel: "@" + samCoords.x + "," + samCoords.y, timeLabel: timeLabel
      });
    }

    items.sort(function(a, b) {
      if (a.isBuilding && !b.isBuilding) return -1;
      if (!a.isBuilding && b.isBuilding) return 1;
      return a.coords.x - b.coords.x || a.coords.y - b.coords.y;
    });

    content.innerHTML = "";
    if (items.length === 0) {
      content.innerHTML = '<div class="ohss-empty">' + _tr("No matching SAMs found.") + '</div>';
      return;
    }

    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var row = document.createElement("div");
        row.className = "ohss-row";

        var inner = document.createElement("div");
        inner.className = "ohss-row-inner";

        // Line 1: Name | Status badge
        var topRow = document.createElement("div");
        topRow.className = "ohss-row-top";

        var nameEl = document.createElement("span");
        nameEl.className = "ohss-row-name";
        nameEl.style.color = item.ownerColor || "#e2e8f0";
        nameEl.textContent = item.ownerName;

        var statusEl = document.createElement("span");
        statusEl.className = "ohss-row-status " + (item.isBuilding ? "building" : "placed");
        statusEl.textContent = item.isBuilding ? _tr("Building") : _tr("Placed");

        topRow.appendChild(nameEl);
        topRow.appendChild(statusEl);

        // Line 2: Coord | Level | Time
        var metaRow = document.createElement("div");
        metaRow.className = "ohss-row-meta";

        var coordEl = document.createElement("span");
        coordEl.textContent = item.posLabel;

        var levelEl = document.createElement("span");
        levelEl.className = "ohss-tag";
        levelEl.textContent = "Lv." + item.level;

        metaRow.appendChild(coordEl);
        metaRow.appendChild(levelEl);

        if (item.isBuilding && item.timeLabel) {
          var timeEl = document.createElement("span");
          timeEl.className = "ohss-time";
          timeEl.textContent = "⏱" + item.timeLabel;
          metaRow.appendChild(timeEl);
        }

        inner.appendChild(topRow);
        inner.appendChild(metaRow);
        row.appendChild(inner);

        // Nuke button — one-click fire (if enabled) or opens atom batch-fire dialog
        var nukeBtn = document.createElement("button");
        nukeBtn.className = "ohss-nuke-btn";
        nukeBtn.textContent = "☢";
        nukeBtn.title = _tr("Atom batch-fire to SAM");
        nukeBtn.onclick = function(e) {
          e.stopPropagation();
          if (item.tile == null) return;
          if (_cfg("combatSamOneClickFire", false)) {
            if (!window.__OFH_atomBatch || typeof window.__OFH_atomBatch.fireRecommended !== "function") return;
            window.__OFH_atomBatch.fireRecommended(item.tile).then(function(res) {
              if (res && res.ok) {
                _toast("🚀 " + _tr("Fired") + " " + res.fired + "/" + res.qty + " " + _tr("atom bomb(s)"), "rgba(0,150,80,0.92)");
              } else {
                _toast(_samFireFailureMessage(res), "rgba(220,40,40,0.92)");
              }
            }).catch(function() {
              _toast(_tr("Cannot fire right now."), "rgba(220,40,40,0.92)");
            });
            return;
          }
          try {
            if (window.__OFH_atomBatch && typeof window.__OFH_atomBatch.openDialog === "function") {
              window.__OFH_atomBatch.openDialog(item.tile);
            } else if (typeof sendGamePacket === "function") {
              // Fallback: direct fire
              sendGamePacket({ type: "build_unit", unit: "Atom Bomb", tile: item.tile });
            }
          } catch (err) {}
        };
        row.appendChild(nukeBtn);

        row.addEventListener("click", function() {
          if (item.coords) _centerCameraOnTile(item.coords.x, item.coords.y);
        });

        content.appendChild(row);
      })(items[i]);
    }
  }

  // ---- Panel management ----

  // Default positions: bottom row, right-aligned.
  // Layout (right to left): [Auto-bot 244px] [gap 8] [Silo 250px] [gap 8] [SAM 250px]
  // Auto-bot is at right:16px in CSS.
  function _getDefaultPos(id) {
    var w = window.innerWidth || 1920;
    var h = window.innerHeight || 1080;
    if (id === SILO_PANEL_ID) {
      // Immediately LEFT of auto-bot: right edge = 16 + 244 + 8 = 268
      return { left: w - 268 - 250, top: h - 16 - 380 };
    }
    if (id === SAM_PANEL_ID) {
      // Immediately LEFT of silo
      return { left: w - 268 - 250 - 8 - 250, top: h - 16 - 380 };
    }
    return { left: 300, top: 120 };
  }

  function _ensurePanel(id, title, settingKey) {
    var panel = document.getElementById(id);
    if (panel) {
      panel.dataset.visible = "true";
      panel.style.setProperty("display", "flex", "important");
      // Apply stored position (user may have dragged it)
      if (typeof applyStoredGoldStatPanelPosition === "function") {
        applyStoredGoldStatPanelPosition(panel, id + "-pos");
      }
      return panel;
    }
    console.log("[SiloSAM] creating panel:", id);
    _ensureStyles();
    panel = document.createElement("div");
    panel.id = id;
    panel.dataset.visible = "true";
    panel.style.setProperty("display", "flex", "important");
    panel.dataset.minimized = "false";
    // Default position: align TOP with auto-bot panel
    var autoBot = document.getElementById("openfront-helper-autobot-panel");
    var autoTop = 500; // fallback
    if (autoBot) {
      var rect = autoBot.getBoundingClientRect();
      autoTop = rect.top + 16;
    }
    if (id === SILO_PANEL_ID) {
      panel.style.left = "268px";
      panel.style.top = autoTop + "px";
      panel.style.bottom = "auto";
    } else if (id === SAM_PANEL_ID) {
      panel.style.left = "526px";
      panel.style.top = autoTop + "px";
      panel.style.bottom = "auto";
    }

    var hdr = document.createElement("div");
    hdr.className = "ohss-header";
    var titleEl = document.createElement("div");
    titleEl.className = "ohss-title";
    titleEl.textContent = "⚙ " + title;

    // Minimize button (-)
    var minBtn = document.createElement("button");
    minBtn.type = "button";
    minBtn.className = "ohss-min-btn";
    minBtn.textContent = "▾";
    minBtn.title = "Minimize / Restore";
    minBtn.addEventListener("click", function() {
      var isMin = panel.dataset.minimized === "true";
      panel.dataset.minimized = isMin ? "false" : "true";
      minBtn.textContent = isMin ? "▾" : "▴";
    });

    // Close button (×)
    var xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "ohss-x";
    xBtn.textContent = "×";
    xBtn.addEventListener("click", function() {
      panel.dataset.visible = "false";
      // Sync setting back + hide panel immediately
      if (settingKey) {
        // Update cache directly
        try {
          if (typeof _quickPanelSettingsCache === "object" && _quickPanelSettingsCache) {
            _quickPanelSettingsCache[settingKey] = false;
          }
        } catch (e) {}
        // Notify lobby
        try {
          window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
            detail: { key: settingKey, value: false }
          }));
        } catch (e) {}
        // Force hide this panel now
        _removePanel(id);
        // Sync Quick Panel toggle UI
        try {
          var qpPanel = document.getElementById("openfront-helper-quick-panel");
          if (qpPanel && qpPanel.dataset.visible === "true" && typeof _renderActiveTab === "function") {
            _renderActiveTab();
          }
        } catch (e) {}
      }
    });

    hdr.appendChild(titleEl);
    hdr.appendChild(minBtn);
    hdr.appendChild(xBtn);

    var body = document.createElement("div");
    body.className = "ohss-body";

    panel.appendChild(hdr);
    panel.appendChild(body);

    (document.body || document.documentElement).appendChild(panel);

    // Debug: log final position
    var rect = panel.getBoundingClientRect();
    console.log("[SiloSAM] panel appended:", id, {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      visible: panel.dataset.visible, display: getComputedStyle(panel).display
    });

    if (typeof makeGoldStatPanelDraggable === "function") {
      makeGoldStatPanelDraggable(panel, hdr, id + "-pos");
      // NOTE: do NOT apply stored position here — default position is set above.
      // Stored position is applied only when re-opening an existing panel (top of function).
    }

    return panel;
  }

  function _removePanel(id) {
    var panel = document.getElementById(id);
    if (panel) {
      panel.dataset.visible = "false";
      panel.style.setProperty("display", "none", "important");
      console.log("[SiloSAM] _removePanel:", id, "display:", panel.style.display);
    } else {
      console.log("[SiloSAM] _removePanel: not found", id);
    }
  }

  // ---- New silo placement detection (audio alert) ----

  function checkSiloPlacements(state) {
    if (!state || !state.game) return;
    var game = state.game;

    if (game !== _lastGameObj) {
      _lastGameObj = game;
      _knownSiloIds = {};
      var existing = _getAllSilos(game);
      for (var i = 0; i < existing.length; i++) {
        var id = typeof existing[i].id === "function" ? existing[i].id() : null;
        if (id !== null) _knownSiloIds[id] = true;
      }
      return;
    }

    var audioEnabled = _cfg("combatSiloAudioAlert", false);
    var current = _getAllSilos(game);
    var foundNew = false;
    for (var i = 0; i < current.length; i++) {
      var id = typeof current[i].id === "function" ? current[i].id() : null;
      if (id !== null && !_knownSiloIds[id]) {
        _knownSiloIds[id] = true;
        var isBuilding = typeof current[i].isUnderConstruction === "function" ? current[i].isUnderConstruction() : true;
        if (isBuilding) {
          var me = state.game.myPlayer ? state.game.myPlayer() : null;
          if (!_isAlly(current[i], me, game)) foundNew = true;
        }
      }
    }

    if (foundNew && audioEnabled) {
      var now = Date.now();
      if (now - _lastAudioAlertMs > 5000) {
        _lastAudioAlertMs = now;
        _playPing();
      }
    }
  }

  function _playPing() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  // ---- Camera jump (ported from Blon centerCameraOnTile) ----

  function _centerCameraOnTile(x, y) {
    try {
      var overlay = document.querySelector("player-info-overlay");
      if (!overlay || !overlay.eventBus) return;
      var bus = overlay.eventBus;
      if (!bus.listeners || typeof bus.listeners.entries !== "function") return;
      var it = bus.listeners.entries();
      var entry = it.next();
      while (!entry.done) {
        var ctor = entry.value[0];
        var callbacks = entry.value[1];
        if (ctor) {
          var matched = ctor.name === "GoToPositionEvent";
          if (!matched && Array.isArray(callbacks)) {
            for (var i = 0; i < callbacks.length; i++) {
              if (typeof callbacks[i] === "function") {
                var s = callbacks[i].toString();
                if (s.indexOf("onGoToPosition") !== -1 || s.indexOf("GoToPositionEvent") !== -1) {
                  matched = true;
                  break;
                }
              }
            }
          }
          if (matched) {
            try { bus.emit(new ctor(x, y)); } catch (e) {}
            return;
          }
        }
        entry = it.next();
      }
    } catch (e) {}
  }

  // ---- Global tick entry point (called from bootstrap game loop) ----

  window.__OFH_updateSiloSamTracker = function() {
    try {
      var siloPanel = _cfg("combatSiloPanel", false);
      var samTracker = _cfg("combatSamTracker", false);
      console.log("[SiloSAM] tick:", { siloPanel: siloPanel, samTracker: samTracker, cache: !!_quickPanelSettingsCache });
      if (!siloPanel && !samTracker) return;

      var ctx = (typeof getOpenFrontGameContext === "function" ? getOpenFrontGameContext() : null);
      if (!ctx || !ctx.game) {
        console.log("[SiloSAM] no game context", { siloPanel: siloPanel, samTracker: samTracker });
        return;
      }

      if (siloPanel) {
        updateSiloNotification();
        updateSiloPanel();
        checkSiloPlacements(ctx);
      }
      if (samTracker) {
        updateSAMTrackerPanel();
        _runSamAutoFireBuilding(ctx);
      }
    } catch (e) {}
  };
