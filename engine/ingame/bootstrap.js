// Final message routing and bridge startup.

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) {
      return;
    }

    if (data.type === "JOIN_PUBLIC_LOBBY" && data.payload?.gameID) {
      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: data.payload.gameID,
            source: "public",
            publicLobbyInfo: data.payload.publicLobbyInfo,
          },
          bubbles: true,
          composed: true,
        }),
      );
    }

    if (data.type === "SHOW_PLAYER_MAP_OVERLAYS") {
      setPlayerMapOverlaysEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_MAP_TROOP_COUNTS") {
      setMapTroopCountsEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_THREAT_INDICATORS") {
      setThreatIndicatorsEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_MAP_MONEY") {
      setMapMoneyEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_ATTACK_HIGHLIGHT") {
      setAttackHighlightEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_RETALIATION_HUD") {
      setRetaliationEnabled(data.payload?.enabled);
    }

    if (data.type === "SET_ANTI_AFK") {
      setAntiAfkEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_BUILD_TIMERS") {
      setBuildTimerEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_SPAWN_HEATMAP") {
      setSpawnHeatmapEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_SPAWN_MARKERS") {
      setSpawnMarkersEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_NUKE_PREDICTION") {
      setNukePredictionEnabled(data.payload?.enabled);
      // The trajectory line is a sub-toggle on the shared map-overlay scheduler.
      setNukeTrajectoryEnabled(data.payload?.trajectory);
      requestMapOverlayLoop();
    }

    if (data.type === "SHOW_BOAT_PREDICTION") {
      setBoatPredictionEnabled(data.payload?.enabled, {
        alwaysOwnRoutes: data.payload?.alwaysOwnRoutes,
        alwaysTeamRoutes: data.payload?.alwaysTeamRoutes,
        alwaysAllyRoutes: data.payload?.alwaysAllyRoutes,
        alwaysEnemyRoutes: data.payload?.alwaysEnemyRoutes,
      });
    }

    if (data.type === "SHOW_WARSHIP_ROUTES") {
      setWarshipRoutesEnabled(data.payload?.enabled, {
        own: data.payload?.own,
        team: data.payload?.team,
        ally: data.payload?.ally,
        enemy: data.payload?.enemy,
      });
    }

    if (data.type === "SHOW_BOAT_PANEL") {
      setBoatPanelEnabled(data.payload?.enabled);
    }

    if (data.type === "SET_BOAT_INCOMING_WARNING") {
      setBoatIncomingWarningEnabled(data.payload?.enabled);
    }

    if (data.type === "SET_AUTO_LEAVE_ON_TEAM_WIN") {
      setAutoLeaveOnTeamWinEnabled(data.payload?.enabled);
    }


    if (data.type === "APPLY_SELECTIVE_TRADE_POLICY") {
      const requestedAt = Number(data.payload?.requestedAt);
      if (Number.isFinite(requestedAt) && requestedAt !== lastSelectiveTradePolicyRequestAt) {
        lastSelectiveTradePolicyRequestAt = requestedAt;
        applySelectiveTradePolicy();
      }
    }

    if (data.type === "SET_SELECTIVE_TRADE_POLICY") {
      setSelectiveTradePolicyEnabled(Boolean(data.payload?.enabled));
    }

    if (data.type === "SET_AUTO_BOT_I18N") {
      if (typeof setAutoBotI18n === "function") {
        setAutoBotI18n(data.payload?.language, data.payload?.bundle);
      }
    }

    if (data.type === "SHOW_QUICK_PANEL") {
      if (typeof setQuickPanelEnabled === "function") {
        setQuickPanelEnabled(data.payload?.enabled);
      }
    }

    if (data.type === "SYNC_QUICK_PANEL_SETTINGS") {
      if (typeof setQuickPanelSettings === "function") {
        setQuickPanelSettings(data.payload?.settings);
      }
    }

    if (data.type === "RELOCALIZE_PANELS") {
      // Language changed — rebuild all visible panels so static text
      // (set once during creation) picks up the new tr() translations.
      _relocalizeAllPanels();
    }
  });

  window.setInterval(() => {
    refreshSelectiveTradePolicyAvailability();
    refreshCheatsAvailability();
  }, 1000);
  refreshSelectiveTradePolicyAvailability();
  refreshCheatsAvailability();

  // Rebuild all visible panels so static text (set once during creation) picks
  // up the new tr() translations after a language change. Each panel setter
  // must remove-and-recreate when called with true while already enabled.
  function _relocalizeAllPanels() {
    // For each panel: disable first (remove), then re-enable (recreate).
    // Auto-bot is handled by setAutoBotI18n already.
    var panels = [
      { enabled: function() { return typeof advisorPanelEnabled !== "undefined" && advisorPanelEnabled; }, set: function(v) { if (typeof setAdvisorPanelEnabled === "function") setAdvisorPanelEnabled(v); } },
      { enabled: function() { return typeof goldPerMinuteEnabled !== "undefined" && goldPerMinuteEnabled; }, set: function(v) { if (typeof setGoldPerMinuteEnabled === "function") setGoldPerMinuteEnabled(v); } },
      { enabled: function() { return typeof topGoldPerMinuteEnabled !== "undefined" && topGoldPerMinuteEnabled; }, set: function(v) { if (typeof setTopGoldPerMinuteEnabled === "function") setTopGoldPerMinuteEnabled(v); } },
      { enabled: function() { return typeof teamGoldPerMinuteEnabled !== "undefined" && teamGoldPerMinuteEnabled; }, set: function(v) { if (typeof setTeamBuildStatsEnabled === "function") setTeamBuildStatsEnabled(v); } },
      { enabled: function() { return typeof tradeBalancesEnabled !== "undefined" && tradeBalancesEnabled; }, set: function(v) { if (typeof setTradeBalancesEnabled === "function") setTradeBalancesEnabled(v); } },
      { enabled: function() { return typeof boatPanelOpen !== "undefined" && boatPanelOpen; }, set: function(v) { if (typeof setBoatPanelEnabled === "function") setBoatPanelEnabled(v); } },
      { enabled: function() { return typeof allianceRequestsPanelEnabled !== "undefined" && allianceRequestsPanelEnabled; }, set: function(v) { if (typeof setAllianceRequestsPanelEnabled === "function") setAllianceRequestsPanelEnabled(v); } },
      { enabled: function() { return typeof allyMarkersEnabled !== "undefined" && allyMarkersEnabled; }, set: function(v) { if (typeof setAllyMarkersEnabled === "function") setAllyMarkersEnabled(v); } },
      { enabled: function() { return typeof buildTimerEnabled !== "undefined" && buildTimerEnabled; }, set: function(v) { if (typeof setBuildTimerEnabled === "function") setBuildTimerEnabled(v); } },
      { enabled: function() { return typeof retaliationEnabled !== "undefined" && retaliationEnabled; }, set: function(v) { if (typeof setRetaliationEnabled === "function") setRetaliationEnabled(v); } },
    ];
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p.enabled()) {
        p.set(false);
        p.set(true);
      }
    }
  }

  window.__openfrontAutoJoinBridgeReady = true;
