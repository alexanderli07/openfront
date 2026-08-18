// Auto-Bot — floating control panel UI (control/log tabs, sliders, drag).

"use strict";

  // =========================================================================
  // Floating control panel
  // =========================================================================
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        --ab-accent: var(--oh-accent, #60a5fa);
        --ab-border: var(--oh-panel-border, rgba(148, 163, 184, 0.34));
        --ab-surface: rgba(255, 255, 255, 0.05);
        --ab-surface-2: rgba(255, 255, 255, 0.09);
        --ab-muted: #94a3b8;
        position: fixed;
        z-index: 8000;
        width: 244px;
        bottom: 16px;
        right: 16px;
        background: var(--oh-panel-bg, rgba(12, 18, 20, 0.95));
        border: 1px solid var(--ab-border);
        border-radius: 8px;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4), 0 0 16px var(--oh-accent-soft, rgba(148, 163, 184, 0.1));
        color: var(--oh-panel-text, #e2e8f0);
        font: 700 11px/1.45 "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        user-select: none;
        overflow: hidden;
      }
      #${PANEL_ID} .ab-head {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; cursor: grab;
        background: transparent;
        border-bottom: 1px solid var(--oh-panel-header-border, rgba(148, 163, 184, 0.18));
      }
      #${PANEL_ID} .ab-head:active { cursor: grabbing; }
      #${PANEL_ID} .ab-title { font-weight: 900; font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase; color: rgba(226, 232, 240, 0.85); flex: 1; }
      #${PANEL_ID} .ab-head-btns { display: flex; align-items: center; gap: 1px; }
      #${PANEL_ID} .ab-mini, #${PANEL_ID} .ab-close {
        background: transparent; border: none; color: var(--ab-muted);
        cursor: pointer; font-size: 13px; line-height: 1; width: 20px; height: 20px;
        border-radius: 6px; display: grid; place-items: center; transition: .14s;
      }
      #${PANEL_ID} .ab-mini:hover { color: #fff; background: var(--ab-surface-2); }
      #${PANEL_ID} .ab-close:hover { color: #fca5a5; background: rgba(248,113,113,0.15); }
      #${PANEL_ID} .ab-switch {
        position: relative; width: 36px; height: 20px; border-radius: 999px;
        background: rgba(120,130,130,.3); cursor: pointer; transition: .18s; flex: none;
        border: 1px solid rgba(255,255,255,.08);
      }
      #${PANEL_ID} .ab-switch.on {
        background: var(--oh-accent-muted, rgba(96,165,250,0.6));
        border-color: rgba(148,163,184,.5);
      }
      #${PANEL_ID} .ab-switch::after {
        content: ""; position: absolute; top: 2px; left: 2px;
        width: 14px; height: 14px; border-radius: 50%; background: #fff;
        transition: transform .18s; box-shadow: 0 1px 3px rgba(0,0,0,.4);
      }
      #${PANEL_ID} .ab-switch.on::after { transform: translateX(16px); }
      #${PANEL_ID} .ab-body { padding: 9px 10px 10px; }
      #${PANEL_ID}.ab-collapsed .ab-body { display: none; }
      #${PANEL_ID}.ab-collapsed .ab-tabs { display: none; }
      #${PANEL_ID} .ab-gate-dot {
        width: 8px; height: 8px; border-radius: 50%; flex: none; cursor: help;
        background: currentColor; box-shadow: 0 0 6px currentColor;
      }
      #${PANEL_ID} .ab-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 0;
      }
      #${PANEL_ID} .ab-feat {
        display: flex; align-items: center; gap: 9px; cursor: pointer;
        padding: 8px 9px; border-radius: 9px; transition: background 0.12s;
      }
      #${PANEL_ID} .ab-feat:hover { background: var(--ab-surface); }
      #${PANEL_ID} .ab-adv-toggle {
        cursor: pointer; color: #cdd8d8; font-size: 11px; font-weight: 600;
        padding: 7px 9px; border-radius: 7px; transition: .12s; letter-spacing: .2px;
        background: var(--ab-surface); margin-top: 4px;
      }
      #${PANEL_ID} .ab-adv-toggle:hover { background: var(--ab-surface-2); color: #fff; }
      #${PANEL_ID} .ab-feats-grid {
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;
        max-height: 0; overflow: hidden; transition: max-height 0.24s ease;
      }
      #${PANEL_ID} .ab-feats-grid.open { max-height: 200px; margin: 4px 0 2px; }
      #${PANEL_ID} .ab-feat-mini {
        position: relative; flex-direction: column; align-items: center; justify-content: center;
        gap: 3px; padding: 7px 2px; border-radius: 8px; background: var(--ab-surface);
        border: 1px solid transparent; opacity: 0.5; transition: .12s;
      }
      #${PANEL_ID} .ab-feat-mini:hover { background: var(--ab-surface-2); opacity: 0.85; }
      #${PANEL_ID} .ab-feat-mini.on { opacity: 1; border-color: var(--oh-accent-muted, rgba(96,165,250,.45)); background: var(--oh-accent-soft, rgba(96,165,250,.14)); }
      #${PANEL_ID} .ab-feat-mini .ab-feat-emoji { font-size: 16px; line-height: 1; transition: filter .14s; }
      #${PANEL_ID} .ab-feat-mini.on .ab-feat-emoji { filter: drop-shadow(0 0 5px var(--oh-accent-muted, rgba(96,165,250,.85))); }
      .ab-feat-tip {
        position: fixed; z-index: 9000; transform: translate(-50%, -100%);
        padding: 7px 10px; border-radius: 8px; pointer-events: none;
        background: var(--oh-panel-bg, rgba(12,18,20,0.98)); border: 1px solid var(--oh-accent-muted, rgba(96,165,250,0.35));
        color: var(--oh-panel-text, #e2e8f0); font: 500 11px/1.4 "Aptos", system-ui, sans-serif;
        white-space: normal; max-width: 220px; text-align: center;
        box-shadow: 0 8px 22px rgba(0,0,0,0.5); opacity: 0; transition: opacity 0.12s;
      }
      .ab-feat-tip b { color: var(--oh-accent, #60a5fa); font-weight: 800; }
      .ab-feat-tip.show { opacity: 1; }
      #${PANEL_ID} .ab-status {
        display: none; margin-top: 6px; padding: 11px; border-radius: 11px;
        background: var(--ab-surface); border: 1px solid rgba(255,255,255,.05); font-size: 11px;
      }
      #${PANEL_ID} .ab-status.open { display: block; }
      #${PANEL_ID} .ab-status .ab-st-line { color: #dce6e6; font-weight: 600; }
      #${PANEL_ID} .ab-status .ab-st-act { color: #fcd34d; margin-top: 4px; font-size: 10.5px; }
      #${PANEL_ID} .ab-stats {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px;
      }
      #${PANEL_ID} .ab-stat {
        background: rgba(0,0,0,.28); border: 1px solid rgba(255,255,255,.05);
        border-radius: 9px; padding: 7px 4px; text-align: center;
      }
      #${PANEL_ID} .ab-stat b { display: block; color: var(--ab-accent); font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
      #${PANEL_ID} .ab-stat span { color: var(--ab-muted); font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; }
      #${PANEL_ID} .ab-tabs {
        display: flex; gap: 3px; padding: 8px 10px 0;
      }
      #${PANEL_ID} .ab-tab {
        flex: 1; cursor: pointer; padding: 5px 0; text-align: center;
        font-size: 12px; color: var(--oh-panel-text-dim);
        background: rgba(148,163,184,0.08); border: 1px solid rgba(148,163,184,0.15);
        border-radius: 8px; transition: background 0.14s, border-color 0.14s;
      }
      #${PANEL_ID} .ab-tab:hover { background: rgba(148,163,184,0.15); border-color: var(--oh-accent-muted); }
      #${PANEL_ID} .ab-tab.on {
        background: var(--oh-accent-soft, rgba(96,165,250,.14));
        border-color: var(--oh-accent-muted, rgba(96,165,250,.45));
      }
      /* 3-tab visibility: control is default; log/config show when their class is set. */
      #${PANEL_ID} .ab-pane[data-pane="log"],
      #${PANEL_ID} .ab-pane[data-pane="config"] { display: none; }
      #${PANEL_ID}.ab-tab-log .ab-pane[data-pane="control"],
      #${PANEL_ID}.ab-tab-config .ab-pane[data-pane="control"] { display: none; }
      #${PANEL_ID}.ab-tab-log .ab-pane[data-pane="log"] { display: block; }
      #${PANEL_ID}.ab-tab-config .ab-pane[data-pane="config"] { display: block; }
      /* Config tab controls */
      #${PANEL_ID} .ab-cfg-sec {
        font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;
        color: var(--oh-panel-text-dim, #94a3b8); margin: 10px 0 5px;
      }
      #${PANEL_ID} .ab-cfg-sec:first-child { margin-top: 2px; }
      #${PANEL_ID} .ab-cfg-chips { display: flex; gap: 4px; flex-wrap: wrap; }
      #${PANEL_ID} .ab-cfg-chip {
        cursor: pointer; padding: 4px 10px; border-radius: 7px; font-size: 10px; font-weight: 700;
        color: var(--oh-panel-text-dim, #94a3b8); background: var(--ab-surface);
        border: 1px solid transparent; transition: 0.12s;
      }
      #${PANEL_ID} .ab-cfg-chip:hover { background: var(--ab-surface-2); color: var(--oh-panel-text, #e2e8f0); }
      #${PANEL_ID} .ab-cfg-chip.on {
        color: var(--oh-panel-text, #e2e8f0); background: var(--oh-accent-muted, rgba(96,165,250,0.6));
        border-color: var(--oh-accent-muted, rgba(96,165,250,0.6));
      }
      #${PANEL_ID} .ab-cfg-row {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 5px 0;
      }
      #${PANEL_ID} .ab-cfg-label { font-size: 11px; color: var(--oh-panel-text, #e2e8f0); flex: 1; min-width: 0; }
      #${PANEL_ID} .ab-cfg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
      #${PANEL_ID} .ab-cfg-struct {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 6px 2px; border-radius: 8px; background: var(--ab-surface);
        border: 1px solid transparent; cursor: pointer; opacity: 0.5; transition: 0.12s;
      }
      #${PANEL_ID} .ab-cfg-struct:hover { background: var(--ab-surface-2); opacity: 0.85; }
      #${PANEL_ID} .ab-cfg-struct.on {
        opacity: 1; border-color: var(--oh-accent-muted, rgba(96,165,250,0.45));
        background: var(--oh-accent-soft, rgba(96,165,250,0.14));
      }
      #${PANEL_ID} .ab-cfg-struct .ab-cfg-struct-emoji { font-size: 15px; line-height: 1; }
      #${PANEL_ID} .ab-cfg-struct .ab-cfg-struct-icon { width: 16px; height: 16px; object-fit: contain; }
      #${PANEL_ID} .ab-cfg-struct .ab-cfg-struct-name { font-size: 8px; color: var(--oh-panel-text-dim, #94a3b8); text-align: center; }
      #${PANEL_ID} .ab-cfg-sw {
        width: 30px; height: 16px; border-radius: 999px; flex-shrink: 0; cursor: pointer;
        background: rgba(120,130,130,.3); position: relative; border: 1px solid rgba(255,255,255,.08); transition: .18s;
      }
      #${PANEL_ID} .ab-cfg-sw.on { background: var(--oh-accent-muted, rgba(96,165,250,0.6)); border-color: rgba(148,163,184,.5); }
      #${PANEL_ID} .ab-cfg-sw::after {
        content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px;
        border-radius: 50%; background: #fff; transition: transform .18s;
      }
      #${PANEL_ID} .ab-cfg-sw.on::after { transform: translateX(14px); }
      #${PANEL_ID} .ab-cfg-num {
        width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.3));
        border-radius: 5px; color: var(--oh-panel-text, #e2e8f0); padding: 3px 6px; font: 11px monospace; text-align: right;
      }
      #${PANEL_ID} .ab-cfg-body { max-height: 340px; overflow-y: auto; margin-right: -10px; padding-right: 10px; }
      #${PANEL_ID} .ab-cfg-body::-webkit-scrollbar { width: 6px; }
      #${PANEL_ID} .ab-cfg-body::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.18); border-radius: 3px;
      }
      #${PANEL_ID} .ab-log-filters {
        display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;
      }
      #${PANEL_ID} .ab-chip {
        cursor: pointer; padding: 3px 7px; border-radius: 999px;
        font-size: 10px; font-weight: 700; color: #cbd5e1;
        background: rgba(255,255,255,0.05); border: 1px solid transparent;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
      }
      #${PANEL_ID} .ab-chip:hover { background: rgba(255,255,255,0.09); }
      #${PANEL_ID} .ab-chip.on {
        background: var(--oh-accent-soft, rgba(96,165,250,0.18)); color: var(--oh-accent, #60a5fa);
        border-color: var(--oh-accent-muted, rgba(96,165,250,0.4));
      }
      #${PANEL_ID} .ab-log-list {
        max-height: 240px; overflow-y: auto; display: flex; flex-direction: column;
        gap: 1px; font-variant-numeric: tabular-nums;
      }
      #${PANEL_ID} .ab-log-list::-webkit-scrollbar { width: 7px; }
      #${PANEL_ID} .ab-log-list::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.14); border-radius: 4px;
      }
      #${PANEL_ID} .ab-log-item {
        display: flex; gap: 6px; align-items: baseline; padding: 3px 5px;
        border-radius: 5px; line-height: 1.3;
      }
      #${PANEL_ID} .ab-log-item:nth-child(odd) { background: rgba(255,255,255,0.03); }
      #${PANEL_ID} .ab-log-time { color: #6b7280; font-size: 10px; flex: none; }
      #${PANEL_ID} .ab-log-text { color: #e5e7eb; font-size: 11px; word-break: break-word; }
      #${PANEL_ID} .ab-log-empty { color: #6b7280; font-size: 11px; text-align: center; padding: 16px 0; }
    `;
    document.head.appendChild(style);
  }

  // key -> [label, detailed description] for the hover tooltip. Descriptions
  // reuse the popup's strings so they share translations.
  const FEAT_TIP = {
    spawn: ["Auto-spawn", "Automatically pick a spawn tile."],
    expand: ["Auto-expand / attack", "Expand into land and attack targets."],
    boat: ["Auto-landing (1% boat)", "Send probe and landing boats overseas."],
    warship: ["Auto-deploy warships", "Build and dispatch warships."],
    build: ["Auto-build", "Build and upgrade structures."],
    nuke: ["Auto-launch nukes", "Fire nukes at high-value targets."],
    alliance: ["Auto-accept alliances", "Send and accept alliance requests."],
    embargo: ["Auto-embargo enemies", "Stop trading with hostile nations."],
    donate: ["Auto-donate troops (allies)", "Donate troops to needy allies."],
    betray: ["Auto-betray allies", "Off = stay loyal (defensive retaliation only)."],
  };

  function cfgStructIcon(type, emoji) {
    var url = (typeof window.__OFH_gameIconUrl === "function" && window.__OFH_gameIconUrl(type)) || "";
    if (!url) return '<span class="ab-cfg-struct-emoji">' + emoji + '</span>';
    return '<img class="ab-cfg-struct-icon" src="' + url + '" alt="' + type + '" onerror="this.replaceWith(document.createTextNode(\'' + emoji + '\'))" draggable="false">';
  }

  function featRow(key, label, emoji) {
    const on = state.settings.features[key];
    // Compact icon tile (5-per-row). No checkmark — when ON the icon lights up
    // (full opacity + glow). Label + detailed description show on hover.
    return `
      <div class="ab-feat ab-feat-mini ${on ? "on" : ""}" data-feat="${key}">
        <span class="ab-feat-emoji">${emoji}</span>
      </div>`;
  }

  function buildPanel() {
    ensureStyles();
    let panel = document.getElementById(PANEL_ID);
    // X-closed: keep the panel out of the DOM (the lifecycle watcher calls
    // buildPanel() every ~1.2s, so this also stops it from coming back).
    if (state.settings.hidden) {
      if (panel) panel.remove();
      return null;
    }
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    if (state.settings.minimized) panel.classList.add("ab-collapsed");
    if (state.activeTab === "log") panel.classList.add("ab-tab-log");
    if (state.activeTab === "config") panel.classList.add("ab-tab-config");
    panel.innerHTML = `
      <div class="ab-head">
        <div class="ab-gate-dot" data-role="gate-dot" style="color:#fbbf24;" title="${tr("Checking lobby…")}"></div>
        <span class="ab-title">Auto-Bot</span>
        <div class="ab-switch ${state.settings.enabled ? "on" : ""}" data-role="switch" title="${tr("Toggle on/off")}"></div>
        <div class="ab-head-btns">
          <button class="ab-mini" data-role="mini" title="${tr("Collapse")}">${state.settings.minimized ? "▢" : "—"}</button>
          <button class="ab-close" data-role="close" title="${tr("Close")}">✕</button>
        </div>
      </div>
      <div class="ab-tabs">
        <div class="ab-tab ${state.activeTab === "control" ? "on" : ""}" data-tab="control" title="${tr("🎮 Controls")}">🎮</div>
        <div class="ab-tab ${state.activeTab === "config" ? "on" : ""}" data-tab="config" title="${tr("⚙️ Config")}">⚙️</div>
        <div class="ab-tab ${state.activeTab === "log" ? "on" : ""}" data-tab="log" title="${tr("📜 Log")}">📜</div>
      </div>
      <div class="ab-body">
        <div class="ab-pane" data-pane="control">
          <div class="ab-adv-toggle" data-role="feats-toggle">${
            state.settings.featsOpen
              ? tr("Auto toggles ▴")
              : tr("Auto toggles ▾")
          }</div>
          <div class="ab-feats-grid ${state.settings.featsOpen ? "open" : ""}" data-role="feats">
            ${featRow("spawn", "Auto-spawn", "🏁")}
            ${featRow("expand", "Auto-expand / attack", "⚔️")}
            ${featRow("boat", "Auto-landing (1% boat)", "⛵")}
            ${featRow("warship", "Auto-deploy warships", "🚢")}
            ${featRow("build", "Auto-build", "🏗️")}
            ${featRow("nuke", "Auto-launch nukes", "☢️")}
            ${featRow("alliance", "Auto-accept alliances", "🤝")}
            ${featRow("embargo", "Auto-embargo enemies", "🚫")}
            ${featRow("donate", "Auto-donate troops (allies)", "🎁")}
            ${featRow("betray", "Auto-betray allies", "🗡️")}
          </div>
          <div class="ab-adv-toggle" data-role="status-toggle">${
            state.settings.statusOpen
              ? tr("Status & stats ▴")
              : tr("Status & stats ▾")
          }</div>
          <div class="ab-status ${state.settings.statusOpen ? "open" : ""}" data-role="status-wrap">
            <div class="ab-st-line" data-role="status">—</div>
            <div class="ab-st-act" data-role="lastaction">—</div>
            <div class="ab-stats">
              <div class="ab-stat"><b data-role="s-troops">0</b><span>${tr("Troops")}</span></div>
              <div class="ab-stat"><b data-role="s-gold">0</b><span>${tr("Gold")}</span></div>
              <div class="ab-stat"><b data-role="s-tiles">0</b><span>${tr("Tiles")}</span></div>
            </div>
            <div class="ab-stats" style="grid-template-columns: repeat(4, 1fr);">
              <div class="ab-stat"><b data-role="c-spawns">0</b><span>${tr("Spawn")}</span></div>
              <div class="ab-stat"><b data-role="c-attacks">0</b><span>${tr("Attacks")}</span></div>
              <div class="ab-stat"><b data-role="c-builds">0</b><span>${tr("Builds")}</span></div>
              <div class="ab-stat"><b data-role="c-nukes">0</b><span>${tr("Nukes")}</span></div>
            </div>
          </div>
        </div>
        <div class="ab-pane" data-pane="config">
          <div class="ab-cfg-body">
            <div class="ab-cfg-sec">${tr("General")}</div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Auto-bot enabled")}</span>
              <div class="ab-cfg-sw ${state.settings.enabled ? "on" : ""}" data-cfg="enabled"></div>
            </div>

            <div class="ab-cfg-sec">${tr("Auto-build structures")}</div>
            <div class="ab-cfg-grid" data-role="cfg-structs">
              ${[
                ["City", "🏙️"],
                ["Port", "⚓"],
                ["Factory", "🏭"],
                ["Defense Post", "🛡️"],
                ["SAM Launcher", "🛰️"],
                ["Missile Silo", "🚀"],
              ]
                .map(
                  ([type, emoji]) =>
                    `<div class="ab-cfg-struct ${(state.settings.buildStructures || {})[type] !== false ? "on" : ""}" data-struct="${type}">
                       ${cfgStructIcon(type, emoji)}
                       <span class="ab-cfg-struct-name">${tr(type)}</span>
                     </div>`,
                )
                .join("")}
            </div>

            <div class="ab-cfg-sec">${tr("Advanced")}</div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Win-condition fixes")}</span>
              <div class="ab-cfg-sw ${state.settings.winFixes ? "on" : ""}" data-cfg="winFixes"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Smart spawn")}</span>
              <div class="ab-cfg-sw ${state.settings.smartSpawn ? "on" : ""}" data-cfg="smartSpawn"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Tick interval (ms)")}</span>
              <input class="ab-cfg-num" type="number" min="50" max="2000" step="50" value="${state.settings.tickMs || 200}" data-cfg-num="tickMs">
            </div>

            <!-- DIVERGENCE: none of these four behaviours exist in src's Nation AI. -->
            <div class="ab-cfg-sec">${tr("Strategy")}</div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Build cities, ports and factories far more aggressively and stop hoarding gold for nukes.")}">${tr("Economy first")}</span>
              <div class="ab-cfg-sw ${state.settings.economyFirst ? "on" : ""}" data-cfg="economyFirst"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Salvo enough nukes to overwhelm an enemy SAM battery (interceptions + 1). Normally Impossible-only.")}">${tr("Crack enemy SAMs")}</span>
              <div class="ab-cfg-sw ${state.settings.samCrack ? "on" : ""}" data-cfg="samCrack"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Size SAM coverage from enemy silo levels and the per-player average rather than a fixed ratio, and always weight placement for overlap.")}">${tr("Scale SAMs to threat")}</span>
              <div class="ab-cfg-sw ${state.settings.samDefense ? "on" : ""}" data-cfg="samDefense"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Build defense posts whenever we border a hostile player, sized by gold/min, instead of only once an attack has already landed.")}">${tr("Proactive defense posts")}</span>
              <div class="ab-cfg-sw ${state.settings.defensePosts ? "on" : ""}" data-cfg="defensePosts"></div>
            </div>

            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Always aim at the densest structure cluster we can actually land on. If SAMs cover it, fire a full saturation salvo (interceptions + 1) instead of picking an easier target.")}">${tr("Nuke densest target")}</span>
              <div class="ab-cfg-sw ${state.settings.nukeDensityFirst ? "on" : ""}" data-cfg="nukeDensityFirst"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" title="${tr("Hold back more troops for every extra hostile player bordering us (+7% each, capped at 65%).")}">${tr("Reserve vs neighbours")}</span>
              <div class="ab-cfg-sw ${state.settings.reserveByNeighbors ? "on" : ""}" data-cfg="reserveByNeighbors"></div>
            </div>

            <div class="ab-cfg-sec">${tr("Donate tuning")}</div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Keep fraction")}</span>
                <span class="ab-cfg-val" data-cfg-val="donateKeepFrac">${Math.round((state.settings.donateKeepFrac || 0.45) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value="${Math.round((state.settings.donateKeepFrac || 0.45) * 100)}" data-cfg-range="donateKeepFrac" data-cfg-div="100" style="width:100%;accent-color:var(--oh-accent);">
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Need threshold")}</span>
                <span class="ab-cfg-val" data-cfg-val="donateNeedThreshold">${Math.round((state.settings.donateNeedThreshold || 0.8) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value="${Math.round((state.settings.donateNeedThreshold || 0.8) * 100)}" data-cfg-range="donateNeedThreshold" data-cfg-div="100" style="width:100%;accent-color:var(--oh-accent);">
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Min donate %")}</span>
                <span class="ab-cfg-val" data-cfg-val="donateMinDonatePct">${Math.round((state.settings.donateMinDonatePct || 0.2) * 100)}%</span>
              </div>
              <input type="range" min="5" max="80" step="5" value="${Math.round((state.settings.donateMinDonatePct || 0.2) * 100)}" data-cfg-range="donateMinDonatePct" data-cfg-div="100" style="width:100%;accent-color:var(--oh-accent);">
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Throttle (ms)")}</span>
                <span class="ab-cfg-val" data-cfg-val="donateThrottleMs">${state.settings.donateThrottleMs || 1200}ms</span>
              </div>
              <input type="range" min="500" max="10000" step="100" value="${state.settings.donateThrottleMs || 1200}" data-cfg-range="donateThrottleMs" style="width:100%;accent-color:var(--oh-accent);">
            </div>

            <div class="ab-cfg-sec">${tr("Warship tuning")}</div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Auto-build warships")}</span>
              <div class="ab-cfg-sw ${state.settings.warshipAutoSpawn !== false ? "on" : ""}" data-cfg="warshipAutoSpawn"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Hunt enemy trade")}</span>
              <div class="ab-cfg-sw ${state.settings.warshipHuntTrade !== false ? "on" : ""}" data-cfg="warshipHuntTrade"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Evade enemies")}</span>
              <div class="ab-cfg-sw ${state.settings.warshipEvade !== false ? "on" : ""}" data-cfg="warshipEvade"></div>
            </div>
            <div class="ab-cfg-row">
              <span class="ab-cfg-label">${tr("Dodge nukes")}</span>
              <div class="ab-cfg-sw ${state.settings.warshipNukeDodge !== false ? "on" : ""}" data-cfg="warshipNukeDodge"></div>
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Retreat HP %")}</span>
                <span class="ab-cfg-val" data-cfg-val="warshipRetreatHealthPct">${state.settings.warshipRetreatHealthPct || 50}%</span>
              </div>
              <input type="range" min="10" max="90" step="5" value="${state.settings.warshipRetreatHealthPct || 50}" data-cfg-range="warshipRetreatHealthPct" style="width:100%;accent-color:var(--oh-accent);">
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Combat throttle (ms)")}</span>
                <span class="ab-cfg-val" data-cfg-val="warshipCombatThrottleMs">${state.settings.warshipCombatThrottleMs || 800}ms</span>
              </div>
              <input type="range" min="200" max="5000" step="100" value="${state.settings.warshipCombatThrottleMs || 800}" data-cfg-range="warshipCombatThrottleMs" style="width:100%;accent-color:var(--oh-accent);">
            </div>
            <div class="ab-cfg-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="ab-cfg-label">${tr("Patrol throttle (ms)")}</span>
                <span class="ab-cfg-val" data-cfg-val="warshipPatrolThrottleMs">${state.settings.warshipPatrolThrottleMs || 1500}ms</span>
              </div>
              <input type="range" min="500" max="10000" step="100" value="${state.settings.warshipPatrolThrottleMs || 1500}" data-cfg-range="warshipPatrolThrottleMs" style="width:100%;accent-color:var(--oh-accent);">
            </div>
          </div>
        </div>
        <div class="ab-pane" data-pane="log">
          <div class="ab-log-filters" data-role="log-filters">
            <div class="ab-chip ${state.logFilter === "all" ? "on" : ""}" data-filter="all">${tr("All")}</div>
            ${Object.entries(LOG_CATS)
              .map(
                ([key, c]) =>
                  `<div class="ab-chip ${state.logFilter === key ? "on" : ""}" data-filter="${key}">${c.emoji} ${tr(c.label)}</div>`,
              )
              .join("")}
          </div>
          <div class="ab-log-list" data-role="log-list"></div>
        </div>
      </div>`;

    document.body.appendChild(panel);
    wirePanel(panel);
    applyStoredPosition(panel);
    return panel;
  }

  function wirePanel(panel) {
    // master switch
    panel.querySelector('[data-role="switch"]').addEventListener("click", () => {
      setEnabled(!state.settings.enabled);
    });

    // minimize
    panel.querySelector('[data-role="mini"]').addEventListener("click", () => {
      state.settings.minimized = !state.settings.minimized;
      panel.classList.toggle("ab-collapsed", state.settings.minimized);
      panel.querySelector('[data-role="mini"]').textContent = state.settings.minimized
        ? "▢"
        : "—";
      saveSettings();
    });

    // close (hide whole panel; re-show from the popup Auto Bot tab)
    panel.querySelector('[data-role="close"]').addEventListener("click", () => {
      state.settings.hidden = true;
      saveSettings();
      panel.remove();
      // Notify Quick Panel so the "Auto-Bot panel" toggle reflects the new state.
      try {
        window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
          detail: { key: "showAutoBotPanel", value: false }
        }));
      } catch (e) {}
    });

    // feature toggles
    panel.querySelectorAll(".ab-feat").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.feat;
        if (!key) return; // the win-fixes tile has no data-feat → its own handler
        const on = !state.settings.features[key];
        state.settings.features[key] = on;
        el.classList.toggle("on", on); // tile lights up when ON (no checkmark)
        saveSettings();
      });
    });

    // "Auto toggles" collapsible group (Control tab)
    const featsToggle = panel.querySelector('[data-role="feats-toggle"]');
    const feats = panel.querySelector('[data-role="feats"]');
    if (featsToggle && feats) {
      featsToggle.addEventListener("click", () => {
        state.settings.featsOpen = !state.settings.featsOpen;
        feats.classList.toggle("open", state.settings.featsOpen);
        featsToggle.textContent = state.settings.featsOpen
          ? tr("Auto toggles ▴")
          : tr("Auto toggles ▾");
        saveSettings();
      });
    }

    // hover tooltip for the compact feature tiles (label + detailed description)
    // Clean up any stale tooltip left from a previous panel rebuild.
    // Popover helper — reuse .ab-feat-tip for any element that needs a rich tooltip.
    // Clean up old popovers from previous panel builds.
    document.querySelectorAll(".ab-feat-tip").forEach(function(t) { t.remove(); });
    var gateTip = null;
    function _showPopover(el, html) {
      if (!gateTip) {
        gateTip = document.createElement("div");
        gateTip.className = "ab-feat-tip";
        document.body.appendChild(gateTip);
      }
      gateTip.innerHTML = html;
      var r = el.getBoundingClientRect();
      gateTip.style.left = (r.left + r.width / 2) + "px";
      gateTip.style.top = (r.top - 6) + "px";
      gateTip.classList.add("show");
    }
    function _hidePopover() {
      if (gateTip) gateTip.classList.remove("show");
    }

    // Gate dot — show popover on hover.
    var gateDot = panel.querySelector('[data-role="gate-dot"]');
    if (gateDot) {
      gateDot.addEventListener("mouseenter", function() {
        _showPopover(gateDot, "<b>" + tr("Lobby status") + "</b><br>" + (gateDot.title || ""));
      });
      gateDot.addEventListener("mouseleave", _hidePopover);
    }

    // Tab buttons — show popover on hover.
    panel.querySelectorAll(".ab-tab").forEach(function(tab) {
      tab.addEventListener("mouseenter", function() {
        _showPopover(tab, "<b>" + tr(tab.title || "") + "</b>");
      });
      tab.addEventListener("mouseleave", _hidePopover);
    });

    var featTip = null;
    panel.querySelectorAll(".ab-feat-mini").forEach((tile) => {
      tile.addEventListener("mouseenter", () => {
        const info = FEAT_TIP[tile.dataset.feat];
        if (!info) return;
        if (!featTip) {
          featTip = document.createElement("div");
          featTip.className = "ab-feat-tip";
          document.body.appendChild(featTip);
        }
        featTip.innerHTML = `<b>${tr(info[0])}</b><br>${tr(info[1])}`;
        const r = tile.getBoundingClientRect();
        featTip.style.left = `${r.left + r.width / 2}px`;
        featTip.style.top = `${r.top - 6}px`;
        featTip.classList.add("show");
      });
      tile.addEventListener("mouseleave", () => {
        if (featTip) featTip.classList.remove("show");
      });
    });

    // status & stats collapsible group
    const statusToggle = panel.querySelector('[data-role="status-toggle"]');
    const statusWrap = panel.querySelector('[data-role="status-wrap"]');
    if (statusToggle && statusWrap) {
      statusToggle.addEventListener("click", () => {
        state.settings.statusOpen = !state.settings.statusOpen;
        statusWrap.classList.toggle("open", state.settings.statusOpen);
        statusToggle.textContent = state.settings.statusOpen
          ? tr("Status & stats ▴")
          : tr("Status & stats ▾");
        saveSettings();
      });
    }

    // ── Config tab wiring ───────────────────────────────────────────────────
    // All controls mutate state.settings directly (same shared scope), persist
    // via saveSettings(), and retuneEngine() where the change affects the loop.
    // auto-build structure tiles
    panel.querySelectorAll("[data-struct]").forEach((el) => {
      el.addEventListener("click", () => {
        const type = el.dataset.struct;
        if (!state.settings.buildStructures) state.settings.buildStructures = {};
        const on = state.settings.buildStructures[type] === false; // was off → turn on
        state.settings.buildStructures[type] = on;
        el.classList.toggle("on", on);
        saveSettings();
      });
    });
    // advanced boolean switches (winFixes / smartSpawn / enabled)
    panel.querySelectorAll("[data-cfg]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.cfg;
        const on = !el.classList.contains("on");
        el.classList.toggle("on", on);
        if (key === "enabled") {
          setEnabled(on);
          // keep the header master switch in sync
          const master = panel.querySelector('[data-role="switch"]');
          if (master) master.classList.toggle("on", on);
        } else {
          state.settings[key] = on;
          saveSettings();
        }
      });
    });
    // number inputs (tickMs)
    const tickInput = panel.querySelector('[data-cfg-num="tickMs"]');
    if (tickInput) {
      tickInput.addEventListener("change", () => {
        const ms = Number(tickInput.value);
        if (Number.isFinite(ms) && ms > 0) {
          state.settings.tickMs = ms;
          saveSettings();
          if (typeof retuneEngine === "function") retuneEngine();
        }
      });
    }
    // range sliders (donate tuning)
    panel.querySelectorAll("[data-cfg-range]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.cfgRange;
        const divisor = Number(input.dataset.cfgDiv) || 1;
        const raw = Number(input.value);
        const v = divisor > 1 ? raw / divisor : raw;
        state.settings[key] = v;
        saveSettings();
        // Update value label
        const valEl = panel.querySelector(`[data-cfg-val="${key}"]`);
        if (valEl) {
          valEl.textContent = divisor > 1 ? Math.round(v * 100) + "%" : raw + "ms";
        }
      });
    });
    // Preserve config tab scroll position across reflows/rebuilds
    const cfgBody = panel.querySelector(".ab-cfg-body");
    if (cfgBody) {
      const SCROLL_KEY = "openfront-helper-autobot-config-scroll";
      // Restore saved scroll
      try {
        const saved = Number(localStorage.getItem(SCROLL_KEY));
        if (saved > 0) setTimeout(() => { cfgBody.scrollTop = saved; }, 50);
      } catch (_e) {}
      // Save on scroll
      cfgBody.addEventListener("scroll", () => {
        try { localStorage.setItem(SCROLL_KEY, String(cfgBody.scrollTop)); } catch (_e) {}
      }, { passive: true });
    }

    // tab switching (control / config / log)
    panel.querySelectorAll(".ab-tab").forEach((el) => {
      el.addEventListener("click", () => {
        const tab = el.dataset.tab;
        if (tab === state.activeTab) return;
        state.activeTab = tab;
        panel.classList.toggle("ab-tab-log", tab === "log");
        panel.classList.toggle("ab-tab-config", tab === "config");
        panel
          .querySelectorAll(".ab-tab")
          .forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
        if (tab === "log") renderLog();
      });
    });

    // log category filter chips
    panel.querySelectorAll(".ab-chip").forEach((el) => {
      el.addEventListener("click", () => {
        state.logFilter = el.dataset.filter;
        panel
          .querySelectorAll(".ab-chip")
          .forEach((c) => c.classList.toggle("on", c.dataset.filter === state.logFilter));
        renderLog();
      });
    });

    makeDraggable(panel, panel.querySelector(".ab-head"));
  }

  function renderLog() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const list = panel.querySelector('[data-role="log-list"]');
    if (!list) return;
    const entries =
      state.logFilter === "all"
        ? state.log
        : state.log.filter((e) => e.cat === state.logFilter);
    if (entries.length === 0) {
      list.innerHTML = `<div class="ab-log-empty">${tr("No actions yet")}</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      // The label already carries its own action emoji (🛡️/🏗️/☢️/…), so we
      // render it as-is — the category is only used for filtering, not display.
      const item = document.createElement("div");
      item.className = "ab-log-item";
      const time = document.createElement("span");
      time.className = "ab-log-time";
      time.textContent = new Date(e.t).toLocaleTimeString();
      const text = document.createElement("span");
      text.className = "ab-log-text";
      text.textContent = e.text;
      item.appendChild(time);
      item.appendChild(text);
      frag.appendChild(item);
    }
    list.replaceChildren(frag);
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    function onDown(e) {
      if (e.target.closest('[data-role="switch"], [data-role="mini"], [data-role="close"]')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = originLeft + "px";
      panel.style.top = originTop + "px";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const left = clamp(originLeft + (e.clientX - startX), 0, window.innerWidth - 60);
      const top = clamp(originTop + (e.clientY - startY), 0, window.innerHeight - 30);
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      state.settings.pos = {
        left: parseInt(panel.style.left, 10),
        top: parseInt(panel.style.top, 10),
      };
      saveSettings();
      console.log("[Panel] saved pos", state.settings.pos);
    }
    handle.addEventListener("pointerdown", onDown);
  }

  function applyStoredPosition(panel) {
    const pos = state.settings.pos;
    console.log("[Panel] applyStoredPosition", pos);
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = clamp(pos.left, 0, window.innerWidth - 60) + "px";
      panel.style.top = clamp(pos.top, 0, window.innerHeight - 30) + "px";
    }
  }

  function renderHeader() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel
      .querySelector('[data-role="switch"]')
      .classList.toggle("on", state.settings.enabled);
  }

  function refreshGateBanner() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const dot = panel.querySelector('[data-role="gate-dot"]');
    if (!dot) return;
    const game = getGame();
    if (!game) {
      dot.style.color = "#fbbf24";
      dot.title = tr("Waiting to enter game…");
      return;
    }
    const type = gameType(game);
    if (type) {
      dot.style.color = "#4ade80";
      let label;
      if (type === "Singleplayer") label = tr("Singleplayer");
      else if (type === "Public") label = tr("Public lobby");
      else label = tr("Private lobby");
      dot.title = label;
    } else {
      dot.style.color = "#fbbf24";
      dot.title = tr("Waiting to enter game…");
    }
  }

  function fmt(n) {
    const v = Math.round(n);
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
    if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
    return String(v);
  }

  function renderStatus() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const set = (role, text) => {
      const el = panel.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    set("status", state.status);
    set("lastaction", state.lastAction);
    set("s-troops", fmt(state.live.troops));
    set("s-gold", fmt(state.live.gold));
    set("s-tiles", fmt(state.live.tiles));
    set("c-spawns", String(state.stats.spawns));
    set("c-attacks", String(state.stats.attacks));
    set("c-builds", String(state.stats.builds));
    set("c-nukes", String(state.stats.nukes));
  }
