// Floating Auto-Join panel -------------------------------------------------
// A compact, draggable, collapsible Auto-Join panel that lives on the
// OpenFront page (mirror of the floating helpers panel). Holds the essentials:
// the Auto-Join power toggle, the game-found notification toggle, and a
// read-only lobby forecast. Shares the content-script global scope, so it uses
// `settings`, `saveSettings`, `t`, and `hasSelectedCriteria` from the other
// content scripts. Filters/maps stay in the popup — this panel is on purpose
// compact.

function ensureFloatingAutoJoinStyles() {
  if (document.getElementById(FLOATING_AUTOJOIN_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = FLOATING_AUTOJOIN_STYLE_ID;
  style.textContent = `
    /* ---- shared panel-chrome tokens (USER: the three panels' window controls and
       status dots must be identical). DUPLICATED VERBATIM in quick-panel.js and
       auto-bot/panel.js: the lobby layer and the in-game layer are separate IIFEs in
       the build, so they cannot share a JS constant - these tokens ARE the contract.
       Change one, change all three. ---- */
    :root {
      --ofh-ctl-size: 22px;      /* window-control hit box */
      --ofh-ctl-radius: 6px;
      --ofh-ctl-font: 12px;
      --ofh-dot-size: 8px;       /* every panel status dot */
    }
    @keyframes ofhStatusPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.28; }
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} {
      position: fixed;
      left: var(--ofh-aj-left, 18px);
      top: var(--ofh-aj-top, 92px);
      z-index: 9000;
      width: min(300px, calc(100vw - 24px));
      height: auto;
      max-height: calc(100vh - 24px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
      border-radius: 8px;
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
      color: var(--oh-panel-text, #e2e8f0);
      font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
      font-size: 11px;
      font-weight: 700;
      box-shadow:
        0 10px 26px rgba(0, 0, 0, 0.4),
        0 0 16px var(--oh-accent-soft, rgba(96,165,250,0.15));
      user-select: none;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID}.ofh-aj-collapsed {
      grid-template-rows: auto;
      min-height: 0;
      height: auto;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID}.ofh-aj-collapsed .ofh-aj-body {
      display: none;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      cursor: move;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID}.ofh-aj-collapsed .ofh-aj-header {
      border-bottom: 0;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-title {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-header-actions {
      display: inline-flex;
      gap: 6px;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-iconbtn {
      display: grid;
      place-items: center;
      width: var(--ofh-ctl-size);
      height: var(--ofh-ctl-size);
      border-radius: var(--ofh-ctl-radius);
      /* The border is always present and only changes COLOUR on hover - a transparent
         border rather than none, so hovering never reflows the row by a pixel. */
      border: 1px solid transparent;
      background: transparent;
      color: var(--oh-panel-text-dim, #94a3b8);
      cursor: pointer;
      font-size: var(--ofh-ctl-font);
      font-weight: 700;
      line-height: 1;
      transition: background .14s, color .14s, border-color .14s;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-iconbtn:hover {
      background: var(--oh-accent-soft, rgba(96,165,250,0.15));
      border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
      color: var(--oh-panel-text, #e2e8f0);
    }

    /* Close keeps its red affordance - that distinction is meaningful, unlike the
       size/glyph differences this change removes. */
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-close:hover {
      background: rgba(248,113,113,0.15);
      border-color: rgba(248,113,113,0.6);
      color: #fca5a5;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-body {
      display: grid;
      gap: 10px;
      flex: 0 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 12px;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 13px 16px;
      border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
      border-radius: 12px;
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
      color: var(--oh-panel-text, #e2e8f0);
      font: inherit;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power:hover:not(:disabled) {
      border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power-dot {
      flex: 0 0 auto;
      width: var(--ofh-dot-size);
      height: var(--ofh-dot-size);
      border-radius: 50%;
      background: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
      box-shadow: 0 0 0 4px var(--oh-accent-soft, rgba(96,165,250,0.15));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power[data-enabled="true"] {
      border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
      background:
        radial-gradient(circle at 30% 24%, var(--oh-accent-soft, rgba(96,165,250,0.15)), transparent 40%),
        linear-gradient(135deg, var(--oh-accent-muted, rgba(96,165,250,0.6)), var(--oh-accent-muted, rgba(96,165,250,0.6)));
      color: var(--oh-panel-text, #e2e8f0);
      box-shadow: inset 0 1px 0 var(--oh-accent-soft, rgba(96,165,250,0.15)), 0 0 18px var(--oh-accent-soft, rgba(96,165,250,0.15));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-power[data-enabled="true"] .ofh-aj-power-dot {
      background: var(--oh-accent, #60a5fa);
      box-shadow: 0 0 0 4px var(--oh-accent-soft, rgba(96,165,250,0.15)), 0 0 12px var(--oh-accent-muted, rgba(96,165,250,0.6));
      /* Live = flashing, on every panel. Idle stays steady so the flash means something. */
      animation: ofhStatusPulse 1.4s ease-in-out infinite;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-notif {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      border-radius: 10px;
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
      cursor: pointer;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-notif-text {
      min-width: 0;
      font-size: 12px;
      font-weight: 700;
      color: var(--oh-panel-text, #e2e8f0);
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-notif input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-switch {
      position: relative;
      flex: 0 0 auto;
      width: 38px;
      height: 22px;
      border-radius: 999px;
      border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
      transition: background 200ms ease, border-color 200ms ease;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-switch::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 3px;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
      transition: left 200ms cubic-bezier(0.34, 1.4, 0.5, 1), background 200ms ease;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-notif input:checked + .ofh-aj-switch {
      border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
      background: linear-gradient(180deg, var(--oh-accent, #60a5fa), var(--oh-accent, #60a5fa));
      box-shadow: 0 0 10px var(--oh-accent-soft, rgba(96,165,250,0.15)), inset 0 1px 0 var(--oh-accent-soft, rgba(96,165,250,0.15));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-notif input:checked + .ofh-aj-switch::after {
      left: 19px;
      background: var(--oh-panel-text, #e2e8f0);
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast {
      display: grid;
      gap: 6px;
      padding: 10px 12px;
      border: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      border-radius: 10px;
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast-title {
      margin: 0 0 2px;
      color: var(--oh-accent, #60a5fa);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast-row span {
      color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast-row strong {
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 12px;
      font-weight: 900;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 13px;
      border: 1px solid var(--oh-accent-muted, rgba(96,165,250,0.6));
      border-radius: 10px;
      background:
        linear-gradient(135deg, var(--oh-accent-soft, rgba(96,165,250,0.15)), transparent 60%),
        var(--oh-panel-bg, rgba(12,18,20,0.92));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer[hidden] {
      display: none;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer-label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer-dot {
      width: var(--ofh-dot-size);
      height: var(--ofh-dot-size);
      border-radius: 50%;
      background: var(--oh-accent, #60a5fa);
      box-shadow: 0 0 8px var(--oh-accent, #60a5fa);
      animation: ofhAjPulse 1.4s ease-in-out infinite;
    }

    @keyframes ofhAjPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer strong {
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 15px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }

    /* Paused: auto-join is ON but a game/lobby (or the post-game grace) is
       occupying us, so we're not actively searching. Amber + steady (no pulse)
       to read clearly as "waiting", distinct from the green live "Searching". */
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer[data-state="paused"] {
      border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
      background:
        linear-gradient(135deg, var(--oh-accent-soft, rgba(96,165,250,0.15)), transparent 60%),
        var(--oh-panel-bg, rgba(12,18,20,0.92));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer[data-state="paused"] .ofh-aj-timer-label {
      color: var(--oh-panel-text, #e2e8f0);
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer[data-state="paused"] .ofh-aj-timer-dot {
      background: var(--oh-accent, #60a5fa);
      box-shadow: 0 0 8px var(--oh-accent, #60a5fa);
      animation: none;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-timer[data-state="paused"] strong {
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 12px;
      font-weight: 800;
      font-variant-numeric: normal;
      text-transform: lowercase;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary {
      display: grid;
      gap: 6px;
      padding: 10px 12px;
      border: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      border-radius: 10px;
      background: var(--oh-panel-bg, rgba(12,18,20,0.92));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary-title {
      margin: 0 0 2px;
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary-title,
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-forecast-title {
      display: flex; align-items: center; justify-content: space-between;
      cursor: pointer; user-select: none;
    }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-chev {
      font-size: 9px; opacity: 0.6; transition: transform 0.15s;
    }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-sec-collapsed .ofh-aj-chev { transform: rotate(-90deg); }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-sec-rows { display: grid; gap: 6px; }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-sec-collapsed .ofh-aj-sec-rows { display: none; }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-editbtn {
      margin-top: 2px; width: 100%; cursor: pointer;
      font: 700 11px/1 "Aptos", "Segoe UI", sans-serif; color: var(--oh-panel-text, #e2e8f0);
      background: var(--oh-accent-soft, rgba(96,165,250,0.15)); border: 1px solid var(--oh-accent-muted, rgba(96,165,250,0.6));
      border-radius: 8px; padding: 7px; transition: 0.14s;
    }
    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-editbtn:hover { background: var(--oh-accent-soft, rgba(96,165,250,0.15)); }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary-row span {
      flex: 0 0 auto;
      padding-top: 1px;
      color: var(--oh-panel-text-dim, rgba(148,163,184,0.85));
    }

    #${FLOATING_AUTOJOIN_PANEL_ID} .ofh-aj-summary-row strong {
      color: var(--oh-panel-text, #e2e8f0);
      font-size: 11.5px;
      font-weight: 800;
      line-height: 1.3;
      text-align: right;
      overflow-wrap: anywhere;
    }

  `;
  (document.head || document.documentElement).appendChild(style);
}

function formatAutoJoinDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) {
    return `${rest}s`;
  }
  return `${minutes}m ${rest}s`;
}

