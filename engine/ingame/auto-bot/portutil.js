// Auto-Bot — port utilities: a faithful JS reimplementation of the src/core
// helpers the Nation AI behaviors depend on, so the ported behaviors can call
// them with identical semantics. NO custom logic lives here — every function is
// a 1:1 translation of a named src function (citation in each block).
//
// Loaded after context/sensing, before gameApi and the behaviors.
// Classic-script shared-global scope (no IIFE): top-level names are visible to
// the other modules and must stay unique across the bundle.

"use strict";

  // ===========================================================================
  // Enums — src/core/game/Game.ts (string enums match the engine wire values).
  // (Relation is defined in gameApi.js.)
  // ===========================================================================
  const Difficulty = {
    Easy: "Easy",
    Medium: "Medium",
    Hard: "Hard",
    Impossible: "Impossible",
  };
  const GameType = {
    Singleplayer: "Singleplayer",
    Public: "Public",
    Private: "Private",
  };
  const GameMode = { FFA: "Free For All", Team: "Team" };
  const PlayerType = { Bot: "BOT", Human: "HUMAN", Nation: "NATION" };
  // TerrainType is a NUMERIC enum in src.
  const TerrainType = {
    Plains: 0,
    Highland: 1,
    Mountain: 2,
    Lake: 3,
    Ocean: 4,
  };

  // The difficulty the bot REPLICATES (user-selected in the panel) — drives all
  // strategy order / ratios / probabilities. NOTE: this is distinct from the
  // lobby's actual Nation difficulty; enemy-stat reads (config().maxTroops(enemy))
  // still use the real game difficulty. Default Impossible (the strongest Nation).
  function currentDifficulty() {
    const d = state && state.settings ? state.settings.difficulty : null;
    switch (d) {
      case "Easy":
      case "Medium":
      case "Hard":
      case "Impossible":
        return d;
      default:
        return Difficulty.Impossible;
    }
  }

  // ===========================================================================
  // PseudoRandom — src/core/PseudoRandom.ts
  // ---------------------------------------------------------------------------
  // The src class is backed by the `seedrandom` npm lib (an ARC4 generator). We
  // cannot import it into the page bridge, and we do NOT need its exact stream:
  // the bot is its own player, so its RNG sequence need not match any specific
  // Nation. What MUST be faithful is the per-call PROBABILITY of every branch —
  // `chance(odds)` = 1/odds, `nextInt(min,max)` uniform over [min,max) — and
  // those are preserved by ANY uniform [0,1) generator. We back it with a
  // self-contained seeded mulberry32 (the same generator the headless harness
  // uses for Math.random) so Common-Random-Numbers determinism holds in BOTH the
  // extension and the harness. Seeded per the src formula
  // simpleHash(playerInfo.id) + simpleHash(gameID) (NationExecution.ts:54).
  class PseudoRandom {
    constructor(seed) {
      // mulberry32 — fast, well-distributed 32-bit seeded PRNG.
      let s = (Number(seed) >>> 0) || 1;
      this._next01 = function () {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Next pseudorandom number between 0 and 1.
    next() {
      return this._next01();
    }

    // Random integer between min (inclusive) and max (exclusive).
    nextInt(min, max) {
      const lo = Math.floor(min);
      const hi = Math.floor(max);
      return Math.floor(this._next01() * (hi - lo)) + lo;
    }

    // Random float between min (inclusive) and max (exclusive).
    nextFloat(min, max) {
      return this._next01() * (max - min) + min;
    }

    // Random element from an array.
    randElement(arr) {
      if (arr.length === 0) throw new Error("array must not be empty");
      return arr[this.nextInt(0, arr.length)];
    }

    // Random element from a set.
    randFromSet(set) {
      const size = set.size;
      if (size === 0) throw new Error("set must not be empty");
      const index = this.nextInt(0, size);
      let i = 0;
      for (const item of set) {
        if (i === index) return item;
        i++;
      }
      throw new Error("Unexpected error selecting element from set");
    }

    // True with probability 1/odds.
    chance(odds) {
      return this.nextInt(0, odds) === 0;
    }

    // Fisher-Yates shuffled COPY of the array.
    shuffleArray(array) {
      const result = [...array];
      for (let i = result.length - 1; i > 0; i--) {
        const j = this.nextInt(0, i + 1);
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    }
  }

  // ===========================================================================
  // simpleHash — src/core/Util.ts:118
  // ===========================================================================
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // within — src/core/Util.ts:37 (clamp; named `within` to keep src parity;
  // helpers.js already defines `clamp` with the same semantics).
  function within(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // ===========================================================================
  // Geometry helpers. These mirror the src functions but take the gameApi
  // `game`/`player` wrappers, which expose the SAME synchronous map/player API
  // as the core Game/Player (after the per-tick snapshot hydrates borderTiles).
  // ===========================================================================

  // closestTile — src/core/execution/Util.ts:159 → [TileRef|null, distance]
  function closestTile(gm, refs, tile) {
    let minDistance = Infinity;
    let minRef = null;
    for (const ref of refs) {
      const distance = gm.manhattanDist(ref, tile);
      if (distance < minDistance) {
        minDistance = distance;
        minRef = ref;
      }
    }
    return [minRef, minDistance];
  }

  // closestTwoTiles — src/core/execution/Util.ts:176 → { x, y } | null
  function closestTwoTiles(gm, x, y) {
    const xSorted = Array.from(x).sort((a, b) => gm.x(a) - gm.x(b));
    const ySorted = Array.from(y).sort((a, b) => gm.x(a) - gm.x(b));
    if (xSorted.length === 0 || ySorted.length === 0) return null;

    let i = 0;
    let j = 0;
    let minDistance = Infinity;
    let result = { x: xSorted[0], y: ySorted[0] };

    while (i < xSorted.length && j < ySorted.length) {
      const currentX = xSorted[i];
      const currentY = ySorted[j];
      const distance =
        Math.abs(gm.x(currentX) - gm.x(currentY)) +
        Math.abs(gm.y(currentX) - gm.y(currentY));
      if (distance < minDistance) {
        minDistance = distance;
        result = { x: currentX, y: currentY };
      }
      if (i === xSorted.length - 1) {
        j++;
      } else if (j === ySorted.length - 1) {
        i++;
      } else if (gm.x(currentX) < gm.x(currentY)) {
        i++;
      } else {
        j++;
      }
    }
    return result;
  }

  // calculateBoundingBox — src/core/Util.ts:128 → { min:{x,y}, max:{x,y} }
  function calculateBoundingBox(gm, borderTiles) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tile of borderTiles) {
      const x = gm.x(tile);
      const y = gm.y(tile);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  }

  // boundingBoxCenter — src/core/Util.ts:209 → {x,y}
  function boundingBoxCenter(box) {
    return {
      x: box.min.x + Math.floor((box.max.x - box.min.x) / 2),
      y: box.min.y + Math.floor((box.max.y - box.min.y) / 2),
    };
  }

  // calculateBoundingBoxCenter — src/core/Util.ts:201 → {x,y}
  function calculateBoundingBoxCenter(gm, borderTiles) {
    return boundingBoxCenter(calculateBoundingBox(gm, borderTiles));
  }

  // boundingBoxTiles — src/core/Util.ts:149 → TileRef[] (perimeter ring)
  function boundingBoxTiles(gm, center, radius) {
    const tiles = [];
    const centerX = gm.x(center);
    const centerY = gm.y(center);
    const minX = centerX - radius;
    const maxX = centerX + radius;
    const minY = centerY - radius;
    const maxY = centerY + radius;
    for (let x = minX; x <= maxX; x++) {
      if (gm.isValidCoord(x, minY)) tiles.push(gm.ref(x, minY));
      if (gm.isValidCoord(x, maxY) && minY !== maxY) tiles.push(gm.ref(x, maxY));
    }
    for (let y = minY + 1; y < maxY; y++) {
      if (gm.isValidCoord(minX, y)) tiles.push(gm.ref(minX, y));
      if (gm.isValidCoord(maxX, y) && minX !== maxX) tiles.push(gm.ref(maxX, y));
    }
    return tiles;
  }

  // calculateTerritoryCenter — src/core/execution/Util.ts:233 → TileRef | null
  // `target.borderTiles()` here is the SYNC snapshot Set (gameApi core-shape).
  function calculateTerritoryCenter(game, target) {
    const borderTiles = target.borderTiles();
    if (borderTiles.size === 0) return null;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const tile of borderTiles) {
      const x = game.x(tile);
      const y = game.y(tile);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const centerX = Math.floor((minX + maxX) / 2);
    const centerY = Math.floor((minY + maxY) / 2);
    const centerTile = game.ref(centerX, centerY);

    // Verify ownership of the center tile (core compares identity; we compare smallID).
    const centerOwner = game.owner(centerTile);
    if (
      centerOwner &&
      centerOwner.isPlayer &&
      centerOwner.isPlayer() &&
      centerOwner.smallID() === target.smallID()
    ) {
      return centerTile;
    }

    // Fall back to nearest border tile if center is not owned.
    let closest = null;
    let closestDistanceSquared = Infinity;
    for (const tile of borderTiles) {
      const dx = game.x(tile) - centerX;
      const dy = game.y(tile) - centerY;
      const distSquared = dx * dx + dy * dy;
      if (distSquared < closestDistanceSquared) {
        closestDistanceSquared = distSquared;
        closest = tile;
      }
    }
    return closest;
  }

  // randTerritoryTileArray — src/core/execution/nation/NationUtils.ts:6
  function randTerritoryTileArray(random, mg, player, numTiles) {
    const boundingBox = calculateBoundingBox(mg, player.borderTiles());
    const tiles = [];
    for (let i = 0; i < numTiles; i++) {
      const tile = randTerritoryTile(random, mg, player, boundingBox);
      if (tile !== null) tiles.push(tile);
    }
    return tiles;
  }

  // randTerritoryTile — src/core/execution/nation/NationUtils.ts:23
  // DIVERGENCE: the src fallback samples `player.tiles()` (ALL owned tiles), which
  // is core-only — the client has no per-player tile enumeration. We fall back to
  // a random border tile instead (still inside the territory), or null. Only the
  // <=100-tiles-after-100-misses path is affected (rare, early game).
  function randTerritoryTile(random, mg, p, boundingBox) {
    if (boundingBox == null) {
      boundingBox = calculateBoundingBox(mg, p.borderTiles());
    }
    for (let i = 0; i < 100; i++) {
      const randX = random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!mg.isValidCoord(randX, randY)) continue;
      const randTile = mg.ref(randX, randY);
      const owner = mg.owner(randTile);
      if (owner && owner.isPlayer && owner.isPlayer() && owner.smallID() === p.smallID()) {
        return randTile;
      }
    }
    const border = p.borderTiles();
    if (p.numTilesOwned() > 0 && p.numTilesOwned() <= 100 && border.size > 0) {
      return random.randElement(Array.from(border));
    }
    return null;
  }
