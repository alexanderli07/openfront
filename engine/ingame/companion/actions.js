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
