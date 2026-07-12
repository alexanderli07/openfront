(function initOpenFrontHelperSettings(globalScope) {
  const MAPS = Array.isArray(globalScope.OPENFRONT_MAPS)
    ? globalScope.OPENFRONT_MAPS
    : [];
  const MAP_IDS = MAPS.map((map) => map.id);

  const FILTER_KEYS = [
    "startingGold0M",
    "randomSpawn",
    "alliancesDisabled",
    "portsDisabled",
    "nukesDisabled",
    "samsDisabled",
    "waterNukes",
    "peaceTime4m",
    "startingGold5M",
    "startingGold1M",
    "startingGold25M",
    "goldMultiplier2x",
  ];

  const TEAM_SIZE_MIN = 1;
  const TEAM_SIZE_MAX = 100;


  const START_GOLD_FILTER_KEYS = [
    "startingGold0M",
    "startingGold1M",
    "startingGold5M",
    "startingGold25M",
  ];

  function createDefaultMapFilters() {
    return Object.fromEntries(MAP_IDS.map((id) => [id, false]));
  }

  const DEFAULT_INCLUDE_EXCLUDE_FILTERS = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, false]),
  );

  const DEFAULT_SETTINGS = {
    language: "en",
    enabled: false,
    searchStartedAt: null,
    joinNotification: true,
    minLobbySize: null,
    minTeamSize: 5,
    maxTeamSize: null,
    minTeamCount: null,
    maxTeamCount: 5,
    keepAutoJoinAfterMatch: true,
    autoLeaveOnTeamWin: false,
    markBotNationsRed: false,
    showGoldPerMinute: true,
    showTopGoldPerMinute: true,
    showTeamBuildStats: true,
    markHoveredAlliesGreen: true,
    showAllianceRequestsPanel: true,
    showTradeBalances: false,
    showHelperUsers: true,
    showGameTimeAlert: false,
    gameTimeAlertThresholdSec: 300,
    showPlayerMapOverlays: true,
    showMapTroopCounts: true,
    showThreatIndicators: true,
    showMapMoney: true,
    showAttackHighlight: true,
    showAdvisorPanel: false,
    showRetaliationHud: true,
    hideAds: true,
    attackRatioHotkey: true,
    rightClickConquest: true,
    roundLogger: false,
    networkLogger: false,
    showBuildTimers: true,
    showEnemyIntent: true,
    showSpawnHeatmap: false,
    showSpawnMarkers: true,
    sosDefense: true,
    selectiveTradePolicyEnabled: false,
    autoCancelDeniedTradesAvailable: true,
    cheatsAvailable: true,
    showNukePrediction: true,
    showNukeTrajectory: true,
    showNukeSuggestions: false,
    showBoatPrediction: true,
    showWarshipRoutes: true,
    showWarshipRoutesOwn: true,
    showWarshipRoutesTeam: true,
    showWarshipRoutesAlly: true,
    showWarshipRoutesEnemy: true,
    alwaysShowOwnBoatRoutes: true,
    alwaysShowTeamBoatRoutes: false,
    alwaysShowAllyBoatRoutes: false,
    alwaysShowEnemyBoatRoutes: true,
    showBoatPanel: true,
    warnIncomingBoats: true,
    showEstatePanel: true,
    autoNuke: true,
    autoNukeIncludeAllies: true,
    send1PercentBoat: true,
    showEconomyHeatmap: false,
    economyHeatmapIntensity: 1,
    showExportPartnerHeatmap: false,
    applySelectiveTradePolicyRequestAt: null,
    showFloatingHelpersPanel: false,
    // Quick Panel — compact tabbed floating control with WS actions.
    showQuickPanel: true,
    quickPanelActiveTab: "actions",
    // WS-injected actions (Quick Panel Actions tab)
    killShotInstantSend: false,
    killShotHotkey: "Shift+KeyK",
    atomBatchHotkey: "Backslash",
    embargoAutoRepeat: false,
    autoWarshipEnabled: false,
    autoWarshipHuntTrade: true,
    autoWarshipEvade: true,
    autoWarshipRetreatHealthPct: 50,
    preAttackingEnabled: false,
    preAttackingDoubleClick: false,
    combatSiloPanel: true,
    combatSiloShowAll: false,
    combatSiloBuildingOnly: false,
    combatSiloAudioAlert: false,
    combatSamTracker: true,
    combatSamBuildingOnly: false,
    combatSamShowAll: false,
    combatSamOneClickFire: false,
    combatSamAutoFireBuilding: false,
    combatSamAutoFireMaxQty: 1,
    chatLoopEnabled: false,
    chatLoopIntervalMs: 2000,
    chatLoopTarget: "everyone",
    autoDonateEnabled: false,
    autoDonateKeepPct: 40,
    autoDonatePercentage: 25,
    autoDonateTargets: "",
    autoDonateGoldEnabled: false,
    autoDonateGoldThreshold: 5000000,
    autoDonateGoldPercentage: 25,
    autoDonateGoldTargets: "",
    // Theme & Appearance
    guiAccentColor: "#00ff66",
    guiAccentHue: 150,
    guiOpacity: 1,
    overlayOpacity: 1,
    rainbowMode: false,
    // Config
    boatScanInterval: 50,
    missileScanInterval: 100,
    nukeScanInterval: 250,
    uiUpdateInterval: 500,
    combatPct1: 10,
    combatPct2: 25,
    combatPct3: 50,
    combatPct4: 100,
    skinUnlocker: false,
    lowLagMode: false,
    // Lobby
    lobby3x2Grid: false,
    lobbyForecast: {
      available: false,
      sampleSize: 0,
      etaMinSeconds: null,
      etaMaxSeconds: null,
      hitChanceNext10: null,
      medianLobbiesToMatch: null,
      last100Averages: {
        windowSize: 100,
        sampleSize: 0,
        hitRate: null,
        avgLobbyIntervalMs: null,
        avgLobbiesPerMinute: null,
        etaSeconds: null,
        updatedAt: null,
      },
    },
    floatingHelpersPanelPosition: {
      left: null,
      top: null,
    },
    floatingHelpersPanelHeight: null,
    showFloatingAutoJoinPanel: true,
    showAutoBotPanel: true,
    floatingAutoJoinPanelPosition: {
      left: null,
      top: null,
    },
    floatingAutoJoinPanelHeight: null,
    floatingAutoJoinPanelCollapsed: false,
    collapsedHelperCategories: {
      panels: false,
      map: false,
      combat: false,
      alerts: false,
      tools: false,
      // legacy keys (kept so old saved settings merge cleanly)
      game: false,
      economic: false,
    },
    includeFilters: {
      ...DEFAULT_INCLUDE_EXCLUDE_FILTERS,
    },
    excludeFilters: {
      ...DEFAULT_INCLUDE_EXCLUDE_FILTERS,
    },
    mapFilters: {
      ...createDefaultMapFilters(),
      baikal: true,
      baikalnukewars: true,
      luna: true,
      pluto: true,
    },
    mapExcludeFilters: createDefaultMapFilters(),
  };

  function normalizeEconomyHeatmapIntensity(value) {
    const intensity = Number(value);
    if (!Number.isFinite(intensity)) {
      return DEFAULT_SETTINGS.economyHeatmapIntensity;
    }
    return Math.max(0, Math.min(2, Math.round(intensity)));
  }

  function normalizeGameTimeAlertThreshold(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) {
      return DEFAULT_SETTINGS.gameTimeAlertThresholdSec;
    }
    return Math.max(30, Math.min(3600, Math.round(seconds)));
  }

  function getEconomyHeatmapIntensityLabel(value) {
    return ["Low", "Default", "High"][normalizeEconomyHeatmapIntensity(value)];
  }

  function normalizeFloatingHelpersPanelPosition(value = {}) {
    const left = Number(value.left);
    const top = Number(value.top);
    return {
      left:
        value.left == null || value.left === "" || !Number.isFinite(left)
          ? null
          : left,
      top:
        value.top == null || value.top === "" || !Number.isFinite(top)
          ? null
          : top,
    };
  }

  function normalizeFloatingHelpersPanelHeight(value) {
    const height = Number(value);
    return Number.isFinite(height) && height > 0 ? height : null;
  }

  function normalizeActionRequestTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  function normalizeMinLobbySize(value) {
    if (value == null || value === "") {
      return null;
    }
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? Math.min(100, Math.floor(size)) : null;
  }

  function normalizeTeamSize(value) {
    if (value == null || value === "") {
      return null;
    }
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) {
      return null;
    }
    return Math.min(TEAM_SIZE_MAX, Math.max(TEAM_SIZE_MIN, Math.floor(size)));
  }

  function normalizeTeamSizeRange(minValue, maxValue) {
    let minTeamSize = normalizeTeamSize(minValue);
    let maxTeamSize = normalizeTeamSize(maxValue);
    if (minTeamSize != null && maxTeamSize != null && minTeamSize > maxTeamSize) {
      const swap = minTeamSize;
      minTeamSize = maxTeamSize;
      maxTeamSize = swap;
    }
    return { minTeamSize, maxTeamSize };
  }

  function normalizeTeamCountRange(minValue, maxValue) {
    let minTeamCount = normalizeTeamSize(minValue);
    let maxTeamCount = normalizeTeamSize(maxValue);
    if (
      minTeamCount != null &&
      maxTeamCount != null &&
      minTeamCount > maxTeamCount
    ) {
      const swap = minTeamCount;
      minTeamCount = maxTeamCount;
      maxTeamCount = swap;
    }
    return { minTeamCount, maxTeamCount };
  }

  function normalizeSearchStartedAt(rawSettings, ensureActiveSearchTimestamp) {
    if (!rawSettings?.enabled) {
      return null;
    }

    const searchStartedAt = Number(rawSettings.searchStartedAt);
    if (Number.isFinite(searchStartedAt) && searchStartedAt > 0) {
      return searchStartedAt;
    }

    return ensureActiveSearchTimestamp ? Date.now() : null;
  }

  function normalizeForecastSeconds(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  }

  function normalizeForecastProbability(value) {
    const probability = Number(value);
    if (!Number.isFinite(probability)) {
      return null;
    }
    return Math.max(0, Math.min(1, probability));
  }

  function normalizeForecastCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
  }

  function normalizeForecastMilliseconds(value) {
    const milliseconds = Number(value);
    return Number.isFinite(milliseconds) && milliseconds > 0
      ? Math.round(milliseconds)
      : null;
  }

  function normalizeLobbyForecast(value = {}) {
    const source = value || {};
    const averagesSource = source.last100Averages || {};
    return {
      available: Boolean(source.available),
      sampleSize: normalizeForecastCount(source.sampleSize),
      etaMinSeconds: normalizeForecastSeconds(source.etaMinSeconds),
      etaMaxSeconds: normalizeForecastSeconds(source.etaMaxSeconds),
      hitChanceNext10: normalizeForecastProbability(source.hitChanceNext10),
      medianLobbiesToMatch:
        source.medianLobbiesToMatch == null
          ? null
          : Math.max(1, normalizeForecastCount(source.medianLobbiesToMatch)),
      last100Averages: {
        windowSize: 100,
        sampleSize: Math.min(100, normalizeForecastCount(averagesSource.sampleSize)),
        hitRate: normalizeForecastProbability(averagesSource.hitRate),
        avgLobbyIntervalMs: normalizeForecastMilliseconds(
          averagesSource.avgLobbyIntervalMs,
        ),
        avgLobbiesPerMinute:
          averagesSource.avgLobbiesPerMinute == null
            ? null
            : Number.isFinite(Number(averagesSource.avgLobbiesPerMinute))
              ? Math.max(0, Number(averagesSource.avgLobbiesPerMinute))
              : null,
        etaSeconds: normalizeForecastSeconds(averagesSource.etaSeconds),
        updatedAt: normalizeActionRequestTimestamp(averagesSource.updatedAt),
      },
    };
  }

  function normalizeLanguage(value) {
    const language = String(value || "").trim().toLowerCase();
    return /^[a-z]{2}$/.test(language) ? language : DEFAULT_SETTINGS.language;
  }

  function normalizeMapFilters(rawMapFilters = {}, defaultMapFilters = null) {
    const normalizedMapFilters = createDefaultMapFilters();
    for (const id of MAP_IDS) {
      if (id in rawMapFilters) {
        normalizedMapFilters[id] = Boolean(rawMapFilters[id]);
      } else if (defaultMapFilters && id in defaultMapFilters) {
        // Key absent from source (fresh install) → fall back to the configured
        // default so preset maps (e.g. Baikal/Luna) stay selected.
        normalizedMapFilters[id] = Boolean(defaultMapFilters[id]);
      }
    }
    return normalizedMapFilters;
  }

  function normalizeSettings(rawSettings = {}, options = {}) {
    const { ensureActiveSearchTimestamp = false } = options;
    const source = rawSettings || {};
    // Fall back to DEFAULT_SETTINGS for keys absent from `source` (a fresh
    // install passes {}), so configured defaults like team size survive the
    // per-field normalization below. A saved settings object always carries
    // these keys, so existing users keep their own values untouched.
    const pick = (key) => (key in source ? source[key] : DEFAULT_SETTINGS[key]);
    const includeFilters = source.includeFilters || source.filters || {};
    const excludeFilters = source.excludeFilters || source.excludes || {};
    const mapFilters = source.mapFilters || source.maps || {};
    const mapExcludeFilters = source.mapExcludeFilters || source.mapExcludes || {};
    const floatingHelpersPanelPosition = source.floatingHelpersPanelPosition || {};
    const floatingAutoJoinPanelPosition = source.floatingAutoJoinPanelPosition || {};
    const collapsedHelperCategories = source.collapsedHelperCategories || {};
    const { minTeamSize, maxTeamSize } = normalizeTeamSizeRange(
      pick("minTeamSize"),
      pick("maxTeamSize"),
    );
    const { minTeamCount, maxTeamCount } = normalizeTeamCountRange(
      pick("minTeamCount"),
      pick("maxTeamCount"),
    );

    const normalized = {
      ...DEFAULT_SETTINGS,
      ...source,
      searchStartedAt: normalizeSearchStartedAt(
        source,
        ensureActiveSearchTimestamp,
      ),
      minLobbySize: normalizeMinLobbySize(pick("minLobbySize")),
      minTeamSize,
      maxTeamSize,
      minTeamCount,
      maxTeamCount,
      floatingHelpersPanelPosition: normalizeFloatingHelpersPanelPosition(
        floatingHelpersPanelPosition,
      ),
      floatingHelpersPanelHeight: normalizeFloatingHelpersPanelHeight(
        source.floatingHelpersPanelHeight,
      ),
      showFloatingAutoJoinPanel: Boolean(pick("showFloatingAutoJoinPanel")),
      floatingAutoJoinPanelPosition: normalizeFloatingHelpersPanelPosition(
        floatingAutoJoinPanelPosition,
      ),
      floatingAutoJoinPanelHeight: normalizeFloatingHelpersPanelHeight(
        source.floatingAutoJoinPanelHeight,
      ),
      floatingAutoJoinPanelCollapsed: Boolean(source.floatingAutoJoinPanelCollapsed),
      lobbyForecast: normalizeLobbyForecast(source.lobbyForecast),
      collapsedHelperCategories: {
        ...DEFAULT_SETTINGS.collapsedHelperCategories,
        ...collapsedHelperCategories,
      },
      includeFilters: {
        ...DEFAULT_SETTINGS.includeFilters,
        ...includeFilters,
      },
      excludeFilters: {
        ...DEFAULT_SETTINGS.excludeFilters,
        ...excludeFilters,
      },
      mapFilters: normalizeMapFilters(mapFilters, DEFAULT_SETTINGS.mapFilters),
      mapExcludeFilters: normalizeMapFilters(mapExcludeFilters),
    };

    delete normalized.showNukeTargetHeatmap;

    if (normalized.showExportPartnerHeatmap) {
      normalized.showEconomyHeatmap = false;
    }

    normalized.economyHeatmapIntensity = normalizeEconomyHeatmapIntensity(
      normalized.economyHeatmapIntensity,
    );
    normalized.gameTimeAlertThresholdSec = normalizeGameTimeAlertThreshold(
      normalized.gameTimeAlertThresholdSec,
    );
    normalized.language = normalizeLanguage(normalized.language);
    normalized.applySelectiveTradePolicyRequestAt = normalizeActionRequestTimestamp(
      normalized.applySelectiveTradePolicyRequestAt,
    );

    return normalized;
  }

  globalScope.OpenFrontHelperSettings = {
    STORAGE_KEY: "settings",
    WHATS_NEW_NOTICE_KEY: "whatsNewNoticePending",
    MAPS,
    MAP_IDS,
    FILTER_KEYS,
    START_GOLD_FILTER_KEYS,
    DEFAULT_SETTINGS,
    createDefaultMapFilters,
    normalizeSettings,
    normalizeMinLobbySize,
    normalizeTeamSize,
    normalizeLanguage,
    normalizeMapFilters,
    normalizeEconomyHeatmapIntensity,
    normalizeGameTimeAlertThreshold,
    normalizeFloatingHelpersPanelPosition,
    normalizeFloatingHelpersPanelHeight,
    normalizeActionRequestTimestamp,
    getEconomyHeatmapIntensityLabel,
  };
})(globalThis);
