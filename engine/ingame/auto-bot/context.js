// Auto-Bot — game/UI handle discovery, intent constructor discovery,
// emitIntent, and the window.__autoBotDiag() console diagnostic.

"use strict";

  // =========================================================================
  // Game / UI handle discovery
  // =========================================================================
  function findContext() {
    // Preferred: robust DOM scan shared from selective-trade-policy.js.
    try {
      if (typeof getOpenFrontGameContext === "function") {
        const c = getOpenFrontGameContext();
        if (c?.game?.myPlayer) return c;
      }
    } catch (_e) {
      /* fall through */
    }
    try {
      if (lastOpenFrontGameContext?.game?.myPlayer) {
        return lastOpenFrontGameContext;
      }
    } catch (_e) {
      /* fall through */
    }
    const selectors = [
      "main-radial-menu",
      "build-menu",
      "control-panel",
      "leader-board",
      "options-menu",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.game?.myPlayer) {
        return {
          game: el.game,
          transform: el.transformHandler || el.transform || null,
        };
      }
    }
    return null;
  }

  function getGame() {
    return findContext()?.game ?? null;
  }

  function getRadialMenu() {
    return document.querySelector("main-radial-menu");
  }

  // `build-menu` is declared in index.html (persistent) and the game wires it
  // with .game/.eventBus/.uiState — the reliable handle for actuation. The
  // radial menu is only mounted while its right-click menu is open, so we must
  // NOT depend on it for the bot loop.
  function getBuildMenu() {
    return (
      document.querySelector("build-menu") || getRadialMenu()?.buildMenu || null
    );
  }

  function getEventBus() {
    const bm = getBuildMenu();
    if (bm?.eventBus) return bm.eventBus;
    const cp = document.querySelector("control-panel");
    if (cp?.eventBus) return cp.eventBus;
    const lb = document.querySelector("leader-board");
    if (lb?.eventBus) return lb.eventBus;
    return getRadialMenu()?.eventBus ?? null;
  }

  // ---- Intent constructor discovery ---------------------------------------
  // We emit the same GameEvents the UI emits. Property names are not mangled in
  // the game's build, so we identify the right constructor by probing the
  // EventBus listener map with sentinel args and matching the resulting
  // own-property shape. Same approach as boat-macro.js.
  const _ctors = {
    bus: null,
    spawn: null,
    attack: null,
    boat: null,
    moveWarship: null,
    embargo: null,
    donateTroops: null,
    emoji: null, // SendEmojiIntentEvent(recipient|AllPlayers, emoji:number)
    target: null, // SendTargetPlayerIntentEvent(targetID:PlayerID string)
    allianceRequest: null, // learned lazily by sniffing an accept (see doAlliance)
  };

  // Alliance request/renewal event objects we've already actioned, so we don't
  // re-accept the same one each tick (and to dedupe across the two sources).
  const _alliancesActioned = new WeakSet();

  function getListenersMap(eventBus) {
    if (eventBus?.listeners instanceof Map) return eventBus.listeners;
    for (const key of Object.getOwnPropertyNames(eventBus || {})) {
      try {
        if (eventBus[key] instanceof Map) return eventBus[key];
      } catch (_e) {
        /* ignore */
      }
    }
    return null;
  }

  function discoverCtors(eventBus) {
    if (
      _ctors.bus === eventBus &&
      _ctors.attack &&
      _ctors.spawn &&
      _ctors.boat &&
      _ctors.moveWarship &&
      _ctors.embargo &&
      _ctors.donateTroops
    ) {
      return _ctors;
    }
    const map = getListenersMap(eventBus);
    if (!map) return _ctors;
    _ctors.bus = eventBus;
    for (const C of map.keys()) {
      if (typeof C !== "function") continue;
      if (!_ctors.moveWarship) {
        try {
          const m = new C([7, 8], 99); // MoveWarshipIntentEvent(unitIds[], tile)
          if (
            m &&
            Array.isArray(m.unitIds) &&
            m.unitIds[0] === 7 &&
            m.tile === 99
          ) {
            _ctors.moveWarship = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.embargo) {
        try {
          const s1 = { __probe: 1 };
          const e = new C(s1, "start"); // SendEmbargoIntentEvent(target, action)
          if (e && e.target === s1 && e.action === "start") {
            _ctors.embargo = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.donateTroops) {
        try {
          const s1 = { __probe: 1 };
          // SendDonateTroopsIntentEvent(recipient, troops) — distinguished from
          // SendDonateGoldIntentEvent by the `troops` property (vs `gold`).
          const dt = new C(s1, 123);
          if (dt && dt.recipient === s1 && dt.troops === 123) {
            _ctors.donateTroops = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.emoji) {
        try {
          const s1 = { __probe: 1 };
          // SendEmojiIntentEvent(recipient, emoji:number) — has `emoji`, unlike
          // donateTroops (`troops`) / embargo (`action`).
          const em = new C(s1, 7);
          if (
            em &&
            em.recipient === s1 &&
            em.emoji === 7 &&
            em.troops === undefined &&
            em.action === undefined
          ) {
            _ctors.emoji = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.target) {
        try {
          // SendTargetPlayerIntentEvent(targetID:PlayerID) — a single string
          // targetID and NO troops. Distinguished from SendAttackIntentEvent
          // (which also has targetID but carries troops): pass a 2nd arg and
          // require it is IGNORED (troops stays undefined).
          const tp = new C("§tp", 456);
          if (
            tp &&
            tp.targetID === "§tp" &&
            tp.troops === undefined &&
            tp.recipient === undefined &&
            tp.dst === undefined &&
            tp.emoji === undefined
          ) {
            _ctors.target = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.attack) {
        try {
          const a = new C("§p", 123); // SendAttackIntentEvent(targetID, troops)
          if (a && a.targetID === "§p" && a.troops === 123 && a.dst === undefined) {
            _ctors.attack = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.boat) {
        try {
          const b = new C(77, 123); // SendBoatAttackIntentEvent(dst, troops)
          if (b && b.dst === 77 && b.troops === 123) {
            _ctors.boat = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
      if (!_ctors.spawn) {
        try {
          const s = new C(55); // SendSpawnIntentEvent(tile)
          if (
            s &&
            s.tile === 55 &&
            s.targetID === undefined &&
            s.dst === undefined &&
            s.unit === undefined &&
            s.troops === undefined
          ) {
            _ctors.spawn = C;
            continue;
          }
        } catch (_e) {
          /* skip */
        }
      }
    }
    return _ctors;
  }

  function emitIntent(ctor, ...args) {
    const eventBus = getEventBus();
    if (!eventBus || typeof ctor !== "function") return false;
    try {
      eventBus.emit(new ctor(...args));
      return true;
    } catch (error) {
      console.error("[AutoBot] emit failed:", error);
      return false;
    }
  }

  // Console diagnostic — call window.__autoBotDiag() in-game to inspect what
  // the bot can see/use.
  function diagnose() {
    const game = getGame();
    const eventBus = getEventBus();
    const ctors = eventBus ? discoverCtors(eventBus) : _ctors;
    const bm = getBuildMenu();
    const me = game?.myPlayer?.();
    const diag = {
      game: !!game,
      gameType: game ? gameType(game) : null,
      inSpawnPhase: game?.inSpawnPhase?.() ?? null,
      myPlayer: !!me,
      hasSpawned: me?.hasSpawned?.() ?? null,
      buildMenu: !!bm,
      sendBuildOrUpgrade: typeof bm?.sendBuildOrUpgrade,
      eventBus: !!eventBus,
      ctorSpawn: !!ctors.spawn,
      ctorAttack: !!ctors.attack,
      ctorBoat: !!ctors.boat,
      ctorMoveWarship: !!ctors.moveWarship,
      ctorEmbargo: !!ctors.embargo,
      ctorDonateTroops: !!ctors.donateTroops,
      ctorEmoji: !!ctors.emoji,
      ctorAllianceRequest: !!ctors.allianceRequest,
      speedFactor: Math.round((state.speed?.factor ?? 1) * 100) / 100,
      gold: me ? Math.round(toNum(me.gold?.())) : 0,
      troops: me ? Math.round(toNum(me.troops?.())) : 0,
      tiles: me ? toNum(me.numTilesOwned?.()) : 0,
      botStatus: (() => {
        try {
          return typeof _bot !== "undefined" && _bot ? _bot.status : "no-bot";
        } catch (_e) {
          return "n/a";
        }
      })(),
      eventsDisplayEvents: (() => {
        try {
          return document.querySelector("events-display")?.events?.length ?? null;
        } catch (_e) {
          return null;
        }
      })(),
    };
    console.log("[AutoBot] DIAG", diag);
    return diag;
  }
  window.__autoBotDiag = diagnose;
