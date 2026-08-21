// Shared content-script state and helper bridge synchronization.

const {
  STORAGE_KEY,
  FILTER_KEYS,
  START_GOLD_FILTER_KEYS,
  MAPS,
  MAP_IDS,
  createDefaultMapFilters,
  normalizeSettings,
  normalizeEconomyHeatmapIntensity,
  getEconomyHeatmapIntensityLabel,
} = globalThis.OpenFrontHelperSettings;
const i18n = globalThis.OpenFrontHelperI18n;

const BRIDGE_SOURCE_PAGE = "openfront-autojoin-page";
const BRIDGE_SOURCE_EXTENSION = "openfront-autojoin-extension";
const FLOATING_HELPERS_PANEL_ID = "openfront-helper-floating-helpers-panel";
const FLOATING_HELPERS_STYLE_ID = "openfront-helper-floating-helpers-styles";
const FLOATING_AUTOJOIN_PANEL_ID = "openfront-helper-floating-autojoin-panel";
const FLOATING_AUTOJOIN_STYLE_ID = "openfront-helper-floating-autojoin-styles";
const JOIN_ATTEMPT_TIMEOUT_MS = 12000;
const LOBBY_RETRY_COOLDOWN_MS = 30000;
// After we stop being "occupied" (public-lobby waiting modal / game-start
// loading / live game), the search stays paused until it has been continuously
// un-occupied for this long. This is a SIGNAL-INDEPENDENT backstop for the brief
// game-start window where none of the DOM "occupied" signals are true yet (the
// waiting modal already closed, in-game class / live URL not set yet): a
// transient false reading can't outlast the grace, so we never fire a spurious
// join into a different lobby while the chosen game is starting. Tune from the
// `[autojoin-diag]` console log's `sinceOccupiedMs` if a real loading screen ever
// exceeds it.
const RESUME_GRACE_MS = 6000;
// Bump on any auto-join logic change. Printed in the `[autojoin-diag]` log so a
// single reproduction proves the running userscript is the freshly-built one —
// rules out "fix still fails" actually being a stale Tampermonkey install.
const AUTOJOIN_DIAG_BUILD = "aj-debounce-v1";
const PREFERRED_GROUP_ORDER = ["special", "ffa", "team"];

const lobbyCooldowns = new Map();

let settings = normalizeSettings();
let latestLobbySnapshot = null;
let pendingJoin = null;
// "Keep searching after joining": searching is paused whenever we're "occupied"
// (in the public-lobby waiting modal OR in an active game) and resumes when we
// return to the menu — whether the game ended or the user backed out of the
// lobby. wasOccupied tracks the previous tick to detect that return edge.
let wasOccupied = false;
// Timestamp (ms) we last OBSERVED an "occupied" state, and when we last fired a
// join request. Drive the resume/join debounce (RESUME_GRACE_MS) and the
// `[autojoin-diag]` log; 0 means "never yet" so cold-start searching isn't
// delayed.
let lastOccupiedAt = 0;
let lastJoinRequestedAt = 0;
let joinAlertAudio = null;
let customJoinAlertAudio = null;
let hasCustomNotificationSound = false;
let customNotificationSoundData = null;
let lastProcessedSelectiveTradePolicyRequestAt = null;
let selectiveTradePolicyAvailable = false;
let cheatsAvailable = false;
let translations = i18n?.DEFAULT_TRANSLATIONS || {};

// Shared settings, defaults, and filter normalization live in `shared/settings.js`
// so popup and content stay in sync.

function t(key) {
  return i18n?.getMessage(translations, key) || key;
}

async function loadContentTranslations() {
  if (!i18n) {
    return;
  }
  translations = await i18n.loadBundle(settings.language);
}

// Helper bridge sync -------------------------------------------------------
function syncBotNationMarkers() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "MARK_BOT_NATIONS_RED",
      payload: {
        enabled: Boolean(settings.markBotNationsRed),
      },
    },
    "*",
  );
}

function syncGoldPerMinuteHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_GOLD_PER_MINUTE",
      payload: {
        enabled: Boolean(settings.showGoldPerMinute),
      },
    },
    "*",
  );
}

function syncCompanionHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_COMPANION",
      payload: {
        panel: Boolean(settings.showCompanionPanel),
        enabled: Boolean(settings.companionEnabled),
      },
    },
    "*",
  );
}

function syncTopGoldPerMinuteHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_TOP_GOLD_PER_MINUTE",
      payload: {
        enabled: Boolean(settings.showTopGoldPerMinute),
      },
    },
    "*",
  );
}

function syncTeamBuildStatsHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_TEAM_BUILD_STATS",
      payload: {
        enabled: Boolean(settings.showTeamBuildStats),
      },
    },
    "*",
  );
}

function syncHoveredAlliesHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "MARK_HOVERED_ALLIES_GREEN",
      payload: {
        enabled: Boolean(settings.markHoveredAlliesGreen),
      },
    },
    "*",
  );
}

function syncAllianceRequestsPanelHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ALLIANCE_REQUESTS_PANEL",
      payload: {
        enabled: Boolean(settings.showAllianceRequestsPanel),
      },
    },
    "*",
  );
}

function syncTradeBalancesHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_TRADE_BALANCES",
      payload: {
        enabled: Boolean(settings.showTradeBalances),
      },
    },
    "*",
  );
}


function syncHelperUsersHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_HELPER_USERS",
      payload: {
        enabled: Boolean(settings.showHelperUsers),
      },
    },
    "*",
  );
}

function syncSosDefenseHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_SOS_DEFENSE",
      payload: {
        enabled: Boolean(settings.sosDefense),
      },
    },
    "*",
  );
}

function syncNukePredictionHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_NUKE_PREDICTION",
      payload: {
        enabled: Boolean(settings.showNukePrediction),
        trajectory: Boolean(settings.showNukeTrajectory),
      },
    },
    "*",
  );
}

function syncGameTimeAlertHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_GAME_TIME_ALERT",
      payload: {
        enabled: Boolean(settings.showGameTimeAlert),
        thresholdSec: Number(settings.gameTimeAlertThresholdSec) || 300,
      },
    },
    "*",
  );
}

function syncPlayerMapOverlaysHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_PLAYER_MAP_OVERLAYS",
      payload: {
        enabled: Boolean(settings.showPlayerMapOverlays),
      },
    },
    "*",
  );
}

function syncMapTroopCountsHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_MAP_TROOP_COUNTS",
      payload: {
        enabled: Boolean(settings.showMapTroopCounts),
      },
    },
    "*",
  );
}

function syncThreatIndicatorsHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_THREAT_INDICATORS",
      payload: {
        enabled: Boolean(settings.showThreatIndicators),
      },
    },
    "*",
  );
}

function syncMapMoneyHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_MAP_MONEY",
      payload: {
        enabled: Boolean(settings.showMapMoney),
      },
    },
    "*",
  );
}

function syncAttackHighlightHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ATTACK_HIGHLIGHT",
      payload: {
        enabled: Boolean(settings.showAttackHighlight),
      },
    },
    "*",
  );
}

function syncAdvisorPanelHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ADVISOR_PANEL",
      payload: {
        enabled: Boolean(settings.showAdvisorPanel),
      },
    },
    "*",
  );
}

function syncRetaliationHudHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_RETALIATION_HUD",
      payload: {
        enabled: Boolean(settings.showRetaliationHud),
      },
    },
    "*",
  );
}

function syncHideAdsHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_HIDE_ADS",
      payload: {
        enabled: Boolean(settings.hideAds),
      },
    },
    "*",
  );
}

function syncAntiAfkHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_ANTI_AFK",
      payload: {
        enabled: Boolean(settings.antiAfk),
      },
    },
    "*",
  );
}

function syncAttackRatioHotkeyHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_ATTACK_RATIO_HOTKEY",
      payload: {
        enabled: Boolean(settings.attackRatioHotkey),
      },
    },
    "*",
  );
}

function syncRightClickConquestHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_RIGHT_CLICK_CONQUEST",
      payload: {
        enabled: Boolean(settings.rightClickConquest),
      },
    },
    "*",
  );
}

function syncRoundLoggerHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_ROUND_LOGGER",
      payload: {
        enabled: Boolean(settings.roundLogger),
      },
    },
    "*",
  );
}

function syncNetworkLoggerHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_NETWORK_LOGGER",
      payload: {
        enabled: Boolean(settings.networkLogger),
      },
    },
    "*",
  );
}

function syncBuildTimersHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_BUILD_TIMERS",
      payload: {
        enabled: Boolean(settings.showBuildTimers),
      },
    },
    "*",
  );
}

function syncEnemyIntentHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ENEMY_INTENT",
      payload: {
        enabled: Boolean(settings.showEnemyIntent),
      },
    },
    "*",
  );
}

function syncSpawnHeatmapHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_SPAWN_HEATMAP",
      payload: {
        enabled: Boolean(settings.showSpawnHeatmap),
      },
    },
    "*",
  );
}

function syncSpawnMarkersHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_SPAWN_MARKERS",
      payload: {
        enabled: Boolean(settings.showSpawnMarkers),
      },
    },
    "*",
  );
}

function syncBoatPredictionHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_BOAT_PREDICTION",
      payload: {
        enabled: Boolean(settings.showBoatPrediction),
        alwaysOwnRoutes: Boolean(settings.alwaysShowOwnBoatRoutes),
        alwaysTeamRoutes: Boolean(settings.alwaysShowTeamBoatRoutes),
        alwaysAllyRoutes: Boolean(settings.alwaysShowAllyBoatRoutes),
        alwaysEnemyRoutes: Boolean(settings.alwaysShowEnemyBoatRoutes),
      },
    },
    "*",
  );
}

function syncWarshipRoutesHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_WARSHIP_ROUTES",
      payload: {
        enabled: Boolean(settings.showWarshipRoutes),
        own: Boolean(settings.showWarshipRoutesOwn),
        team: Boolean(settings.showWarshipRoutesTeam),
        ally: Boolean(settings.showWarshipRoutesAlly),
        enemy: Boolean(settings.showWarshipRoutesEnemy),
      },
    },
    "*",
  );
}

function syncBoatIncomingWarningHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_BOAT_INCOMING_WARNING",
      payload: {
        enabled: Boolean(settings.warnIncomingBoats),
      },
    },
    "*",
  );
}

function syncEstatePanelHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ESTATE_PANEL",
      payload: {
        enabled: Boolean(settings.showEstatePanel),
      },
    },
    "*",
  );
}

function syncAutoLeaveOnTeamWinHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_AUTO_LEAVE_ON_TEAM_WIN",
      payload: {
        enabled: Boolean(settings.autoLeaveOnTeamWin),
      },
    },
    "*",
  );
}

function syncNukeSuggestionsHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_NUKE_SUGGESTIONS",
      payload: {
        enabled: Boolean(settings.showNukeSuggestions && cheatsAvailable),
      },
    },
    "*",
  );
}

function syncAutoNukeHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_AUTO_NUKE",
      payload: {
        enabled: Boolean(settings.autoNuke && cheatsAvailable),
        includeAllies: Boolean(settings.autoNukeIncludeAllies),
      },
    },
    "*",
  );
}

function syncSend1PercentBoatHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_SEND_1_PERCENT_BOAT",
      payload: {
        enabled: Boolean(settings.send1PercentBoat),
        contextMenu: settings.send1PercentBoatContextMenu !== false,
      },
    },
    "*",
  );
}

function syncEconomyHeatmapHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_ECONOMY_HEATMAP",
      payload: {
        enabled: Boolean(settings.showEconomyHeatmap),
        intensity: settings.economyHeatmapIntensity,
      },
    },
    "*",
  );
}

function syncExportPartnerHeatmapHelper() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_EXPORT_PARTNER_HEATMAP",
      payload: {
        enabled: Boolean(settings.showExportPartnerHeatmap),
      },
    },
    "*",
  );
}

