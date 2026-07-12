// Round logger — records a timeline of game events (attacks, nuke launches,
// alliance changes, structure builds, combat outcomes) as a JSON array in
// localStorage. Useful for debugging bot behavior, analyzing match flow, and
// reporting issues. Events are keyed per-match (reset when a new game starts).
//
// The logger is intentionally lightweight: it writes to an in-memory array and
// flushes to localStorage every FLUSH_MS (5s). Names are sanitized by default
// (player IDs only) unless roundLogKeepNames is true.

  const ROUND_LOG_STORAGE_KEY = "openfront-helper-round-log";
  const ROUND_LOG_FLUSH_MS = 5000;
  const ROUND_LOG_MAX_EVENTS = 4000;

  let _roundLogEvents = [];
  let _roundLogFlushTimer = null;
  let _roundLogGameId = null;
  let _roundLogKeepNames = false;

  function roundLogRecord(category, data) {
    if (!roundLoggerEnabled) return;
    const event = {
      t: Date.now(),
      cat: category,
      ...data,
    };
    _roundLogEvents.push(event);
    if (_roundLogEvents.length > ROUND_LOG_MAX_EVENTS) {
      _roundLogEvents = _roundLogEvents.slice(-ROUND_LOG_MAX_EVENTS);
    }
  }

  function roundLogFlush() {
    if (_roundLogEvents.length === 0) return;
    try {
      const entry = {
        gameId: _roundLogGameId,
        events: _roundLogEvents,
        flushedAt: Date.now(),
      };
      localStorage.setItem(ROUND_LOG_STORAGE_KEY, JSON.stringify(entry));
    } catch (_error) {
      // Storage full or unavailable — silently drop.
    }
  }

  function roundLogStartMatch(game) {
    _roundLogEvents = [];
    try {
      const ticks = game.ticks ? game.ticks() : 0;
      _roundLogGameId = `match-${Date.now()}-${ticks}`;
    } catch (_error) {
      _roundLogGameId = `match-${Date.now()}`;
    }
    roundLogRecord("match_start", { gameId: _roundLogGameId });
  }

  // Observe game state each tick and record significant changes.
  let _roundLogLastTick = -1;
  let _roundLogLastPlayerSnapshot = null;

  function roundLogTick(game) {
    if (!roundLoggerEnabled) return;
    const ticks = game.ticks ? game.ticks() : 0;
    if (ticks <= _roundLogLastTick) return;
    _roundLogLastTick = ticks;

    // Detect new match (ticks restarted near 0).
    if (ticks < 10 && _roundLogEvents.length > 0) {
      roundLogFlush();
      roundLogStartMatch(game);
    }

    const players = getCachedPlayerViews(game);
    const snapshot = new Map();
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      const sid = p.smallID ? p.smallID() : i;
      const troops = Number(p.troops ? p.troops() : 0) || 0;
      const tiles = Number(p.numTilesOwned ? p.numTilesOwned() : 0) || 0;
      snapshot.set(sid, { troops, tiles });

      // Detect troop changes > 20% (combat events).
      const prev = _roundLogLastPlayerSnapshot?.get(sid);
      if (prev) {
        const troopDelta = troops - prev.troops;
        if (Math.abs(troopDelta) > prev.troops * 0.2 && Math.abs(troopDelta) > 1000) {
          let name = _roundLogKeepNames ? getPlayerDisplayNameSafe(p) : `p${sid}`;
          roundLogRecord("troop_change", {
            player: name,
            delta: troopDelta,
            troops,
            tiles,
          });
        }
      }
    }
    _roundLogLastPlayerSnapshot = snapshot;
  }

  function getPlayerDisplayNameSafe(player) {
    try {
      return getPlayerDisplayName ? getPlayerDisplayName(player) : "?";
    } catch (_error) {
      return "?";
    }
  }

  function setRoundLoggerEnabled(enabled) {
    roundLoggerEnabled = Boolean(enabled);
    if (roundLoggerEnabled) {
      if (_roundLogFlushTimer === null) {
        _roundLogFlushTimer = window.setInterval(roundLogFlush, ROUND_LOG_FLUSH_MS);
      }
      let context = null;
      try { context = getOpenFrontGameContext(); } catch (_e) { context = null; }
      if (context?.game) roundLogStartMatch(context.game);
      if (typeof registerHelperTickListener === "function") {
        registerHelperTickListener(() => {
          try {
            const ctx = getOpenFrontGameContext();
            if (ctx?.game) roundLogTick(ctx.game);
          } catch (_e) { /* ignore */ }
        });
      }
    } else {
      roundLogFlush();
      if (_roundLogFlushTimer !== null) {
        window.clearInterval(_roundLogFlushTimer);
        _roundLogFlushTimer = null;
      }
      _roundLogEvents = [];
      _roundLogLastPlayerSnapshot = null;
      _roundLogLastTick = -1;
    }
  }

  function exportRoundLog() {
    roundLogFlush();
    try {
      const raw = localStorage.getItem(ROUND_LOG_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Sanitize: remove player names if keepNames is off.
      if (!_roundLogKeepNames && data.events) {
        for (const ev of data.events) {
          if (ev.player && typeof ev.player === "string" && !ev.player.startsWith("p")) {
            ev.player = "[redacted]";
          }
        }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openfront-log-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return data;
    } catch (_error) {
      return null;
    }
  }