function formatFloatingAutoJoinElapsed(startedAt) {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function floatingAutoJoinRangeSummary(min, max) {
  if (min == null && max == null) {
    return t("Any");
  }
  if (min != null && max == null) {
    return `${min}+`;
  }
  if (min == null && max != null) {
    return `≤${max}`;
  }
  if (min === max) {
    return `${min}`;
  }
  return `${min}–${max}`;
}

function floatingAutoJoinTeamSizeSummary() {
  return floatingAutoJoinRangeSummary(settings.minTeamSize, settings.maxTeamSize);
}

function floatingAutoJoinTeamCountSummary() {
  return floatingAutoJoinRangeSummary(
    settings.minTeamCount,
    settings.maxTeamCount,
  );
}

function floatingAutoJoinCondenseNames(names) {
  if (names.length <= 3) {
    return names.join(", ");
  }
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function floatingAutoJoinMapsSummary() {
  const maps = Array.isArray(globalThis.OPENFRONT_MAPS)
    ? globalThis.OPENFRONT_MAPS
    : [];
  const included = maps
    .filter((map) => settings.mapFilters && settings.mapFilters[map.id])
    .map((map) => map.name);
  const excluded = maps
    .filter((map) => settings.mapExcludeFilters && settings.mapExcludeFilters[map.id])
    .map((map) => map.name);
  if (included.length) {
    return floatingAutoJoinCondenseNames(included);
  }
  if (excluded.length) {
    return `${t("All")} − ${floatingAutoJoinCondenseNames(excluded)}`;
  }
  return t("All");
}

function floatingAutoJoinMinLobbySummary() {
  return settings.minLobbySize == null ? t("Any") : `> ${settings.minLobbySize}`;
}

// Why is the search paused right now? (Same occupancy predicates the auto-join
// loop uses — shared lexical scope.) Mostly the panel is hidden while we're in a
// lobby/game, so the reasons that actually surface are "game starting" (the
// brief startup gap) and "resuming…" (the post-game grace window).
function floatingAutoJoinPauseReason() {
  if (typeof isInActiveGame === "function" && isInActiveGame()) {
    return t("in a game");
  }
  if (typeof isInLobbyWaiting === "function" && isInLobbyWaiting()) {
    return t("in lobby");
  }
  if (typeof isGameStarting === "function" && isGameStarting()) {
    return t("game starting");
  }
  return t("resuming…");
}

function updateFloatingAutoJoinSearchTime(panel) {
  const wrap = panel.querySelector('[data-role="timer-wrap"]');
  const timer = panel.querySelector('[data-role="timer"]');
  const labelText = panel.querySelector('[data-role="timer-label"]');
  const enabled = Boolean(settings.enabled);
  // Paused = auto-join is on but currently occupied (waiting room / game-start
  // loading / live game) or within the post-game resume grace, so it deliberately
  // isn't joining anything. recentlyOccupied() also covers the loading gap where
  // every DOM "occupied" signal momentarily reads false.
  const paused =
    enabled &&
    ((typeof isOccupied === "function" && isOccupied()) ||
      (typeof recentlyOccupied === "function" && recentlyOccupied()));
  const searching = enabled && Number.isFinite(settings.searchStartedAt);

  if (wrap instanceof HTMLElement) {
    wrap.hidden = !(searching || paused);
    wrap.dataset.state = paused ? "paused" : "searching";
  }
  if (labelText) {
    labelText.textContent = paused ? t("Paused") : t("Searching");
  }
  if (timer) {
    if (paused) {
      timer.textContent = floatingAutoJoinPauseReason();
    } else if (searching) {
      timer.textContent = formatFloatingAutoJoinElapsed(settings.searchStartedAt);
    }
  }
}

// True only on the home / lobby-browser screen. The panel auto-hides once a
// lobby/room modal opens (OpenFront locks `body.style.overflow` while any modal
// is up — see OModal.open()) or a game is running (`in-game` body class added
// in Main.ts). So: home = no modal up AND not in a game.
function shouldShowFloatingAutoJoinPanel() {
  if (!settings.showFloatingAutoJoinPanel) {
    return false;
  }
  const body = document.body;
  if (!body) {
    return false;
  }
  if (body.classList.contains("in-game")) {
    return false;
  }
  if (body.style.overflow === "hidden") {
    return false;
  }
  return true;
}

let floatingAutoJoinWatcherId = null;

function createFloatingAutoJoinPanel() {
  ensureFloatingAutoJoinStyles();

  const panel = document.createElement("div");
  panel.id = FLOATING_AUTOJOIN_PANEL_ID;
  panel.innerHTML = `
    <div class="ofh-aj-header">
      <p class="ofh-aj-title"><span aria-hidden="true">⚡</span>${t("Auto-Join")}</p>
      <div class="ofh-aj-header-actions">
        <button class="ofh-aj-iconbtn" type="button" data-role="settings" title="${t("Open settings")}">⚙</button>
        <button class="ofh-aj-iconbtn" type="button" data-role="collapse" title="${t("Collapse")}">—</button>
        <button class="ofh-aj-iconbtn ofh-aj-close" type="button" data-role="close" aria-label="${t("Close auto-join panel")}">✕</button>
      </div>
    </div>
    <div class="ofh-aj-body">
      <button class="ofh-aj-power" type="button" data-role="power" data-enabled="false">
        <span class="ofh-aj-power-label">${t("autoJoinOff")}</span>
        <span class="ofh-aj-power-dot" aria-hidden="true"></span>
      </button>
      <div class="ofh-aj-timer" data-role="timer-wrap" data-state="searching" hidden>
        <span class="ofh-aj-timer-label"><span class="ofh-aj-timer-dot" aria-hidden="true"></span><span data-role="timer-label">${t("Searching")}</span></span>
        <strong data-role="timer">00:00</strong>
      </div>
      <label class="ofh-aj-notif">
        <span class="ofh-aj-notif-text">${t("Game found notification popup")}</span>
        <input type="checkbox" data-role="notif">
        <span class="ofh-aj-switch"></span>
      </label>
      <div class="ofh-aj-summary ${settings.floatingAutoJoinFiltersCollapsed ? "ofh-aj-sec-collapsed" : ""}">
        <p class="ofh-aj-summary-title" data-role="filters-toggle"><span>${t("Filters")}</span><span class="ofh-aj-chev" aria-hidden="true">▾</span></p>
        <div class="ofh-aj-sec-rows">
          <div class="ofh-aj-summary-row"><span>${t("Players per team")}</span><strong data-role="teamsize">${t("Any")}</strong></div>
          <div class="ofh-aj-summary-row"><span>${t("Teams in match")}</span><strong data-role="teamcount">${t("Any")}</strong></div>
          <div class="ofh-aj-summary-row"><span>${t("Maps")}</span><strong data-role="maps">${t("All")}</strong></div>
          <div class="ofh-aj-summary-row"><span>${t("Min lobby size")}</span><strong data-role="minlobby">${t("Any")}</strong></div>
          <button class="ofh-aj-editbtn" type="button" data-role="edit-filters">${t("Edit filters")}</button>
        </div>
      </div>
      <div class="ofh-aj-forecast ${settings.floatingAutoJoinForecastCollapsed ? "ofh-aj-sec-collapsed" : ""}">
        <p class="ofh-aj-forecast-title" data-role="forecast-toggle"><span>${t("Lobby forecast")}</span><span class="ofh-aj-chev" aria-hidden="true">▾</span></p>
        <div class="ofh-aj-sec-rows">
          <div class="ofh-aj-forecast-row"><span>${t("ETA (estimate)")}</span><strong data-role="eta">—</strong></div>
          <div class="ofh-aj-forecast-row"><span>${t("Hit chance next 10 lobbies")}</span><strong data-role="hit">—</strong></div>
          <div class="ofh-aj-forecast-row"><span>${t("Median to match")}</span><strong data-role="median">—</strong></div>
        </div>
      </div>
    </div>
  `;

  panel.querySelector('[data-role="close"]')?.addEventListener("click", () => {
    // Sync to Quick Panel BEFORE saving so the guard doesn't block the event.
    try {
      window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
        detail: { key: "showFloatingAutoJoinPanel", value: false }
      }));
    } catch(e) {}
    saveSettings({ ...settings, showFloatingAutoJoinPanel: false }).catch((error) => {
      console.error("Failed to close floating auto-join panel:", error);
    });
  });

  panel.querySelector('[data-role="collapse"]')?.addEventListener("click", () => {
    const collapsed = !settings.floatingAutoJoinPanelCollapsed;
    // Toggle immediately for snappy feedback, then persist.
    panel.classList.toggle("ofh-aj-collapsed", collapsed);
    saveSettings({ ...settings, floatingAutoJoinPanelCollapsed: collapsed }).catch((error) => {
      console.error("Failed to collapse floating auto-join panel:", error);
    });
  });

  panel.querySelector('[data-role="power"]')?.addEventListener("click", () => {
    const button = panel.querySelector('[data-role="power"]');
    if (button instanceof HTMLButtonElement && button.disabled) {
      return;
    }
    const enabling = !settings.enabled;
    saveSettings({
      ...settings,
      enabled: enabling,
      searchStartedAt: enabling ? Date.now() : null,
    }).catch((error) => {
      console.error("Failed to toggle auto-join from floating panel:", error);
    });
  });

  panel.querySelector('[data-role="notif"]')?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    // turning it on is a user gesture — ask the shell to request OS-notification permission
    if (target.checked && typeof window.__OFH_requestNotifyPermission === "function") {
      window.__OFH_requestNotifyPermission();
    }
    saveSettings({ ...settings, joinNotification: target.checked }).catch((error) => {
      console.error("Failed to toggle notification from floating panel:", error);
    });
  });

  // Open the main settings popup (gear → general; "Edit filters" → Filters tab).
  panel.querySelector('[data-role="settings"]')?.addEventListener("click", () => {
    if (typeof window.__OFH_openPopup === "function") window.__OFH_openPopup();
  });
  panel.querySelector('[data-role="edit-filters"]')?.addEventListener("click", () => {
    if (typeof window.__OFH_openPopup === "function") {
      window.__OFH_openPopup("autojoin", "filters");
    }
  });

  // Collapsible Filters / Lobby-forecast sections (persisted via settings).
  panel.querySelector('[data-role="filters-toggle"]')?.addEventListener("click", () => {
    const collapsed = !settings.floatingAutoJoinFiltersCollapsed;
    panel.querySelector(".ofh-aj-summary")?.classList.toggle("ofh-aj-sec-collapsed", collapsed);
    saveSettings({ ...settings, floatingAutoJoinFiltersCollapsed: collapsed }).catch((error) => {
      console.error("Failed to toggle filters section:", error);
    });
  });
  panel.querySelector('[data-role="forecast-toggle"]')?.addEventListener("click", () => {
    const collapsed = !settings.floatingAutoJoinForecastCollapsed;
    panel.querySelector(".ofh-aj-forecast")?.classList.toggle("ofh-aj-sec-collapsed", collapsed);
    saveSettings({ ...settings, floatingAutoJoinForecastCollapsed: collapsed }).catch((error) => {
      console.error("Failed to toggle forecast section:", error);
    });
  });

  installFloatingAutoJoinDrag(panel);
  return panel;
}

