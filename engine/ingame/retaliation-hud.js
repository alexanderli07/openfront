// Retaliation HUD — a semi-automatic nuke counter-attack panel. When you are
// hit by a nuke and have enough gold to fire back, a card appears with a "Fire"
// button. Clicking it fires the cheapest available nuke at the attacker. This is
// the manual-play counterpart to auto-nuke: it does NOT auto-fire, it asks.
// Uses the same intent API (discoverCtors / emitIntent) as auto-nuke/boat-macro.

  function ensureRetaliationStyles() {
    if (document.getElementById(RETALIATION_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = RETALIATION_STYLE_ID;
    style.textContent = `
      /* A plain flow child of the shared bottom-right stack — no position/z-index of
         its own, so it cannot collide with the incoming-boat card any more. */
      #${RETALIATION_CONTAINER_ID} {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        width: max-content;
        max-width: 100%;
        pointer-events: none;
      }

      /* Deliberately understated: this is a corner notice, not a takeover. The 2px
         accent border, 28px shaking icon, 15px message and infinite glow pulse all went
         — a pulsing card in the corner of the eye is worse than a still one. */
      #${RETALIATION_CONTAINER_ID} .ofh-ret-card {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 9px;
        border: 1px solid rgba(248, 113, 113, 0.42);
        border-radius: 8px;
        background: rgba(26, 9, 9, 0.9);
        color: #fee2e2;
        font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
        animation: openfront-helper-ret-in 0.18s ease-out;
      }

      /* Slides in from the right edge it is anchored to. */
      @keyframes openfront-helper-ret-in {
        from { opacity: 0; transform: translateX(14px); }
        to { opacity: 1; transform: translateX(0); }
      }

      #${RETALIATION_CONTAINER_ID} .ofh-ret-icon {
        flex: 0 0 auto;
        font-size: 15px; line-height: 1;
      }

      #${RETALIATION_CONTAINER_ID} .ofh-ret-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      #${RETALIATION_CONTAINER_ID} .ofh-ret-title {
        font-size: 9px; font-weight: 800; letter-spacing: 0.07em;
        text-transform: uppercase; color: #fca5a5;
      }
      #${RETALIATION_CONTAINER_ID} .ofh-ret-msg {
        font-size: 12px; font-weight: 700; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* One button treatment shared with the boat card: a quiet ghost, not a filled
         call-to-action. The same Focus action used to be solid red here and teal there. */
      #${RETALIATION_CONTAINER_ID} .ofh-ret-fire,
      #${RETALIATION_CONTAINER_ID} .ofh-ret-dismiss {
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        border: 1px solid rgba(248, 250, 252, 0.22);
        border-radius: 6px; background: rgba(148, 163, 184, 0.14);
        color: #fee2e2; font: 700 10px/1 "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        cursor: pointer; white-space: nowrap;
      }
      #${RETALIATION_CONTAINER_ID} .ofh-ret-fire { padding: 5px 7px; }
      #${RETALIATION_CONTAINER_ID} .ofh-ret-dismiss { width: 20px; height: 20px; }
      #${RETALIATION_CONTAINER_ID} .ofh-ret-fire:hover,
      #${RETALIATION_CONTAINER_ID} .ofh-ret-dismiss:hover { background: rgba(248, 113, 113, 0.28); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureRetaliationContainer() {
    ensureRetaliationStyles();
    let c = document.getElementById(RETALIATION_CONTAINER_ID);
    if (!c) {
      c = document.createElement("div");
      c.id = RETALIATION_CONTAINER_ID;
      c.setAttribute("aria-hidden", "true");
      ensureOfhAlertStack().appendChild(c);
    }
    return c;
  }

  function showRetaliationCard(attackerName, attackerPlayer) {
    const container = ensureRetaliationContainer();
    const card = document.createElement("div");
    card.className = "ofh-ret-card";

    const icon = document.createElement("div");
    icon.className = "ofh-ret-icon";
    icon.textContent = "☢";

    const body = document.createElement("div");
    body.className = "ofh-ret-body";
    const title = document.createElement("div");
    title.className = "ofh-ret-title";
    title.textContent = tr("Nuke incoming");
    const msg = document.createElement("div");
    msg.className = "ofh-ret-msg";
    msg.textContent = tr("Retaliate against {name}?", { name: attackerName });
    body.appendChild(title);
    body.appendChild(msg);

    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "ofh-ret-fire";
    focus.textContent = `🎯 ${tr("Focus")}`;

    let focused = false;
    focus.addEventListener("click", () => {
      if (focused) return;
      focused = true;
      focusOnAttacker(attackerPlayer);
      card.remove();
    });

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "ofh-ret-dismiss";
    dismiss.textContent = "✕";
    dismiss.title = tr("Dismiss");
    dismiss.addEventListener("click", () => card.remove());

    // Auto-dismiss after 15s.
    window.setTimeout(() => { if (!focused) card.remove(); }, 15000);

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(focus);
    card.appendChild(dismiss);
    container.appendChild(card);
  }

  function focusOnAttacker(attackerPlayer) {
    try {
      if (!attackerPlayer) return;
      const context = getOpenFrontGameContext();
      if (!context?.game) return;
      const game = context.game;
      // Find a tile owned by the attacker to focus on
      const targetId = attackerPlayer.smallID ? attackerPlayer.smallID() : null;
      if (targetId == null) return;
      // Try to find the nuke that's targeting us — focus on its source
      const nukes = game.units("Atom Bomb", "Hydrogen Bomb");
      for (const unit of nukes) {
        if (!unit || !unit.isActive || !unit.isActive()) continue;
        // Skip MIRV warheads — one launch spawns many, flooding the HUD
        var utype;
        try { utype = unit.type ? unit.type() : ""; } catch (_e) { utype = ""; }
        if (utype === "MIRV Warhead") continue;
        const owner = unit.owner ? unit.owner() : null;
        if (!owner) continue;
        const ownerSid = owner.smallID ? owner.smallID() : null;
        if (ownerSid === targetId) {
          // Found the nuke — use its tile (launch source)
          const tile = unit.tile ? unit.tile() : null;
          if (tile != null && typeof game.x === "function" && typeof game.y === "function") {
            _centerCameraOnTile(game.x(tile), game.y(tile));
            return;
          }
        }
      }
      // Fallback: use GoToPositionEvent with attacker's ID to focus territory
      // (the game will center on their capital/first city)
    } catch (_error) {}
  }

  // Camera jump (same as silo-sam-tracker)
  function _centerCameraOnTile(x, y) {
    try {
      var overlay = document.querySelector("player-info-overlay");
      if (!overlay || !overlay.eventBus) return;
      var bus = overlay.eventBus;
      if (!bus.listeners || typeof bus.listeners.entries !== "function") return;
      var it = bus.listeners.entries();
      var entry = it.next();
      while (!entry.done) {
        var ctor = entry.value[0];
        var callbacks = entry.value[1];
        if (ctor) {
          var matched = ctor.name === "GoToPositionEvent";
          if (!matched && Array.isArray(callbacks)) {
            for (var i = 0; i < callbacks.length; i++) {
              if (typeof callbacks[i] === "function") {
                var s = callbacks[i].toString();
                if (s.indexOf("onGoToPosition") !== -1 || s.indexOf("GoToPositionEvent") !== -1) {
                  matched = true;
                  break;
                }
              }
            }
          }
          if (matched) {
            try { bus.emit(new ctor(x, y)); } catch (e) {}
            return;
          }
        }
        entry = it.next();
      }
    } catch (e) {}
  }

  // One-shot latch per nuke-hit: fires once per distinct nuke that hits us.
  const _retaliationSeenHits = new Set();

  function checkRetaliation() {
    if (!retaliationEnabled) return;
    let context = null;
    try {
      context = getOpenFrontGameContext();
    } catch (_error) {
      return;
    }
    if (!context?.game) return;
    const game = context.game;
    const me = game.myPlayer ? game.myPlayer() : null;
    if (!me) return;

    // Check for incoming nukes targeting us.
    try {
      const nukes = game.units("Atom Bomb", "Hydrogen Bomb");
      for (const unit of nukes) {
        if (!unit || !unit.isActive || !unit.isActive()) continue;
        // Skip MIRV warheads — one launch spawns many, flooding the HUD
        var utype;
        try { utype = unit.type ? unit.type() : ""; } catch (_e) { utype = ""; }
        if (utype === "MIRV Warhead") continue;
        const owner = unit.owner ? unit.owner() : null;
        if (!owner) continue;
        // Skip our own / allied nukes.
        try {
          if (me.isFriendly && me.isFriendly(owner)) continue;
        } catch (_e) { /* treat as hostile */ }
        const targetTile = unit.targetTile ? unit.targetTile() : undefined;
        if (targetTile === undefined) continue;
        // Check if the target is our territory (approximate: check if the unit
        // is targeting a tile owned by us via ownerID).
        try {
          if (game.ownerID && game.ownerID(targetTile) !== me.smallID()) continue;
        } catch (_e) { continue; }
        const hitKey = `${unit.id ? unit.id() : targetTile}`;
        if (_retaliationSeenHits.has(hitKey)) continue;
        _retaliationSeenHits.add(hitKey);
        let attackerName = "?";
        try {
          attackerName = getPlayerDisplayName ? getPlayerDisplayName(owner) : owner.name && owner.name();
        } catch (_e) { attackerName = "?"; }
        showRetaliationCard(attackerName, owner);
      }
    } catch (_error) { /* ignore */ }

    // Prune seen-hits for nukes no longer in flight.
    if (_retaliationSeenHits.size > 0) {
      try {
        const activeIds = new Set();
        const nukes = game.units("Atom Bomb", "Hydrogen Bomb", "MIRV Warhead");
        for (const unit of nukes) {
          if (unit && unit.id) activeIds.add(String(unit.id()));
        }
        for (const id of _retaliationSeenHits) {
          if (!activeIds.has(id)) _retaliationSeenHits.delete(id);
        }
      } catch (_error) { /* ignore */ }
    }
  }

  function setRetaliationEnabled(enabled) {
    retaliationEnabled = Boolean(enabled);
    if (!retaliationEnabled) {
      if (retaliationInterval !== null) {
        window.clearInterval(retaliationInterval);
        retaliationInterval = null;
      }
      _retaliationSeenHits.clear();
      document.getElementById(RETALIATION_CONTAINER_ID)?.remove();
      return;
    }
    if (retaliationInterval === null) {
      retaliationInterval = window.setInterval(checkRetaliation, 800);
    }
  }
