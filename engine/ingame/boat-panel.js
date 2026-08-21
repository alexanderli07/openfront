// Incoming-boat warning.
//
// This file used to also host a two-tab boat LIST panel (boats you sent / boats
// incoming, with hover-to-focus rows). That panel is gone — removed on request. Its
// hover-focus never worked in this build anyway: the only map-side reader of the
// focused id lived in the DOM boat renderer, which is unreachable because
// _boatUseCanvas is hardcoded true.
//
// What remains is the alert: a new transport aimed at MY territory raises a small
// card in the shared bottom-right alert stack. Detection rides on the boat-prediction
// scan (maybeWarnNewIncomingBoats, called from syncBoatPrediction).

  // ── Incoming-boat warning ────────────────────────────────────────────────
  // A new transport aimed at MY territory raises a center-screen alert, in the
  // same spirit as the Missile Silo warning. Detection runs on the overlay scan
  // (see maybeWarnNewIncomingBoats, called from syncBoatPrediction).
  const BOAT_ALERT_MS = 9000;
  let boatIncomingSeen = new Set(); // ids treated as "already known"
  let boatIncomingWarnInit = false; // seeded yet? (first pass primes, no alert)
  const boatAlertTimers = new Map(); // boatId -> dismiss timer

  function ensureBoatAlertStyles() {
    if (document.getElementById(BOAT_ALERT_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = BOAT_ALERT_STYLE_ID;
    style.textContent = `
      /* A plain flow child of the shared bottom-right stack (see ensureOfhAlertStack). */
      #${BOAT_ALERT_CONTAINER_ID} {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        width: max-content;
        max-width: 100%;
        pointer-events: none;
      }
      /* Same understated corner treatment as the retaliation card: 1px border, no glow
         pulse, no bobbing icon, 12px message. --boat-accent still tints the title so the
         relation (team / ally / enemy) is still readable at a glance. */
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 9px;
        border: 1px solid var(--boat-accent, rgba(248, 113, 113, 0.42));
        border-radius: 8px;
        background: rgba(8, 18, 20, 0.9);
        color: #ecfdf5;
        font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
        animation: ofh-boat-alert-in 0.18s ease-out;
      }
      @keyframes ofh-boat-alert-in {
        from { opacity: 0; transform: translateX(14px); }
        to { opacity: 1; transform: translateX(0); }
      }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-icon {
        flex: 0 0 auto;
        font-size: 15px;
        line-height: 1;
      }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-title {
        font-size: 9px; font-weight: 800; letter-spacing: 0.07em;
        text-transform: uppercase; color: var(--boat-accent, #fca5a5);
      }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-msg {
        font-size: 12px; font-weight: 700; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-who { color: var(--boat-accent, #fecaca); }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-actions { display: flex; align-items: center; gap: 4px; margin-left: 2px; }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-btn {
        cursor: pointer;
        border: 1px solid rgba(248, 250, 252, 0.22);
        border-radius: 6px;
        background: rgba(148, 163, 184, 0.14);
        color: #ecfdf5;
        font: 700 10px/1 "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        padding: 5px 7px;
        white-space: nowrap;
      }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-btn:hover { background: rgba(20, 184, 166, 0.28); }
      #${BOAT_ALERT_CONTAINER_ID} .ofh-boat-alert-close { width: 20px; height: 20px; padding: 0; justify-content: center; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBoatAlertContainer() {
    ensureBoatAlertStyles();
    let container = document.getElementById(BOAT_ALERT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = BOAT_ALERT_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      ensureOfhAlertStack().appendChild(container);
    }
    return container;
  }

  function dismissIncomingBoatAlert(boatId) {
    const timer = boatAlertTimers.get(boatId);
    if (timer != null) {
      clearTimeout(timer);
      boatAlertTimers.delete(boatId);
    }
    const container = document.getElementById(BOAT_ALERT_CONTAINER_ID);
    if (container) {
      for (const el of Array.from(container.children)) {
        if (el.dataset && el.dataset.boatId === boatId) {
          el.remove();
        }
      }
    }
  }

  function clearAllIncomingBoatAlerts() {
    for (const timer of boatAlertTimers.values()) {
      clearTimeout(timer);
    }
    boatAlertTimers.clear();
    const container = document.getElementById(BOAT_ALERT_CONTAINER_ID);
    if (container) {
      container.replaceChildren();
    }
  }

  // Pan the camera to a boat via the game's own events-display HUD (same hook the
  // game uses for "go to unit"). Best-effort; silently no-ops if unavailable.
  function focusIncomingBoat(unit) {
    try {
      const eventsDisplay = document.querySelector("events-display");
      if (unit && eventsDisplay && typeof eventsDisplay.emitGoToUnitEvent === "function") {
        eventsDisplay.emitGoToUnitEvent(unit);
      }
    } catch (_error) {
      // ignore
    }
  }

  function showIncomingBoatAlert(transport) {
    const container = ensureBoatAlertContainer();
    dismissIncomingBoatAlert(transport.domUnitId); // re-arm if somehow present

    const alert = document.createElement("div");
    alert.className = "ofh-boat-alert";
    alert.dataset.boatId = transport.domUnitId;
    alert.style.setProperty("--boat-accent", transport.color);

    const icon = document.createElement("div");
    icon.className = "ofh-boat-alert-icon";
    icon.textContent = "🚤";

    const body = document.createElement("div");
    body.className = "ofh-boat-alert-body";
    const title = document.createElement("span");
    title.className = "ofh-boat-alert-title";
    title.textContent = tr("⚠ Incoming boat");
    const msg = document.createElement("span");
    msg.className = "ofh-boat-alert-msg";
    const who = document.createElement("span");
    who.className = "ofh-boat-alert-who";
    who.textContent = transport.ownerName || "—";
    msg.append(who, document.createTextNode(" " + tr("is landing in your territory!")));
    body.append(title, msg);

    const actions = document.createElement("div");
    actions.className = "ofh-boat-alert-actions";
    const focusBtn = document.createElement("button");
    focusBtn.type = "button";
    focusBtn.className = "ofh-boat-alert-btn";
    focusBtn.textContent = "🎯 " + tr("Focus");
    focusBtn.addEventListener("click", () => focusIncomingBoat(transport.unit));
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ofh-boat-alert-btn ofh-boat-alert-close";
    closeBtn.textContent = "✕";
    closeBtn.title = tr("Close");
    closeBtn.addEventListener("click", () => dismissIncomingBoatAlert(transport.domUnitId));
    actions.append(focusBtn, closeBtn);

    alert.append(icon, body, actions);
    container.appendChild(alert);

    const timer = setTimeout(() => dismissIncomingBoatAlert(transport.domUnitId), BOAT_ALERT_MS);
    boatAlertTimers.set(transport.domUnitId, timer);
  }

  // Called once per scan (~1s) from syncBoatPrediction. First pass after enabling
  // primes the "seen" set without alerting, so boats already incoming at that
  // moment don't all fire at once.
  function maybeWarnNewIncomingBoats(transports) {
    if (!boatWarnIncoming) {
      return;
    }
    const current = new Set();
    for (const transport of transports) {
      if (transport.relation === "self" || !transport.targetsMyTerritory) {
        continue;
      }
      try {
        if (!transport.unit?.isActive?.()) {
          continue;
        }
      } catch (_error) {
        continue;
      }
      current.add(transport.domUnitId);
      if (boatIncomingWarnInit && !boatIncomingSeen.has(transport.domUnitId)) {
        showIncomingBoatAlert(transport);
      }
    }
    boatIncomingSeen = current; // also prunes ids that are gone
    boatIncomingWarnInit = true;
  }

  // Re-prime detection without alerting (called when the game context is lost,
  // i.e. between matches in the same session, so a new match seeds cleanly).
  function resetIncomingBoatWarningBaseline() {
    boatIncomingSeen = new Set();
    boatIncomingWarnInit = false;
  }

  function setBoatIncomingWarningEnabled(enabled) {
    const next = Boolean(enabled);
    const changed = next !== boatWarnIncoming;
    boatWarnIncoming = next;
    if (changed) {
      // Re-prime detection on any real toggle: on enable the next scan seeds
      // silently; on disable drop open alerts.
      boatIncomingSeen = new Set();
      boatIncomingWarnInit = false;
      if (!next) {
        clearAllIncomingBoatAlerts();
      }
    }
    // The warning keeps the scan loop alive by itself (see isBoatOverlayActive).
    refreshBoatOverlayActivity();
  }