function installFloatingAutoJoinDrag(panel) {
  const header = panel.querySelector(".ofh-aj-header");
  if (!(header instanceof HTMLElement)) {
    return;
  }

  let dragState = null;
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target instanceof HTMLButtonElement) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    const left = Math.max(8, Math.min(maxLeft, event.clientX - dragState.offsetX));
    const top = Math.max(8, Math.min(maxTop, event.clientY - dragState.offsetY));
    setFloatingAutoJoinPosition(panel, left, top);
  });

  function finishDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    dragState = null;
    const rect = panel.getBoundingClientRect();
    saveSettings({
      ...settings,
      floatingAutoJoinPanelPosition: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      },
    }).catch((error) => {
      console.error("Failed to save floating auto-join position:", error);
    });
  }

  header.addEventListener("pointerup", finishDrag);
  header.addEventListener("pointercancel", finishDrag);
}


function setFloatingAutoJoinPosition(panel, left, top) {
  panel.style.setProperty("--ofh-aj-left", `${Math.round(left)}px`);
  panel.style.setProperty("--ofh-aj-top", `${Math.round(top)}px`);
}


function positionFloatingAutoJoinPanel(panel) {
  const position = settings.floatingAutoJoinPanelPosition || {};
  const left = position.left ?? window.innerWidth - 320;
  const top = position.top ?? 92;
  const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
  setFloatingAutoJoinPosition(
    panel,
    Math.max(8, Math.min(maxLeft, left)),
    Math.max(8, Math.min(maxTop, top)),
  );
  // Panel auto-sizes to its content now (no manual resize / stored height).
}

