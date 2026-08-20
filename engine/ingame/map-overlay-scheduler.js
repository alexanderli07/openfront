// Shared map-overlay scheduler.
//
// The compounding lag from many overlays comes from N separate rAF loops + N
// getOpenFrontGameContext() calls + N world→screen passes, not from DOM itself.
// This module runs ONE rAF loop, fetches the game context ONCE per frame, and
// hands every registered layer a shared 2D canvas to draw on. New high-node-count
// overlays (per-player troop bars, money tags, threat icons for 50+ players every
// frame) draw here instead of spawning hundreds of DOM nodes. Existing optimized
// overlays (nuke/warship/boat) keep their own loops untouched — this is additive.
//
// A layer is: { id, isEnabled(): bool, scanIntervalMs?, scan?(game, transform, now),
//               draw(ctx, game, transform, now) }
// scan() runs on a throttle (default 250ms) for expensive proxy reads; draw()
// runs every frame from the layer's own cache. The loop auto-stops when no layer
// is enabled and tears the canvas down.

  const MAP_OVERLAY_CANVAS_ID = "openfront-helper-map-overlay-canvas";
  const MAP_OVERLAY_DEFAULT_SCAN_MS = 250;
  const _mapOverlayLayers = [];
  let _mapOverlayCanvas = null;
  let _mapOverlayCtx = null;
  let _mapOverlayFrame = null;
  let _mapOverlayCssW = 0;
  let _mapOverlayCssH = 0;
  // Low-lag mode: skip 2 of every 3 animation frames (throttle rAF to ~20fps).
  // Cached (reading localStorage every frame would itself cost) and refreshed
  // every ~1s from the persisted settings, so the toggle applies without reload.
  let _mapOverlayFrameCounter = 0;
  let _lowLagCached = false;
  let _lowLagCheckedAt = 0;
  function _isLowLagMode() {
    var now = performance.now();
    if (now - _lowLagCheckedAt > 1000) {
      _lowLagCheckedAt = now;
      try {
        var raw = localStorage.getItem("ofh:settings");
        _lowLagCached = raw ? !!(JSON.parse(raw) || {}).lowLagMode : false;
      } catch (_e) { _lowLagCached = false; }
    }
    return _lowLagCached;
  }
  // Redraw-on-dirty state: we only clear+redraw when something actually changed
  // (camera moved, a layer scanned, canvas resized, or a layer was just enabled).
  // A static camera then costs almost nothing — this is the main anti-lag lever.
  let _mapOverlayDirty = true;
  let _mapOverlayLastCamSig = "";
  let _mapOverlayHadContext = false;
  // Reused input object for worldToScreenCoordinates so the per-player hot loop
  // does not allocate a point per player per frame.
  const _mapOverlayWorldArg = { x: 0, y: 0 };
  const _mapOverlayCamProbe = { x: 0, y: 0 };

  // Cache the game's transform object (NOT screen coords) to avoid a DOM lookup
  // per world→screen call. Tactical Assistant's smoothness comes from this: the
  // transform object is stable across pan/zoom, so caching it for 250ms removes
  // ~1000 getOpenFrontGameContext() DOM scans per frame while positions stay live.
  let _mapOverlayCachedTransform = null;
  let _mapOverlayCachedTransformAt = 0;
  const MAP_OVERLAY_TRANSFORM_CACHE_MS = 250;

  function registerMapOverlayLayer(layer) {
    if (!layer || typeof layer.draw !== "function") {
      return;
    }
    layer._lastScanAt = 0;
    layer.scanIntervalMs =
      typeof layer.scanIntervalMs === "number"
        ? layer.scanIntervalMs
        : MAP_OVERLAY_DEFAULT_SCAN_MS;
    // animated:true layers redraw every frame (e.g. pulsing rings); everything
    // else is dirty-gated. Default false = gated (the heavy layers).
    layer.animated = layer.animated === true;
    _mapOverlayLayers.push(layer);
  }

  // Mark the overlay dirty so the next frame redraws. Called on enable/disable.
  function markMapOverlayDirty() {
    _mapOverlayDirty = true;
  }

  function anyMapOverlayLayerEnabled() {
    for (let i = 0; i < _mapOverlayLayers.length; i += 1) {
      try {
        if (_mapOverlayLayers[i].isEnabled()) {
          return true;
        }
      } catch (_error) {
        // A misbehaving predicate must not wedge the loop.
      }
    }
    return false;
  }

  function ensureMapOverlayCanvas() {
    if (!_mapOverlayCanvas || !_mapOverlayCanvas.isConnected) {
      _mapOverlayCanvas = document.getElementById(MAP_OVERLAY_CANVAS_ID);
    }
    if (!_mapOverlayCanvas) {
      _mapOverlayCanvas = document.createElement("canvas");
      _mapOverlayCanvas.id = MAP_OVERLAY_CANVAS_ID;
      _mapOverlayCanvas.setAttribute("aria-hidden", "true");
      // Map marks sit below the helper's DOM overlays and panels, and well above the
      // game canvas. (The old note here cited "nuke ...646 / warship ...645"; no such
      // z-indexes exist anywhere — the real DOM overlay values are in the thousands, so
      // anyone reasoning from that comment was off by an order of magnitude.)
      _mapOverlayCanvas.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;z-index:500;pointer-events:none;";
      (document.body || document.documentElement).appendChild(_mapOverlayCanvas);
      _mapOverlayCtx = null;
    }
    if (!_mapOverlayCtx) {
      _mapOverlayCtx = _mapOverlayCanvas.getContext("2d");
    }
    // Backing store = CSS pixels (NO devicePixelRatio). This is deliberate and
    // matches Tactical Assistant: on hi-dpi displays a dpr-scaled canvas has to
    // fill 4× the pixels, which is the single biggest overlay lag source. We
    // trade a little text crispness for a large fill-rate win.
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    if (cssW !== _mapOverlayCssW || cssH !== _mapOverlayCssH) {
      _mapOverlayCssW = cssW;
      _mapOverlayCssH = cssH;
      _mapOverlayCanvas.width = cssW;
      _mapOverlayCanvas.height = cssH;
      _mapOverlayDirty = true; // resize wipes the canvas → must redraw
    }
    return _mapOverlayCanvas;
  }

  function teardownMapOverlayCanvas() {
    if (_mapOverlayCanvas) {
      _mapOverlayCanvas.remove();
    }
    _mapOverlayCanvas = null;
    _mapOverlayCtx = null;
    _mapOverlayCssW = 0;
    _mapOverlayCssH = 0;
    _mapOverlayHadContext = false;
    _mapOverlayLastCamSig = "";
  }

  // A cheap signature of the current camera: project one fixed world point and
  // read the transform scale. When either changes, the camera panned/zoomed and
  // we must redraw. One transform call per frame instead of thousands.
  function computeCameraSignature(transform) {
    let sx = 0;
    let sy = 0;
    try {
      _mapOverlayCamProbe.x = 0;
      _mapOverlayCamProbe.y = 0;
      const p = transform.worldToScreenCoordinates(_mapOverlayCamProbe);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        sx = p.x;
        sy = p.y;
      }
    } catch (_error) {
      /* keep zeros */
    }
    let scale = 1;
    try {
      const s = Number(transform.scale);
      if (Number.isFinite(s)) scale = s;
    } catch (_error) {
      /* keep 1 */
    }
    return `${Math.round(sx)},${Math.round(sy)},${scale}`;
  }

  function _mapOverlayTick() {
    if (!anyMapOverlayLayerEnabled()) {
      teardownMapOverlayCanvas();
      _mapOverlayFrame = null;
      return;
    }

    // Low-lag mode: process only every 3rd frame (~20fps) to cut CPU on the
    // shared overlay loop. Still schedules the next rAF so it stays responsive.
    if (_isLowLagMode()) {
      _mapOverlayFrameCounter++;
      if (_mapOverlayFrameCounter % 3 !== 0) {
        _mapOverlayFrame = requestAnimationFrame(_mapOverlayTick);
        return;
      }
    }

    ensureMapOverlayCanvas();
    const ctx = _mapOverlayCtx;
    if (ctx) {
      let context = null;
      try {
        context = getOpenFrontGameContext();
      } catch (_error) {
        context = null;
      }

      if (context && context.game && context.transform) {
        if (!_mapOverlayHadContext) {
          _mapOverlayHadContext = true;
          _mapOverlayDirty = true; // first frame with a live game → draw
        }
        const now = performance.now();

        // 1) Run due scans (throttled per layer). A scan that runs makes the
        //    frame dirty because the cached data changed.
        let anyAnimated = false;
        for (let i = 0; i < _mapOverlayLayers.length; i += 1) {
          const layer = _mapOverlayLayers[i];
          let enabled = false;
          try {
            enabled = layer.isEnabled();
          } catch (_error) {
            enabled = false;
          }
          if (!enabled) continue;
          if (layer.animated) anyAnimated = true;
          if (
            typeof layer.scan === "function" &&
            now - layer._lastScanAt >= layer.scanIntervalMs
          ) {
            try {
              layer.scan(context.game, context.transform, now);
            } catch (error) {
              console.error("OpenFront map-overlay scan failed:", layer.id, error);
            }
            layer._lastScanAt = now;
            _mapOverlayDirty = true;
          }
        }

        // 2) Camera-move detection: one transform call per frame.
        const camSig = computeCameraSignature(context.transform);
        if (camSig !== _mapOverlayLastCamSig) {
          _mapOverlayLastCamSig = camSig;
          _mapOverlayDirty = true;
        }

        // 3) Only clear+redraw when dirty, or when an animated layer is on.
        if (_mapOverlayDirty || anyAnimated) {
          if (typeof resetScreenPointPool === "function") {
            resetScreenPointPool();
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, _mapOverlayCssW, _mapOverlayCssH);
          for (let i = 0; i < _mapOverlayLayers.length; i += 1) {
            const layer = _mapOverlayLayers[i];
            let enabled = false;
            try {
              enabled = layer.isEnabled();
            } catch (_error) {
              enabled = false;
            }
            if (!enabled) continue;
            try {
              layer.draw(ctx, context.game, context.transform, now);
            } catch (error) {
              console.error("OpenFront map-overlay draw failed:", layer.id, error);
            }
          }
          _mapOverlayDirty = false;
        }
      } else if (_mapOverlayHadContext) {
        // Lost the game (match ended) — clear once and reset.
        _mapOverlayHadContext = false;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, _mapOverlayCssW, _mapOverlayCssH);
        _mapOverlayLastCamSig = "";
      }
    }

    _mapOverlayFrame = requestAnimationFrame(_mapOverlayTick);
  }

  // Call after enabling/disabling any layer. Starts the shared loop if something
  // is now on; the loop stops itself on the next frame when everything is off.
  function requestMapOverlayLoop() {
    _mapOverlayDirty = true; // an enable/disable happened → force one redraw
    if (_mapOverlayFrame === null && anyMapOverlayLayerEnabled()) {
      _mapOverlayFrame = requestAnimationFrame(_mapOverlayTick);
    }
  }

  // ---- Shared drawing helpers (keep every layer visually consistent) ----

  // Faction palette — identical values to boat-prediction / warship-routes so the
  // whole helper reads as one system.
  function mapFactionColor(relation) {
    switch (relation) {
      case "self":
        return "rgba(96, 165, 250, 0.95)"; // blue
      case "team":
        return "rgba(45, 212, 191, 0.95)"; // teal
      case "ally":
        return "rgba(74, 222, 128, 0.95)"; // green
      case "neutralEnemy":
        return "rgba(250, 204, 21, 0.95)"; // yellow (enemy not targeting you)
      default:
        return "rgba(248, 113, 113, 0.95)"; // enemy red
    }
  }

  // World point → screen point via the shared reused arg. Returns null when the
  // transform rejects the point.
  function mapWorldToScreen(transform, worldX, worldY) {
    _mapOverlayWorldArg.x = worldX;
    _mapOverlayWorldArg.y = worldY;
    try {
      const p = transform.worldToScreenCoordinates(_mapOverlayWorldArg);
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
        return null;
      }
      return p;
    } catch (_error) {
      return null;
    }
  }

  // Fast batch projector: the game transform is affine (translate + uniform
  // scale, no rotation), so we can derive it from 3 sample points ONCE and then
  // project thousands of cells with plain arithmetic instead of thousands of
  // worldToScreenCoordinates calls. This is what makes the spawn heatmap (~1200
  // cells) smooth while panning. Returns null if the transform can't be sampled.
  const _mapProjectorRef = { ox: 0, oy: 0, sx: 1, sy: 1 };
  function mapMakeProjector(transform) {
    const a = mapWorldToScreen(transform, 0, 0);
    if (!a) return null;
    const bx = mapWorldToScreen(transform, 1000, 0);
    const cy = mapWorldToScreen(transform, 0, 1000);
    if (!bx || !cy) return null;
    _mapProjectorRef.ox = a.x;
    _mapProjectorRef.oy = a.y;
    _mapProjectorRef.sx = (bx.x - a.x) / 1000;
    _mapProjectorRef.sy = (cy.y - a.y) / 1000;
    return _mapProjectorRef;
  }
  // Project a world coord with a projector from mapMakeProjector into (out.x,out.y).
  function mapProject(proj, worldX, worldY, out) {
    out.x = proj.ox + worldX * proj.sx;
    out.y = proj.oy + worldY * proj.sy;
    return out;
  }

  function mapPointOnScreen(x, y, pad = 40) {
    return (
      x >= -pad &&
      y >= -pad &&
      x <= _mapOverlayCssW + pad &&
      y <= _mapOverlayCssH + pad
    );
  }

  /** ── The one map label ────────────────────────────────────────────────────────
   *  Every piece of text drawn on the map goes through here, so a money pill, a build
   *  timer and a boat ETA are the same object with different contents. Before this each
   *  caller rolled its own: different font, different padding (3/4/5px), different
   *  background alpha (0.6/0.72/0.82), rounded vs square corners, and legibility handled
   *  three different ways.
   *
   *  Three redundant legibility layers, because the map underneath can be anything:
   *    1. a dark fill at 0.82 beats bright terrain (snow, desert, capital glow);
   *    2. a 1px semantic outline separates the chip from dark water, where a dark fill
   *       has nothing to contrast against;
   *    3. a 2px black text halo covers the case where both fail — when the user pulls
   *       Overlay Opacity down and the chip itself goes translucent.
   *  The halo is strokeText-then-fillText, NOT shadowBlur: shadowBlur is the most
   *  expensive 2D operation on a full-viewport canvas, and the one caller that used it
   *  applied it to the pill and then cleared it before drawing the text, so it did the
   *  exact opposite of its purpose.
   *
   *  Returns the chip's WIDTH in px, so a caller can line something up with it exactly
   *  instead of re-deriving it from a formula that only approximates the real measured
   *  width. (No caller needs it today — the troop bar that did was removed — but it is the
   *  only place the measurement exists, so it stays exposed rather than recomputed.)
   *
   *  opts: { size, segments:[{text,color}], outline:bool, halo:bool, align, outlineColor }
   *  Measured width is quantized to 4px because canvas 2D has no font-variant-numeric,
   *  so a proportional face makes the chip visibly breathe as $1.2k -> $1.3k.
   *  save/restore is mandatory here: this canvas is shared by ~8 layers drawn in
   *  sequence, and a leaked font or textAlign shows up as a bug in somebody else's layer.
   */
  function drawMapLabel(ctx, cx, cy, text, color, options) {
    const opts = options || {};
    const style = typeof OFH_OVERLAY_STYLE === "object" && OFH_OVERLAY_STYLE ? OFH_OVERLAY_STYLE : null;
    if (!style) return 0;
    let chipW = 0;
    const size = Number(opts.size) || style.sizeMd;
    const segments =
      Array.isArray(opts.segments) && opts.segments.length
        ? opts.segments
        : [{ text: String(text == null ? "" : text), color: color }];

    ctx.save();
    try {
      ctx.font = ofhOverlayFont(size);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const widths = segments.map((seg) => ctx.measureText(String(seg.text == null ? "" : seg.text)).width);
      const gap = segments.length > 1 ? style.gap : 0;
      let raw = gap * (segments.length - 1);
      for (const wd of widths) raw += wd;
      const tw = Math.ceil(raw / 4) * 4;

      const w = tw + style.padX * 2;
      chipW = w;
      const h = Math.max(style.minH, size + style.padY * 2);
      const x0 = cx - w / 2;
      const y0 = cy - h / 2;
      const r = Math.max(3, Math.round(h * 0.28));

      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
      ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
      ctx.arcTo(x0, y0 + h, x0, y0, r);
      ctx.arcTo(x0, y0, x0 + w, y0, r);
      ctx.closePath();
      ctx.fillStyle = ofhOverlaySurface(style.surfaceA);
      ctx.fill();
      if (opts.outline !== false) {
        ctx.lineWidth = 1;
        // An explicit outlineColor lets the caller encode a SECOND dimension in the chip:
        // name-overlay uses the faction colour here while keeping the money text amber, so
        // a teammate's pill and an enemy's pill differ at a glance. That relation colour
        // used to be computed and thrown away.
        ctx.strokeStyle =
          opts.outlineColor || segments[0].color || ofhOverlayAccentRgba(style.outlineA);
        ctx.globalAlpha = style.outlineA;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      let x = cx - tw / 2;
      ctx.lineJoin = "round";
      for (let i = 0; i < segments.length; i++) {
        const str = String(segments[i].text == null ? "" : segments[i].text);
        if (opts.halo !== false) {
          ctx.lineWidth = style.haloW;
          ctx.strokeStyle = style.haloRgba;
          ctx.strokeText(str, x, cy + 0.5);
        }
        ctx.fillStyle = segments[i].color || "#e2e8f0";
        ctx.fillText(str, x, cy + 0.5);
        x += widths[i] + gap;
      }
    } catch (_e) {
      /* a label is never worth killing the frame for */
    }
    ctx.restore();
    return chipW;
  }

  /** A filled triangle at the destination end of a route, so direction is stated rather
   *  than inferred. `angle` is the heading of the final segment. */
  function drawMapArrowhead(ctx, x, y, angle, color, size) {
    const s = Number(size) || 7;
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-s, -s * 0.5);
      ctx.lineTo(-s, s * 0.5);
      ctx.closePath();
      ctx.fillStyle = color || "#e2e8f0";
      ctx.fill();
    } catch (_e) {
      /* ignore */
    }
    ctx.restore();
  }

  // Text with a dark halo so it stays readable over any territory color. Used for naked
  // symbols (a warning glyph, a rank digit) that carry no pill of their own.
  function drawMapHaloText(ctx, x, y, text, color, options) {
    const opts = options || {};
    const font =
      opts.font ||
      (typeof ofhOverlayFont === "function"
        ? ofhOverlayFont(OFH_OVERLAY_STYLE.sizeMd)
        : '700 11px "Aptos", "Trebuchet MS", "Segoe UI", sans-serif');
    ctx.font = font;
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = opts.baseline || "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = opts.haloWidth || 3;
    ctx.strokeStyle = opts.halo || "rgba(0, 0, 0, 0.9)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || "#e2e8f0";
    ctx.fillText(text, x, y);
  }
