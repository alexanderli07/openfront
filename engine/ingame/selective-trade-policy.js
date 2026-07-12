// OpenFront context discovery and selective trade policy.

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isUsableOpenFrontGameContext(game, transform) {
    return Boolean(
      game?.playerViews &&
        transform?.worldToScreenCoordinates,
    );
  }

  function rememberOpenFrontGameContext(game, transform) {
    if (!isUsableOpenFrontGameContext(game, transform)) {
      return null;
    }

    lastOpenFrontGameContext = { game, transform };
    if (selectiveTradePolicyEnabled) {
      syncSelectiveTradePolicyPatches(game);
      if (selectiveTradePolicyNeedsEmbargoSync) {
        applySelectiveTradePolicy(game);
      }
    }
    return lastOpenFrontGameContext;
  }

  function findOpenFrontGameContextInDom() {
    const gameSources = [];
    const transformSources = [];

    for (const element of document.querySelectorAll("*")) {
      if (element?.game) {
        gameSources.push(element.game);
      }
      if (element?.g) {
        gameSources.push(element.g);
      }
      if (element?.transformHandler) {
        transformSources.push(element.transformHandler);
      }
      if (element?.transform) {
        transformSources.push(element.transform);
      }
    }

    for (const game of gameSources) {
      for (const transform of transformSources) {
        const context = rememberOpenFrontGameContext(game, transform);
        if (context) {
          return context;
        }
      }
    }

    return null;
  }

  function isTeamGame(game) {
    const mode = String(game?.config?.().gameMode ?? game?.config?.().gameMode?.() ?? "")
      .trim()
      .toLowerCase();
    if (mode === "team") {
      return true;
    }
    if (mode === "free for all" || mode === "ffa") {
      return false;
    }

    const players = Array.from(game?.playerViews?.() || []).filter((player) =>
      player?.isAlive?.(),
    );
    return players.some((player) => {
      const team = getPlayerTeamName(player);
      return team && team !== "Bot";
    });
  }

  function getGameConfig(game) {
    try {
      const value = game?.config;
      const config = typeof value === "function" ? value.call(game) : value;
      return isObject(config) ? config : null;
    } catch (_error) {
      return null;
    }
  }

  function getAliveHumanPlayers(game) {
    return Array.from(game?.playerViews?.() || []).filter(
      (player) => player?.isAlive?.() && isHumanPlayer(player),
    );
  }

  function hasTruthyFlag(target, keys) {
    return keys.some((key) => Boolean(target?.[key]));
  }

  function hasStringFieldMatching(target, keys, includeTokens, excludeTokens = []) {
    for (const key of keys) {
      const rawValue = target?.[key];
      if (typeof rawValue !== "string") {
        continue;
      }
      const value = rawValue.trim().toLowerCase();
      if (!value) {
        continue;
      }
      if (excludeTokens.some((token) => value.includes(token))) {
        continue;
      }
      if (includeTokens.some((token) => value.includes(token))) {
        return true;
      }
    }
    return false;
  }

  function isCustomGame(game) {
    const config = getGameConfig(game);
    if (!config) {
      return false;
    }

    if (
      hasTruthyFlag(config, [
        "isCustom",
        "customGame",
        "customLobby",
        "isPrivate",
        "privateGame",
        "privateLobby",
      ])
    ) {
      return true;
    }

    return hasStringFieldMatching(
      config,
      [
        "gameType",
        "lobbyType",
        "matchType",
        "source",
        "queueType",
        "visibility",
      ],
      ["custom", "private", "friend"],
      ["public", "ranked", "matchmaking"],
    );
  }

  function isSoloGame(game) {
    return getAliveHumanPlayers(game).length <= 1;
  }

  function isCheatsAvailable(game) {
    if (!game) {
      return false;
    }

    return isSoloGame(game) || isCustomGame(game);
  }

  function reportCheatsAvailability(game = null) {
    const available = isCheatsAvailable(game);
    if (available === lastReportedCheatsAvailability) {
      return;
    }

    lastReportedCheatsAvailability = available;
    postToExtension("CHEATS_AVAILABILITY", {
      available,
    });
  }

  function isHumanPlayer(player) {
    try {
      const playerType = player?.type?.() ?? player?.data?.playerType;
      return playerType === "HUMAN";
    } catch (_error) {
      return false;
    }
  }

  function isSelectiveTradePolicyAvailable(game) {
    const myPlayer = game?.myPlayer?.();
    return Boolean(
      game &&
      isTeamGame(game) &&
      myPlayer?.isPlayer?.() &&
      isHumanPlayer(myPlayer)
    );
  }

  function reportSelectiveTradePolicyAvailability(game = null) {
    const available = isSelectiveTradePolicyAvailable(game);
    if (available === lastReportedSelectiveTradePolicyAvailability) {
      return;
    }

    lastReportedSelectiveTradePolicyAvailability = available;
    postToExtension("SELECTIVE_TRADE_POLICY_AVAILABILITY", {
      available,
    });
  }

  function isAllowedTradePartnerForMyPlayer(myPlayer, otherPlayer, game) {
    if (!myPlayer || !otherPlayer) {
      return false;
    }
    if (!isHumanPlayer(myPlayer) || !isHumanPlayer(otherPlayer)) {
      return true;
    }

    const myId = getPlayerSmallId(myPlayer);
    const otherId = getPlayerSmallId(otherPlayer);
    if (!Number.isFinite(myId) || !Number.isFinite(otherId)) {
      return false;
    }
    if (myId === otherId) {
      return true;
    }

    try {
      if (isTeamGame(game)) {
        return Boolean(myPlayer?.isOnSameTeam?.(otherPlayer));
      }
      return Boolean(myPlayer?.isAlliedWith?.(otherPlayer));
    } catch (_error) {
      return false;
    }
  }

  function rebuildSelectiveTradePolicyCache(game, myPlayer) {
    selectiveTradePolicyAllowedPartnerIds.clear();
    selectiveTradePolicyMyPlayerId = null;

    const myId = getPlayerSmallId(myPlayer);
    if (!Number.isFinite(myId)) {
      return;
    }

    selectiveTradePolicyMyPlayerId = myId;
    selectiveTradePolicyAllowedPartnerIds.add(myId);

    for (const player of Array.from(game?.playerViews?.() || [])) {
      if (!player?.isAlive?.() || !isHumanPlayer(player)) {
        continue;
      }

      const playerId = getPlayerSmallId(player);
      if (!Number.isFinite(playerId) || playerId === myId) {
        continue;
      }

      if (isAllowedTradePartnerForMyPlayer(myPlayer, player, game)) {
        selectiveTradePolicyAllowedPartnerIds.add(playerId);
      }
    }
  }

  function isBlockedBySelectiveTradePolicy(player, otherPlayer, game = null) {
    if (!selectiveTradePolicyEnabled || !player || !otherPlayer) {
      return false;
    }
    if (
      !Number.isFinite(selectiveTradePolicyMyPlayerId) ||
      selectiveTradePolicyAllowedPartnerIds.size === 0
    ) {
      return false;
    }
    if (!isHumanPlayer(player) || !isHumanPlayer(otherPlayer)) {
      return false;
    }

    const playerId = getPlayerSmallId(player);
    const otherId = getPlayerSmallId(otherPlayer);
    if (!Number.isFinite(playerId) || !Number.isFinite(otherId)) {
      return false;
    }

    if (playerId === selectiveTradePolicyMyPlayerId) {
      return !selectiveTradePolicyAllowedPartnerIds.has(otherId);
    }

    if (otherId === selectiveTradePolicyMyPlayerId) {
      return !selectiveTradePolicyAllowedPartnerIds.has(playerId);
    }

    return false;
  }

  function ensureSelectiveTradePolicyPatchForPlayer(player) {
    if (!player || typeof player?.hasEmbargo !== "function") {
      return;
    }
    if (originalPlayerHasEmbargoMethods.has(player)) {
      return;
    }

    const originalHasEmbargo = player.hasEmbargo.bind(player);
    originalPlayerHasEmbargoMethods.set(player, originalHasEmbargo);
    player.hasEmbargo = function patchedHasEmbargo(otherPlayer) {
      if (isBlockedBySelectiveTradePolicy(player, otherPlayer)) {
        return true;
      }

      try {
        return Boolean(originalHasEmbargo(otherPlayer));
      } catch (_error) {
        return false;
      }
    };
  }

  function syncSelectiveTradePolicyPatches(game) {
    for (const player of Array.from(game?.playerViews?.() || [])) {
      ensureSelectiveTradePolicyPatchForPlayer(player);
    }
  }

  function callEmbargoMethod(target, methodName, args) {
    const method = target?.[methodName];
    if (typeof method !== "function") {
      return false;
    }

    try {
      method.apply(target, args);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function trySetEmbargo(player, otherPlayer, shouldEmbargo, game) {
    const directCandidates = shouldEmbargo
      ? [
          [otherPlayer],
          [otherPlayer, true],
          [getPlayerSmallId(otherPlayer)],
          [getPlayerSmallId(otherPlayer), true],
        ]
      : [
          [otherPlayer, false],
          [otherPlayer],
          [getPlayerSmallId(otherPlayer), false],
          [getPlayerSmallId(otherPlayer)],
        ];
    const directMethods = shouldEmbargo
      ? [
          "setEmbargo",
          "embargo",
          "embargoPlayer",
          "addEmbargo",
          "setTradeEmbargo",
        ]
      : [
          "setEmbargo",
          "removeEmbargo",
          "clearEmbargo",
          "unembargo",
          "setTradeEmbargo",
        ];

    for (const methodName of directMethods) {
      for (const args of directCandidates) {
        if (callEmbargoMethod(player, methodName, args)) {
          return true;
        }
      }
    }

    const gameMethods = shouldEmbargo
      ? ["setEmbargo", "embargoPlayer", "embargo"]
      : ["setEmbargo", "removeEmbargo", "clearEmbargo"];
    const gameArgs = shouldEmbargo
      ? [
          [player, otherPlayer],
          [getPlayerSmallId(player), getPlayerSmallId(otherPlayer)],
          [player, otherPlayer, true],
        ]
      : [
          [player, otherPlayer, false],
          [getPlayerSmallId(player), getPlayerSmallId(otherPlayer), false],
          [player, otherPlayer],
        ];

    for (const methodName of gameMethods) {
      for (const args of gameArgs) {
        if (callEmbargoMethod(game, methodName, args)) {
          return true;
        }
      }
    }

    return false;
  }

  function applySelectiveTradePolicy(gameOverride = null) {
    const context = gameOverride ? { game: gameOverride } : getOpenFrontGameContext();
    const game = context?.game ?? gameOverride;
    if (!isSelectiveTradePolicyAvailable(game)) {
      selectiveTradePolicyEnabled = false;
      selectiveTradePolicyNeedsEmbargoSync = false;
      selectiveTradePolicyAllowedPartnerIds.clear();
      selectiveTradePolicyMyPlayerId = null;
      reportSelectiveTradePolicyAvailability(game);
      return;
    }

    selectiveTradePolicyEnabled = true;
    selectiveTradePolicyNeedsEmbargoSync = true;
    const myPlayer = game?.myPlayer?.();
    reportSelectiveTradePolicyAvailability(game);

    rebuildSelectiveTradePolicyCache(game, myPlayer);
    syncSelectiveTradePolicyPatches(game);

    for (const player of Array.from(game?.playerViews?.() || [])) {
      if (!player?.isAlive?.() || !isHumanPlayer(player)) {
        continue;
      }

      const playerId = getPlayerSmallId(player);
      const myId = getPlayerSmallId(myPlayer);
      if (!Number.isFinite(playerId) || !Number.isFinite(myId) || playerId === myId) {
        continue;
      }

      const shouldAllowTrade = isAllowedTradePartnerForMyPlayer(myPlayer, player, game);
      trySetEmbargo(myPlayer, player, !shouldAllowTrade, game);
      trySetEmbargo(player, myPlayer, !shouldAllowTrade, game);
    }

    selectiveTradePolicyNeedsEmbargoSync = false;
  }

  function clearSelectiveTradePolicy(gameOverride = null) {
    const context = gameOverride ? { game: gameOverride } : getOpenFrontGameContext();
    const game = context?.game ?? gameOverride;
    const myPlayer = game?.myPlayer?.();

    selectiveTradePolicyEnabled = false;
    selectiveTradePolicyNeedsEmbargoSync = false;
    selectiveTradePolicyAllowedPartnerIds.clear();
    selectiveTradePolicyMyPlayerId = null;
    reportSelectiveTradePolicyAvailability(game);

    if (!game || !myPlayer?.isPlayer?.() || !isHumanPlayer(myPlayer)) {
      return;
    }

    for (const player of Array.from(game?.playerViews?.() || [])) {
      if (!player?.isAlive?.() || !isHumanPlayer(player)) {
        continue;
      }

      const playerId = getPlayerSmallId(player);
      const myId = getPlayerSmallId(myPlayer);
      if (!Number.isFinite(playerId) || !Number.isFinite(myId) || playerId === myId) {
        continue;
      }

      trySetEmbargo(myPlayer, player, false, game);
      trySetEmbargo(player, myPlayer, false, game);
    }
  }

  function setSelectiveTradePolicyEnabled(enabled, gameOverride = null) {
    if (enabled) {
      applySelectiveTradePolicy(gameOverride);
      return;
    }

    clearSelectiveTradePolicy(gameOverride);
  }

  // Context discovery is the hottest per-frame path: every active helper
  // (nuke-prediction, boat-prediction, bot-markers, heatmaps) calls this on
  // every render frame. The old implementation ran 11 document.querySelector
  // calls plus 66 inner iterations every time, even when lastOpenFrontGameContext
  // was perfectly valid. That was ~2640 querySelectors/s with four helpers
  // active at 60 Hz, which is a major contributor to in-game frame drops.
  //
  // Strategy: short-circuit on the cached context. Game/transform references
  // are stable across the lifetime of a single match. Force a periodic full
  // re-discovery so we still notice when a game ends and a new one starts.
  const _OPEN_FRONT_CONTEXT_REFRESH_MS = 1000;
  let _lastOpenFrontContextDiscoveryAt = 0;

  function _discoverOpenFrontGameContext() {
    const playerInfoOverlay = document.querySelector("player-info-overlay");
    const playerPanel = document.querySelector("player-panel");
    const emojiTable = document.querySelector("emoji-table");
    const buildMenu = document.querySelector("build-menu");
    const gameLeftSidebar = document.querySelector("game-left-sidebar");
    const gameRightSidebar = document.querySelector("game-right-sidebar");
    const leaderBoard = document.querySelector("leader-board");
    const teamStats = document.querySelector("team-stats");
    const spawnTimer = document.querySelector("spawn-timer");
    const unitDisplay = document.querySelector("unit-display");
    const controlPanel = document.querySelector("control-panel");

    const gameSources = [
      playerInfoOverlay?.game,
      playerPanel?.g,
      emojiTable?.game,
      leaderBoard?.game,
      teamStats?.game,
      gameLeftSidebar?.game,
      gameRightSidebar?.game,
      buildMenu?.game,
      spawnTimer?.game,
      unitDisplay?.game,
      controlPanel?.game,
    ];
    const transformSources = [
      playerInfoOverlay?.transform,
      emojiTable?.transformHandler,
      buildMenu?.transformHandler,
      spawnTimer?.transformHandler,
      unitDisplay?.transformHandler,
      controlPanel?.transformHandler,
    ];

    for (const game of gameSources) {
      for (const transform of transformSources) {
        const context = rememberOpenFrontGameContext(game, transform);
        if (context) {
          return context;
        }
      }
    }

    const discoveredContext = findOpenFrontGameContextInDom();
    if (discoveredContext) {
      return discoveredContext;
    }

    return null;
  }

  function getOpenFrontGameContext() {
    // Fast path: re-use the cached context as long as it still looks usable
    // and the periodic refresh interval has not elapsed.
    const now = performance.now();
    if (
      now - _lastOpenFrontContextDiscoveryAt < _OPEN_FRONT_CONTEXT_REFRESH_MS &&
      isUsableOpenFrontGameContext(
        lastOpenFrontGameContext?.game,
        lastOpenFrontGameContext?.transform,
      )
    ) {
      return lastOpenFrontGameContext;
    }

    _lastOpenFrontContextDiscoveryAt = now;
    const discovered = _discoverOpenFrontGameContext();
    if (discovered) {
      return discovered;
    }

    // Last resort: even if discovery failed this round, keep the previously
    // cached context if its functions still exist. Prevents a single failed
    // DOM scan from breaking helpers mid-game.
    if (
      isUsableOpenFrontGameContext(
        lastOpenFrontGameContext?.game,
        lastOpenFrontGameContext?.transform,
      )
    ) {
      return lastOpenFrontGameContext;
    }

    return null;
  }

  function refreshSelectiveTradePolicyAvailability() {
    const context = getOpenFrontGameContext();
    reportSelectiveTradePolicyAvailability(context?.game ?? null);
  }

  function refreshCheatsAvailability() {
    const context = getOpenFrontGameContext();
    reportCheatsAvailability(context?.game ?? null);
  }

