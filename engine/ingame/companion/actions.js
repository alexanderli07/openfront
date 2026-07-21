// Companion Bot — actions: the primitive things a companion can do, each one a
// single intent and a boolean result. No scheduling and no policy here; the
// engine decides WHEN, these decide HOW.
//
// Everything goes out through sendGamePacket() (ws-hook.js), whose shapes are
// validated against OpenFrontIO/src/core/Schemas.ts:437-514. That is deliberately
// simpler than the auto-bot's EventBus path: no intent-constructor discovery is
// needed, and auto-donate.js/silo-sam-tracker.js already ship the same approach.

"use strict";

  // sendGamePacket lives in the shared engine scope (ws-hook.js), NOT on window.
  function companionSend(intent) {
    if (typeof sendGamePacket !== "function") return false;
    let ok = false;
    try {
      ok = sendGamePacket(intent) === true;
    } catch (_error) {
      ok = false;
    }
    if (ok) {
      companionState.lastSendAt = Date.now();
    } else {
      companionState.lastSendFailedAt = Date.now();
    }
    return ok;
  }

  function companionPlayerId(p) {
    try {
      return p && typeof p.id === "function" ? p.id() : null;
    } catch (_error) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Donations
  // ---------------------------------------------------------------------------

  function companionDonateGold(me, boss, pct) {
    const recipient = companionPlayerId(boss);
    if (!recipient || !me || typeof me.gold !== "function") return false;
    let gold;
    try {
      gold = me.gold();
    } catch (_error) {
      return false;
    }
    const amount = companionPercentAmount(gold, pct);
    if (amount <= 0) return false;
    return companionSend({ type: "donate_gold", recipient: recipient, gold: amount });
  }

  function companionDonateTroops(me, boss, pct) {
    const recipient = companionPlayerId(boss);
    if (!recipient || !me || typeof me.troops !== "function") return false;
    let troops;
    try {
      troops = me.troops();
    } catch (_error) {
      return false;
    }
    const amount = companionPercentAmount(troops, pct);
    if (amount <= 0) return false;
    return companionSend({ type: "donate_troops", recipient: recipient, troops: amount });
  }

  // ---------------------------------------------------------------------------
  // Diplomacy
  // ---------------------------------------------------------------------------

  function companionRequestAlliance(boss) {
    const recipient = companionPlayerId(boss);
    if (!recipient) return false;
    return companionSend({ type: "allianceRequest", recipient: recipient });
  }

  function companionBreakAlliance(boss) {
    const recipient = companionPlayerId(boss);
    if (!recipient) return false;
    return companionSend({ type: "breakAlliance", recipient: recipient });
  }

  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------

  // Troops are stored ×10 on both sides of this ratio, so it needs no scaling.
  function companionBossNeedsTroops(game, boss, needPct) {
    if (!game || !boss || typeof boss.troops !== "function") return false;
    let max = 0;
    try {
      const cfg = typeof game.config === "function" ? game.config() : null;
      max = cfg && typeof cfg.maxTroops === "function" ? Number(cfg.maxTroops(boss)) : 0;
    } catch (_error) {
      return false;
    }
    if (!Number.isFinite(max) || max <= 0) return false;
    let cur = 0;
    try {
      cur = Number(boss.troops());
    } catch (_error) {
      return false;
    }
    if (!Number.isFinite(cur)) return false;
    return cur / max <= Number(needPct) / 100;
  }

  function companionIsAlliedWithBoss(me, boss) {
    if (!me || !boss) return false;
    try {
      if (typeof me.isOnSameTeam === "function" && me.isOnSameTeam(boss)) return true;
    } catch (_error) {
      /* fall through */
    }
    try {
      if (typeof me.isAlliedWith === "function" && me.isAlliedWith(boss)) return true;
    } catch (_error) {
      /* fall through */
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Spawn
  // ---------------------------------------------------------------------------

  // Nearest valid land tile inside the [minR, maxR] ring around the boss's spawn.
  //
  // The multitab original built its candidate by splitting the tile id's digit
  // string in half to get (x, y) and then jumping to a random point on a circle —
  // arithmetic that only lands correctly when the map width is a power of ten.
  // Here the ring is enumerated properly and every candidate is validated against
  // the same rules the game enforces, nearest-first so the bot hugs the boss.
  function companionPickSpawnTile(game, me, boss, minR, maxR) {
    if (!game || !boss || !boss.state) return null;
    const bossTile = boss.state.spawnTile;
    if (bossTile == null) return null;
    // isValidCoord is bounds-checking, not an optional nicety: without it a
    // negative or overflowing x silently wraps into an adjacent row and the bot
    // spawns on the far side of the map. Bail like the width/ref guards do.
    if (
      typeof game.width !== "function" ||
      typeof game.ref !== "function" ||
      typeof game.isValidCoord !== "function"
    ) {
      return null;
    }

    let width = 0;
    try {
      width = Number(game.width());
    } catch (_error) {
      return null;
    }
    if (!Number.isFinite(width) || width <= 0) return null;

    const origin = companionTileToXY(bossTile, width);
    const offsets = companionRingOffsets(minR, maxR);

    for (const off of offsets) {
      const x = origin.x + off.dx;
      const y = origin.y + off.dy;
      try {
        if (!game.isValidCoord(x, y)) continue;
        const tile = game.ref(x, y);
        if (tile == null) continue;
        if (typeof game.isLand === "function" && !game.isLand(tile)) continue;
        if (typeof game.hasOwner === "function" && game.hasOwner(tile)) continue;
        if (typeof game.isBorder === "function" && game.isBorder(tile)) continue;
        return tile;
      } catch (_error) {
        /* skip this candidate */
      }
    }
    return null;
  }

  function companionSpawnAt(tile) {
    const t = Number(tile);
    // A TileRef is a non-negative integer index. The wire schema is a bare
    // z.number(), so a negative or fractional value would be accepted here and
    // rejected (silently) further in.
    if (tile == null || !Number.isInteger(t) || t < 0) return false;
    return companionSend({ type: "spawn", tile: t });
  }
