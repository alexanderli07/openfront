// Economic and export-partner heatmap rendering.

  const heatmapWebGlRenderers = new WeakMap();
  // Reusable per-canvas Float32Array for vertex data. Avoids allocating
  // points.length * 6 * 6 floats every panning frame.
  const heatmapVertexBuffers = new WeakMap();
  // Cached economy heatmap intensity settings. Recomputed only when the
  // intensity setting changes, not per point per frame.
  const _economyHeatmapIntensityVariants = [
    { alpha: 0.7, radius: 0.88 },
    { alpha: 1, radius: 1 },
    { alpha: 1.35, radius: 1.18 },
  ];

  function _getEconomyHeatmapIntensitySettingsCached() {
    return _economyHeatmapIntensityVariants[
      normalizeEconomyHeatmapIntensity(economyHeatmapIntensity)
    ];
  }

  function _ensureHeatmapVertexBuffer(canvas, floatsNeeded) {
    let buffer = heatmapVertexBuffers.get(canvas);
    if (!buffer || buffer.length < floatsNeeded) {
      // Allocate with growth headroom so subsequent frames reuse the buffer.
      const capacity = Math.max(floatsNeeded, buffer ? buffer.length * 2 : 256);
      buffer = new Float32Array(capacity);
      heatmapVertexBuffers.set(canvas, buffer);
    }
    return buffer;
  }

  function ensureEconomyHeatmapStyles() {
    if (document.getElementById(ECONOMY_HEATMAP_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = ECONOMY_HEATMAP_STYLE_ID;
    style.textContent = `
      #${ECONOMY_HEATMAP_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 7000;
        pointer-events: none;
      }

      #${ECONOMY_HEATMAP_CONTAINER_ID} .${ECONOMY_HEATMAP_CANVAS_CLASS} {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        opacity: 0.82;
        mix-blend-mode: normal;
      }

      #${ECONOMY_HEATMAP_CONTAINER_ID}[data-status]::after {
        content: attr(data-status);
        position: fixed;
        left: 18px;
        bottom: 18px;
        padding: 7px 10px;
        border: 1px solid rgba(74, 222, 128, 0.45);
        border-radius: 8px;
        background: rgba(6, 30, 18, 0.78);
        color: rgba(220, 252, 231, 0.95);
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureEconomyHeatmapCanvas() {
    ensureEconomyHeatmapStyles();

    let container = document.getElementById(ECONOMY_HEATMAP_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = ECONOMY_HEATMAP_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }

    let canvas = container.querySelector(`.${ECONOMY_HEATMAP_CANVAS_CLASS}`);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = ECONOMY_HEATMAP_CANVAS_CLASS;
      container.appendChild(canvas);
    }

    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const cssWidth = `${window.innerWidth}px`;
    const cssHeight = `${window.innerHeight}px`;
    if (canvas.style.width !== cssWidth) {
      canvas.style.width = cssWidth;
    }
    if (canvas.style.height !== cssHeight) {
      canvas.style.height = cssHeight;
    }

    return { canvas, pixelRatio };
  }

  function ensureExportPartnerHeatmapStyles() {
    if (document.getElementById(EXPORT_PARTNER_HEATMAP_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = EXPORT_PARTNER_HEATMAP_STYLE_ID;
    style.textContent = `
      #${EXPORT_PARTNER_HEATMAP_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 8000;
        pointer-events: none;
      }

      #${EXPORT_PARTNER_HEATMAP_CONTAINER_ID} .${EXPORT_PARTNER_HEATMAP_CANVAS_CLASS} {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        opacity: 0.84;
        mix-blend-mode: normal;
      }

      #${EXPORT_PARTNER_HEATMAP_CONTAINER_ID}[data-status]::after {
        content: attr(data-status);
        position: fixed;
        left: 18px;
        bottom: 18px;
        padding: 7px 10px;
        border: 1px solid rgba(45, 212, 191, 0.45);
        border-radius: 8px;
        background: rgba(10, 30, 34, 0.78);
        color: rgba(204, 251, 241, 0.95);
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureExportPartnerHeatmapCanvas() {
    ensureExportPartnerHeatmapStyles();

    let container = document.getElementById(EXPORT_PARTNER_HEATMAP_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = EXPORT_PARTNER_HEATMAP_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }

    let canvas = container.querySelector(`.${EXPORT_PARTNER_HEATMAP_CANVAS_CLASS}`);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = EXPORT_PARTNER_HEATMAP_CANVAS_CLASS;
      container.appendChild(canvas);
    }

    const pixelRatio = 1;
    const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const cssWidth = `${window.innerWidth}px`;
    const cssHeight = `${window.innerHeight}px`;
    if (canvas.style.width !== cssWidth) {
      canvas.style.width = cssWidth;
    }
    if (canvas.style.height !== cssHeight) {
      canvas.style.height = cssHeight;
    }

    return { canvas, pixelRatio };
  }

  function resetExportPartnerHeatmapSourceCache() {
    exportPartnerHeatmapSourceCacheGame = null;
    exportPartnerHeatmapSourceCachePlayerId = null;
    exportPartnerHeatmapSourceCacheAt = 0;
    exportPartnerHeatmapSourceCache = [];
  }

  function getExportPartnerHeatmapSources(game, player) {
    const now = performance.now();
    const playerId = getPlayerSmallId(player);

    if (
      exportPartnerHeatmapSourceCacheGame !== game ||
      exportPartnerHeatmapSourceCachePlayerId !== playerId ||
      now - exportPartnerHeatmapSourceCacheAt >= EXPORT_PARTNER_HEATMAP_SOURCE_CACHE_MS
    ) {
      exportPartnerHeatmapSourceCache = collectExportPartnerHeatmapSources(game, player);
      exportPartnerHeatmapSourceCacheGame = game;
      exportPartnerHeatmapSourceCachePlayerId = playerId;
      exportPartnerHeatmapSourceCacheAt = now;
    }

    return exportPartnerHeatmapSourceCache;
  }

  function toFiniteNumber(value, fallback = 0) {
    const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  }

  function canStationTradeWith(player, otherPlayer) {
    if (!player || !otherPlayer) {
      return false;
    }
    if (getPlayerSmallId(player) === getPlayerSmallId(otherPlayer)) {
      return true;
    }
    return canPlayersTrade(player, otherPlayer);
  }

  function getHeatmapTypePriority(type) {
    if (type === "Factory") {
      return 4;
    }
    if (type === "Port") {
      return 3;
    }
    if (type === "City") {
      return 2;
    }
    return 1;
  }

  // addEconomicSource is provided globally by runtime.js with an O(1) tile
  // dedup index. Previously this file shadowed it with a linear sources.find
  // implementation (O(n^2) across late-game collections).

  function getRevenueUnitKey(unit) {
    const unitId = toFiniteNumber(unit?.id?.(), NaN);
    if (Number.isFinite(unitId)) {
      return `unit:${unitId}`;
    }

    const tile = unit?.tile?.();
    const type = String(unit?.type?.() ?? "Industry");
    return tile == null ? null : `tile:${type}:${tile}`;
  }

  function isEconomyRevenueType(type) {
    return type === "City" || type === "Port" || type === "Factory";
  }

  function addEconomyRevenueSource(unit, goldAmount) {
    const amount = toFiniteNumber(goldAmount);
    if (!unit || !Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const type = String(unit?.type?.() ?? "Industry");
    if (!isEconomyRevenueType(type)) {
      return;
    }

    const tile = unit?.tile?.();
    if (tile == null) {
      return;
    }

    const key = getRevenueUnitKey(unit);
    if (!key) {
      return;
    }

    const unitId = toFiniteNumber(unit?.id?.(), NaN);
    const owner = unit?.owner?.();
    const entry = economyRevenueSourceTrackers.get(key) ?? {
      unitId: Number.isFinite(unitId) ? unitId : null,
      ownerId: owner ? getPlayerSmallId(owner) : null,
      tile,
      type,
      total: 0,
      events: [],
    };
    entry.unitId = Number.isFinite(unitId) ? unitId : entry.unitId;
    entry.ownerId = owner ? getPlayerSmallId(owner) : entry.ownerId;
    entry.tile = tile;
    entry.type = type;
    entry.events.push({
      amount,
      at: Date.now(),
    });
    entry.total += amount;
    economyRevenueSourceTrackers.set(key, entry);
  }

  function getActiveRevenueUnit(game, entry) {
    const unitId = Number(entry?.unitId);
    if (Number.isFinite(unitId)) {
      try {
        const unit = game?.unit?.(unitId);
        if (
          unit?.isActive?.() &&
          String(unit?.type?.() ?? "") === String(entry.type ?? "")
        ) {
          return unit;
        }
      } catch (_error) {
        // Fall back to a tile lookup below.
      }
    }

    try {
      return (
        Array.from(game?.units?.(entry.type) || []).find(
          (unit) => unit?.isActive?.() && unit?.tile?.() === entry.tile,
        ) ?? null
      );
    } catch (_error) {
      return null;
    }
  }

  function pruneEconomyRevenueSources(game) {
    const cutoff = Date.now() - ECONOMY_HEATMAP_REVENUE_WINDOW_MS;
    for (const [key, entry] of economyRevenueSourceTrackers.entries()) {
      const unit = getActiveRevenueUnit(game, entry);
      if (!unit) {
        economyRevenueSourceTrackers.delete(key);
        continue;
      }

      entry.tile = unit.tile?.() ?? entry.tile;
      entry.type = String(unit?.type?.() ?? entry.type);
      entry.events = entry.events.filter(
        (event) =>
          Number.isFinite(event?.amount) &&
          event.amount > 0 &&
          Number.isFinite(event?.at) &&
          event.at >= cutoff,
      );
      entry.total = entry.events.reduce((total, event) => total + event.amount, 0);

      if (entry.total <= 0) {
        economyRevenueSourceTrackers.delete(key);
      }
    }
  }

  function getHeatmapZoomScale(transform) {
    const scale = Number(transform?.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      return 1;
    }

    return scale / HEATMAP_REFERENCE_ZOOM;
  }

  function projectEconomyHeatmapPoints(sources, game, transform) {
    const points = [];
    const padding = ECONOMY_HEATMAP_VIEWPORT_PADDING;
    const zoomScale = getHeatmapZoomScale(transform);

    for (const source of sources) {
      if (source.tile == null) {
        continue;
      }

      try {
        const worldPoint = {
          x: game.x(source.tile),
          y: game.y(source.tile),
        };
        const screenPoint = transform.worldToScreenCoordinates(worldPoint);
        if (
          Number.isFinite(screenPoint?.x) &&
          Number.isFinite(screenPoint?.y) &&
          screenPoint.x > -padding &&
          screenPoint.y > -padding &&
          screenPoint.x < window.innerWidth + padding &&
          screenPoint.y < window.innerHeight + padding
        ) {
          points.push({
            x: screenPoint.x,
            y: screenPoint.y,
            weight: source.weight,
            type: source.type,
            zoomScale,
          });
        }
      } catch (_error) {
        // Ignore points from stale units or off-map references.
      }
    }

    return points;
  }

  function collectEconomyHeatmapSources(game) {
    const sources = [];
    pruneEconomyRevenueSources(game);

    for (const entry of economyRevenueSourceTrackers.values()) {
      if (
        entry.tile == null ||
        !Number.isFinite(entry.total) ||
        entry.total <= 0 ||
        !isEconomyRevenueType(String(entry.type ?? ""))
      ) {
        continue;
      }

      addEconomicSource(sources, entry.tile, entry.total, entry.type);
    }

    return sources;
  }

  function getEconomyHeatmapSources(game) {
    const now = performance.now();
    if (
      economyHeatmapDataGame !== game ||
      lastEconomyHeatmapDataAt === 0 ||
      now - lastEconomyHeatmapDataAt >= ECONOMY_HEATMAP_DATA_REFRESH_MS
    ) {
      economyHeatmapSources = collectEconomyHeatmapSources(game);
      economyHeatmapDataGame = game;
      lastEconomyHeatmapDataAt = now;
    }

    return economyHeatmapSources;
  }

  function normalizeEconomyHeatmapIntensity(value) {
    const intensity = Number(value);
    if (!Number.isFinite(intensity)) {
      return 1;
    }
    return Math.max(0, Math.min(2, Math.round(intensity)));
  }

  function getEconomyHeatmapIntensitySettings() {
    return _getEconomyHeatmapIntensitySettingsCached();
  }

  function createHeatmapWebGlShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createHeatmapWebGlRenderer(canvas) {
    const gl =
      canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      }) ||
      canvas.getContext("experimental-webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
    if (!gl) {
      return null;
    }

    const vertexShader = createHeatmapWebGlShader(
      gl,
      gl.VERTEX_SHADER,
      `
        attribute vec2 a_center;
        attribute vec2 a_offset;
        attribute float a_radius;
        attribute float a_intensity;
        uniform vec2 u_resolution;
        varying vec2 v_offset;
        varying float v_intensity;

        void main() {
          vec2 position = a_center + a_offset * a_radius;
          vec2 clip = (position / u_resolution) * 2.0 - 1.0;
          gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
          v_offset = a_offset;
          v_intensity = a_intensity;
        }
      `,
    );
    const fragmentShader = createHeatmapWebGlShader(
      gl,
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;

        uniform int u_palette;
        varying vec2 v_offset;
        varying float v_intensity;

        vec4 gradientColor(vec3 c0, vec3 c1, vec3 c2, float a0, float a1, float a2, float d) {
          if (d <= 0.34) {
            float t = d / 0.34;
            return vec4(mix(c0, c1, t), mix(a0, a1, t));
          }
          float t = (d - 0.34) / 0.66;
          return vec4(mix(c1, c2, clamp(t, 0.0, 1.0)), mix(a1, a2, clamp(t, 0.0, 1.0)));
        }

        void main() {
          float distanceFromCenter = length(v_offset);
          if (distanceFromCenter > 1.0) {
            discard;
          }

          float fade = 1.0 - smoothstep(0.72, 1.0, distanceFromCenter);
          vec4 color;
          if (u_palette == 0) {
            color = gradientColor(
              vec3(239.0, 68.0, 68.0) / 255.0,
              vec3(250.0, 204.0, 21.0) / 255.0,
              vec3(34.0, 197.0, 94.0) / 255.0,
              0.9,
              0.68,
              0.38,
              distanceFromCenter
            );
          } else {
            color = gradientColor(
              vec3(20.0, 184.0, 166.0) / 255.0,
              vec3(250.0, 204.0, 21.0) / 255.0,
              vec3(59.0, 130.0, 246.0) / 255.0,
              0.94,
              0.66,
              0.36,
              distanceFromCenter
            );
          }

          gl_FragColor = vec4(color.rgb, color.a * v_intensity * fade);
        }
      `,
    );

    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return null;
    }

    return {
      gl,
      program,
      buffer,
      centerLocation: gl.getAttribLocation(program, "a_center"),
      offsetLocation: gl.getAttribLocation(program, "a_offset"),
      radiusLocation: gl.getAttribLocation(program, "a_radius"),
      intensityLocation: gl.getAttribLocation(program, "a_intensity"),
      resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
      paletteLocation: gl.getUniformLocation(program, "u_palette"),
    };
  }

  function getHeatmapWebGlRenderer(canvas) {
    const existing = heatmapWebGlRenderers.get(canvas);
    if (existing) {
      return existing;
    }

    const renderer = createHeatmapWebGlRenderer(canvas);
    if (renderer) {
      heatmapWebGlRenderers.set(canvas, renderer);
    }
    return renderer;
  }

  function clearHeatmapCanvas(canvas) {
    const renderer = getHeatmapWebGlRenderer(canvas);
    if (renderer && !renderer.gl.isContextLost?.()) {
      renderer.gl.viewport(0, 0, canvas.width, canvas.height);
      renderer.gl.clearColor(0, 0, 0, 0);
      renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT);
      return;
    }

    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function renderHeatmapPointsWebGl(canvas, points, maxWeight, pixelRatio, palette, getShape) {
    const renderer = getHeatmapWebGlRenderer(canvas);
    if (
      !renderer ||
      renderer.centerLocation < 0 ||
      renderer.offsetLocation < 0 ||
      renderer.radiusLocation < 0 ||
      renderer.intensityLocation < 0
    ) {
      return false;
    }

    const { gl, program, buffer } = renderer;
    if (gl.isContextLost?.()) {
      heatmapWebGlRenderers.delete(canvas);
      return false;
    }

    const quadOffsets = [
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ];
    const floatsPerVertex = 6;
    const verticesPerPoint = 6;
    const floatsNeeded = points.length * verticesPerPoint * floatsPerVertex;
    const data = _ensureHeatmapVertexBuffer(canvas, floatsNeeded);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const shape = getShape(point, maxWeight, pixelRatio);
      const centerX = point.x * pixelRatio;
      const centerY = point.y * pixelRatio;
      const radius = shape.radius;
      const intensity = shape.intensity;
      const baseOffset = index * verticesPerPoint * floatsPerVertex;
      for (let vertex = 0; vertex < verticesPerPoint; vertex += 1) {
        const offset = baseOffset + vertex * floatsPerVertex;
        data[offset] = centerX;
        data[offset + 1] = centerY;
        data[offset + 2] = quadOffsets[vertex * 2];
        data[offset + 3] = quadOffsets[vertex * 2 + 1];
        data[offset + 4] = radius;
        data[offset + 5] = intensity;
      }
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Upload only the used slice: data may have growth headroom from the
    // reusable buffer pool. subarray returns a Float32Array view over the
    // same underlying ArrayBuffer (no copy).
    gl.bufferData(
      gl.ARRAY_BUFFER,
      data.length === floatsNeeded ? data : data.subarray(0, floatsNeeded),
      gl.DYNAMIC_DRAW,
    );

    const stride = floatsPerVertex * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(renderer.centerLocation);
    gl.vertexAttribPointer(renderer.centerLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(renderer.offsetLocation);
    gl.vertexAttribPointer(renderer.offsetLocation, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(renderer.radiusLocation);
    gl.vertexAttribPointer(renderer.radiusLocation, 1, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(renderer.intensityLocation);
    gl.vertexAttribPointer(renderer.intensityLocation, 1, gl.FLOAT, false, stride, 5 * Float32Array.BYTES_PER_ELEMENT);
    gl.uniform2f(renderer.resolutionLocation, canvas.width, canvas.height);
    gl.uniform1i(renderer.paletteLocation, palette);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, points.length * verticesPerPoint);

    return true;
  }

  // Reused shape result. getEconomyHeatmapPointShape is called once per point
  // per frame; returning a fresh object each call caused thousands of object
  // allocations per second during panning.
  const _economyShapeResult = { intensity: 0, radius: 0 };

  function getEconomyHeatmapPointShape(point, maxWeight, pixelRatio) {
    const baseIntensity = Math.max(0.28, Math.min(1, point.weight / maxWeight));
    const intensitySettings = _getEconomyHeatmapIntensitySettingsCached();
    const intensity = Math.max(
      0.14,
      Math.min(1, baseIntensity * intensitySettings.alpha),
    );
    const radiusIntensity = Math.max(
      0.22,
      Math.min(1, baseIntensity * intensitySettings.radius),
    );
    const typeScale =
      point.type === "Factory" ? 1.25 : point.type === "Port" ? 1.05 : 0.9;
    const zoomRadiusScale =
      point.zoomScale < 1
        ? Math.min(1.35, Math.max(0.68, point.zoomScale * 1.8))
        : point.zoomScale;
    _economyShapeResult.intensity = intensity;
    _economyShapeResult.radius =
      (18 + radiusIntensity * 52) * typeScale * zoomRadiusScale * pixelRatio;
    return _economyShapeResult;
  }

  function drawEconomyHeatmapPoint(ctx, point, maxWeight, pixelRatio) {
    const shape = getEconomyHeatmapPointShape(point, maxWeight, pixelRatio);
    const { intensity, radius } = shape;
    const x = point.x * pixelRatio;
    const y = point.y * pixelRatio;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(239, 68, 68, ${0.9 * intensity})`);
    gradient.addColorStop(0.3, `rgba(250, 204, 21, ${0.68 * intensity})`);
    gradient.addColorStop(0.66, `rgba(34, 197, 94, ${0.38 * intensity})`);
    gradient.addColorStop(1, "rgba(34, 197, 94, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEconomyHeatmap() {
    if (!economyHeatmapEnabled) {
      economyHeatmapAnimationFrame = null;
      return;
    }

    const now = performance.now();
    if (now - lastEconomyHeatmapDrawAt < ECONOMY_HEATMAP_DRAW_MS) {
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }
    lastEconomyHeatmapDrawAt = now;

    const context = getOpenFrontGameContext();
    const { canvas, pixelRatio } = ensureEconomyHeatmapCanvas();
    if (!context?.game || !context?.transform) {
      clearHeatmapCanvas(canvas);
      canvas.parentElement?.setAttribute("data-status", "Economic heatmap: waiting for game data");
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }

    sampleGoldPerMinuteIfDue();
    processTradeBalanceUpdates(context.game);
    let points = [];
    try {
      const sources = getEconomyHeatmapSources(context.game);
      points = projectEconomyHeatmapPoints(
        sources,
        context.game,
        context.transform,
      );
    } catch (_error) {
      clearHeatmapCanvas(canvas);
      canvas.parentElement?.setAttribute("data-status", "Economic heatmap: data error");
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }
    if (points.length === 0) {
      clearHeatmapCanvas(canvas);
      canvas.parentElement?.setAttribute("data-status", "Economic heatmap: waiting for observed trade revenue");
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }

    canvas.parentElement?.removeAttribute("data-status");
    let maxWeight = 1;
    for (let i = 0; i < points.length; i += 1) {
      const w = points[i].weight;
      if (w > maxWeight) {
        maxWeight = w;
      }
    }
    if (renderHeatmapPointsWebGl(canvas, points, maxWeight, pixelRatio, 0, getEconomyHeatmapPointShape)) {
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (const point of points) {
      drawEconomyHeatmapPoint(ctx, point, maxWeight, pixelRatio);
    }
    ctx.globalCompositeOperation = "source-over";

    economyHeatmapAnimationFrame = requestAnimationFrame(drawEconomyHeatmap);
  }

  const _exportPartnerShapeResult = { intensity: 0, radius: 0 };

  function getExportPartnerHeatmapPointShape(point, maxWeight, pixelRatio) {
    const intensity = Math.max(0.3, Math.min(1, point.weight / maxWeight));
    const typeScale =
      point.type === "City"
        ? 1.35
        : point.type === "Factory"
          ? 1.15
          : point.type === "Port"
            ? 1.05
            : 0.95;
    const zoomRadiusScale =
      point.zoomScale < 1
        ? Math.min(1.15, Math.max(0.58, point.zoomScale * 1.55))
        : point.zoomScale;
    _exportPartnerShapeResult.intensity = intensity;
    _exportPartnerShapeResult.radius =
      (20 + intensity * 64) * typeScale * zoomRadiusScale * pixelRatio;
    return _exportPartnerShapeResult;
  }

  function drawExportPartnerHeatmapPoint(ctx, point, maxWeight, pixelRatio) {
    const shape = getExportPartnerHeatmapPointShape(point, maxWeight, pixelRatio);
    const { intensity, radius } = shape;
    const x = point.x * pixelRatio;
    const y = point.y * pixelRatio;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(20, 184, 166, ${0.94 * intensity})`);
    gradient.addColorStop(0.34, `rgba(250, 204, 21, ${0.66 * intensity})`);
    gradient.addColorStop(0.72, `rgba(59, 130, 246, ${0.36 * intensity})`);
    gradient.addColorStop(1, "rgba(59, 130, 246, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawExportPartnerHeatmap() {
    if (!exportPartnerHeatmapEnabled) {
      exportPartnerHeatmapAnimationFrame = null;
      return;
    }

    const now = performance.now();
    if (now - lastExportPartnerHeatmapDrawAt < EXPORT_PARTNER_HEATMAP_DRAW_MS) {
      exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
      return;
    }
    lastExportPartnerHeatmapDrawAt = now;

    const { canvas, pixelRatio } = ensureExportPartnerHeatmapCanvas();
    const overlay = getHoveredPlayerInfoOverlay();
    if (!overlay?.game || !overlay?.transform || !overlay?.player) {
      clearHeatmapCanvas(canvas);
      canvas.parentElement?.removeAttribute("data-status");
      exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
      return;
    }

    processTradeBalanceUpdates(overlay.game);
    const sources = getExportPartnerHeatmapSources(overlay.game, overlay.player);
    const points = projectEconomyHeatmapPoints(sources, overlay.game, overlay.transform);
    if (points.length === 0) {
      clearHeatmapCanvas(canvas);
      canvas.parentElement?.setAttribute("data-status", "Export partner heatmap: no observed exports yet");
      exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
      return;
    }

    canvas.parentElement?.removeAttribute("data-status");
    let maxWeight = 1;
    for (let i = 0; i < points.length; i += 1) {
      const w = points[i].weight;
      if (w > maxWeight) {
        maxWeight = w;
      }
    }
    if (renderHeatmapPointsWebGl(canvas, points, maxWeight, pixelRatio, 1, getExportPartnerHeatmapPointShape)) {
      exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (const point of points) {
      drawExportPartnerHeatmapPoint(ctx, point, maxWeight, pixelRatio);
    }
    ctx.globalCompositeOperation = "source-over";

    exportPartnerHeatmapAnimationFrame = requestAnimationFrame(drawExportPartnerHeatmap);
  }

  function setEconomyHeatmapIntensity(value) {
    economyHeatmapIntensity = normalizeEconomyHeatmapIntensity(value);
  }

  function setEconomyHeatmapEnabled(enabled) {
    economyHeatmapEnabled = Boolean(enabled);
    if (!economyHeatmapEnabled) {
      if (economyHeatmapAnimationFrame !== null) {
        cancelAnimationFrame(economyHeatmapAnimationFrame);
      }
      economyHeatmapAnimationFrame = null;
      lastEconomyHeatmapDrawAt = 0;
      lastEconomyHeatmapDataAt = 0;
      economyHeatmapDataGame = null;
      economyHeatmapSources = [];
      economyRevenueSourceTrackers.clear();
      if (!tradeBalancesEnabled && !exportPartnerHeatmapEnabled) {
        trainTradeTrackers.clear();
        tradeShipSourceTrackers.clear();
        lastProcessedTradeBalanceTick = null;
      }
      if (!goldPerMinuteEnabled && !teamGoldPerMinuteEnabled && !topGoldPerMinuteEnabled) {
        goldTrackers.clear();
        incomingGoldTransfers.clear();
        lastProcessedIncomingGoldTransferTick = null;
      }
      document.getElementById(ECONOMY_HEATMAP_CONTAINER_ID)?.remove();
      return;
    }

    setExportPartnerHeatmapEnabled(false);
    if (economyHeatmapAnimationFrame === null) {
      drawEconomyHeatmap();
    }
  }

  function setExportPartnerHeatmapEnabled(enabled) {
    exportPartnerHeatmapEnabled = Boolean(enabled);
    if (!exportPartnerHeatmapEnabled) {
      if (exportPartnerHeatmapAnimationFrame !== null) {
        cancelAnimationFrame(exportPartnerHeatmapAnimationFrame);
      }
      exportPartnerHeatmapAnimationFrame = null;
      lastExportPartnerHeatmapDrawAt = 0;
      resetExportPartnerHeatmapSourceCache();
      document.getElementById(EXPORT_PARTNER_HEATMAP_CONTAINER_ID)?.remove();
      if (!tradeBalancesEnabled && !economyHeatmapEnabled) {
        tradeBalanceTrackers.clear();
        exportPartnerSourceTrackers.clear();
        factoryPortSpendTrackers.clear();
        factoryPortUnitTrackers.clear();
        trainTradeTrackers.clear();
        tradeShipSourceTrackers.clear();
      }
      return;
    }

    setEconomyHeatmapEnabled(false);
    if (exportPartnerHeatmapAnimationFrame === null) {
      drawExportPartnerHeatmap();
    }
  }
