// Companion Bot — engine: scheduling and policy. Decides WHEN the primitives in
// actions.js run, drains them through a single rate-limited queue, and exposes
// the two guarded hooks the auto-bot calls in Active mode.
//
// Classic-script shared scope; nothing runs at load time except the bridge
// assignment at the bottom, which is a plain property write and cannot throw.

"use strict";

  // Minimum spacing between two outgoing intents. Keeps a burst of emoji commands
  // from looking like a packet flood.
  const COMPANION_MIN_SEND_GAP_MS = 300;
  const COMPANION_LOG_LIMIT = 100;
  const COMPANION_DONATE_TROOPS_COOLDOWN_MS = 10000;
  const COMPANION_DONATE_GOLD_COOLDOWN_MS = 30000;
  const COMPANION_FACTORY_COOLDOWN_MS = 5000;

  // ---------------------------------------------------------------------------
  // Log
  // ---------------------------------------------------------------------------

  function companionLog(message) {
    companionState.log.unshift({ at: Date.now(), text: String(message) });
    if (companionState.log.length > COMPANION_LOG_LIMIT) {
      companionState.log.length = COMPANION_LOG_LIMIT;
    }
  }

  // ---------------------------------------------------------------------------
  // Action queue
  // ---------------------------------------------------------------------------

  function companionEnqueue(label, fn) {
    companionState.queue.push({ label: String(label), fn: fn });
  }

  // Run at most one queued action, respecting the minimum gap. Returns how many
  // ran (0 or 1). A throwing action is dropped rather than retried, so one bad
  // action can never wedge the queue.
  function companionDrainQueue(now) {
    if (companionState.queue.length === 0) return 0;
    if (now - companionState.lastSendAt < COMPANION_MIN_SEND_GAP_MS) return 0;
    const item = companionState.queue.shift();
    companionState.lastSendAt = now;
    try {
      item.fn();
    } catch (error) {
      companionLog(`⚠ ${item.label}: ${error && error.message ? error.message : error}`);
    }
    return 1;
  }

  function companionCooldownReady(key, ms, now) {
    const last = companionState.cooldowns[key];
    if (last == null) return true;
    return now - last >= ms;
  }

  function companionMarkCooldown(key, now) {
    companionState.cooldowns[key] = now;
  }

  // ---------------------------------------------------------------------------
  // Game access
  // ---------------------------------------------------------------------------

  function companionGame() {
    try {
      if (typeof getOpenFrontGameContext === "function") {
        const ctx = getOpenFrontGameContext();
        if (ctx && ctx.game) return ctx.game;
      }
    } catch (_error) {
      /* fall through */
    }
    return null;
  }

  // GameView does not expose isCatchingUp() on every build, so this is a guarded
  // probe rather than a direct call.
  function companionIsCatchingUp(game) {
    try {
      return typeof game.isCatchingUp === "function" && game.isCatchingUp() === true;
    } catch (_error) {
      return false;
    }
  }

  // Resolve the boss and cache its smallID for the hooks (which run on the
  // auto-bot's clock, not ours).
  function companionRefreshBoss(game) {
    const res = companionResolveBoss(game, companionSettings().bossName);
    companionState.bossStatus = res.status;
    companionState.bossSmallID = null;
    if (res.boss) {
      try {
        companionState.bossSmallID = res.boss.smallID();
      } catch (_error) {
        companionState.bossSmallID = null;
      }
    }
    return res.boss;
  }

  // ---------------------------------------------------------------------------
  // Emoji-driven actions
  // ---------------------------------------------------------------------------

  function companionRunAction(actionId, ctx) {
    const s = companionSettings();
    switch (actionId) {
      case "donateAllGold":
        return companionDonateGold(ctx.me, ctx.boss, 100);
      case "donateAllTroops":
        return companionDonateTroops(ctx.me, ctx.boss, 100);
      case "requestAlliance":
        return companionRequestAlliance(ctx.boss);
      case "breakAlliance":
        return companionBreakAlliance(ctx.boss);
      case "attackBossTarget":
        return companionAttackBossTarget(ctx.game, ctx.me, ctx.boss, s.troopSendPct);
      case "buildFactory":
        return companionBuildOrUpgradeFactory(ctx.game, ctx.me);
      case "pause":
        companionState.paused = true;
        // In Active mode the auto-bot is what is actually playing, so pausing
        // has to stop it too — otherwise the bot keeps expanding while the user
        // believes everything has stopped.
        if (s.mode === "active") {
          try {
            if (window.__OFH_autobot) window.__OFH_autobot.set({ enabled: false });
          } catch (_error) { /* ignore */ }
        }
        return true;
      case "resume":
        companionState.paused = false;
        if (s.mode === "active") {
          try {
            if (window.__OFH_autobot) window.__OFH_autobot.set({ enabled: true });
          } catch (_error) { /* ignore */ }
        }
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Hooks called by the auto-bot (Active mode only)
  // ---------------------------------------------------------------------------

  // Returns a spawn TileRef to force, or null to let the auto-bot decide.
  function companionSpawnCenter(game, _player) {
    if (!companionState.enabled) return null;
    const s = companionSettings();
    if (s.mode !== "active" || !s.autoSpawn) return null;
    const g = game || companionGame();
    if (!g) return null;
    const boss = companionRefreshBoss(g);
    if (!boss) return null;
    let me = null;
    try {
      me = g.myPlayer ? g.myPlayer() : null;
    } catch (_error) {
      me = null;
    }
    return companionPickSpawnTile(g, me, boss, s.spawnMinRadius, s.spawnMaxRadius);
  }

  // true = block this alliance. Only ever blocks when a boss has actually been
  // resolved, so a mistyped boss name degrades to "auto-bot behaves normally"
  // instead of "auto-bot can never ally with anyone".
  function companionAllianceVeto(other) {
    if (!companionState.enabled) return false;
    const s = companionSettings();
    if (s.mode !== "active" || !s.autoAlliance) return false;
    if (companionState.bossSmallID == null) return false;
    if (!other || typeof other.smallID !== "function") return true;
    try {
      return other.smallID() !== companionState.bossSmallID;
    } catch (_error) {
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  function companionTick() {
    if (!companionState.enabled) return;
    const now = Date.now();
    // Always drain, even while paused — the queue only ever holds work that was
    // already approved when it was enqueued.
    companionDrainQueue(now);

    const game = companionGame();
    if (!game) return;
    if (companionIsCatchingUp(game)) return;

    let me = null;
    try {
      me = game.myPlayer ? game.myPlayer() : null;
    } catch (_error) {
      me = null;
    }
    if (!me) return;

    const boss = companionRefreshBoss(game);
    if (!boss) return;

    const s = companionSettings();
    const ctx = { game: game, me: me, boss: boss };

    // 1. Emoji commands — these bypass thresholds and cooldowns because they are
    //    an explicit request from the player, but still go through the queue.
    if (s.emojiControl) {
      const cmds = companionCollectCommands(
        boss,
        (function () { try { return me.smallID(); } catch (_e) { return null; } })(),
        companionBindings(),
        companionState.seenEmoji,
      );
      for (const actionId of cmds) {
        companionEnqueue(actionId, function () {
          const ok = companionRunAction(actionId, ctx);
          companionLog((ok ? "✅ " : "❌ ") + actionId);
        });
      }
    }

    if (companionState.paused) return;

    // 2. Spawn phase — Passive mode only; Active mode goes through the auto-bot
    //    hook so the two can never fight over the same decision.
    let inSpawn = false;
    try {
      inSpawn = typeof game.inSpawnPhase === "function" && game.inSpawnPhase();
    } catch (_error) {
      inSpawn = false;
    }
    if (inSpawn) {
      if (s.mode === "passive" && s.autoSpawn) {
        const tile = companionPickSpawnTile(
          game, me, boss, s.spawnMinRadius, s.spawnMaxRadius,
        );
        if (tile != null && tile !== companionState.lastSpawnTile) {
          companionState.lastSpawnTile = tile;
          companionEnqueue("spawn", function () {
            if (companionSpawnAt(tile)) companionLog("🏁 Spawned near boss");
          });
        }
      }
      return;
    }

    // 3. Alliance — only ever with the boss.
    if (s.autoAlliance && !companionIsAlliedWithBoss(me, boss)) {
      let asked = [];
      try {
        asked = boss.state && boss.state.outgoingAllianceRequests
          ? boss.state.outgoingAllianceRequests : [];
      } catch (_error) {
        asked = [];
      }
      let myId = null;
      try { myId = me.id(); } catch (_error) { myId = null; }
      if (myId && asked.indexOf(myId) !== -1
          && companionCooldownReady("alliance", 5000, now)) {
        companionMarkCooldown("alliance", now);
        companionEnqueue("alliance", function () {
          if (companionRequestAlliance(boss)) companionLog("🤝 Alliance with boss");
        });
      }
    }

    const allied = companionIsAlliedWithBoss(me, boss);

    // 4. Donate troops when the boss is running low.
    if (s.autoTroops && allied
        && companionCooldownReady("donateTroops", COMPANION_DONATE_TROOPS_COOLDOWN_MS, now)
        && companionBossNeedsTroops(game, boss, s.troopNeedPct)) {
      companionMarkCooldown("donateTroops", now);
      companionEnqueue("donateTroops", function () {
        if (companionDonateTroops(me, boss, s.troopSendPct)) companionLog("🎖 Troops → boss");
      });
    }

    // 5. Factory — build one, then keep upgrading it until it reaches the cap.
    //    Level 0 means we own none yet, so the same call covers both cases.
    const factoryLevel = companionFactoryLevel(game, me);
    companionState.factoryLevel = factoryLevel;
    if (s.autoFactory && factoryLevel < s.maxFactoryLevel
        && companionCooldownReady("factory", COMPANION_FACTORY_COOLDOWN_MS, now)) {
      companionMarkCooldown("factory", now);
      companionEnqueue("factory", function () {
        if (companionBuildOrUpgradeFactory(game, me)) companionLog("🏭 Factory");
      });
    }

    // 6. Donate gold. While we are still building factories only the gold GAINED
    //    since the last donation is shared, so the bot keeps enough capital to
    //    finish its build-out; once the cap is reached everything goes to the boss.
    if (s.autoGold && allied
        && companionCooldownReady("donateGold", COMPANION_DONATE_GOLD_COOLDOWN_MS, now)) {
      let goldNow = 0;
      try { goldNow = Number(me.gold()); } catch (_error) { goldNow = 0; }
      const building = factoryLevel < s.maxFactoryLevel;
      let amountSource = goldNow;
      let pct = s.goldIdlePct;
      if (building) {
        amountSource = Math.max(0, goldNow - companionState.lastGoldSnapshot);
        pct = s.goldBuildingPct;
      }
      const amount = companionPercentAmount(amountSource, pct);
      if (amount > 0) {
        companionMarkCooldown("donateGold", now);
        companionState.lastGoldSnapshot = building ? goldNow : 0;
        companionEnqueue("donateGold", function () {
          const recipient = (function () {
            try { return boss.id(); } catch (_e) { return null; }
          })();
          if (!recipient) return;
          if (companionSend({ type: "donate_gold", recipient: recipient, gold: amount })) {
            companionLog("💰 Gold → boss");
          }
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Enable / disable + bridge
  // ---------------------------------------------------------------------------

  function setCompanionEnabled(enabled) {
    const on = Boolean(enabled);
    if (companionState.enabled === on) return;
    companionState.enabled = on;
    if (on) {
      companionState.seenEmoji.length = 0;
      companionState.cooldowns = {};
      companionState.lastGoldSnapshot = 0;
      companionState.lastSpawnTile = null;
      if (!companionState.tickRegistered && typeof registerHelperTickListener === "function") {
        companionState.tickRegistered = true;
        registerHelperTickListener(companionTickThrottled);
      }
      companionLog("▶ Companion enabled");
    } else {
      companionState.queue.length = 0;
      companionLog("⏹ Companion disabled");
    }
    if (typeof companionRefreshPanel === "function") companionRefreshPanel();
  }

  // The shared helper tick runs at 250ms; the companion wants its own (slower,
  // user-configurable) cadence on top of it.
  function companionTickThrottled() {
    const now = Date.now();
    const period = Number(companionSettings().tickMs) || 2000;
    if (now - (companionState.lastTickAt || 0) < period) {
      // Still drain the queue at full rate so a burst of commands is not stuck
      // behind the slow decision cadence.
      companionDrainQueue(now);
      return;
    }
    companionState.lastTickAt = now;
    try {
      companionTick();
    } catch (error) {
      companionLog(`⚠ tick: ${error && error.message ? error.message : error}`);
    }
  }

  function setCompanionPanelVisible(visible) {
    companionPatchSettings({ hidden: !visible });
    if (typeof companionRefreshPanel === "function") companionRefreshPanel();
  }

  window.__OFH_companion = {
    ACTION_IDS: COMPANION_ACTION_IDS,
    get: function () {
      return Object.assign({}, companionSettings(), {
        enabled: Boolean(companionState.enabled),
        bossStatus: companionState.bossStatus,
        factories: companionState.factoryLevel,
      });
    },
    set: function (patch) {
      if (!patch || typeof patch !== "object") return;
      companionPatchSettings(patch);
      if ("enabled" in patch) setCompanionEnabled(Boolean(patch.enabled));
      if (typeof companionRefreshPanel === "function") companionRefreshPanel();
    },
  };

  // Mirrors window.__autoBotDiag(): a full object back means the wiring is intact.
  window.__companionDiag = function () {
    const game = companionGame();
    return {
      enabled: Boolean(companionState.enabled),
      settings: companionSettings(),
      bossStatus: companionState.bossStatus,
      bossSmallID: companionState.bossSmallID,
      paused: companionState.paused,
      queued: companionState.queue.length,
      factories: companionState.factoryLevel,
      gameFound: Boolean(game),
      humans: companionHumanPlayers(game).map(function (p) {
        try { return p.name(); } catch (_e) { return "?"; }
      }),
      bindings: companionBindings(),
      lastSendFailedAt: companionState.lastSendFailedAt,
      logLines: companionState.log.length,
    };
  };
