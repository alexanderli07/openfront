// Enemy-intent early warning — intercepts WebSocket messages to detect incoming
// attacks/boats BEFORE they appear in the game state (incomingAttacks()). Hooks
// window.WebSocket to listen for "turn" and "start" messages containing
// turn.intents[] arrays.
//
// This is a DATA LAYER only (no rendering). Warnings are consumed by the
// attack-highlight overlay and the advisor panel via getEnemyIntentWarnings().
//
// The hook is lightweight: it only parses the small intents[] array from each
// turn message, not the full game state.

  const ENEMY_INTENT_TTL_MS = 15000; // warning lifetime
  const ENEMY_INTENT_LOG_COOLDOWN_MS = 3000;

  // Map: attackerKey -> { kind, attackerID, attackerName, troops, dstX, dstY, atMs }
  const _enemyIntentWarnings = new Map();
  const _enemyIntentLogCooldowns = new Map();
  let _enemyIntentOriginalWsAddEventListener = null;
  let _enemyIntentHookInstalled = false;

  function getMyIdentifiers() {
    let context = null;
    try { context = getOpenFrontGameContext(); } catch (_error) { context = null; }
    if (!context?.game) return null;
    const game = context.game;
    const me = game.myPlayer ? game.myPlayer() : null;
    if (!me) return null;
    return {
      myId: me.id ? me.id() : null,
      mySmallId: me.smallID ? me.smallID() : null,
      game,
      me,
    };
  }

  function isOwnedByMe(game, me, tile) {
    try {
      if (!game.hasOwner || !game.hasOwner(tile)) return false;
      const ownerSid = game.ownerID ? game.ownerID(tile) : null;
      const mySid = me.smallID ? me.smallID() : -1;
      return ownerSid === mySid;
    } catch (_error) {
      return false;
    }
  }

  function isMineOrAdjacent(game, me, dst) {
    if (isOwnedByMe(game, me, dst)) return true;
    try {
      const width = game.width();
      const height = game.height();
      const x = dst % width;
      const y = Math.floor(dst / width);
      const neighbors = [];
      if (x > 0) neighbors.push(dst - 1);
      if (x < width - 1) neighbors.push(dst + 1);
      if (y > 0) neighbors.push(dst - width);
      if (y < height - 1) neighbors.push(dst + width);
      return neighbors.some((n) => isOwnedByMe(game, me, n));
    } catch (_error) {
      return false;
    }
  }

  function resolveAttackerName(clientId) {
    let context = null;
    try { context = getOpenFrontGameContext(); } catch (_error) { context = null; }
    if (!context?.game) return `p${clientId}`;
    const players = getCachedPlayerViews(context.game);
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      try {
        if (p.clientID && p.clientID() === clientId) {
          return getPlayerDisplayName ? getPlayerDisplayName(p) : p.name && p.name() || `p${clientId}`;
        }
      } catch (_error) { /* ignore */ }
    }
    return `p${clientId}`;
  }

  function isHostileClientId(clientId) {
    const ids = getMyIdentifiers();
    if (!ids) return true;
    const players = getCachedPlayerViews(ids.game);
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      try {
        if (p.clientID && p.clientID() === clientId) {
          if (ids.me.isFriendly && ids.me.isFriendly(p)) return false;
          return true;
        }
      } catch (_error) { /* treat as hostile */ }
    }
    return true;
  }

  function addEnemyIntentWarning(kind, intent, dst) {
    const ids = getMyIdentifiers();
    if (!ids) return;
    if (intent.clientID == null) return;
    // Skip my own intents.
    // We compare clientID to myId (which is the player.id, not clientID directly).
    // Instead, check if the attacker is friendly.
    if (!isHostileClientId(intent.clientID)) return;

    const key = `client:${intent.clientID}`;
    const warning = {
      kind,
      attackerID: intent.clientID,
      attackerName: resolveAttackerName(intent.clientID),
      troops: Math.max(0, Number(intent.troops) || 0),
      atMs: performance.now(),
      dstX: null,
      dstY: null,
    };
    if (dst != null) {
      try {
        const width = ids.game.width();
        warning.dstX = dst % width;
        warning.dstY = Math.floor(dst / width);
      } catch (_error) { /* ignore */ }
    }
    _enemyIntentWarnings.set(key, warning);
  }

  function observeTurn(turn) {
    if (!turn || !Array.isArray(turn.intents)) return;
    const ids = getMyIdentifiers();
    if (!ids) return;
    for (let i = 0; i < turn.intents.length; i += 1) {
      const intent = turn.intents[i];
      if (!intent || intent.clientID == null) continue;
      if (intent.type === "attack") {
        // Check if the attack targets me.
        const targetId = intent.targetID;
        if (targetId == null) continue;
        const myId = ids.myId;
        const mySmallId = ids.mySmallId;
        if (targetId !== myId && targetId !== mySmallId) continue;
        addEnemyIntentWarning("attack", intent, null);
      } else if (intent.type === "boat") {
        const dst = Number(intent.dst);
        if (!Number.isFinite(dst)) continue;
        if (!isMineOrAdjacent(ids.game, ids.me, dst)) continue;
        addEnemyIntentWarning("boat", intent, dst);
      }
    }
  }

  function processWsMessage(data) {
    if (!data || typeof data !== "object") return;
    try {
      if (data.type === "turn" && data.turn) {
        observeTurn(data.turn);
      } else if (data.type === "start" && Array.isArray(data.turns)) {
        for (let i = 0; i < data.turns.length; i += 1) {
          observeTurn(data.turns[i]);
        }
      }
    } catch (_error) { /* ignore parse errors */ }
    // Forward to spawn heatmap for spawn-intent tracking.
    if (typeof spawnHeatmapProcessWsMessage === "function") {
      spawnHeatmapProcessWsMessage(data);
    }
  }

  function installEnemyIntentHook() {
    // NOTE: We do NOT patch window.WebSocket — the game uses binary frames and
    // patching breaks the connection ("game is starting" hang). Instead we poll
    // the game's incomingAttacks() API via registerHelperTickListener, which is
    // the same data source attack-highlight uses but we expose it as a reusable
    // data layer with TTL-based warnings.
    if (_enemyIntentHookInstalled) return;
    _enemyIntentHookInstalled = true;
    if (typeof registerHelperTickListener === "function") {
      registerHelperTickListener(enemyIntentPollTick);
    }
  }

  function uninstallEnemyIntentHook() {
    if (typeof unregisterHelperTickListener === "function") {
      unregisterHelperTickListener(enemyIntentPollTick);
    }
    _enemyIntentWarnings.clear();
    _enemyIntentLogCooldowns.clear();
    _enemyIntentHookInstalled = false;
  }

  // Poll incomingAttacks() every 250ms (same cadence as the helper tick) and
  // update warnings. This replaces the fragile WebSocket hook with the same
  // data the game already exposes.
  function enemyIntentPollTick() {
    if (!enemyIntentEnabled) return;
    let context = null;
    try { context = getOpenFrontGameContext(); } catch (_error) { context = null; }
    if (!context?.game) return;
    const me = context.game.myPlayer ? context.game.myPlayer() : null;
    if (!me) return;
    let atks = null;
    try { atks = me.incomingAttacks ? me.incomingAttacks() : null; } catch (_error) { atks = null; }
    if (!atks) return;
    const now = performance.now();
    // Clear stale warnings first.
    for (const [key, warning] of _enemyIntentWarnings) {
      if (now - warning.atMs > ENEMY_INTENT_TTL_MS) {
        _enemyIntentWarnings.delete(key);
      }
    }
    for (let i = 0; i < atks.length; i += 1) {
      const a = atks[i];
      if (!a || a.retreating) continue;
      const attackerID = a.attackerID;
      if (attackerID == null) continue;
      // Skip friendly fire.
      try {
        const attacker = context.game.playerBySmallID
          ? context.game.playerBySmallID(attackerID) : null;
        if (attacker && me.isFriendly && me.isFriendly(attacker)) continue;
      } catch (_error) { /* treat as hostile */ }
      const key = `sid:${attackerID}`;
      const existing = _enemyIntentWarnings.get(key);
      if (existing) {
        // Update troops (may change as more troops join the attack).
        existing.troops = Math.max(existing.troops, Number(a.troops) || 0);
        existing.atMs = now;
      } else {
        _enemyIntentWarnings.set(key, {
          kind: "attack",
          attackerID,
          attackerName: resolveAttackerName(attackerID),
          troops: Math.max(0, Number(a.troops) || 0),
          atMs: now,
          dstX: null,
          dstY: null,
        });
      }
    }
  }

  function pruneEnemyIntentWarnings() {
    const now = performance.now();
    for (const [key, warning] of _enemyIntentWarnings) {
      if (now - warning.atMs > ENEMY_INTENT_TTL_MS) {
        _enemyIntentWarnings.delete(key);
      }
    }
  }

  // Public API: consumed by attack-highlight overlay and advisor panel.
  function getEnemyIntentWarnings() {
    pruneEnemyIntentWarnings();
    const out = [];
    for (const warning of _enemyIntentWarnings.values()) {
      out.push(warning);
    }
    return out.sort((a, b) => b.troops - a.troops);
  }

  function getActiveEnemyIntentWarning() {
    pruneEnemyIntentWarnings();
    let best = null;
    for (const warning of _enemyIntentWarnings.values()) {
      if (!best || warning.troops > best.troops) best = warning;
    }
    return best;
  }

  function setEnemyIntentEnabled(enabled) {
    enemyIntentEnabled = Boolean(enabled);
    if (enemyIntentEnabled) {
      installEnemyIntentHook();
    } else {
      uninstallEnemyIntentHook();
    }
  }