function syncQuickPanelHelper() {
  // Only sync if showQuickPanel is explicitly set — don't auto-hide on first load
  if (settings.showQuickPanel == null) return;
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SHOW_QUICK_PANEL",
      payload: {
        enabled: Boolean(settings.showQuickPanel),
      },
    },
    "*",
  );
}

function syncQuickPanelSettings() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SYNC_QUICK_PANEL_SETTINGS",
      payload: {
        settings: settings,
      },
    },
    "*",
  );
}

// Listen for setting changes from the Quick Panel (page context).
window.addEventListener("ofh-quick-panel-setting", function(e) {
  if (!e.detail || !e.detail.key) return;
  var key = e.detail.key;
  var value = e.detail.value;
  // Guard: skip if value unchanged (prevents feedback loop from panel self-close).
  if (key in settings && settings[key] === value) return;
  if (key.indexOf("collapsedHelperCategories.") === 0) {
    var catKey = key.split(".")[1];
    settings.collapsedHelperCategories = settings.collapsedHelperCategories || {};
    settings.collapsedHelperCategories[catKey] = value;
  } else if (key in settings) {
    settings[key] = value;
  }
  settings = normalizeSettings(settings);

  if (key === "language") {
    var newLang = value;
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(function(err) {
      console.error("Quick Panel language persist failed:", err);
    });
    if (i18n) {
      i18n.loadBundle(newLang).then(function(bundle) {
        translations = bundle;
        window.postMessage({
          source: BRIDGE_SOURCE_EXTENSION,
          type: "SET_AUTO_BOT_I18N",
          payload: { language: newLang, bundle: bundle },
        }, "*");
        window.postMessage({
          source: BRIDGE_SOURCE_EXTENSION,
          type: "RELOCALIZE_PANELS",
          payload: {},
        }, "*");
        syncQuickPanelSettings();
        var ajPanel = document.getElementById(FLOATING_AUTOJOIN_PANEL_ID);
        if (ajPanel) ajPanel.remove();
        syncFloatingAutoJoinPanel();
      }).catch(function(err) {
        console.error("i18n loadBundle failed:", err);
      });
    }
  } else {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(function(err) {
      console.error("Quick Panel setting persist failed:", err);
    });
    syncHelpers();
    if (key === "showFloatingAutoJoinPanel") {
      syncFloatingAutoJoinPanel();
      syncQuickPanelSettings();
    }
    if (key === "showAutoBotPanel") {
      syncQuickPanelSettings();
    }
    if (key === "showCompanionPanel" || key === "companionEnabled") {
      syncQuickPanelSettings();
    }
  }
});


// The auto-bot runs in the page context and can't load locale bundles itself,
// so we forward the bundle for the current language. Posted unconditionally
// (like every other helper sync) so the post-injection syncHelpers() reliably
// delivers it once the bridge is listening; the page side only rebuilds its
// panel when the language actually changes, so repeated posts are cheap no-ops.
function syncAutoBotI18n() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_AUTO_BOT_I18N",
      payload: {
        language: settings.language,
        bundle: translations,
      },
    },
    "*",
  );
}

function syncSelectiveTradePolicyToggle() {
  window.postMessage(
    {
      source: BRIDGE_SOURCE_EXTENSION,
      type: "SET_SELECTIVE_TRADE_POLICY",
      payload: {
        enabled: Boolean(settings.selectiveTradePolicyEnabled),
      },
    },
    "*",
  );
}

function updateAutoCancelDeniedTradesAvailability(available) {
  const nextAvailable = Boolean(available);
  const availabilityChanged =
    nextAvailable !== selectiveTradePolicyAvailable ||
    nextAvailable !== Boolean(settings.autoCancelDeniedTradesAvailable);

  selectiveTradePolicyAvailable = nextAvailable;

  if (availabilityChanged) {
    saveSettings({
      ...settings,
      autoCancelDeniedTradesAvailable: nextAvailable,
      selectiveTradePolicyEnabled:
        settings.selectiveTradePolicyEnabled && nextAvailable,
    }).catch((error) => {
      console.error("Failed to sync denied trade cancellation availability:", error);
    });
  }

  syncFloatingHelpersPanel();
  syncFloatingAutoJoinPanel();
}

