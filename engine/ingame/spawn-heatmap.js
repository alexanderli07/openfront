// Spawn heatmap overlay — faithful port of Tactical spawn-scoring.js +
// map-heatmap-overlay.js. Scores every grid cell by spawn quality and renders
// a colored heatmap + top-5 diverse spots. Auto-hides after spawn phase.
//
// TWO-PHASE scoring (exactly matching Tactical):
//   Phase 1 — STATIC (computed once per map): land density, plains ratio,
//             nation proximity, edge avoidance.
//   Phase 2 — DYNAMIC (recomputed every 250ms during spawn): adds player
//             distance from spawn intents, enemy pressure, team spawn pull.
//
// Player positions come from SPAWN INTENTS (turn.intents with type==="spawn"),
// not from current player positions — this is critical: the Tactical tracks
// where players ARE SPAWNING, not where they currently are.

  const SPAWN_HEATMAP_GRID_STEP = 16;
  const SPAWN_HEATMAP_ANALYSIS_R = 30;
  const SPAWN_HEATMAP_NATION_R = 120;
  const SPAWN_HEATMAP_PLAYER_R = 150;
  const SPAWN_HEATMAP_CELL = 14;
  const SPAWN_HEATMAP_MAX_CELLS = 1200;
  const SPAWN_HEATMAP_TOP_N = 5;
  const SPAWN_HEATMAP_ENEMY_PRESSURE_R = 220;
  const SPAWN_HEATMAP_TEAM_ATTRACT_R = 110;
  const SPAWN_HEATMAP_TEAM_MIN_GAP = 30;
  const SPAWN_HEATMAP_TEAM_IDEAL_MAX = 90;
  const SPAWN_HEATMAP_TEAM_OVERLAP_MAX = 0.4;
  const SPAWN_HEATMAP_TEAM_CENTROID_R = 260;

  // Weights — exact match with Tactical.
  const SPAWN_W = {
    land: 0.25,
    plains: 0.2,
    nation: 0.25,
    player: 0.25,
    edge: 0.05,
    team: 0.2,
    teamCentroid: 0.08,
    enemyPressure: 0.12,
  };

  // ── Raw terrain access (THE anti-lag fix) ──────────────────────────────
  // Tactical is smooth because it reads the map's raw Uint8Array terrain buffer
  // (terrain[y*width+x]) instead of calling game.isLand()/magnitude() millions of
  // times through the GameView proxy. We get the SAME buffer straight off the
  // client GameView (gv._map.terrain — TS `private` is not enforced at runtime),
  // so no fetch hook is needed. Byte layout (GameMapImpl): bit 7 = land, low 5
  // bits = magnitude. If the buffer can't be reached (e.g. minified property
  // names), we bulk-read it once via the proxy into a local Uint8Array — a single
  // O(W*H) pass instead of the old ~15M repeated proxy calls.
  const SPAWN_IS_LAND_BIT = 7;
  const SPAWN_MAGNITUDE_MASK = 31;
  function isLandByte(byte) {
    return (byte & (1 << SPAWN_IS_LAND_BIT)) !== 0;
  }
  function isPlainsByte(byte) {
    return isLandByte(byte) && (byte & SPAWN_MAGNITUDE_MASK) < 10;
  }

  let _spawnTerrainCache = null; // { terrain, W, H, raw }
  let _spawnTerrainSrcRef = null;
  function getSpawnTerrain(game) {
    const src = (game && game.__src) || game;
    if (_spawnTerrainSrcRef === src && _spawnTerrainCache) return _spawnTerrainCache;
    const W = game.width ? game.width() : 0;
    const H = game.height ? game.height() : 0;
    if (W <= 0 || H <= 0) return null;

    // Fast path: the real Uint8Array off the GameView's GameMap.
    try {
      const map = src && src._map;
      const raw = map && map.terrain;
      if (raw && typeof raw.length === "number" && raw.length >= W * H) {
        _spawnTerrainCache = { terrain: raw, W, H, raw: true };
        _spawnTerrainSrcRef = src;
        return _spawnTerrainCache;
      }
    } catch (_error) { /* fall through to bulk read */ }

    // Fallback: reconstruct the buffer once via the proxy (O(W*H), one-time).
    // Prefer terrainByte() — a single public proxy call per tile that returns the
    // exact game byte (IS_LAND_BIT=7 + MAGNITUDE_MASK=0x1f match our constants),
    // half the calls of isLand()+magnitude() and guaranteed to exist on every
    // build. Only fall back to the two-call form if terrainByte is unavailable.
    try {
      const buf = new Uint8Array(W * H);
      const n = W * H;
      const byteFn =
        typeof game.terrainByte === "function"
          ? (ref) => game.terrainByte(ref)
          : null;
      if (byteFn) {
        for (let ref = 0; ref < n; ref += 1) {
          const b = byteFn(ref);
          // Keep only the bits our scorer reads (land + magnitude); drop the rest.
          if (b & (1 << SPAWN_IS_LAND_BIT)) {
            buf[ref] = (1 << SPAWN_IS_LAND_BIT) | (b & SPAWN_MAGNITUDE_MASK);
          }
        }
      } else {
        for (let ref = 0; ref < n; ref += 1) {
          if (game.isLand(ref)) {
            let b = 1 << SPAWN_IS_LAND_BIT;
            if (game.magnitude) b |= game.magnitude(ref) & SPAWN_MAGNITUDE_MASK;
            buf[ref] = b;
          }
        }
      }
      _spawnTerrainCache = { terrain: buf, W, H, raw: false };
      _spawnTerrainSrcRef = src;
      return _spawnTerrainCache;
    } catch (_error) {
      return null;
    }
  }

  // Phase 1 cache: static candidates [{x, y, staticScore}]. Computed once per
  // map (when game context changes). Sorted descending by staticScore.
  let _spawnStaticCandidates = null;
  let _spawnStaticGameRef = null;

  // Phase 2 cache: final scores + top spots. Recomputed every 250ms.
  let _spawnHeatmapData = null;
  let _spawnHeatmapWasInSpawnPhase = false;

  // Player spawn positions tracked from WebSocket spawn intents.
  // Map: clientID -> {x, y}. Populated by observeSpawnIntents().
  const _spawnPlayerPositions = new Map();
  // Teammate clientIDs — refreshed each scan from getPlayerRelationToMyPlayer.
  const _spawnTeammateClientIds = new Set();

  // ── Spawn intent tracking (from enemy-intent-intel WebSocket hook) ──────
  // The enemy-intent-intel module already intercepts WS messages. We hook
  // into its processWsMessage to also extract spawn intents.

  function observeSpawnIntentsFromTurn(turn) {
    if (!turn || !Array.isArray(turn.intents)) return;
    for (let i = 0; i < turn.intents.length; i += 1) {
      const intent = turn.intents[i];
      if (!intent || intent.type !== "spawn") continue;
      if (intent.clientID == null) continue;
      const tile = Number(intent.tile);
      if (!Number.isFinite(tile)) continue;
      // We need world coords — but we don't have game.x(tile) here.
      // Store the tile; convert to world coords during scan.
      _spawnPlayerPositions.set(intent.clientID, { tile });
    }
  }

  // Hook into the existing WS message processor (enemy-intent-intel.js).
  // We extend processWsMessage to also extract spawn intents.
  const _originalProcessWsMessage = typeof processWsMessage === "function"
    ? processWsMessage
    : null;

  function spawnHeatmapProcessWsMessage(data) {
    // Call original if it exists.
    if (_originalProcessWsMessage) _originalProcessWsMessage(data);
    // Extract spawn intents.
    if (!data || typeof data !== "object") return;
    try {
      if (data.type === "turn" && data.turn) {
        observeSpawnIntentsFromTurn(data.turn);
      } else if (data.type === "start" && Array.isArray(data.turns)) {
        for (let i = 0; i < data.turns.length; i += 1) {
          observeSpawnIntentsFromTurn(data.turns[i]);
        }
      }
    } catch (_error) { /* ignore */ }
  }

  // ── Phase 1: Static scoring (computed once per map) ────────────────────

  // 1:1 port of Tactical precomputeStaticScores — reads the raw terrain buffer
  // directly (terrain[ny*W+nx]), skips water grid centers before the expensive
  // neighbourhood scan, and uses a circular mask. This is what makes it fast.
  function computeStaticCandidates(game) {
    const td = getSpawnTerrain(game);
    if (!td) return [];
    const { terrain, W, H } = td;

    const R = SPAWN_HEATMAP_ANALYSIS_R;
    const R2 = R * R;
    const step = SPAWN_HEATMAP_GRID_STEP;
    const candidates = [];

    // Gather nation-bot locations ONCE (not per candidate) for proximity scoring.
    const nationLocs = collectNationLocations(game);

    for (let cy = R; cy < H - R; cy += step) {
      for (let cx = R; cx < W - R; cx += step) {
        // Skip water grid centers immediately — avoids the neighbourhood scan
        // for the majority of cells (ocean), the biggest single speedup.
        if (!isLandByte(terrain[cy * W + cx])) continue;

        let landCount = 0, plainsCount = 0, totalChecked = 0;
        for (let dy = -R; dy <= R; dy += 2) {
          const ny = cy + dy;
          if (ny < 0 || ny >= H) continue;
          const rowBase = ny * W;
          const dy2 = dy * dy;
          for (let dx = -R; dx <= R; dx += 2) {
            if (dx * dx + dy2 > R2) continue; // circular mask
            const nx = cx + dx;
            if (nx < 0 || nx >= W) continue;
            totalChecked += 1;
            const byte = terrain[rowBase + nx];
            if (isLandByte(byte)) {
              landCount += 1;
              if ((byte & SPAWN_MAGNITUDE_MASK) < 10) plainsCount += 1;
            }
          }
        }

        const landDensity = totalChecked > 0 ? landCount / totalChecked : 0;
        const plainsRatio = landCount > 0 ? plainsCount / landCount : 0;
        const nationScore = computeNationProximity(nationLocs, cx, cy);
        const edgeX = Math.min(cx, W - cx) / (W / 2);
        const edgeY = Math.min(cy, H - cy) / (H / 2);
        const edgeScore = Math.min(edgeX, edgeY);

        const staticScore =
          landDensity * SPAWN_W.land +
          plainsRatio * SPAWN_W.plains +
          nationScore * SPAWN_W.nation +
          edgeScore * SPAWN_W.edge;

        candidates.push({ x: cx, y: cy, staticScore });
      }
    }

    candidates.sort((a, b) => b.staticScore - a.staticScore);
    return candidates;
  }

  // Nation-bot territory centers, collected once per static computation.
  function collectNationLocations(game) {
    const locs = [];
    let players = [];
    try { players = getCachedPlayerViews(game) || []; } catch (_error) { players = []; }
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      if (!isNationBotPlayer || !isNationBotPlayer(p)) continue;
      let loc = null;
      try { loc = p.nameLocation ? p.nameLocation() : null; } catch (_error) { loc = null; }
      if (loc && Number.isFinite(loc.x) && Number.isFinite(loc.y)) locs.push(loc);
    }
    return locs;
  }

  function computeNationProximity(nationLocs, cx, cy) {
    let minDist = Infinity;
    for (let i = 0; i < nationLocs.length; i += 1) {
      const loc = nationLocs[i];
      const d = Math.abs(loc.x - cx) + Math.abs(loc.y - cy);
      if (d < minDist) minDist = d;
    }
    if (!Number.isFinite(minDist)) return 0;
    return Math.max(0, 1 - minDist / SPAWN_HEATMAP_NATION_R);
  }

  // ── Phase 2: Dynamic scoring (recomputed every 250ms) ──────────────────

  function refreshTeammateClientIds(game, me) {
    _spawnTeammateClientIds.clear();
    if (!me) return;
    const players = getCachedPlayerViews(game);
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      try {
        if (me.isOnSameTeam && me.isOnSameTeam(p)) {
          const cid = p.clientID ? p.clientID() : null;
          if (cid != null) _spawnTeammateClientIds.add(cid);
        }
      } catch (_error) { /* ignore */ }
    }
  }

  function teamAttractScore(dist) {
    // Piecewise function matching Tactical exactly.
    if (dist >= SPAWN_HEATMAP_TEAM_ATTRACT_R) return 0;
    if (dist <= SPAWN_HEATMAP_TEAM_MIN_GAP) {
      return (dist / SPAWN_HEATMAP_TEAM_MIN_GAP) * SPAWN_HEATMAP_TEAM_OVERLAP_MAX;
    }
    if (dist <= SPAWN_HEATMAP_TEAM_IDEAL_MAX) return 1.0;
    // 90 < dist < 110
    return (SPAWN_HEATMAP_TEAM_ATTRACT_R - dist) / (SPAWN_HEATMAP_TEAM_ATTRACT_R - SPAWN_HEATMAP_TEAM_IDEAL_MAX);
  }

  function computeDynamicScores(game, staticCandidates, me) {
    const W = game.width ? game.width() : 0;
    const H = game.height ? game.height() : 0;

    // Enemy / team spawn positions from the GAME API (players that have spawned,
    // via nameLocation). The old WebSocket-intent source is gone; this is the
    // same signal the auto-bot's pickSpawnCenter uses, so the heatmap and the bot
    // agree on where players are.
    //
    // CRITICAL PERF: only count HUMAN players here — this mirrors Tactical, which
    // sourced positions from WS spawn intents (only human clients emit those).
    // A public game has up to ~400 NATION bots that all report hasSpawned()=true
    // from tick 0; including them made enemySpawns huge and turned the per-cell
    // scoring into an O(candidates × hundreds) loop that froze the spawn phase.
    // Nations are already fully accounted for in the STATIC phase (nationScore),
    // so counting them here also double-counted them. Bots ("BOT") are likewise
    // excluded — they're not the human opponents the repel term is about.
    const enemySpawns = [];
    const teamSpawns = [];
    const mySid = me && me.smallID ? me.smallID() : null;
    const players = getCachedPlayerViews(game);
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      try {
        // Humans only (skip NATION + BOT). PlayerType.Human = "HUMAN".
        if (!p.type || p.type() !== "HUMAN") continue;
        if (mySid != null && p.smallID && p.smallID() === mySid) continue;
        if (!p.hasSpawned || !p.hasSpawned()) continue;
      } catch (_error) { continue; }
      let loc = null;
      try { loc = p.nameLocation ? p.nameLocation() : null; } catch (_error) { loc = null; }
      if (!loc || !Number.isFinite(loc.x) || !Number.isFinite(loc.y)) continue;
      let isTeammate = false;
      try {
        isTeammate = Boolean(me && me.isOnSameTeam && me.isOnSameTeam(p));
      } catch (_error) { isTeammate = false; }
      if (isTeammate) {
        teamSpawns.push({ x: loc.x, y: loc.y });
      } else {
        enemySpawns.push({ x: loc.x, y: loc.y });
      }
    }
    const teamMode = teamSpawns.length > 0;

    // Compute team centroid (if team mode).
    let teamCentroidX = 0, teamCentroidY = 0;
    if (teamSpawns.length > 0) {
      for (const s of teamSpawns) {
        teamCentroidX += s.x;
        teamCentroidY += s.y;
      }
      teamCentroidX /= teamSpawns.length;
      teamCentroidY /= teamSpawns.length;
    }

    const out = [];
    let maxScore = 0;

    for (const cand of staticCandidates) {
      const { x, y, staticScore } = cand;
      let score = staticScore;

      // Player distance: distance from nearest enemy spawn (farther = better).
      let minEnemyDist = Infinity;
      for (const es of enemySpawns) {
        const d = Math.abs(es.x - x) + Math.abs(es.y - y);
        if (d < minEnemyDist) minEnemyDist = d;
      }
      const playerDistScore = Number.isFinite(minEnemyDist)
        ? Math.min(1, minEnemyDist / SPAWN_HEATMAP_PLAYER_R)
        : 1;
      score += playerDistScore * SPAWN_W.player;

      // Enemy pressure: density of enemies within 220 tiles.
      let pressure = 0;
      for (const es of enemySpawns) {
        const d = Math.abs(es.x - x) + Math.abs(es.y - y);
        if (d < SPAWN_HEATMAP_ENEMY_PRESSURE_R) {
          pressure += 1 - d / SPAWN_HEATMAP_ENEMY_PRESSURE_R;
        }
      }
      const enemyPressureScore = pressure > 0 ? 1 - 1 / (1 + pressure) : 1;
      score += enemyPressureScore * SPAWN_W.enemyPressure;

      // Team terms (team mode only).
      if (teamMode) {
        // Team attract: distance from nearest teammate spawn.
        let minTeamDist = Infinity;
        for (const ts of teamSpawns) {
          const d = Math.abs(ts.x - x) + Math.abs(ts.y - y);
          if (d < minTeamDist) minTeamDist = d;
        }
        const teamAttract = Number.isFinite(minTeamDist) ? teamAttractScore(minTeamDist) : 0;
        score += teamAttract * SPAWN_W.team;

        // Team centroid: distance from team centroid.
        if (teamSpawns.length > 0) {
          const centroidDist = Math.abs(teamCentroidX - x) + Math.abs(teamCentroidY - y);
          const centroidScore = Math.max(0, 1 - centroidDist / SPAWN_HEATMAP_TEAM_CENTROID_R);
          score += centroidScore * SPAWN_W.teamCentroid * Math.min(1, teamSpawns.length / 2);
        }
      }

      if (score > maxScore) maxScore = score;
      out.push({ x, y, score });
    }

    // Pick diverse top spots (greedy, >= 60 tiles apart).
    out.sort((a, b) => b.score - a.score);
    const topSpots = [];
    for (const cand of out) {
      if (topSpots.length >= SPAWN_HEATMAP_TOP_N) break;
      let diverse = true;
      for (const spot of topSpots) {
        if (Math.abs(cand.x - spot.x) + Math.abs(cand.y - spot.y) < 60) {
          diverse = false;
          break;
        }
      }
      if (diverse) topSpots.push({ x: cand.x, y: cand.y });
    }

    return { scores: out, topSpots, maxScore };
  }

  // ── Main scan (called by scheduler every 250ms) ────────────────────────

  function scanSpawnHeatmap(game) {
    const inSpawnPhase = Boolean(game.inSpawnPhase && game.inSpawnPhase());
    if (_spawnHeatmapWasInSpawnPhase && !inSpawnPhase) {
      _spawnHeatmapData = null;
      _spawnStaticCandidates = null;
      _spawnStaticGameRef = null;
      _spawnPlayerPositions.clear();
      _spawnHeatmapWasInSpawnPhase = false;
      return;
    }
    _spawnHeatmapWasInSpawnPhase = inSpawnPhase;
    if (!inSpawnPhase) {
      _spawnHeatmapData = null;
      return;
    }

    // Phase 1: static candidates (shared with the bot, computed once per map).
    const candidates = ensureSpawnStaticCandidates(game);
    if (!candidates || candidates.length === 0) {
      _spawnHeatmapData = null;
      return;
    }

    // Phase 2: dynamic scoring using live game-API player positions.
    const me = game.myPlayer ? game.myPlayer() : null;
    _spawnHeatmapData = computeDynamicScores(game, candidates, me);
  }

  // ONE static-candidate cache shared by the overlay and the auto-bot, keyed on
  // the unwrapped source GameView (the bot passes a wrapper, the overlay the raw
  // game — both resolve to the same underlying object, so the heavy grid scan
  // runs a single time per map).
  function ensureSpawnStaticCandidates(game) {
    const src = (game && game.__src) || game;
    if (_spawnStaticGameRef !== src || _spawnStaticCandidates === null) {
      _spawnStaticCandidates = computeStaticCandidates(game);
      _spawnStaticGameRef = src;
    }
    return _spawnStaticCandidates;
  }

  // The exact topSpots array currently drawn on the map (or null). The auto-bot
  // reads this first so it spawns at literally the same #1 the player sees.
  function getSpawnHeatmapTopSpots() {
    return _spawnHeatmapData && _spawnHeatmapData.topSpots && _spawnHeatmapData.topSpots.length > 0
      ? _spawnHeatmapData.topSpots
      : null;
  }

  // Shared scorer entry point for the auto-bot. Computes the SAME topSpots the
  // heatmap draws, so the bot spawns exactly where the #1 circle appears. Reuses
  // the shared static-candidate cache (works even if the heatmap is disabled).
  //
  // Per-tick memo: the bot calls this twice in the same tick (currentSpawnTopKey
  // then pickSpawnCenter) with identical inputs, and if the overlay is on it also
  // ran computeDynamicScores this tick. Cache the result per game-tick so the
  // dynamic scoring pass runs at most once per tick regardless of how many
  // callers ask for it.
  let _botTopSpotsTick = -1;
  let _botTopSpotsGameRef = null;
  let _botTopSpotsResult = null;
  function computeSpawnTopSpotsForBot(game, me) {
    try {
      const src = (game && game.__src) || game;
      let tick = -1;
      try { tick = Number(game.ticks ? game.ticks() : -1); } catch (_e) { tick = -1; }
      if (
        _botTopSpotsGameRef === src &&
        Number.isFinite(tick) &&
        tick === _botTopSpotsTick
      ) {
        return _botTopSpotsResult;
      }
      const _botSpawnStaticCandidates = ensureSpawnStaticCandidates(game);
      if (!_botSpawnStaticCandidates || _botSpawnStaticCandidates.length === 0) {
        return null;
      }
      const data = computeDynamicScores(game, _botSpawnStaticCandidates, me);
      const result =
        data && data.topSpots && data.topSpots.length > 0 ? data.topSpots : null;
      _botTopSpotsGameRef = src;
      _botTopSpotsTick = Number.isFinite(tick) ? tick : -1;
      _botTopSpotsResult = result;
      return result;
    } catch (_error) {
      return null;
    }
  }

  // ── Draw ────────────────────────────────────────────────────────────────

  const _spawnCellPt = { x: 0, y: 0 };
  function drawSpawnHeatmap(ctx, game, transform) {
    if (!_spawnHeatmapData || _spawnHeatmapData.maxScore <= 0) return;
    const { scores, topSpots, maxScore } = _spawnHeatmapData;
    const cell = SPAWN_HEATMAP_CELL;
    const halfCell = cell / 2;
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const invMax = 1 / maxScore;
    let drawn = 0;

    // Derive the affine projector ONCE (3 transform calls) then project every
    // cell with arithmetic — avoids ~1200 worldToScreenCoordinates per frame.
    const proj = mapMakeProjector(transform);
    if (!proj) return;

    ctx.save();
    // Colored heatmap cells — only when the heatmap layer is on.
    if (spawnHeatmapEnabled) {
      for (let i = 0; i < scores.length && drawn < SPAWN_HEATMAP_MAX_CELLS; i += 1) {
        const item = scores[i];
        mapProject(proj, item.x, item.y, _spawnCellPt);
        const px = _spawnCellPt.x;
        const py = _spawnCellPt.y;
        if (px < -cell || py < -cell || px > innerW + cell || py > innerH + cell) continue;
        const value = item.score * invMax;
        const r = ((1 - value) * 255) | 0;
        const g = (value * 255) | 0;
        const alpha = value * 0.45 + 0.12;
        ctx.fillStyle = `rgba(${r},${g},42,${alpha.toFixed(2)})`;
        ctx.fillRect(px - halfCell, py - halfCell, cell, cell);
        drawn++;
      }
    }

    // Numbered top-spot markers — only when the markers layer is on. Can show
    // WITHOUT the heatmap (clean map, just the best spots).
    if (!spawnMarkersEnabled) {
      ctx.restore();
      return;
    }
    const spotColors = ["#ffd54f", "#9ccc65", "#9ccc65", "#d8dde6", "#d8dde6"];
    for (let i = 0; i < topSpots.length; i += 1) {
      const spot = topSpots[i];
      mapProject(proj, spot.x, spot.y, _spawnCellPt);
      const p = _spawnCellPt;
      if (!mapPointOnScreen(p.x, p.y, 20)) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = spotColors[i] || "#d8dde6";
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fill();
      ctx.fillStyle = spotColors[i] || "#d8dde6";
      ctx.font = 'bold 10px "Aptos", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    }
    ctx.restore();
  }

  function spawnOverlayEnabled() {
    return spawnHeatmapEnabled || spawnMarkersEnabled;
  }

  registerMapOverlayLayer({
    id: "spawn-heatmap",
    scanIntervalMs: 1000, // match Tactical: heavy dynamic scoring recomputes every 1000ms
    isEnabled: spawnOverlayEnabled,
    scan: function (game) { scanSpawnHeatmap(game); },
    draw: function (ctx, game, transform) { drawSpawnHeatmap(ctx, game, transform); },
  });

  function _resetSpawnHeatmapCaches() {
    if (!spawnOverlayEnabled()) {
      _spawnHeatmapData = null;
      _spawnStaticCandidates = null;
      _spawnStaticGameRef = null;
      _spawnPlayerPositions.clear();
      _spawnHeatmapWasInSpawnPhase = false;
    }
  }

  function setSpawnHeatmapEnabled(enabled) {
    spawnHeatmapEnabled = Boolean(enabled);
    _resetSpawnHeatmapCaches();
    requestMapOverlayLoop();
  }

  function setSpawnMarkersEnabled(enabled) {
    spawnMarkersEnabled = Boolean(enabled);
    _resetSpawnHeatmapCaches();
    requestMapOverlayLoop();
  }
