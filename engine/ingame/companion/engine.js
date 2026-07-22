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
  // Hard ceiling on pending actions. The drain rate (~2/s) outruns the game's own
  // 5s-per-recipient emoji cooldown, so this should never bind — but an unbounded
  // queue would turn any future burst into a growing backlog of minutes-old orders.
  const COMPANION_QUEUE_LIMIT = 32;
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
    if (companionState.queue.length >= COMPANION_QUEUE_LIMIT) {
      companionState.queue.shift();
      companionLog("⚠ queue full, dropped the oldest action");
    }
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

  // Everything that is only meaningful inside ONE match. A companion left enabled
  // across a game boundary would otherwise carry its gold baseline, cooldowns and
  // seen-emoji keys into the next match — measured effect: gold donations dropped
  // from 10 per 5 minutes to 1, because the stale baseline swallowed the whole new
  // game's income.
  //
  // `paused` and `autobotWasEnabled` are deliberately NOT reset here. Pausing is
  // an explicit instruction from the player, not match state, and auto-join can
  // start the next match on its own — clearing it here would let one feature of
  // this script silently undo the stop button of another.
  function companionResetRunState() {
    companionState.cooldowns = {};
    companionState.seenEmoji.length = 0;
    companionState.queue.length = 0;
    companionState.lastGoldSnapshot = 0;
    companionState.lastSpawnTile = null;
    companionState.lastBossSpawnTile = null;
    companionState.factoryLevel = 0;
    companionState.bossSmallID = null;
    companionState.bossStatus = "idle";
    companionState.lastSendFailedAt = 0;
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
  // Auto-bot policy
  // ---------------------------------------------------------------------------

  // Companion only ever FORCES the auto-bot off; it never switches it on except
  // to hand back exactly the state it took. __OFH_autobot.set() persists to
  // localStorage, so a policy that forced `true` would permanently enable an
  // auto-bot the user had left off.
  //
  //   suppress = companion on AND (passive mode OR paused)
  //     suppress && !suppressed → remember current enabled, set off, mark suppressed
  //    !suppress &&  suppressed → set back to remembered value, clear the mark
  //
  // Called from setCompanionEnabled, the panel's Mode change, and pause/resume.
  function companionSyncAutobot() {
    let bridge = null;
    try {
      bridge = window.__OFH_autobot || null;
    } catch (_error) {
      bridge = null;
    }
    if (!bridge || typeof bridge.set !== "function") return;

    const s = companionSettings();
    const suppress =
      companionState.enabled && (s.mode === "passive" || companionState.paused);

    if (suppress && !companionState.autobotSuppressed) {
      let wasOn = false;
      try {
        wasOn = typeof bridge.get === "function" && Boolean(bridge.get().enabled);
      } catch (_error) {
        wasOn = false;
      }
      companionState.autobotWasEnabled = wasOn;
      companionState.autobotSuppressed = true;
      try {
        bridge.set({ enabled: false });
      } catch (_error) {
        /* ignore */
      }
    } else if (!suppress && companionState.autobotSuppressed) {
      companionState.autobotSuppressed = false;
      try {
        bridge.set({ enabled: companionState.autobotWasEnabled });
      } catch (_error) {
        /* ignore */
      }
    }
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
        companionSyncAutobot();
        return true;
      case "resume":
        companionState.paused = false;
        companionSyncAutobot();
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Hooks called by the auto-bot (Active mode only)
  // ---------------------------------------------------------------------------

  // "We have already taken a spawn." hasSpawned() is the real answer; on a build
  // where PlayerView does not expose it, fall back to "we already picked a tile",
  // which is weaker (a rejected spawn is never retried) but still stops the
  // relinquish/re-conquer loop.
  function companionSpawnSettled(me) {
    if (me && typeof me.hasSpawned === "function") {
      try {
        return me.hasSpawned() === true;
      } catch (_error) {
        /* fall through */
      }
    }
    return companionState.lastSpawnTile != null;
  }

  // Ensure the auto-bot's own spawn logic is active, without writing to
  // localStorage on every tick — only set what is not already set.
  function companionForceAutobotSpawn() {
    let bridge = null;
    try {
      bridge = window.__OFH_autobot || null;
    } catch (_error) {
      bridge = null;
    }
    if (!bridge || typeof bridge.set !== "function") return;
    let cur = null;
    try {
      cur = typeof bridge.get === "function" ? bridge.get() : null;
    } catch (_error) {
      cur = null;
    }
    const patch = {};
    const spawnOn = cur && cur.features && cur.features.spawn === true;
    if (!spawnOn) patch.features = { spawn: true };
    if (!cur || cur.smartSpawn !== true) patch.smartSpawn = true;
    if (patch.features || "smartSpawn" in patch) {
      try {
        bridge.set(patch);
      } catch (_error) {
        /* ignore */
      }
    }
  }

  // Returns a spawn TileRef to force, or null to let the auto-bot decide.
  // Active mode is governed by spawnStrategy, NOT by autoSpawn (that toggle only
  // applies to the passive-mode branch in companionTick).
  function companionSpawnCenter(game, _player) {
    // Paused means "stop interfering", including with the auto-bot's own choices.
    if (!companionState.enabled || companionState.paused) return null;
    const s = companionSettings();
    if (s.mode !== "active") return null;

    // "auto" — hand spawn back to the auto-bot, and make sure its spawn is on.
    if (s.spawnStrategy === "auto") {
      companionForceAutobotSpawn();
      return null;
    }

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

    // Same anti-oscillation rule as the passive branch. Our own territory turns
    // the tile we just took into `hasOwner`, so re-picking on every call walks
    // the spawn one tile over, and SpawnExecution relinquishes everything to
    // follow it — freeing the first tile again so the next call walks back.
    // Returning the tile we already chose makes doSpawn() compare it against its
    // own lastSpawnTile and emit nothing.
    const bossSpawn = boss.state ? boss.state.spawnTile : null;
    if (
      companionSpawnSettled(me) &&
      bossSpawn === companionState.lastBossSpawnTile &&
      companionState.lastSpawnTile != null
    ) {
      return companionState.lastSpawnTile;
    }

    const tile = companionPickSpawnTile(g, me, boss, s.spawnMinRadius, s.spawnMaxRadius);
    if (tile != null) {
      companionState.lastBossSpawnTile = bossSpawn;
      companionState.lastSpawnTile = tile;
    }
    return tile;
  }

  // true = block this alliance. Only ever blocks when a boss has actually been
  // resolved, so a mistyped boss name degrades to "auto-bot behaves normally"
  // instead of "auto-bot can never ally with anyone".
  function companionAllianceVeto(other) {
    // While paused the auto-bot gets its diplomacy back — a veto left standing
    // would silently block every alliance it tries.
    if (!companionState.enabled || companionState.paused) return false;
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

    // New match → drop everything that only made sense in the previous one.
    const gameRef = game.__src || game;
    if (companionState.lastGameRef !== gameRef) {
      companionState.lastGameRef = gameRef;
      companionResetRunState();
      companionLog("▶ new match");
    }

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
        const bossSpawn = boss.state ? boss.state.spawnTile : null;
        // Re-pick only before we have landed, or when the boss itself moves. Without
        // this the bot oscillates: our own territory makes the tile we just took
        // `hasOwner`, the picker moves one tile over, SpawnExecution relinquishes
        // everything and re-conquers there, which frees the first tile again — a
        // two-step cycle a one-step "same tile as last time" check cannot see.
        // Measured at 28 relocations across a single spawn phase before this guard.
        // Same settled-check the Active-mode hook uses (companionSpawnCenter) — the
        // two paths must never drift apart again.
        if (!companionSpawnSettled(me) || bossSpawn !== companionState.lastBossSpawnTile) {
          companionState.lastBossSpawnTile = bossSpawn;
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
    //    Passive mode only — in Active mode the auto-bot's own structureBehavior
    //    already handles building/upgrading, and running both here would fight it
    //    for gold and double up on upgrade_structure calls. The 🏭 emoji command
    //    still works in both modes: it goes through companionRunAction, not here.
    const factoryLevel = companionFactoryLevel(game, me);
    companionState.factoryLevel = factoryLevel;
    if (s.mode === "passive" && s.autoFactory && factoryLevel < s.maxFactoryLevel
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
    companionState.uiSignature = null; // force the banner to appear/disappear now
    if (on) {
      companionResetRunState();
      // Switching the feature on IS a fresh start, so here the pause does clear.
      companionState.paused = false;
      companionState.autobotWasEnabled = false;
      if (!companionState.tickRegistered && typeof registerHelperTickListener === "function") {
        companionState.tickRegistered = true;
        registerHelperTickListener(companionTickThrottled);
      }
      companionLog("▶ Companion enabled");
    } else {
      companionState.queue.length = 0;
      companionLog("⏹ Companion disabled");
    }
    companionSyncAutobot();
    if (typeof companionRefreshPanel === "function") companionRefreshPanel();
  }

  // The shared helper tick runs at 250ms; the companion wants its own (slower,
  // user-configurable) cadence on top of it.
  // The panel and the banner are drawn on user actions, but bossStatus, paused and
  // factoryLevel all change on the tick clock. A banner still saying "no boss"
  // after the boss has joined is worse than no banner at all.
  //
  // Gated on a signature so a quiet tick costs one string compare, and skipped
  // entirely while the user is typing into the panel — rebuilding it would drop
  // focus mid-edit.
  function companionSyncUi() {
    const sig = companionState.enabled
      ? [
          companionState.bossStatus,
          companionState.paused,
          companionState.factoryLevel,
          companionSettings().bossName,
        ].join("|")
      : "off";
    if (sig === companionState.uiSignature) return;
    companionState.uiSignature = sig;
    try {
      if (typeof companionSyncBanner === "function") companionSyncBanner();
    } catch (_error) {
      /* ignore */
    }
    try {
      const panelEl = document.getElementById(COMPANION_PANEL_ID);
      if (panelEl && panelEl.contains(document.activeElement)) return;
      if (typeof companionBuildPanel === "function") companionBuildPanel();
    } catch (_error) {
      /* ignore */
    }
  }

  function companionTickThrottled() {
    const now = Date.now();
    const period = Number(companionSettings().tickMs) || 2000;
    if (now - (companionState.lastTickAt || 0) < period) {
      // Still drain the queue at full rate so a burst of commands is not stuck
      // behind the slow decision cadence.
      companionDrainQueue(now);
      companionSyncUi();
      return;
    }
    companionState.lastTickAt = now;
    try {
      companionTick();
    } catch (error) {
      companionLog(`⚠ tick: ${error && error.message ? error.message : error}`);
    }
    companionSyncUi();
  }

  function setCompanionPanelVisible(visible) {
    companionPatchSettings({ hidden: !visible });
    if (typeof companionRefreshPanel === "function") companionRefreshPanel();
  }

  window.__OFH_companion = {
    ACTION_IDS: COMPANION_ACTION_IDS.slice(),
    get: function () {
      return Object.assign({}, companionSettings(), {
        enabled: Boolean(companionState.enabled),
        bossStatus: companionState.bossStatus,
        // "factoryLevel", not "factories" — the number is an upgrade level, and
        // calling it a count is exactly the confusion this feature already had.
        factoryLevel: companionState.factoryLevel,
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
      factoryLevel: companionState.factoryLevel,
      gameFound: Boolean(game),
      humans: companionHumanPlayers(game).map(function (p) {
        try { return p.name(); } catch (_e) { return "?"; }
      }),
      bindings: companionBindings(),
      lastSendFailedAt: companionState.lastSendFailedAt,
      logLines: companionState.log.length,
    };
  };