function updateFloatingAutoJoinPanel(panel) {
  const collapsed = Boolean(settings.floatingAutoJoinPanelCollapsed);
  panel.classList.toggle("ofh-aj-collapsed", collapsed);
  const collapseBtn = panel.querySelector('[data-role="collapse"]');
  if (collapseBtn instanceof HTMLElement) {
    collapseBtn.textContent = collapsed ? "▢" : "—";
    collapseBtn.title = collapsed ? t("Expand") : t("Collapse");
  }

  const canSearch =
    typeof hasSelectedCriteria === "function" ? hasSelectedCriteria() : true;
  const power = panel.querySelector('[data-role="power"]');
  if (power instanceof HTMLButtonElement) {
    const enabled = Boolean(settings.enabled);
    power.dataset.enabled = String(enabled);
    power.disabled = !enabled && !canSearch;
    const label = power.querySelector(".ofh-aj-power-label");
    if (label) {
      label.textContent = enabled ? t("autoJoinOn") : t("autoJoinOff");
    }
    power.title =
      !enabled && !canSearch
        ? t("Select at least one filter in the popup to enable auto-join.")
        : "";
  }

  const notif = panel.querySelector('[data-role="notif"]');
  if (notif instanceof HTMLInputElement) {
    notif.checked = Boolean(settings.joinNotification);
  }

  const forecast = settings.lobbyForecast || {};
  const etaEl = panel.querySelector('[data-role="eta"]');
  const hitEl = panel.querySelector('[data-role="hit"]');
  const medianEl = panel.querySelector('[data-role="median"]');
  if (etaEl) {
    etaEl.textContent =
      Number.isFinite(forecast.etaMinSeconds) && Number.isFinite(forecast.etaMaxSeconds)
        ? `${formatAutoJoinDuration(forecast.etaMinSeconds)} – ${formatAutoJoinDuration(forecast.etaMaxSeconds)}`
        : "—";
  }
  if (hitEl) {
    hitEl.textContent = Number.isFinite(forecast.hitChanceNext10)
      ? `${Math.round(forecast.hitChanceNext10 * 100)}%`
      : "—";
  }
  if (medianEl) {
    medianEl.textContent = Number.isFinite(forecast.medianLobbiesToMatch)
      ? `${Math.round(forecast.medianLobbiesToMatch)} ${t("lobbies")}`
      : "—";
  }

  const teamSizeEl = panel.querySelector('[data-role="teamsize"]');
  if (teamSizeEl) {
    teamSizeEl.textContent = floatingAutoJoinTeamSizeSummary();
  }
  const teamCountEl = panel.querySelector('[data-role="teamcount"]');
  if (teamCountEl) {
    teamCountEl.textContent = floatingAutoJoinTeamCountSummary();
  }
  const mapsEl = panel.querySelector('[data-role="maps"]');
  if (mapsEl) {
    mapsEl.textContent = floatingAutoJoinMapsSummary();
  }
  const minLobbyEl = panel.querySelector('[data-role="minlobby"]');
  if (minLobbyEl) {
    minLobbyEl.textContent = floatingAutoJoinMinLobbySummary();
  }

  updateFloatingAutoJoinSearchTime(panel);
}

