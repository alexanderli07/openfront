// Build timer overlay — shows construction countdown and missile cooldown timers
// above Missile Silos and SAM Launchers on the map. A layer on the shared
// map-overlay scheduler.
//
// Data source: game.units("Missile Silo", "SAM Launcher") + unit properties
// (isUnderConstruction, missileTimerQueue, level, tile, id). Construction
// progress is tracked by recording the tick when a unit first appears as
// under-construction, then counting down from the configured duration.
// Cooldown is read from missileTimerQueue (array of fire ticks).

  const BUILD_TIMER_TYPES = ["Missile Silo", "SAM Launcher"];
  const BUILD_TIMER_COOLDOWN_TICKS = 90; // default missile cooldown
  const BUILD_TIMER_DEFAULT_DURATION = {
    "Missile Silo": 100,   // 10s at 10 ticks/s
    "SAM Launcher": 300,   // 30s (SAM_CONSTRUCTION_TICKS)
  };

  // Map: unitId -> firstSeenTick (when we first saw it under construction).
  const _buildTimerConstructionSeen = new Map();
  // Game ticks restart near 0 in a new match while this Map survives (it lives for the page
  // session). A reused unit id would then carry the PREVIOUS match's start tick, and
  // `remaining = duration + (staleAnchor - nowTicks)` has no upper clamp, so the label
  // would show a wildly inflated countdown. Detected by the tick going backwards.
  let _buildTimerLastTicks = null;
  // Scan cache: [{ id, type, worldX, worldY, label, ready }].
  let _buildTimerScan = [];

  function getConstructionDuration(game, type) {
    try {
      const info = game.config && game.config().unitInfo
        ? game.config().unitInfo(type)
        : null;
      if (info && Number.isFinite(info.constructionDuration) && info.constructionDuration > 0) {
        return info.constructionDuration;
      }
    } catch (_error) { /* ignore */ }
    return BUILD_TIMER_DEFAULT_DURATION[type] || 100;
  }

  function scanBuildTimers(game) {
    let units;
    try {
      units = game.units(...BUILD_TIMER_TYPES);
    } catch (_error) {
      _buildTimerScan = [];
      return;
    }
    const ticks = game.ticks ? game.ticks() : 0;
    // Ticks running backwards means a new match started in this same page session; the
    // anchor Map outlives the match, so drop it or a reused unit id inherits a start tick
    // from the previous game.
    if (_buildTimerLastTicks !== null && ticks < _buildTimerLastTicks) {
      _buildTimerConstructionSeen.clear();
    }
    _buildTimerLastTicks = ticks;
    const out = [];
    const seenIds = new Set();

    for (const unit of units) {
      if (!unit || !unit.isActive || !unit.isActive()) continue;
      const id = unit.id ? unit.id() : null;
      if (id == null) continue;
      seenIds.add(id);
      const type = unit.type ? unit.type() : null;
      const tile = unit.tile ? unit.tile() : null;
      if (tile == null) continue;

      let worldX = 0, worldY = 0;
      try {
        worldX = game.x(tile);
        worldY = game.y(tile);
      } catch (_error) { continue; }

      const underConstruction = Boolean(unit.isUnderConstruction && unit.isUnderConstruction());

      if (underConstruction) {
        // BUILD NOTE: prefer the unit's REAL constructionStartTick — the accurate
        // read that the removed silo-sam-tracker.js used. First-observed stamping
        // restarts the countdown whenever you join, reconnect, or enable the overlay
        // mid-build, which over-reports remaining time. Fall back only if absent.
        let startTick = null;
        try {
          const st = unit.state && unit.state.constructionStartTick;
          if (st != null && Number.isFinite(Number(st))) startTick = Number(st);
        } catch (_error) { startTick = null; }
        if (startTick === null) {
          if (!_buildTimerConstructionSeen.has(id)) {
            _buildTimerConstructionSeen.set(id, ticks);
          }
          startTick = _buildTimerConstructionSeen.get(id);
        }
        const duration = getConstructionDuration(game, type);
        const remaining = Math.max(0, duration - (ticks - startTick));
        const sec = Math.round(ofhTicksToSeconds(game, remaining));
        const label = sec > 0 ? `🏗 ${sec}s` : tr("Building");
        out.push({ id, type, worldX, worldY, label, state: "building" });
      } else {
        // Done building — remove from construction tracker.
        _buildTimerConstructionSeen.delete(id);

        // Check missile cooldown.
        let queue = [];
        try {
          queue = unit.missileTimerQueue ? unit.missileTimerQueue() : [];
        } catch (_error) { queue = []; }
        let level = 1;
        try {
          level = Number(unit.level ? unit.level() : 1) || 1;
        } catch (_error) { level = 1; }

        if (Array.isArray(queue) && queue.length >= level) {
          // Prefer the unit's OWN ticksLeftInCooldown() — the game's authoritative answer,
          // already relied on by the auto-bot (nukeBehavior nukeSpawn) where
          // "not in cooldown" is defined as ticksLeftInCooldown() === 0. Reconstructing it
          // from missileTimerQueue()[0] minus SAMCooldown() had two problems: it assumed
          // the queue entry is an absolute fire tick, and it applied the SAM constant to
          // Missile Silos as well, which is simply the wrong structure's cooldown. The
          // reconstruction stays as a fallback for a client that doesn't expose the getter.
          let remaining = null;
          try {
            if (typeof unit.ticksLeftInCooldown === "function") {
              const left = Number(unit.ticksLeftInCooldown());
              if (Number.isFinite(left)) remaining = left;
            }
          } catch (_error) { remaining = null; }
          if (remaining === null) {
            const lastFired = queue[0];
            let cooldown = BUILD_TIMER_COOLDOWN_TICKS;
            try {
              const cfg = Number(game.config().SAMCooldown());
              if (Number.isFinite(cfg) && cfg > 0) cooldown = cfg;
            } catch (_error) { /* keep the default */ }
            remaining = cooldown - (ticks - lastFired);
          }
          if (remaining > 0) {
            const sec = Math.round(ofhTicksToSeconds(game, remaining));
            out.push({ id, type, worldX, worldY, label: `⟳ ${sec}s`, state: "cooldown" });
          }
          // Ready state draws NOTHING. The ✓ badge used to sit permanently over every
          // idle silo and SAM — which is their normal state almost all game — so it was
          // constant clutter carrying no information. Absence of a timer = ready.
        }
      }
    }

    // Prune construction tracker for units no longer in the scan.
    for (const id of _buildTimerConstructionSeen.keys()) {
      if (!seenIds.has(id)) _buildTimerConstructionSeen.delete(id);
    }

    _buildTimerScan = out;
  }

  function drawBuildTimers(ctx, game, transform) {
    if (_buildTimerScan.length === 0) return;
    ctx.save();
    for (const entry of _buildTimerScan) {
      const p = mapWorldToScreen(transform, entry.worldX, entry.worldY);
      if (!p || !mapPointOnScreen(p.x, p.y, 30)) continue;

      // Geometry and type now come from the shared map label, so a build timer and a
      // money pill are the same object. This used to be a square fillRect in
      // 'bold 11px "Aptos", monospace' — the `, monospace` tail meant that on a machine
      // without Aptos this resolved to Consolas while the pill beside it resolved to
      // Segoe UI, which is most of the "different fonts on one map" impression.
      const boxH = Math.max(OFH_OVERLAY_STYLE.minH, OFH_OVERLAY_STYLE.sizeMd + OFH_OVERLAY_STYLE.padY * 2);
      const by = p.y - boxH - 6; // above the unit

      // Two states only: building (blue halo) and cooldown (white halo). Ready
      // draws nothing. Since v1.57 drawPlainMapText renders BLACK glyphs with the
      // colour as the OUTLINE (the real vanilla plate style), so the state colour
      // is the halo here, not the fill.
      const halo = entry.state === "building" ? "#60a5fa" : "#e2e8f0";
      drawPlainMapText(ctx, p.x, by + boxH / 2, entry.label, halo, OFH_OVERLAY_STYLE.sizeMd);
    }
    ctx.restore();
  }

  registerMapOverlayLayer({
    id: "build-timers",
    scanIntervalMs: 250,
    isEnabled: function () { return buildTimerEnabled; },
    scan: function (game) { scanBuildTimers(game); },
    draw: function (ctx, game, transform) { drawBuildTimers(ctx, game, transform); },
  });

  function setBuildTimerEnabled(enabled) {
    buildTimerEnabled = Boolean(enabled);
    if (!buildTimerEnabled) {
      _buildTimerScan = [];
      _buildTimerConstructionSeen.clear();
    }
    requestMapOverlayLoop();
  }
