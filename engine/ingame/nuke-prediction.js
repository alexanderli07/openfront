// Enemy nuke prediction: landing markers and blast radius overlay.

  const NUKE_UNIT_TYPES = ["Atom Bomb", "Hydrogen Bomb", "MIRV Warhead"];

  // When several nukes of different relations target the same tile, the highest
  // rank decides the marker color: an incoming enemy strike (defensive warning)
  // outranks my own salvo, which outranks an ally's. In practice relations rarely
  // mix on a single tile, so for my own batch the marker is cyan with my count.
  // Team included since v1.56 (teammate nukes used to be filtered out entirely).
  const NUKE_RELATION_RANK = { ally: 1, team: 2, self: 3, enemy: 4 };

  // Atom/Hydrogen follow a ground-launched parabola we can time for a "time to impact"
  // readout. MIRV Warheads are EXCLUDED: they spawn mid-air at the MIRV split and fly flat
  // (distanceBasedHeight:false) at a different speed, so the silo→target atom parabola would
  // give a garbage time — we keep their count marker but show no ETA.
  const NUKE_ETA_TYPES = new Set(["Atom Bomb", "Hydrogen Bomb"]);

  function ensureNukeLandingStyles() {
    if (document.getElementById(NUKE_LANDING_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = NUKE_LANDING_STYLE_ID;
    style.textContent = `
      #${NUKE_LANDING_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        /* Was 8000, tying the two control panels — a blast ring or its label could paint
           OVER the panels. Map marks belong below panel chrome. */
        z-index: 7600;
        pointer-events: none;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone {
        position: fixed;
        left: 0;
        top: 0;
        width: var(--nuke-diameter);
        height: var(--nuke-diameter);
        border: 2px dashed var(--nuke-color, rgba(248, 113, 113, 0.92));
        /* Without this the 2px border sits OUTSIDE --nuke-diameter, so the ring draws 4px
           wider than the real blast radius. The sibling ring in auto-bot/lifecycle.js
           pins it; this one did not. */
        box-sizing: border-box;
        border-radius: 50%;
        /* USER (v1.54): ring only — the translucent disc fill (and its inset glow)
           tinted a huge patch of map under every incoming warhead. */
        background: transparent;
        box-shadow: 0 0 18px var(--nuke-glow, rgba(248, 113, 113, 0.36));
        transform: translate3d(var(--nuke-tx, 0px), var(--nuke-ty, 0px), 0) translate(-50%, -50%);
        will-change: transform;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before,
      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        background: var(--nuke-cross-color, rgba(254, 202, 202, 0.94));
        box-shadow: 0 0 10px var(--nuke-cross-glow, rgba(248, 113, 113, 0.6));
        transform: translate(-50%, -50%);
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before {
        width: 28px;
        height: 2px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        width: 2px;
        height: 28px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-label {
        position: fixed;
        left: 0;
        top: 0;
        /* USER (v1.54): plain outlined text, no chip — same treatment as the
           money line and build timers. */
        color: var(--nuke-label-color, #fecaca);
        /* Interpolated from the shared overlay tokens so this DOM map label is the same
           type as its canvas siblings. It was a FIFTH font stack — 900-weight system-ui,
           with no Aptos in it at all — which is why the nuke label never looked related to
           the money pill sitting next to it. */
        font: ${OFH_OVERLAY_STYLE.weight} ${OFH_OVERLAY_STYLE.sizeMd}px/1 ${OFH_OVERLAY_STYLE.family};
        letter-spacing: 0;
        text-shadow:
          -1px -1px 0 rgba(0, 0, 0, 0.9),
          1px -1px 0 rgba(0, 0, 0, 0.9),
          -1px 1px 0 rgba(0, 0, 0, 0.9),
          1px 1px 0 rgba(0, 0, 0, 0.9),
          0 1px 4px rgba(0, 0, 0, 0.92);
        transform: translate3d(var(--nuke-tx, 0px), var(--nuke-label-ty, 0px), 0) translate(-50%, -100%);
        will-change: transform;
        white-space: nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNukeLandingContainer() {
    ensureNukeLandingStyles();

    let container = document.getElementById(NUKE_LANDING_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = NUKE_LANDING_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function getNukePredictionRelation(game, unit) {
    const owner = unit?.owner?.();
    const relation = getPlayerRelationToMyPlayer(game, owner);
    return relation === "enemy" ||
      relation === "ally" ||
      relation === "team" ||
      relation === "self"
      ? relation
      : null;
  }

  function getNukePredictionColors(relation, owner) {
    // bg/innerGlow/labelBorder dropped in v1.54 — the ring is fill-less and the
    // label is chipless, so nothing reads them any more.
    // USER (v1.56): everyone except SELF takes the owner's on-map (team) colour;
    // the relation palettes below are the fallback when it can't be read.
    if (relation !== "self") {
      const ownerRgb =
        typeof ofhOwnerOverlayRgb === "function" ? ofhOwnerOverlayRgb(owner) : null;
      if (ownerRgb) {
        const tint = ofhOwnerTint(ownerRgb, 0.65);
        return {
          color: ofhOwnerRgba(ownerRgb, 0.95),
          glow: ofhOwnerRgba(ownerRgb, 0.38),
          crossColor: ofhOwnerRgba(tint, 0.96),
          crossGlow: ofhOwnerRgba(ownerRgb, 0.65),
          labelColor: "rgb(" + tint.r + ", " + tint.g + ", " + tint.b + ")",
        };
      }
    }
    if (relation === "team") {
      // Fallback only — teal, matching the boat/warship team palette.
      return {
        color: "rgba(45, 212, 191, 0.92)",
        glow: "rgba(45, 212, 191, 0.36)",
        crossColor: "rgba(153, 246, 228, 0.94)",
        crossGlow: "rgba(45, 212, 191, 0.6)",
        labelColor: "#99f6e4",
      };
    }
    if (relation === "ally") {
      return {
        color: "rgba(74, 222, 128, 0.92)",
        glow: "rgba(74, 222, 128, 0.36)",
        crossColor: "rgba(187, 247, 208, 0.94)",
        crossGlow: "rgba(74, 222, 128, 0.6)",
        labelColor: "#bbf7d0",
      };
    }

    if (relation === "self") {
      // USER (v1.55): magenta = mine, same identity as routes/markers/pills
      // (warshipRouteColor / getBoatPredictionColors / mapFactionColor). This was
      // the one overlay still using the old cyan for self.
      return {
        color: "rgba(240, 110, 255, 0.95)",
        glow: "rgba(240, 110, 255, 0.38)",
        crossColor: "rgba(250, 208, 255, 0.96)",
        crossGlow: "rgba(240, 110, 255, 0.65)",
        labelColor: "#f5d0fe",
      };
    }

    return {
      color: "rgba(248, 113, 113, 0.92)",
      glow: "rgba(248, 113, 113, 0.36)",
      crossColor: "rgba(254, 202, 202, 0.94)",
      crossGlow: "rgba(248, 113, 113, 0.6)",
      labelColor: "#fecaca",
    };
  }

  function getNukeLandingRadius(game, unit) {
    try {
      const magnitude = game?.config?.().nukeMagnitudes?.(unit.type());
      const radius = Number(magnitude?.outer ?? magnitude?.inner);
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
    } catch (_error) {
      // Fall back to the same radii used by OpenFront's nuke FX layer.
    }

    return unit?.type?.() === "Hydrogen Bomb" ? 160 : 70;
  }

  function getNukeLandingScreenRadius(transform, screenPos, worldRadius) {
    const scale = Number(transform?.scale);
    if (Number.isFinite(scale) && scale > 0) {
      return worldRadius * scale;
    }

    try {
      const reference = transform.worldToScreenCoordinates({
        x: screenPos.worldX + worldRadius,
        y: screenPos.worldY,
      });
      const dx = reference.x - screenPos.x;
      const dy = reference.y - screenPos.y;
      return Math.hypot(dx, dy);
    } catch (_error) {
      return worldRadius;
    }
  }

  // DOM-element cache + scan cache. The active in-flight nuke list rarely
  // changes; the screen position changes every pan frame. Splitting these
  // updates eliminates the per-frame querySelector storm.
  const nukeLandingEntries = new Map();
  let nukeScanCache = []; // [{ unitId, targetTile, worldRadius, relation, count, eta }]
  let lastNukeScanAt = 0;
  const NUKE_SCAN_MS = 250;
  // Pre-allocated reusable objects. Eliminates per-landing per-frame allocs.
  const _nukeWorldQueryArg = { x: 0, y: 0 };
  const _nukeRadiusReusePos = { x: 0, y: 0, worldX: 0, worldY: 0 };
  // id → { firstTick, remainTicks } anchored once at first sight. The nuke advances exactly
  // one trajectory point per tick, so the ETA = remainTicks − (now − firstTick) counts down
  // 1:1 without recomputing the curve each frame. Pruned by id every scan (own map, separate
  // from the tile-keyed nukeLandingEntries).
  const nukeFlightById = new Map();

  // ── Self-calibrating flight time ──────────────────────────────────────────────
  // computeNukeRemainingTicks models the game exactly as far as it can be verified from
  // this repo: the game advances `speed` of ARC distance per tick and detonates once the
  // distance flown exceeds the polyline length, which is floor(L/speed)+1 ticks. But the
  // curve itself is a PORT of the game's Bezier, and `speed` is used twice — as the point
  // spacing AND as the divisor — so any error in the ported height coefficients or in
  // defaultNukeSpeed() scales the whole estimate. Observed symptom of exactly that: the
  // warhead lands while the label still shows several seconds left, with the leftover
  // proportional to flight length.
  //
  // Since the upstream constants are not available to check against, measure instead. Each
  // nuke that flies to completion is a free experiment: compare how long it ACTUALLY took
  // against what was predicted at anchor time, and fold the ratio into a correction.
  // Converges within a couple of observed warheads and needs no constant to be right.
  // MEDIAN of recent observed ratios, not a running average. Some samples are lies: an
  // intercepted warhead vanishes early, and losing track of one does the same. A mean lets a
  // single such sample move the estimate; a median ignores a minority of them outright. That
  // also means the accept window can stay wide enough to learn a LARGE model error — a hard
  // floor near 1 would have rejected exactly the over-estimate this is here to measure.
  const NUKE_CAL = { factor: 1, ratios: [] };
  const NUKE_CAL_MIN_RATIO = 0.25; // wide: the point is to learn the error, not assume it
  const NUKE_CAL_MAX_RATIO = 4;
  const NUKE_CAL_WINDOW = 7;
  const NUKE_CAL_MIN_SAMPLES = 3; // below this, trust the model rather than one observation

  function nukeCalObserve(ratio) {
    if (!Number.isFinite(ratio)) return;
    if (ratio < NUKE_CAL_MIN_RATIO || ratio > NUKE_CAL_MAX_RATIO) return;
    const r = NUKE_CAL.ratios;
    r.push(ratio);
    if (r.length > NUKE_CAL_WINDOW) r.shift();
    if (r.length < NUKE_CAL_MIN_SAMPLES) return;
    const sorted = r.slice().sort((a, b) => a - b);
    NUKE_CAL.factor = sorted[Math.floor(sorted.length / 2)];
  }

  // Remaining flight ticks from a point on the arc to the target, via the SAME parabola the
  // game uses (UniversalPathFinding lives in the auto-bot bundle; guarded in case it is not
  // loaded). Flight time is flip-INDEPENDENT — the arc LENGTH is identical whether it bows up
  // or down — so directionUp:true is valid no matter the firer's flip toggle.
  //
  // NOT path.length! A nuke moves `speed` of ARC distance per tick (NukeExecution →
  // curve.increment(speed)) and detonates when the distance flown exceeds the arc length, so
  // the true count is floor(arcLength/speed)+1. The cached path points are spaced slightly
  // MORE than `speed` apart (Bézier t-sampling overshoots the spacing), so counting points
  // under-counts ticks — and the gap grows with range (far shots read ~1–2 s fast). Summing
  // the real segment lengths from the tile coords matches the game to within ~0.2 s at any
  // distance.
  function computeNukeRemainingTicks(game, fromTile, toTile) {
    try {
      if (
        typeof UniversalPathFinding === "undefined" ||
        !UniversalPathFinding.Parabola ||
        fromTile === undefined ||
        fromTile === null ||
        toTile === undefined ||
        toTile === null
      ) {
        return null;
      }
      const speed = game.config?.().defaultNukeSpeed?.() ?? 8;
      const pf = UniversalPathFinding.Parabola(game, {
        increment: speed,
        distanceBasedHeight: true,
        directionUp: true,
      });
      const path = pf.findPath(fromTile, toTile);
      if (!Array.isArray(path) || path.length === 0) {
        return null;
      }
      if (path.length === 1) {
        return 1; // already at target
      }
      let arc = 0;
      for (let i = 1; i < path.length; i++) {
        const ax = game.x(path[i]);
        const ay = game.y(path[i]);
        const bx = game.x(path[i - 1]);
        const by = game.y(path[i - 1]);
        arc += Math.hypot(ax - bx, ay - by);
      }
      return Math.floor(arc / (speed > 0 ? speed : 8)) + 1;
    } catch (_error) {
      return null;
    }
  }

  function collectNukeScan(game) {
    const groupedByTile = new Map();
    const seenIds = new Set();
    for (const unit of game.units(...NUKE_UNIT_TYPES)) {
      if (!unit?.isActive?.()) {
        continue;
      }
      const relation = getNukePredictionRelation(game, unit);
      if (!relation) {
        continue;
      }
      const nukeOwner = unit.owner?.();
      let nukeOwnerSid = null;
      try {
        nukeOwnerSid = nukeOwner?.smallID?.() ?? null;
      } catch (_e) {
        nukeOwnerSid = null;
      }
      const targetTile = unit.targetTile?.();
      if (targetTile === undefined) {
        continue;
      }

      // Per-nuke ETA (seconds), atom/hydrogen only. Anchor once at first sight, then count
      // down linearly — the nuke steps one trajectory point per tick. MIRV warheads get no
      // ETA (their mid-air, flat-arc flight isn't this parabola).
      let etaSec = null;
      const unitType = unit.type?.();
      const id = unit.id?.();
      if (NUKE_ETA_TYPES.has(unitType) && id !== undefined) {
        seenIds.add(id);
        let flight = nukeFlightById.get(id);
        if (flight === undefined) {
          const remainTicks = computeNukeRemainingTicks(
            game,
            unit.tile?.(),
            targetTile,
          );
          if (remainTicks !== null) {
            // Anchor an ABSOLUTE impact time in real milliseconds, then count down against
            // the wall clock. The arc-length model gives a good tick count, so convert it
            // ONCE here and stop depending on game ticks thereafter.
            //
            // Why not decrement by elapsed game ticks: nowTicks comes from
            // `typeof game.ticks === "function" ? game.ticks() : 0`, so on any client where
            // that accessor is absent it is permanently 0 — making
            // `remainTicks - (nowTicks - firstTick)` equal remainTicks on EVERY scan. The
            // label then sits at the full flight time and never counts down at all, which
            // reads as badly wrong rather than as broken.
            //
            // Counting down in real time also makes the label smooth between the 250ms
            // scans instead of stepping, and it is what the reader actually wants: seconds
            // until this thing hits, on their clock.
            const nowMs = Date.now();
            const anchorTick = Number(game.ticks?.());
            flight = {
              // The UNCORRECTED model prediction, in ticks. Ratios are measured against
              // this so the correction converges on the model's real error.
              rawTicks: remainTicks,
              anchorTick: Number.isFinite(anchorTick) ? anchorTick : null,
              anchorMs: nowMs,
              // Wall-clock fallback, used only when the tick accessor is unusable.
              impactAtMs:
                nowMs + ofhTicksToSeconds(game, remainTicks) * NUKE_CAL.factor * 1000,
            };
            nukeFlightById.set(id, flight);
          }
        }
        if (flight !== undefined) {
          // Remember where it was last seen, so the prune step can tell a warhead that
          // DETONATED from one that was intercepted or that we simply lost track of.
          flight.lastTile = unit.tile?.();
          flight.targetTile = targetTile;

          let left;
          const nowTick = Number(game.ticks?.());
          if (flight.anchorTick !== null && Number.isFinite(nowTick)) {
            // Count down in GAME TICKS. A wall-clock countdown keeps running while the
            // game is paused or the tab is hidden (the scan loop is rAF-driven, so ticks
            // and scans stall together), which raced the label to 0.0 while the warhead
            // hung in the air — and then fed the stalled duration back into calibration.
            const ticksLeft =
              flight.rawTicks * NUKE_CAL.factor - (nowTick - flight.anchorTick);
            left = ofhTicksToSeconds(game, ticksLeft);
          } else {
            left = (flight.impactAtMs - Date.now()) / 1000;
          }
          etaSec = Math.round(Math.max(0, left) * 10) / 10;
        }
      }

      const landingId = `tile-${targetTile}`;
      const worldRadius = getNukeLandingRadius(game, unit);
      const existing = groupedByTile.get(landingId);
      if (existing) {
        existing.count += 1;
        if (worldRadius > existing.worldRadius) {
          existing.worldRadius = worldRadius;
        }
        if (
          (NUKE_RELATION_RANK[relation] ?? 0) >
          (NUKE_RELATION_RANK[existing.relation] ?? 0)
        ) {
          existing.relation = relation;
          existing.owner = nukeOwner;
          existing.ownerSid = nukeOwnerSid;
        }
        // Group ETA = the SOONEST incoming impact on this tile.
        if (etaSec !== null && (existing.eta === null || etaSec < existing.eta)) {
          existing.eta = etaSec;
        }
      } else {
        // World coords are fixed for an in-flight nuke; resolve once per scan
        // and reuse across pan frames instead of calling game.x/y per frame.
        groupedByTile.set(landingId, {
          landingId,
          targetTile,
          worldX: game.x(targetTile),
          worldY: game.y(targetTile),
          worldRadius,
          relation,
          owner: nukeOwner,
          ownerSid: nukeOwnerSid,
          count: 1,
          eta: etaSec,
        });
      }
    }
    // Prune flight anchors for nukes no longer in flight (landed/intercepted).
    if (nukeFlightById.size > 0) {
      for (const id of nukeFlightById.keys()) {
        if (!seenIds.has(id)) {
          // This nuke is gone, so its flight is over: calibrate on it.
          try {
            const done = nukeFlightById.get(id);
            if (done && done.rawTicks > 10) {
              // Only learn from warheads that plausibly DETONATED. "Vanished from the scan"
              // is not the same as "landed": a SAM kill, an alliance change that flips the
              // relation filter, a deactivated unit or the match ending all remove a nuke
              // mid-flight, and every one of those is a truncated sample that drags the
              // factor DOWN. A ratio floor cannot separate them — a late intercept has a
              // ratio near 1. Position can: if the last place we saw it was nowhere near
              // its target, it did not land there.
              let landed = false;
              try {
                const lt = done.lastTile;
                const tt = done.targetTile;
                if (lt !== undefined && lt !== null && tt !== undefined && tt !== null) {
                  const speed = Number(game.config?.().defaultNukeSpeed?.()) || 8;
                  const dx = game.x(lt) - game.x(tt);
                  const dy = game.y(lt) - game.y(tt);
                  landed = Math.hypot(dx, dy) <= 3 * speed;
                }
              } catch (_e) {
                landed = false;
              }
              if (landed) {
                const endTick = Number(game.ticks?.());
                if (done.anchorTick !== null && Number.isFinite(endTick)) {
                  nukeCalObserve((endTick - done.anchorTick) / done.rawTicks);
                } else {
                  const rawMs = ofhTicksToSeconds(game, done.rawTicks) * 1000;
                  if (rawMs > 0) nukeCalObserve((Date.now() - done.anchorMs) / rawMs);
                }
              }
            }
          } catch (_error) {
            /* calibration is never worth breaking the scan for */
          }
          nukeFlightById.delete(id);
        }
      }
    }
    return Array.from(groupedByTile.values());
  }

  function pruneNukeEntries() {
    const activeIds = new Set();
    for (const landing of nukeScanCache) {
      activeIds.add(landing.landingId);
    }
    for (const [landingId, entry] of nukeLandingEntries) {
      if (!activeIds.has(landingId)) {
        entry.zone.remove();
        entry.label.remove();
        nukeLandingEntries.delete(landingId);
      }
    }
  }

  function ensureNukeLandingEntry(container, landingId) {
    let entry = nukeLandingEntries.get(landingId);
    if (entry) {
      return entry;
    }
    const zone = document.createElement("div");
    zone.className = "openfront-helper-nuke-zone";
    zone.dataset.nukeId = landingId;
    container.appendChild(zone);
    const label = document.createElement("div");
    label.className = "openfront-helper-nuke-label";
    label.dataset.nukeId = landingId;
    container.appendChild(label);
    entry = {
      zone,
      label,
      hidden: false,
      tx: NaN,
      ty: NaN,
      labelTy: NaN,
      radius: NaN,
      relation: "",
      colorKey: "",
      count: -1,
      eta: NaN,
    };
    nukeLandingEntries.set(landingId, entry);
    return entry;
  }

  function hideNukeEntry(entry) {
    if (!entry.hidden) {
      entry.zone.hidden = true;
      entry.label.hidden = true;
      entry.hidden = true;
    }
  }

  function applyNukeColors(zone, label, colors) {
    zone.style.setProperty("--nuke-color", colors.color);
    // --nuke-bg / --nuke-inner-glow no longer exist in the sheet (ring only).
    zone.style.setProperty("--nuke-glow", colors.glow);
    zone.style.setProperty("--nuke-cross-color", colors.crossColor);
    zone.style.setProperty("--nuke-cross-glow", colors.crossGlow);
    label.style.setProperty("--nuke-label-color", colors.labelColor);
  }

  function syncNukePrediction() {
    if (!nukePredictionEnabled) {
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      nukeLandingEntries.clear();
      nukeFlightById.clear();
      nukeScanCache = [];
      lastNukeScanAt = 0;
      nukeLandingAnimationFrame = null;
      return;
    }

    const container = ensureNukeLandingContainer();
    const context = getOpenFrontGameContext();
    if (!context?.game || !context?.transform) {
      if (nukeLandingEntries.size > 0) {
        for (const entry of nukeLandingEntries.values()) {
          entry.zone.remove();
          entry.label.remove();
        }
        nukeLandingEntries.clear();
      }
      nukeFlightById.clear();
      nukeScanCache = [];
      lastNukeScanAt = 0;
      nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
      return;
    }

    const now = performance.now();
    if (now - lastNukeScanAt >= NUKE_SCAN_MS) {
      nukeScanCache = collectNukeScan(context.game);
      pruneNukeEntries();
      lastNukeScanAt = now;
    }

    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;

    for (let i = 0; i < nukeScanCache.length; i += 1) {
      const landing = nukeScanCache[i];
      // World coords were resolved during scan; only the screen mapping
      // changes during pan/zoom. Reuse a single input object for the
      // worldToScreenCoordinates call.
      _nukeWorldQueryArg.x = landing.worldX;
      _nukeWorldQueryArg.y = landing.worldY;

      let screenPos;
      try {
        screenPos = context.transform.worldToScreenCoordinates(_nukeWorldQueryArg);
      } catch (_error) {
        screenPos = null;
      }

      if (
        !Number.isFinite(screenPos?.x) ||
        !Number.isFinite(screenPos?.y) ||
        screenPos.x < -300 ||
        screenPos.y < -300 ||
        screenPos.x > innerWidth + 300 ||
        screenPos.y > innerHeight + 300
      ) {
        const existing = nukeLandingEntries.get(landing.landingId);
        if (existing) {
          hideNukeEntry(existing);
        }
        continue;
      }

      _nukeRadiusReusePos.x = screenPos.x;
      _nukeRadiusReusePos.y = screenPos.y;
      _nukeRadiusReusePos.worldX = landing.worldX;
      _nukeRadiusReusePos.worldY = landing.worldY;
      // A MINIMUM existed but no maximum, so a Hydrogen Bomb (world radius 160) at high
      // zoom became a screen-filling translucent disc with an 18px outer glow and its edge
      // off-screen — the single biggest reason the nuke estimate looked like a mess. Cap it
      // at a sane fraction of the viewport: past that the ring conveys nothing extra,
      // because you can no longer see where it ends.
      const _nukeMaxR = Math.max(
        48,
        Math.round(Math.min(window.innerWidth || 1280, window.innerHeight || 800) * 0.42),
      );
      const radius = Math.min(
        _nukeMaxR,
        Math.max(
          12,
          getNukeLandingScreenRadius(
            context.transform,
            _nukeRadiusReusePos,
            landing.worldRadius,
          ),
        ),
      );

      const entry = ensureNukeLandingEntry(container, landing.landingId);
      if (entry.hidden) {
        entry.zone.hidden = false;
        entry.label.hidden = false;
        entry.hidden = false;
      }

      // Positioning is done via a single compositor-friendly transform
      // (translate3d) rather than left/top, so panning does not invalidate
      // paint for the glow/shadow layers of each landing zone.
      const tx = screenPos.x;
      const ty = screenPos.y;
      const labelTy = ty - radius - 10;
      if (entry.tx !== tx) {
        entry.zone.style.setProperty("--nuke-tx", `${tx}px`);
        entry.label.style.setProperty("--nuke-tx", `${tx}px`);
        entry.tx = tx;
      }
      if (entry.ty !== ty) {
        entry.zone.style.setProperty("--nuke-ty", `${ty}px`);
        entry.ty = ty;
      }
      if (entry.labelTy !== labelTy) {
        entry.label.style.setProperty("--nuke-label-ty", `${labelTy}px`);
        entry.labelTy = labelTy;
      }
      if (entry.radius !== radius) {
        entry.zone.style.setProperty("--nuke-diameter", `${radius * 2}px`);
        entry.radius = radius;
      }
      // Key on relation AND owner: two different enemies bombing the same tile at
      // different times must recolour the reused entry.
      const colorKey = landing.relation + "|" + (landing.ownerSid ?? "");
      if (entry.colorKey !== colorKey) {
        applyNukeColors(
          entry.zone,
          entry.label,
          getNukePredictionColors(landing.relation, landing.owner),
        );
        entry.colorKey = colorKey;
        entry.relation = landing.relation;
        entry.count = -1; // force the label prefix below to refresh on a relation flip
      }
      if (entry.count !== landing.count || entry.eta !== landing.eta) {
        const labelPrefix =
          landing.relation === "self"
            ? tr("My nuke")
            : landing.relation === "team"
              ? tr("Team nuke")
              : landing.relation === "ally"
                ? tr("Ally nuke")
                : tr("Enemy nuke");
        const countPart = landing.count > 1 ? ` ${landing.count}x` : "";
        // "time to impact" of the soonest nuke on this tile (atom/hydrogen only).
        const etaPart =
          landing.eta != null ? ` · ${landing.eta.toFixed(1)}s` : "";
        entry.label.textContent = `${labelPrefix}${countPart}${etaPart}`;
        entry.count = landing.count;
        entry.eta = landing.eta;
      }
    }

    // Entries whose landing fell out of the scan cache are removed by
    // pruneNukeEntries on the next scan tick (no per-frame sweep here).

    nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
  }

  function setNukePredictionEnabled(enabled) {
    nukePredictionEnabled = Boolean(enabled);
    if (!nukePredictionEnabled) {
      if (nukeLandingAnimationFrame !== null) {
        cancelAnimationFrame(nukeLandingAnimationFrame);
      }
      nukeLandingAnimationFrame = null;
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      nukeLandingEntries.clear();
      nukeFlightById.clear();
      return;
    }

    if (nukeLandingAnimationFrame === null) {
      syncNukePrediction();
    }
  }
