// Trade balance tracking, ROI display, and observed transport accounting.

  function ensureTradeBalanceStyles() {
    if (document.getElementById(TRADE_BALANCE_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = TRADE_BALANCE_STYLE_ID;
    style.textContent = `
      #${TRADE_BALANCE_BADGE_ID} {
        display: none;
        position: fixed;
        z-index: 9000;
        bottom: calc(8px + env(safe-area-inset-bottom, 0px));
        left: 560px;
        width: min(280px, calc(100vw - 16px));
        padding: 7px 9px;
        border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
        border-radius: 8px;
        background: var(--oh-panel-bg, rgba(12,18,20,0.92));
        color: var(--oh-panel-text, #e2e8f0);
        font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.15;
        cursor: move;
        user-select: none;
        box-shadow:
          0 10px 24px rgba(0, 0, 0, 0.36),
          0 0 16px var(--oh-accent-soft, rgba(96,165,250,0.15));
      }

      #${TRADE_BALANCE_BADGE_ID}[data-visible="true"] {
        display: grid;
        gap: 5px;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-title {
        color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
        font-size: 10px;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        padding: 4px 0 5px;
        border-bottom: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-total {
        display: grid;
        gap: 2px;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-total-label {
        color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
        font-size: 9px;
        text-transform: uppercase;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-total-value {
        color: var(--oh-accent, #60a5fa);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-roi[data-status="unprofitable"] {
        color: #f87171;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-roi[data-status="profitable"] {
        color: #4ade80;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-roi[data-status="unknown"] {
        color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-rows {
        display: grid;
        gap: 3px;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-name {
        overflow: hidden;
        color: var(--oh-panel-text, #e2e8f0);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-value {
        color: var(--oh-accent, #60a5fa);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-value-wrap {
        display: grid;
        gap: 2px;
        justify-items: end;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-direction {
        color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
        font-size: 9px;
        text-transform: uppercase;
        white-space: nowrap;
      }

      #${TRADE_BALANCE_BADGE_ID} .openfront-helper-trade-empty {
        color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Hide-grace state: when you stop hovering a nation, keep the trade panel up
  // briefly (and indefinitely while the pointer is over it) so it can be dragged.
  let tradeBadgeHovered = false;
  let tradeBadgeHideAt = 0;
  const TRADE_BADGE_HIDE_GRACE_MS = 2500;

  function hideTradeBadgeSoon(badge) {
    if (badge.dataset.visible === "false") {
      tradeBadgeHideAt = 0;
      return;
    }
    if (tradeBadgeHovered) {
      tradeBadgeHideAt = 0; // pointer is on the panel — keep it open
      return;
    }
    const now = Date.now();
    if (!tradeBadgeHideAt) tradeBadgeHideAt = now + TRADE_BADGE_HIDE_GRACE_MS;
    if (now >= tradeBadgeHideAt) {
      tradeBadgeHideAt = 0;
      badge.dataset.visible = "false";
      tradeBalanceRenderSignature = "";
      syncHelperStatsContainerVisibility();
    }
  }

  function ensureTradeBalanceBadge() {
    ensureTradeBalanceStyles();

    let badge = document.getElementById(TRADE_BALANCE_BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = TRADE_BALANCE_BADGE_ID;
      badge.innerHTML = `
        <span class="openfront-helper-trade-title">${tr("Trade balance")}</span>
        <span class="openfront-helper-trade-summary">
          <span class="openfront-helper-trade-total">
            <span class="openfront-helper-trade-total-label">${tr("Total imports")}</span>
            <span class="openfront-helper-trade-total-value openfront-helper-trade-imports">+0</span>
          </span>
          <span class="openfront-helper-trade-total">
            <span class="openfront-helper-trade-total-label">${tr("Total exports")}</span>
            <span class="openfront-helper-trade-total-value openfront-helper-trade-exports">+0</span>
          </span>
          <span class="openfront-helper-trade-total">
            <span class="openfront-helper-trade-total-label">${tr("Factory/port spent")}</span>
            <span class="openfront-helper-trade-total-value openfront-helper-trade-factory-port-spend">0</span>
          </span>
          <span class="openfront-helper-trade-total">
            <span class="openfront-helper-trade-total-label">${tr("Return on investment")}</span>
            <span class="openfront-helper-trade-total-value openfront-helper-trade-roi">n/a</span>
          </span>
          <span class="openfront-helper-trade-total">
            <span class="openfront-helper-trade-total-label">${tr("Break even")}</span>
            <span class="openfront-helper-trade-total-value openfront-helper-trade-break-even">${tr("tracking")}</span>
          </span>
        </span>
        <span class="openfront-helper-trade-rows"></span>
      `;
    }
    // Standalone draggable panel — separate from the gold-per-minute container.
    if (badge.parentElement !== document.body) {
      (document.body || document.documentElement).appendChild(badge);
      makeGoldStatPanelDraggable(badge, badge, "openfront-helper-trade-balances-pos");
      applyStoredGoldStatPanelPosition(badge, "openfront-helper-trade-balances-pos");
      // Keep the panel up while the pointer is on it so it can be grabbed/dragged
      // even after you stop hovering the nation (see the hide-grace below).
      badge.addEventListener("pointerenter", () => {
        tradeBadgeHovered = true;
      });
      badge.addEventListener("pointerleave", () => {
        tradeBadgeHovered = false;
      });
    }
    return badge;
  }

  function getTradeBalanceTracker(playerId) {
    const key = String(playerId);
    let tracker = tradeBalanceTrackers.get(key);
    if (!tracker) {
      tracker = new Map();
      tradeBalanceTrackers.set(key, tracker);
    }
    return tracker;
  }

  function addExportPartnerProfitSource(exporterId, partnerId, unit, goldAmount) {
    if (
      !Number.isFinite(exporterId) ||
      !Number.isFinite(Number(partnerId)) ||
      !unit ||
      !Number.isFinite(goldAmount) ||
      goldAmount <= 0
    ) {
      return;
    }

    const exporterKey = String(exporterId);
    let sourceTracker = exportPartnerSourceTrackers.get(exporterKey);
    if (!sourceTracker) {
      sourceTracker = new Map();
      exportPartnerSourceTrackers.set(exporterKey, sourceTracker);
    }

    const tile = unit.tile?.();
    const sourceKey = `${partnerId}:${unit.id?.() ?? tile}`;
    const entry = sourceTracker.get(sourceKey) ?? {
      partnerId: Number(partnerId),
      tile,
      type: String(unit?.type?.() ?? "Industry"),
      total: 0,
    };
    entry.tile = tile ?? entry.tile;
    entry.type = String(unit?.type?.() ?? entry.type);
    entry.total += goldAmount;
    sourceTracker.set(sourceKey, entry);
  }

  function addTradeBalance(receiverId, partnerId, partnerName, goldAmount, direction = "unknown", sourceUnit = null) {
    if (!Number.isFinite(receiverId) || !Number.isFinite(goldAmount) || goldAmount <= 0) {
      return;
    }

    const tracker = getTradeBalanceTracker(receiverId);
    const key = String(partnerId || partnerName || "unknown");
    const entry = tracker.get(key) ?? {
      partnerId,
      partnerName: partnerName || "Unknown",
      total: 0,
      imports: 0,
      exports: 0,
      unknown: 0,
      firstExportAt: null,
      lastExportAt: null,
    };
    entry.partnerId = partnerId ?? entry.partnerId;
    entry.partnerName = partnerName || entry.partnerName;
    entry.total += goldAmount;
    if (direction === "import") {
      entry.imports += goldAmount;
    } else if (direction === "export") {
      const now = Date.now();
      entry.firstExportAt ??= now;
      entry.lastExportAt = now;
      entry.exports += goldAmount;
      addExportPartnerProfitSource(receiverId, partnerId, sourceUnit, goldAmount);
    } else {
      entry.unknown += goldAmount;
    }
    tracker.set(key, entry);
  }

  function getTradeEventGoldAmount(value) {
    if (typeof value === "bigint") {
      return Number(value);
    }
    return Number(value);
  }

  function findOwnedStructureAtTile(game, tile, allowedTypes, owner = null, radius = 2) {
    if (tile == null) {
      return null;
    }

    function matches(unit) {
      try {
        return (
          unit?.isActive?.() &&
          allowedTypes.includes(unit?.type?.()) &&
          (owner === null ||
            getPlayerSmallId(unit?.owner?.()) === getPlayerSmallId(owner))
        );
      } catch (_error) {
        return false;
      }
    }

    try {
      for (const unit of game?.units?.(...allowedTypes) || []) {
        if (matches(unit) && unit.tile?.() === tile) {
          return unit;
        }
      }
    } catch (_error) {
      // Try nearbyUnits below.
    }

    try {
      const nearby = game?.nearbyUnits?.(tile, radius, allowedTypes);
      return nearby?.find((entry) => matches(entry?.unit))?.unit ?? null;
    } catch (_error) {
      return null;
    }
  }

  function getTradeShipSourceUnit(game, shipId) {
    const tracker = tradeShipSourceTrackers.get(String(shipId));
    if (!tracker) {
      return null;
    }

    const sourceUnitId = Number(tracker.sourceUnitId);
    if (Number.isFinite(sourceUnitId)) {
      try {
        const unit = game?.unit?.(sourceUnitId);
        if (unit?.isActive?.() && String(unit?.type?.() ?? "") === "Port") {
          return unit;
        }
      } catch (_error) {
        // Fall back to sourceTile.
      }
    }

    return findOwnedStructureAtTile(
      game,
      tracker.sourceTile,
      ["Port"],
      tracker.sourceOwner,
    );
  }

  function refreshTradeShipSourceTrackers(game) {
    const now = Date.now();
    const activeShipIds = new Set();
    for (const ship of game?.units?.("Trade Ship") || []) {
      const shipId = ship?.id?.();
      if (!Number.isFinite(shipId) || !ship?.isActive?.()) {
        continue;
      }
      activeShipIds.add(String(shipId));

      let tracker = tradeShipSourceTrackers.get(String(shipId));
      if (!tracker) {
        tracker = {
          sourceUnitId: null,
          sourceTile: null,
          sourceOwner: ship?.owner?.() ?? null,
          targetUnitId: toFiniteNumber(ship?.targetUnitId?.(), NaN),
          lastSeenAt: now,
        };
      }
      tracker.lastSeenAt = now;

      if (!Number.isFinite(Number(tracker.sourceUnitId))) {
        const sourcePort = findOwnedStructureAtTile(
          game,
          ship?.tile?.(),
          ["Port"],
          ship?.owner?.(),
        );
        if (sourcePort) {
          const sourceUnitId = toFiniteNumber(sourcePort?.id?.(), NaN);
          tracker.sourceUnitId = Number.isFinite(sourceUnitId)
            ? sourceUnitId
            : tracker.sourceUnitId;
          tracker.sourceTile = sourcePort?.tile?.() ?? tracker.sourceTile;
          tracker.sourceOwner = sourcePort?.owner?.() ?? tracker.sourceOwner;
        }
      }

      tradeShipSourceTrackers.set(String(shipId), tracker);
    }

    for (const shipId of tradeShipSourceTrackers.keys()) {
      if (!activeShipIds.has(shipId)) {
        const tracker = tradeShipSourceTrackers.get(shipId);
        if (!Number.isFinite(tracker?.lastSeenAt) || now - tracker.lastSeenAt > 30000) {
          tradeShipSourceTrackers.delete(shipId);
        }
      }
    }
  }

  function getTradeDirection(receiverId, partnerId, boatRoutes) {
    const route = getTradeRoute(receiverId, partnerId, boatRoutes);
    if (!route) {
      return "unknown";
    }
    return route.sourceId === receiverId ? "export" : "import";
  }

  function collectCompletedBoatTradeRoutes(game, updates) {
    const routes = [];
    for (const updateGroup of Object.values(updates || {})) {
      if (!Array.isArray(updateGroup)) {
        continue;
      }

      for (const event of updateGroup) {
        if (
          event?.unitType !== "Trade Ship" ||
          event?.isActive !== false ||
          event?.targetUnitId === undefined
        ) {
          continue;
        }

        const targetUnit = game?.unit?.(event.targetUnitId);
        const destinationOwner = targetUnit?.owner?.();
        const destinationId = destinationOwner ? getPlayerSmallId(destinationOwner) : NaN;
        const sourceId = Number(event.ownerID);
        if (!Number.isFinite(sourceId) || !Number.isFinite(destinationId) || sourceId === destinationId) {
          continue;
        }

        routes.push({
          shipId: String(event.id),
          sourceId,
          destinationId,
          sourceUnit: getTradeShipSourceUnit(game, event.id),
          destinationUnit: targetUnit,
        });
      }
    }
    return routes;
  }

  function getTradeRoute(receiverId, partnerId, boatRoutes) {
    return boatRoutes.find(
      (entry) =>
        (entry.sourceId === receiverId && entry.destinationId === partnerId) ||
        (entry.destinationId === receiverId && entry.sourceId === partnerId),
    );
  }

  function takeTradeRoute(receiverId, partnerId, boatRoutes) {
    const routeIndex = boatRoutes.findIndex(
      (entry) =>
        (entry.sourceId === receiverId && entry.destinationId === partnerId) ||
        (entry.destinationId === receiverId && entry.sourceId === partnerId),
    );
    if (routeIndex < 0) {
      return null;
    }
    return boatRoutes.splice(routeIndex, 1)[0];
  }

  function isTrainStationUnit(unit, allowedTypes = ["City", "Port"], owner = null) {
    try {
      const type = unit?.type?.();
      if (!allowedTypes.includes(type) || !unit?.hasTrainStation?.()) {
        return false;
      }
      if (!owner) {
        return true;
      }
      return getPlayerSmallId(unit?.owner?.()) === getPlayerSmallId(owner);
    } catch (_error) {
      return false;
    }
  }

  function findTrainStationAtTile(game, tile, allowedTypes = ["City", "Port"], owner = null) {
    if (tile == null) {
      return null;
    }

    for (const unit of game?.units?.(...allowedTypes) || []) {
      if (isTrainStationUnit(unit, allowedTypes, owner) && unit.tile?.() === tile) {
        return unit;
      }
    }

    const nearby = game?.nearbyUnits?.(tile, 2, allowedTypes);
    return (
      nearby?.find((entry) => isTrainStationUnit(entry?.unit, allowedTypes, owner))?.unit ??
      null
    );
  }

  function findNearestOwnedFactory(game, tile, owner) {
    if (tile == null || !owner) {
      return null;
    }

    let bestFactory = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    try {
      for (const factory of owner?.units?.("Factory") || []) {
        if (!factory?.isActive?.() || !factory?.hasTrainStation?.()) {
          continue;
        }

        const factoryTile = factory.tile?.();
        if (factoryTile == null) {
          continue;
        }

        const distance = toFiniteNumber(game?.manhattanDist?.(tile, factoryTile), NaN);
        if (Number.isFinite(distance) && distance < bestDistance) {
          bestDistance = distance;
          bestFactory = factory;
        }
      }
    } catch (_error) {
      return null;
    }

    const maxRange = Math.max(
      1,
      toFiniteNumber(game?.config?.().trainStationMaxRange?.(), 100),
    );
    return bestDistance <= maxRange ? bestFactory : null;
  }

  function getTrackedTrainSourceFactory(game, tracker, trainOwner) {
    const sourceUnitId = Number(tracker?.sourceUnitId);
    if (Number.isFinite(sourceUnitId)) {
      try {
        const unit = game?.unit?.(sourceUnitId);
        if (
          unit?.isActive?.() &&
          String(unit?.type?.() ?? "") === "Factory" &&
          getPlayerSmallId(unit?.owner?.()) === getPlayerSmallId(trainOwner)
        ) {
          return unit;
        }
      } catch (_error) {
        // Try to rediscover the source from the stored source tile below.
      }
    }

    return findNearestOwnedFactory(game, tracker?.sourceTile, trainOwner);
  }

  function rememberTrainSourceFactory(tracker, factory) {
    if (!tracker || !factory) {
      return;
    }

    const unitId = toFiniteNumber(factory?.id?.(), NaN);
    tracker.sourceUnitId = Number.isFinite(unitId) ? unitId : tracker.sourceUnitId;
    tracker.sourceTile = factory?.tile?.() ?? tracker.sourceTile;
  }

  function findTrainSourceFactory(game, engine, tracker = null) {
    const trainOwner = engine?.owner?.();
    if (!trainOwner) {
      return null;
    }

    const trackedFactory = getTrackedTrainSourceFactory(game, tracker, trainOwner);
    if (trackedFactory) {
      return trackedFactory;
    }

    const sourceAtCurrentTile = findTrainStationAtTile(
      game,
      engine?.tile?.(),
      ["Factory"],
      trainOwner,
    );
    if (sourceAtCurrentTile) {
      return sourceAtCurrentTile;
    }

    return findNearestOwnedFactory(game, tracker?.firstTile ?? engine?.tile?.(), trainOwner);
  }

  function getTrainRelation(trainOwner, stationOwner) {
    if (trainOwner === stationOwner || getPlayerSmallId(trainOwner) === getPlayerSmallId(stationOwner)) {
      return "self";
    }
    if (trainOwner?.isOnSameTeam?.(stationOwner)) {
      return "team";
    }
    if (trainOwner?.isAlliedWith?.(stationOwner)) {
      return "ally";
    }
    return "other";
  }

  function canPlayersTrade(player, otherPlayer) {
    try {
      return (
        getPlayerSmallId(player) !== getPlayerSmallId(otherPlayer) &&
        !isBlockedBySelectiveTradePolicy(player, otherPlayer) &&
        !player?.hasEmbargo?.(otherPlayer)
      );
    } catch (_error) {
      return false;
    }
  }

  function processTrainTradeStops(game) {
    const activeEngineIds = new Set();

    for (const engine of game?.units?.("Train") || []) {
      if (engine?.trainType?.() !== "Engine" || !engine?.isActive?.()) {
        continue;
      }

      const engineId = engine.id?.();
      if (!Number.isFinite(engineId)) {
        continue;
      }
      activeEngineIds.add(engineId);

      const station = findTrainStationAtTile(game, engine.tile?.());
      let tracker = trainTradeTrackers.get(engineId);
      if (!tracker) {
        const sourceFactory = findTrainSourceFactory(game, engine);
        tracker = {
          firstTile: engine.tile?.(),
          lastStationKey: station ? String(station.id?.() ?? station.tile?.()) : null,
          stopsVisited: 0,
          sourceUnitId: null,
          sourceTile: null,
        };
        rememberTrainSourceFactory(tracker, sourceFactory);
        trainTradeTrackers.set(engineId, tracker);
        continue;
      }
      rememberTrainSourceFactory(tracker, findTrainSourceFactory(game, engine, tracker));

      if (!station) {
        tracker.lastStationKey = null;
        continue;
      }

      const stationKey = String(station.id?.() ?? station.tile?.());
      if (tracker.lastStationKey === stationKey) {
        continue;
      }
      tracker.lastStationKey = stationKey;

      const trainOwner = engine.owner?.();
      const stationOwner = station.owner?.();
      if (!trainOwner || !stationOwner || !canStationTradeWith(trainOwner, stationOwner)) {
        continue;
      }

      const relation = getTrainRelation(trainOwner, stationOwner);
      // Pass trainOwner as the 3rd arg: the game's trainGold → goldMultiplierFor(player)
      // calls player.isLobbyCreator() whenever the server enables the goldMultiplier
      // host-cheat. Omitting it (player=undefined) threw "Cannot read properties of
      // undefined (reading 'isLobbyCreator')" on cheat-enabled hosts. trainOwner is the
      // real PlayerView (guarded truthy above) and exposes isLobbyCreator().
      const goldAmount = Number(
        game?.config?.().trainGold?.(relation, tracker.stopsVisited, trainOwner),
      );
      tracker.stopsVisited += 1;
      if (!Number.isFinite(goldAmount) || goldAmount <= 0) {
        continue;
      }

      addEconomyRevenueSource(station, goldAmount);
      addEconomyRevenueSource(findTrainSourceFactory(game, engine, tracker), goldAmount);

      if (!canPlayersTrade(trainOwner, stationOwner)) {
        continue;
      }

      const trainOwnerId = getPlayerSmallId(trainOwner);
      const stationOwnerId = getPlayerSmallId(stationOwner);
      addTradeBalance(
        trainOwnerId,
        stationOwnerId,
        getPlayerDisplayName(stationOwner),
        goldAmount,
        "export",
        station,
      );
      addTradeBalance(
        stationOwnerId,
        trainOwnerId,
        getPlayerDisplayName(trainOwner),
        goldAmount,
        "import",
      );
    }

    for (const engineId of trainTradeTrackers.keys()) {
      if (!activeEngineIds.has(engineId)) {
        trainTradeTrackers.delete(engineId);
      }
    }
  }
  function processTradeBalanceUpdates(game) {
    const currentTick = Number(game?.ticks?.());
    if (!Number.isFinite(currentTick) || currentTick === lastProcessedTradeBalanceTick) {
      return;
    }
    lastProcessedTradeBalanceTick = currentTick;

    processFactoryPortSpendUpdates(game);
    refreshTradeShipSourceTrackers(game);
    processTrainTradeStops(game);

    const updates = game?.updatesSinceLastTick?.();
    if (!updates) {
      return;
    }

    const players = getCachedPlayerViews(game);
    const boatRoutes = collectCompletedBoatTradeRoutes(game, updates);
    for (const updateGroup of Object.values(updates)) {
      if (!Array.isArray(updateGroup)) {
        continue;
      }

      for (const event of updateGroup) {
        if (event?.message !== "events_display.received_gold_from_trade") {
          continue;
        }

        const receiverId = Number(event.playerID);
        const goldAmount = getTradeEventGoldAmount(event.goldAmount);
        const partnerName = String(event.params?.name ?? "Unknown");
        const partner = findPlayerByTradeName(players, partnerName);
        const partnerId = partner ? getPlayerSmallId(partner) : `name:${partnerName}`;
        const numericPartnerId = Number(partnerId);
        const matchedRoute = getTradeRoute(receiverId, numericPartnerId, boatRoutes);
        const direction = matchedRoute
          ? matchedRoute.sourceId === receiverId
            ? "export"
            : "import"
          : "unknown";
        const route =
          direction === "export"
            ? takeTradeRoute(receiverId, numericPartnerId, boatRoutes)
            : matchedRoute;
        const sourceUnit = direction === "export" ? route?.destinationUnit : null;
        if (direction === "export" && route) {
          addEconomyRevenueSource(route.sourceUnit, goldAmount);
          addEconomyRevenueSource(route.destinationUnit, goldAmount);
        }
        addTradeBalance(receiverId, partnerId, partnerName, goldAmount, direction, sourceUnit);
      }
    }
  }

  function formatTradeBalanceAmount(value) {
    if (!Number.isFinite(value)) {
      return "+0";
    }

    const absValue = Math.abs(value);
    const sign = value >= 0 ? "+" : "-";
    if (absValue >= 1_000_000_000) {
      return `${sign}${(absValue / 1_000_000_000).toFixed(1)}B`;
    }
    if (absValue >= 1_000_000) {
      return `${sign}${(absValue / 1_000_000).toFixed(1)}M`;
    }
    if (absValue >= 1_000) {
      return `${sign}${(absValue / 1_000).toFixed(1)}K`;
    }
    return `${sign}${Math.round(absValue)}`;
  }

  function formatTradeSpendAmount(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "0";
    }

    return formatTradeBalanceAmount(value).replace(/^\+/, "");
  }

  function formatTradeRoi(exports, spend) {
    if (
      !Number.isFinite(exports) ||
      !Number.isFinite(spend) ||
      spend <= 0
    ) {
      return "n/a";
    }

    const ratio = exports / spend;
    return `${(ratio * 100).toFixed(ratio >= 1 ? 0 : 1)}%`;
  }

  function formatBreakEvenDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "tracking";
    }

    const totalSeconds = Math.ceil(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const totalMinutes = Math.ceil(totalSeconds / 60);
    if (totalMinutes < 60) {
      return `${totalMinutes} minutes`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes} minutes` : `${hours}h`;
  }

  function formatBreakEvenEstimate(exports, spend, exportWindowMs) {
    if (!Number.isFinite(spend) || spend <= 0) {
      return "n/a";
    }
    if (exports >= spend) {
      return "now";
    }
    if (
      !Number.isFinite(exports) ||
      exports <= 0 ||
      !Number.isFinite(exportWindowMs) ||
      exportWindowMs <= 0
    ) {
      return "tracking";
    }

    const exportPerMs = exports / exportWindowMs;
    return formatBreakEvenDuration((spend - exports) / exportPerMs);
  }

  function getTradeRoiStatus(exports, spend) {
    if (
      !Number.isFinite(exports) ||
      !Number.isFinite(spend) ||
      spend <= 0
    ) {
      return "unknown";
    }

    return exports >= spend ? "profitable" : "unprofitable";
  }

  function getFactoryPortSpendForLevels(startLevelCount, levelsToAdd) {
    let total = 0;
    const safeStart = Math.max(0, Math.floor(Number(startLevelCount) || 0));
    const safeLevels = Math.max(0, Math.floor(Number(levelsToAdd) || 0));
    for (let offset = 0; offset < safeLevels; offset += 1) {
      const index = safeStart + offset;
      total += Math.min(1_000_000, Math.pow(2, index) * 125_000);
    }
    return total;
  }

  function addFactoryPortSpend(playerId, levels) {
    if (!Number.isFinite(playerId) || !Number.isFinite(levels) || levels <= 0) {
      return;
    }

    const key = String(playerId);
    const tracker = factoryPortSpendTrackers.get(key) ?? {
      levels: 0,
      total: 0,
    };
    tracker.total += getFactoryPortSpendForLevels(tracker.levels, levels);
    tracker.levels += levels;
    factoryPortSpendTrackers.set(key, tracker);
  }

  function processFactoryPortSpendUpdates(game) {
    const activeUnitKeys = new Set();
    for (const unit of game?.units?.("Factory", "Port") || []) {
      const unitId = unit?.id?.();
      const owner = unit?.owner?.();
      const ownerId = owner ? getPlayerSmallId(owner) : NaN;
      const level = getUnitLevel(unit);
      if (!Number.isFinite(unitId) || !Number.isFinite(ownerId) || level <= 0) {
        continue;
      }

      const key = String(unitId);
      activeUnitKeys.add(key);
      const tracked = factoryPortUnitTrackers.get(key);
      if (!tracked) {
        factoryPortUnitTrackers.set(key, {
          ownerId,
          level,
        });
        addFactoryPortSpend(ownerId, level);
        continue;
      }

      if (tracked.ownerId === ownerId && level > tracked.level) {
        addFactoryPortSpend(ownerId, level - tracked.level);
      }
      tracked.ownerId = ownerId;
      tracked.level = level;
    }

    for (const key of factoryPortUnitTrackers.keys()) {
      if (!activeUnitKeys.has(key)) {
        factoryPortUnitTrackers.delete(key);
      }
    }
  }

  function getFactoryPortSpendTotal(player) {
    const playerId = getPlayerSmallId(player);
    return factoryPortSpendTrackers.get(String(playerId))?.total ?? 0;
  }

  function getTradeBalanceTotals(player) {
    const playerId = getPlayerSmallId(player);
    const tracker = tradeBalanceTrackers.get(String(playerId));
    const totals = {
      imports: 0,
      exports: 0,
      firstExportAt: null,
      lastExportAt: null,
    };
    if (!tracker) {
      return totals;
    }

    for (const entry of tracker.values()) {
      totals.imports += entry.imports || 0;
      totals.exports += entry.exports || 0;
      if (Number.isFinite(entry.firstExportAt)) {
        totals.firstExportAt =
          totals.firstExportAt === null
            ? entry.firstExportAt
            : Math.min(totals.firstExportAt, entry.firstExportAt);
      }
      if (Number.isFinite(entry.lastExportAt)) {
        totals.lastExportAt =
          totals.lastExportAt === null
            ? entry.lastExportAt
            : Math.max(totals.lastExportAt, entry.lastExportAt);
      }
    }
    return totals;
  }
  function getTradeBalanceDirection(entry) {
    if ((entry.exports || 0) > (entry.imports || 0)) {
      return "Player exports more to them";
    }
    if ((entry.imports || 0) > (entry.exports || 0)) {
      return "Player imports more from them";
    }
    return "Imports and exports are balanced";
  }
  function getTradeBalanceEntries(player) {
    const playerId = getPlayerSmallId(player);
    const tracker = tradeBalanceTrackers.get(String(playerId));
    if (!tracker) {
      return [];
    }

    return Array.from(tracker.values())
      .filter((entry) => Number.isFinite(entry.total) && entry.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }

  // Numeric (FNV-1a) hash of the trade-balance render inputs. Replaces a
  // JSON.stringify-based signature that allocated a fresh string + entry array
  // on every render tick. breakEvenBucket is intentionally excluded so that
  // ticking-second changes do not invalidate the full row signature; the
  // break-even text node is updated separately on every tick.
  function getTradeBalanceRenderSignature(player, totals, spend, entries) {
    let h = 0x811c9dc5;
    h = mixHashNumber(h, getPlayerSmallId(player));
    h = mixHashNumber(h, Math.round(totals.imports || 0));
    h = mixHashNumber(h, Math.round(totals.exports || 0));
    h = mixHashNumber(h, Number(totals.firstExportAt) || 0);
    h = mixHashNumber(h, Math.round(spend || 0));
    h = mixHashNumber(h, entries.length);
    for (const entry of entries) {
      h = mixHashNumber(h, Number(entry.partnerId) || 0);
      h = mixHashString(h, entry.partnerName);
      h = mixHashNumber(h, Math.round(entry.total || 0));
      h = mixHashNumber(h, Math.round(entry.imports || 0));
      h = mixHashNumber(h, Math.round(entry.exports || 0));
    }
    return h >>> 0;
  }

  function findTradePartnerPlayer(players, entry) {
    const numericPartnerId = Number(entry?.partnerId);
    if (Number.isFinite(numericPartnerId)) {
      const match = players.find((player) => getPlayerSmallId(player) === numericPartnerId);
      if (match) {
        return match;
      }
    }

    return findPlayerByTradeName(players, entry?.partnerName);
  }

  function getExportPartnerEntries(player) {
    const playerId = getPlayerSmallId(player);
    const tracker = tradeBalanceTrackers.get(String(playerId));
    if (!tracker) {
      return [];
    }

    return Array.from(tracker.values())
      .filter((entry) => Number.isFinite(entry.exports) && entry.exports > 0)
      .sort((a, b) => b.exports - a.exports);
  }

  function collectExportPartnerHeatmapSources(game, player) {
    const sources = [];
    const playerId = getPlayerSmallId(player);
    const sourceTracker = exportPartnerSourceTrackers.get(String(playerId));
    if (!sourceTracker) {
      return sources;
    }

    const players = getCachedPlayerViews(game);
    const alivePartnerIds = new Set(
      players
        .filter((entry) => entry?.isAlive?.())
        .map((entry) => getPlayerSmallId(entry)),
    );
    const sourceEntries = Array.from(sourceTracker.values()).filter(
      (entry) =>
        entry.tile != null &&
        Number.isFinite(entry.total) &&
        entry.total > 0 &&
        alivePartnerIds.has(Number(entry.partnerId)),
    );
    const maxSourceTotal = Math.max(1, ...sourceEntries.map((entry) => entry.total || 0));

    for (const entry of sourceEntries) {
      const type = String(entry.type ?? "Industry");
      if (type !== "City" && type !== "Port") {
        continue;
      }

      const sourceWeight = Math.max(0.2, (entry.total || 0) / maxSourceTotal);
      const typeBonus = type === "City" ? 1.25 : 1;
      addEconomicSource(
        sources,
        entry.tile,
        (8 + (type === "City" ? 6 : 8)) * sourceWeight * typeBonus,
        type,
      );
    }

    return sources;
  }

  function updateTradeBalanceBadge() {
    const badge = ensureTradeBalanceBadge();
    if (!tradeBalancesEnabled) {
      if (badge.dataset.visible !== "false") {
        badge.dataset.visible = "false";
        syncHelperStatsContainerVisibility();
      }
      return;
    }

    const context = getOpenFrontGameContext();
    if (context?.game) {
      processTradeBalanceUpdates(context.game);
    }

    const overlay = getHoveredPlayerInfoOverlay();
    if (!overlay?.game) {
      // Not hovering a nation — hide after a short grace (kept open while the
      // pointer is over the panel) so it stays grabbable.
      hideTradeBadgeSoon(badge);
      return;
    }

    const totals = getTradeBalanceTotals(overlay.player);
    const factoryPortSpendTotal = getFactoryPortSpendTotal(overlay.player);
    const entries = getTradeBalanceEntries(overlay.player);
    const nextRenderSignature = getTradeBalanceRenderSignature(
      overlay.player,
      totals,
      factoryPortSpendTotal,
      entries,
    );

    const exportWindowMs = Number.isFinite(totals.firstExportAt)
      ? Date.now() - totals.firstExportAt
      : NaN;

    if (nextRenderSignature !== tradeBalanceRenderSignature) {
      tradeBalanceRenderSignature = nextRenderSignature;

      const imports = badge.querySelector(".openfront-helper-trade-imports");
      const exports = badge.querySelector(".openfront-helper-trade-exports");
      const factoryPortSpend = badge.querySelector(
        ".openfront-helper-trade-factory-port-spend",
      );
      const roi = badge.querySelector(".openfront-helper-trade-roi");
      if (imports) {
        imports.textContent = formatTradeBalanceAmount(totals.imports);
      }
      if (exports) {
        exports.textContent = formatTradeBalanceAmount(totals.exports);
      }
      if (factoryPortSpend) {
        factoryPortSpend.textContent = formatTradeSpendAmount(factoryPortSpendTotal);
      }
      if (roi) {
        roi.textContent = formatTradeRoi(totals.exports, factoryPortSpendTotal);
        roi.dataset.status = getTradeRoiStatus(totals.exports, factoryPortSpendTotal);
      }

      const rows = badge.querySelector(".openfront-helper-trade-rows");
      if (rows) {
        if (entries.length === 0) {
          rows.innerHTML = `<span class="openfront-helper-trade-empty">${tr("No observed trade yet")}</span>`;
        } else {
          rows.replaceChildren(
            ...entries.map((entry) => {
              const row = document.createElement("span");
              row.className = "openfront-helper-trade-row";
              const name = document.createElement("span");
              name.className = "openfront-helper-trade-name";
              name.textContent = entry.partnerName;
              const valueWrap = document.createElement("span");
              valueWrap.className = "openfront-helper-trade-value-wrap";
              const value = document.createElement("span");
              value.className = "openfront-helper-trade-value";
              value.textContent = formatTradeBalanceAmount(entry.total);
              const direction = document.createElement("span");
              direction.className = "openfront-helper-trade-direction";
              direction.textContent = getTradeBalanceDirection(entry);
              valueWrap.append(value, direction);
              row.append(name, valueWrap);
              return row;
            }),
          );
        }
      }
      markHelperStatsLayoutDirty();
    }

    // Break-even depends on wall-clock time even when no other data changed;
    // update only its text node (no full re-render).
    const breakEven = badge.querySelector(".openfront-helper-trade-break-even");
    if (breakEven) {
      const nextBreakEvenText = formatBreakEvenEstimate(
        totals.exports,
        factoryPortSpendTotal,
        exportWindowMs,
      );
      if (breakEven.textContent !== nextBreakEvenText) {
        breakEven.textContent = nextBreakEvenText;
      }
    }

    tradeBadgeHideAt = 0; // hovering a nation again — cancel any pending hide
    if (badge.dataset.visible !== "true") {
      badge.dataset.visible = "true";
      syncHelperStatsContainerVisibility();
      markHelperStatsLayoutDirty();
    }
    syncHelperStatsLayoutIfDirty();
  }

  function setTradeBalancesEnabled(enabled) {
    tradeBalancesEnabled = Boolean(enabled);
    if (!tradeBalancesEnabled) {
      tradeBalanceAnimationFrame = null;
      lastProcessedTradeBalanceTick = null;
      lastTradeBalanceRenderAt = 0;
      tradeBalanceRenderSignature = "";
      unregisterHelperTickListener(updateTradeBalanceBadge);
      if (!exportPartnerHeatmapEnabled && !economyHeatmapEnabled) {
        tradeBalanceTrackers.clear();
        exportPartnerSourceTrackers.clear();
        factoryPortSpendTrackers.clear();
        factoryPortUnitTrackers.clear();
        trainTradeTrackers.clear();
        tradeShipSourceTrackers.clear();
      }
      const badge = document.getElementById(TRADE_BALANCE_BADGE_ID);
      if (badge) {
        badge.dataset.visible = "false";
      }
      syncHelperStatsContainerVisibility();
      return;
    }

    registerHelperTickListener(updateTradeBalanceBadge);
  }

