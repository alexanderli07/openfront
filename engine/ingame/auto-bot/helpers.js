// Auto-Bot — lobby gate (gameType/isPublicLobby) and small shared helpers
// (clamp, toNum, scaled/game-speed, safeName, withTimeout, …).

"use strict";

  // =========================================================================
  // Lobby gate
  // =========================================================================
  function gameType(game) {
    try {
      return game?.config?.().gameConfig?.().gameType ?? null;
    } catch (_e) {
      return null;
    }
  }

  function isPublicLobby(_game) {
    // Gate intentionally disabled for testing in multiplayer/online lobbies.
    // Original behavior: return gameType(game) === "Public";
    return false;
  }

  // =========================================================================
  // Small helpers
  // =========================================================================
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function toNum(value) {
    if (typeof value === "bigint") return Number(value);
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // Races a worker promise against a timeout so a hung/lost worker query can
  // never freeze the bot loop. Resolves to `fallback` on timeout or rejection.
  // (Late-game 400-bot worker load was stalling buildables/borderTiles calls,
  // leaving tickInFlight stuck true → the whole bot froze.)
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => window.setTimeout(() => resolve(fallback), ms)),
    ]);
  }
  const WORKER_TIMEOUT_MS = 2500;

  // Measures the live game-tick rate (baseline ~10/s) and keeps a smoothed
  // speed factor. factor 2 == game running ~2× → our cadences run ~2× faster.
  function updateSpeedFactor(game) {
    let t = NaN;
    try {
      t = Number(game.ticks?.());
    } catch (_e) {
      t = NaN;
    }
    if (!Number.isFinite(t)) return;
    const now = performance.now();
    const s = state.speed;
    if (s.lastTick === null) {
      s.lastTick = t;
      s.lastMs = now;
      return;
    }
    const dt = t - s.lastTick;
    const dms = now - s.lastMs;
    if (dms >= 1500) {
      if (dt > 0) {
        const ticksPerSec = (dt / dms) * 1000;
        const f = clamp(ticksPerSec / 10, 0.25, 12);
        s.factor = s.factor * 0.6 + f * 0.4; // smooth
      }
      s.lastTick = t;
      s.lastMs = now;
    }
  }

  // Real-time cadence scaled by game speed: at 2× speed a 5000ms cadence becomes
  // 2500ms, so the bot makes the same number of decisions per GAME-tick.
  function scaled(ms) {
    return ms / Math.max(0.25, state.speed.factor || 1);
  }

  function safeMaxTroops(game, player) {
    try {
      const v = game.config().maxTroops(player);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (_e) {
      return 0;
    }
  }

  function safeName(player) {
    try {
      return String(player.displayName?.() ?? player.name?.() ?? "?");
    } catch (_e) {
      return "?";
    }
  }
