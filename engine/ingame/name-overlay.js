// Per-player on-map overlay — a single layer on the shared map-overlay scheduler
// that draws, above each living player's name:
//   • a troop RATIO BAR (home = relation color, attacking = orange, bg = max)
//     plus the /10 troop count            — toggle: showMapTroopCounts
//   • threat marks: ☢ nuke-capable icon,  — toggle: showThreatIndicators
//     red "stronger than you" dot, amber "weak" dot (enemies only)
//   • gold readout                        — toggle: showMapMoney
// Colored by relation (blue=you, teal=team, green=ally, red=enemy). One scan
// (throttled) feeds everything; the per-frame draw maps nameLocation → screen.
//
// IMPORTANT: OpenFront stores troops at 10x internally and the UI renders /10
// (see gold-per-minute.js renderTroops). Ratios (troops/max) are scale-invariant,
// but any DISPLAYED absolute troop number must be divided by 10.

  function formatMapTroops(value) {
    const v = Math.max(0, Math.floor(Number(value) || 0));
    if (v >= 1e6) {
      return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
    }
    if (v >= 1e3) {
      return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
    }
    return String(v);
  }

  // Display helper: raw internal troops (10x) → shown value.
  function troopsDisplay(rawTroops) {
    return formatMapTroops((Number(rawTroops) || 0) / 10);
  }

  function formatMapGold(value) {
    const v = Math.max(0, Math.floor(Number(value) || 0));
    if (v >= 1e6) {
      return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
    }
    if (v >= 1e3) {
      return `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
    }
    return `$${v}`;
  }

  function playerOverlayEnabled() {
    return (
      playerMapOverlaysEnabled &&
      (mapTroopCountsEnabled || threatIndicatorsEnabled || mapMoneyEnabled)
    );
  }

  // Scan cache: [{ player, relation, isEnemy, troops, maxTroops, gold, threat }].
  // troops/maxTroops are RAW (10x); divide by 10 only when displaying.
  let _playerOverlayScan = [];

  function scanPlayerOverlay(game) {
    // Skip overlay during spawn phase — many players crowd the screen and
    // overlays add cost with little value. Uses the game's own spawn-phase
    // detection (game.inSpawnPhase()) instead of heuristics.
    try {
      if (game?.inSpawnPhase?.()) {
        _playerOverlayScan = [];
        return;
      }
    } catch (_error) { /* ignore */ }

    const players = getCachedPlayerViews(game);
    const me = game.myPlayer ? game.myPlayer() : null;
    const nukeBuilders = threatIndicatorsEnabled ? advNukeBuilderIds(game) : null;
    // maxTroops feeds the "/max" pill and the threat indicators. inCombat used to feed the
    // troop bar's "attacking" segment and has no reader now that the bar is gone, so the
    // per-player advTroopsInCombat() call goes with it.
    const needMaxTroops = mapTroopCountsEnabled;
    const out = [];
    for (let i = 0; i < players.length; i += 1) {
      const player = players[i];
      if (!player || !player.isAlive || !player.isAlive()) {
        continue;
      }
      let relation = "enemy";
      try {
        relation = getPlayerRelationToMyPlayer(game, player) || "enemy";
      } catch (_error) {
        relation = "enemy";
      }
      const isEnemy =
        relation !== "self" && relation !== "ally" && relation !== "team";
      const troops = advTroops(player);

      // Skip regular bots for troop bar + money overlays (too many early game).
      // Keep for human players AND nation AI (isNationBotPlayer).
      // PlayerType.Bot = "BOT" (portutil.js:28).
      const isRegularBot =
        isEnemy &&
        typeof isNationBotPlayer === "function" &&
        !isNationBotPlayer(player) &&
        player.type && player.type() === "BOT";

      const entry = {
        player,
        relation,
        isEnemy,
        troops,
        skipOverlay: isRegularBot,
        maxTroops: (needMaxTroops || threatIndicatorsEnabled) && !isRegularBot ? advMaxTroops(game, player) : 0,
        gold: (mapMoneyEnabled && !isRegularBot) ? advGoldNumber(player) : 0,
        threat: null,
      };
      if (threatIndicatorsEnabled && isEnemy && me) {
        try {
          entry.threat = advEvaluateThreat(game, me, player, nukeBuilders);
        } catch (_error) {
          entry.threat = null;
        }
      }
      out.push(entry);
    }
    _playerOverlayScan = out;
  }

  // Money readout with a dark rounded-pill background (Tactical-style), centered
  // above the player's name. Bigger + a coin icon so it reads clearly on the map.
  // Dynamic font sizing (Blon-inspired): scale money/troop bar with camera zoom
  // so overlays stay readable. Cull when the screen-space size drops below 5px.
  var _DYN_FONT_BASE = 36;
  var _DYN_FONT_SCALE = 48;
  var _DYN_SIZE_FACTOR = 0.4;
  var _DYN_NAME_SCALE_FACTOR = 0.25;
  var _DYN_SCALE_CAP = 3;
  var _DYN_MONEY_SIZE_MUL = 0.46;
  // Keep this LOW. Everything a player shows — money pill, troop bar, threat marks — is
  // behind the single `if (!dyn.visible) continue;` gate, so raising this hides all of it
  // at once. It was briefly 14 on the theory that fewer legible labels beat many illegible
  // ones; that hid every player with loc.size <= 10 at default zoom (and even size-16 names
  // when zoomed out), i.e. most of the map. Not a tuning question — 5 is the shipped floor.
  var _DYN_MIN_SCREEN_PX = 5;

  /** Extra cull padding for everything drawn above the name anchor. */
  function _dynPadFor(loc, transform) {
    try {
      var d = _getDynamicSizes(loc, transform);
      return d && Number.isFinite(d.moneyOffsetY) ? d.moneyOffsetY + 12 : 0;
    } catch (_e) {
      return 0;
    }
  }

  function _getDynamicSizes(loc, transform) {
    var baseSize = Math.max(1, Math.floor(loc.size || 16));
    var nameScale = Math.min(baseSize * _DYN_NAME_SCALE_FACTOR, _DYN_SCALE_CAP);
    var nameWorldSize = Math.max(4, Math.floor(baseSize * _DYN_SIZE_FACTOR));
    var lineH_world = _DYN_FONT_BASE * (nameWorldSize * nameScale / _DYN_FONT_SCALE);
    var cameraScale = Number(transform.scale) || 1.8;
    var nameScreenPx = lineH_world * cameraScale;
    // The CEILING is the real fix here: there was none, so at high zoom the pill grew
    // without bound. The floor stays at src's 6 — raising it to the type scale's 11 makes
    // a small player's chip bigger than the name it belongs to, and pushing the
    // visibility gate up to compensate hid most of the map.
    var _sizeMax = OFH_OVERLAY_STYLE && OFH_OVERLAY_STYLE.sizeMax ? OFH_OVERLAY_STYLE.sizeMax : 18;
    var moneyFontSize = Math.max(
      6,
      Math.min(_sizeMax, Math.floor(nameScreenPx * _DYN_MONEY_SIZE_MUL)),
    );

    // Tighter spacing: money pill closer to troop bar.
    var moneyOffsetY = Math.max(10, Math.floor(nameScreenPx * 0.9));

    // Fade background when zoomed close to see the map.
    var zoomFade = nameScreenPx > 30 ? Math.max(0.4, 1.0 - (nameScreenPx - 30) / 80) : 1.0;
    // The pill carries no alpha of its own — drawMapLabel owns that and applies one factor
    // to fill, outline AND text.
    return {
      moneyFontSize: moneyFontSize,
      moneyOffsetY: moneyOffsetY,
      visible: nameScreenPx >= _DYN_MIN_SCREEN_PX,
      screenPx: nameScreenPx,
    };
  }

  // ── The three pills below are now thin wrappers over the shared map label. They keep
  //    their names because the draw loop calls them by name. What they used to be: three
  //    near-identical 20-line copies, each restating the font string, the padding, the
  //    radius 4, the shadow and the +0.5 baseline nudge — and each setting ctx.shadowColor
  //    for the BOX and then clearing it before drawing the TEXT, so the money numbers had
  //    no legibility treatment at all over bright terrain. `accent` is the faction colour,
  //    used for the outline so a teammate's pill reads differently from an enemy's at a
  //    glance; the money itself stays amber so "gold" remains recognisable.
  var MONEY_COLOR = "rgba(252, 211, 77, 0.98)";
  var MAXTROOP_COLOR = "rgba(95, 178, 255, 0.98)";

  function drawMoneyPill(ctx, cx, cy, text, dyn, accent) {
    return drawMapLabel(ctx, cx, cy, text, MONEY_COLOR, {
      size: dyn.moneyFontSize,
      segments: [{ text: text, color: MONEY_COLOR }],
      outlineColor: accent,
    });
  }

  function drawMaxTroopPill(ctx, cx, cy, maxTroops, dyn, accent) {
    // Keep the "/" — without it a lone "48k" reads as CURRENT troops rather than the
    // maximum. It used to come from the combined pill's "/max" segment, and removing the
    // troop bar took the prefix with it.
    var label = "/" + troopsDisplay(maxTroops);
    return drawMapLabel(ctx, cx, cy, label, MAXTROOP_COLOR, {
      size: dyn.moneyFontSize,
      segments: [{ text: label, color: MAXTROOP_COLOR }],
      outlineColor: accent,
    });
  }

  // Money + max troops on one line. The two-colour split is a `segments` list now; it
  // used to be laid out by measuring the literal two-space string in "money  /max" and
  // using that as the gap.
  function drawMoneyTroopPill(ctx, cx, cy, moneyText, maxTroops, dyn, accent) {
    return drawMapLabel(ctx, cx, cy, null, MONEY_COLOR, {
      size: dyn.moneyFontSize,
      segments: [
        { text: moneyText, color: MONEY_COLOR },
        { text: "/" + troopsDisplay(maxTroops), color: MAXTROOP_COLOR },
      ],
      outlineColor: accent,
    });
  }

  // Small rounded-rect helper (background + optional border).
  function fillRoundRect(ctx, x, y, w, h, r, bg, border) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    if (border) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = border;
      ctx.stroke();
    }
  }

  // Troop ratio bar — 1:1 with Tactical Assistant name-overlay (lines 7942-7969).
  // home troops = green (fixed, NOT faction color), attacking = orange, total bar
  // length = total/max. The "/max" label is drawn as its own pill on the line
  // above (drawMoneyTroopPill or drawMaxTroopPill), never on the bar itself.
  function drawPlayerOverlay(ctx, game, transform) {
    const me = game.myPlayer ? game.myPlayer() : null;
    let myTroops = 1;
    try {
      myTroops = Math.max(1, Number(me && me.troops ? me.troops() : 1) || 1);
    } catch (_error) {
      myTroops = 1;
    }

    for (let i = 0; i < _playerOverlayScan.length; i += 1) {
      const entry = _playerOverlayScan[i];
      const player = entry.player;
      let loc = null;
      try {
        loc = player.nameLocation ? player.nameLocation() : null;
      } catch (_error) {
        loc = null;
      }
      if (!loc) {
        continue;
      }
      var p = mapWorldToScreen(transform, loc.x, loc.y);
      // Pad has to cover what we draw ABOVE the anchor: the pill sits up to
      // ~0.9 * nameScreenPx higher (moneyOffsetY), so a flat 30 made pills pop in and out
      // at the top edge of the screen when zoomed in.
      if (!p || !mapPointOnScreen(p.x, p.y, 30 + Math.max(0, _dynPadFor(loc, transform)))) {
        continue;
      }
      var dyn = _getDynamicSizes(loc, transform);
      if (!dyn.visible) {
        continue;
      }
      var color = mapFactionColor(entry.relation);

      if (!entry.skipOverlay) {
        if (mapMoneyEnabled && mapTroopCountsEnabled) {
          // Money and /max on one line.
          drawMoneyTroopPill(ctx, p.x, p.y - dyn.moneyOffsetY, formatMapGold(entry.gold), entry.maxTroops, dyn, color);
        } else if (mapMoneyEnabled) {
          drawMoneyPill(ctx, p.x, p.y - dyn.moneyOffsetY, formatMapGold(entry.gold), dyn, color);
        } else if (mapTroopCountsEnabled) {
          drawMaxTroopPill(ctx, p.x, p.y - dyn.moneyOffsetY, entry.maxTroops, dyn, color);
        }
      }

      if (threatIndicatorsEnabled && entry.isEnemy && !entry.skipOverlay) {
        drawThreatMarks(ctx, p.x, p.y + 10, entry, myTroops);
      }
    }
  }

  function drawThreatMarks(ctx, x, baseY, entry, myTroops) {
    const threat = entry.threat;
    const troops = entry.troops;
    if (threat && (threat.nukeCapable || threat.buildingNuke)) {
      drawMapHaloText(ctx, x - 30, baseY, "☢", "rgba(248, 113, 113, 0.95)");
    }
    // Ratios are scale-invariant → compare raw values directly.
    let dot = null;
    if (troops >= 1.35 * myTroops) {
      dot = "rgba(248, 113, 113, 0.95)"; // stronger than you
    } else if (entry.maxTroops > 0 && troops <= 0.1 * entry.maxTroops) {
      dot = "rgba(251, 191, 36, 0.95)"; // weak
    }
    if (dot) {
      ctx.beginPath();
      ctx.arc(x + 30, baseY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = dot;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      ctx.stroke();
    }
  }

  registerMapOverlayLayer({
    id: "player-overlay",
    scanIntervalMs: 500,
    isEnabled: playerOverlayEnabled,
    scan: function (game) {
      scanPlayerOverlay(game);
    },
    draw: function (ctx, game, transform) {
      drawPlayerOverlay(ctx, game, transform);
    },
  });

  function setPlayerMapOverlaysEnabled(enabled) {
    playerMapOverlaysEnabled = Boolean(enabled);
    if (!playerOverlayEnabled()) {
      _playerOverlayScan = [];
    }
    requestMapOverlayLoop();
  }

  function setMapTroopCountsEnabled(enabled) {
    mapTroopCountsEnabled = Boolean(enabled);
    if (!playerOverlayEnabled()) {
      _playerOverlayScan = [];
    }
    requestMapOverlayLoop();
  }

  function setThreatIndicatorsEnabled(enabled) {
    threatIndicatorsEnabled = Boolean(enabled);
    if (!playerOverlayEnabled()) {
      _playerOverlayScan = [];
    }
    requestMapOverlayLoop();
  }

  function setMapMoneyEnabled(enabled) {
    mapMoneyEnabled = Boolean(enabled);
    if (!playerOverlayEnabled()) {
      _playerOverlayScan = [];
    }
    requestMapOverlayLoop();
  }