function applyFloatingAutoJoinPanelState() {
  const existing = document.getElementById(FLOATING_AUTOJOIN_PANEL_ID);
  if (!shouldShowFloatingAutoJoinPanel()) {
    existing?.remove();
    return;
  }

  let panel = existing;
  if (!panel) {
    panel = createFloatingAutoJoinPanel();
    (document.body || document.documentElement).appendChild(panel);
    positionFloatingAutoJoinPanel(panel);
  }

  updateFloatingAutoJoinPanel(panel);
}

function syncFloatingAutoJoinPanel() {
  // When the feature is on, run a light 1s watcher: it shows the panel on the
  // home screen, hides it the moment a room/game modal opens or a game starts,
  // and ticks the live search timer. (The SPA never reloads between screens, so
  // a poll is the simplest reliable way to react to those transitions.)
  if (settings.showFloatingAutoJoinPanel) {
    if (floatingAutoJoinWatcherId === null) {
      floatingAutoJoinWatcherId = window.setInterval(
        applyFloatingAutoJoinPanelState,
        1000,
      );
    }
  } else if (floatingAutoJoinWatcherId !== null) {
    window.clearInterval(floatingAutoJoinWatcherId);
    floatingAutoJoinWatcherId = null;
  }

  applyFloatingAutoJoinPanelState();
}