function updateCheatsAvailability(available) {
  // Force-enabled for multiplayer testing — nuke suggestion / auto nuke gate
  // on this flag, and public lobbies report cheats unavailable.
  // Original: const nextAvailable = Boolean(available);
  void available;
  const nextAvailable = true;
  const availabilityChanged =
    nextAvailable !== cheatsAvailable ||
    nextAvailable !== Boolean(settings.cheatsAvailable);

  cheatsAvailable = nextAvailable;

  if (availabilityChanged) {
    saveSettings({
      ...settings,
      cheatsAvailable: nextAvailable,
    }).catch((error) => {
      console.error("Failed to sync cheats availability:", error);
    });
  }

  syncHelpers();
}

function syncHelpers() {
  syncBotNationMarkers();
  syncGoldPerMinuteHelper();
  syncTopGoldPerMinuteHelper();
  syncTeamBuildStatsHelper();
  syncHoveredAlliesHelper();
  syncAllianceRequestsPanelHelper();
  syncTradeBalancesHelper();
  syncHelperUsersHelper();
  syncSosDefenseHelper();
  syncGameTimeAlertHelper();
  syncPlayerMapOverlaysHelper();
  syncMapTroopCountsHelper();
  syncThreatIndicatorsHelper();
  syncMapMoneyHelper();
  syncAttackHighlightHelper();
  syncAdvisorPanelHelper();
  syncRetaliationHudHelper();
  syncHideAdsHelper();
  syncAntiAfkHelper();
  syncAttackRatioHotkeyHelper();
  syncRightClickConquestHelper();
  syncRoundLoggerHelper();
  syncNetworkLoggerHelper();
  syncBuildTimersHelper();
  syncEnemyIntentHelper();
  syncSpawnHeatmapHelper();
  syncSpawnMarkersHelper();
  syncSelectiveTradePolicyToggle();
  syncAutoBotI18n();
  syncNukePredictionHelper();
  syncBoatPredictionHelper();
  syncWarshipRoutesHelper();
  syncBoatIncomingWarningHelper();
  syncEstatePanelHelper();
  syncAutoLeaveOnTeamWinHelper();
  syncNukeSuggestionsHelper();
  syncAutoNukeHelper();
  syncSend1PercentBoatHelper();
  syncEconomyHeatmapHelper();
  syncExportPartnerHeatmapHelper();
  syncQuickPanelHelper();
  syncCompanionHelper();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  settings = normalizeSettings(stored[STORAGE_KEY]);
  await loadContentTranslations();
  selectiveTradePolicyAvailable = Boolean(settings.autoCancelDeniedTradesAvailable);
  // Match updateCheatsAvailability override so cold-start UI sees cheats on.
  cheatsAvailable = true;
  console.info("[openfront-helper] cheats override active");
  // Persist so the popup-ui (which reads settings.cheatsAvailable from
  // chrome.storage) sees the override even before the page-bridge sends its
  // first CHEATS_AVAILABILITY message.
  if (settings.cheatsAvailable !== true) {
    settings.cheatsAvailable = true;
    chrome.storage.local
      .set({ [STORAGE_KEY]: settings })
      .catch((error) => console.error("Failed to persist cheats override:", error));
  }
  lastProcessedSelectiveTradePolicyRequestAt =
    settings.applySelectiveTradePolicyRequestAt;
  syncHelpers();
  syncQuickPanelSettings();
  syncFloatingHelpersPanel();
  syncFloatingAutoJoinPanel();
}

async function saveSettings(nextSettings) {
  settings = normalizeSettings(nextSettings);
  await chrome.storage.local.set({
    [STORAGE_KEY]: settings,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPENFRONT_HELPER_PING") {
    sendResponse({
      ok: true,
      source: "openfront-helper-content",
    });
  }
});
