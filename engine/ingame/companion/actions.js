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

  function companionRenewAlliance(boss) {
    const recipient = companionPlayerId(boss);
    if (!recipient) return false;
    return companionSend({ type: "allianceExtension", recipient: recipient });
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

  // True when an alliance WITH THE BOSS is in its extension window (about to
  // expire). hasExtensionRequest on the client is expiresAt <= now + promptOffset,
  // i.e. "renewable now" — both sides see it, so both send and the alliance
  // extends. Reads me.alliances() defensively (may be absent on some builds).
  function companionAllianceNeedsRenew(me, boss) {
    if (!me || !boss || typeof me.alliances !== "function") return false;
    let bossId = null;
    try {
      bossId = typeof boss.id === "function" ? boss.id() : null;
    } catch (_error) {
      return false;
    }
    if (bossId == null) return false;
    let alliances = null;
    try {
      alliances = me.alliances();
    } catch (_error) {
      return false;
    }
    if (!Array.isArray(alliances)) return false;
    for (const a of alliances) {
      if (a && a.other === bossId && a.hasExtensionRequest === true) return true;
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

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  function companionOwnedUnits(game, me, unitType) {
    if (!game || !me || typeof game.units !== "function") return [];
    let mySmall;
    try {
      mySmall = me.smallID ? me.smallID() : null;
    } catch (_error) {
      return [];
    }
    if (mySmall == null) return [];
    let units;
    try {
      units = game.units(unitType) || [];
    } catch (_error) {
      return [];
    }
    // The for..of below sits outside the try above, so a non-iterable here would
    // throw straight out of every caller. GameView.units() always returns an
    // array today; this keeps that from being load-bearing.
    if (!Array.isArray(units)) return [];
    const out = [];
    for (const u of units) {
      try {
        const owner = u && typeof u.owner === "function" ? u.owner() : null;
        if (owner && typeof owner.smallID === "function" && owner.smallID() === mySmall) {
          out.push(u);
        }
      } catch (_error) {
        /* skip */
      }
    }
    return out;
  }

  // The level of the factory we ACTUALLY own — 0 when we own none.
  //
  // This is the progress counter for the whole factory feature. The multitab
  // original kept a local counter it bumped on every build packet and never
  // reconciled, so a rejected build (or a page reload) left the bot convinced it
  // had progressed further than it had. It also *called* that counter
  // "factories" while only ever upgrading a single structure — the number is a
  // LEVEL, not a count, which is why the setting is maxFactoryLevel.
  function companionFactoryLevel(game, me) {
    const units = companionOwnedUnits(game, me, "Factory");
    let best = 0;
    for (const u of units) {
      try {
        const lvl = typeof u.level === "function" ? Number(u.level()) : 1;
        if (Number.isFinite(lvl) && lvl > best) best = lvl;
      } catch (_error) {
        if (best < 1) best = 1; // it exists, so it is at least level 1
      }
    }
    return best;
  }

  function companionFirstFactoryId(game, me) {
    const units = companionOwnedUnits(game, me, "Factory");
    if (units.length === 0) return null;
    try {
      return units[0].id();
    } catch (_error) {
      return null;
    }
  }

  // Build the first factory at our own spawn tile; after that, upgrade the one we
  // have. The server validates affordability, so no client-side cost ladder is
  // needed (the original hard-coded 125k/250k/500k/1M, which is a guess that
  // drifts the moment the game rebalances).
  function companionBuildOrUpgradeFactory(game, me) {
    const existingId = companionFirstFactoryId(game, me);
    if (existingId != null) {
      return companionSend({
        type: "upgrade_structure",
        unit: "Factory",
        unitId: existingId,
      });
    }
    const tile = me && me.state ? me.state.spawnTile : null;
    if (tile == null) return false;
    return companionSend({ type: "build_unit", unit: "Factory", tile: Number(tile) });
  }

  // ---------------------------------------------------------------------------
  // Follow the boss into a fight
  // ---------------------------------------------------------------------------

  // outgoingAttacks entries are plain {troops, attackerID, targetID, retreating}
  // objects — fields, not methods.
  function companionBossTargetId(game, boss) {
    if (!game || !boss || !boss.state) return null;
    const attacks = boss.state.outgoingAttacks;
    if (!Array.isArray(attacks) || attacks.length === 0) return null;
    for (let i = attacks.length - 1; i >= 0; i--) {
      const a = attacks[i];
      if (!a || a.retreating) continue;
      if (a.targetID == null) continue;
      try {
        const target = game.playerBySmallID ? game.playerBySmallID(Number(a.targetID)) : null;
        if (target && typeof target.id === "function") return target.id();
      } catch (_error) {
        /* try the next one */
      }
    }
    return null;
  }

  function companionAttackBossTarget(game, me, boss, pct) {
    const targetID = companionBossTargetId(game, boss);
    if (!targetID || !me || typeof me.troops !== "function") return false;
    let troops;
    try {
      troops = me.troops();
    } catch (_error) {
      return false;
    }
    const amount = companionPercentAmount(troops, pct);
    if (amount <= 0) return false;
    return companionSend({ type: "attack", targetID: targetID, troops: amount });
  }
