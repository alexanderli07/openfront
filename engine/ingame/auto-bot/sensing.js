// Auto-Bot — reading game state: border tiles, ocean-adjacency,
// border analysis, bounding boxes.

"use strict";

  // =========================================================================
  // Sensing
  // =========================================================================
  async function getBorderTiles(game, me) {
    const now = performance.now();
    if (state.border.tiles && now - state.border.atMs < scaled(BORDER_CACHE_MS)) {
      return state.border.tiles;
    }
    let tiles = [];
    try {
      const res = await withTimeout(me.borderTiles(), WORKER_TIMEOUT_MS, null);
      const set = res?.borderTiles ?? res;
      tiles = set ? Array.from(set) : [];
    } catch (error) {
      console.warn("[AutoBot] borderTiles failed:", error);
      tiles = [];
    }
    state.border = { tiles, atMs: now };
    return tiles;
  }

  // True when a tile borders the OCEAN (tradeable shared water). The bot only
  // treats a nation as "coastal" when it can trade by sea — lakes/closed seas
  // don't count (mirrors NationStructureBehavior's sharedWaterComponents).
  function isOceanAdjacent(game, t) {
    try {
      if (typeof game.isOceanShore === "function") return game.isOceanShore(t);
    } catch (_e) {
      /* fall through */
    }
    for (const n of game.neighbors(t)) {
      if (game.isOcean?.(n)) return true;
    }
    return false;
  }

  // Scans border-tile land neighbours to classify the frontier: empty (terra
  // nullius) land available, shore presence (for boats), ocean-coast presence
  // (for port/factory ratios), and the set of bordering enemies.
  function analyzeBorder(game, me, border) {
    const mySmallId = me.smallID?.();
    let hasOpenLand = false;
    let hasNukedLand = false; // unowned land WITH fallout — reclaimable nuked turf
    let hasShore = false;
    let hasCoastal = false;
    const enemies = new Map();
    const friends = new Map(); // bordering allied/same-team players (betrayal candidates)

    for (const bt of border) {
      if (!hasShore && game.isShore?.(bt)) hasShore = true;
      if (!hasCoastal && isOceanAdjacent(game, bt)) hasCoastal = true;
      for (const n of game.neighbors(bt)) {
        if (!game.isLand(n)) continue;
        if (game.ownerID(n) === mySmallId) continue;
        if (!game.hasOwner(n)) {
          if (game.hasFallout?.(n)) {
            hasNukedLand = true;
          } else {
            hasOpenLand = true;
          }
          continue;
        }
        const owner = game.owner(n);
        if (!owner?.isPlayer?.()) continue;
        if (owner.smallID?.() === mySmallId) continue;
        if (me.isFriendly?.(owner)) {
          friends.set(owner.smallID(), owner);
          continue;
        }
        enemies.set(owner.smallID(), owner);
      }
    }

    return {
      hasOpenLand,
      hasNukedLand,
      hasShore,
      hasCoastal,
      enemies: Array.from(enemies.values()),
      friends: Array.from(friends.values()),
    };
  }

  function boundingBox(game, border) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of border) {
      const x = game.x(t);
      const y = game.y(t);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }
