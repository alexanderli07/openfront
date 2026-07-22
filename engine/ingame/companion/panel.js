// Companion Bot — panel: a floating three-tab control surface.
//
// Styling reuses the Quick Panel's CSS custom properties (--oh-panel-bg,
// --oh-panel-border, --oh-panel-text, --oh-accent) so the panel follows the
// user's theme/opacity/rainbow settings, but ships its own `ohcp-` classes so it
// does not depend on the Quick Panel having been created first.
//
// Drag + position persistence reuse the shared helpers from gold-per-minute.js,
// exactly as the Quick Panel does.

"use strict";

  function companionTr(key, params) {
    try {
      if (typeof tr === "function") return tr(key, params);
    } catch (_error) { /* fall through */ }
    return key;
  }

  function companionEsc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function companionEnsureStyles() {
    if (document.getElementById(COMPANION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = COMPANION_STYLE_ID;
    style.textContent = `
#${COMPANION_PANEL_ID}{position:fixed;z-index:2147483000;top:120px;left:16px;width:270px;
  background:var(--oh-panel-bg,rgba(12,18,20,.92));color:var(--oh-panel-text,#e2e8f0);
  border:1px solid var(--oh-panel-border,rgba(148,163,184,.34));border-radius:8px;
  font:12px/1.4 Aptos,system-ui,sans-serif;user-select:none;box-shadow:0 6px 22px rgba(0,0,0,.45)}
#${COMPANION_PANEL_ID} .ohcp-head{display:flex;align-items:center;gap:6px;padding:6px 8px;
  border-bottom:1px solid var(--oh-panel-border,rgba(148,163,184,.34));cursor:move}
#${COMPANION_PANEL_ID} .ohcp-title{flex:1;font-weight:600}
#${COMPANION_PANEL_ID} .ohcp-dot{width:8px;height:8px;border-radius:50%;background:#64748b}
#${COMPANION_PANEL_ID} .ohcp-dot.found{background:#4ade80}
#${COMPANION_PANEL_ID} .ohcp-dot.missing{background:#f87171}
#${COMPANION_PANEL_ID} .ohcp-dot.self{background:#94a3b8}
#${COMPANION_PANEL_ID} .ohcp-close{background:none;border:0;color:inherit;cursor:pointer;font-size:13px}
#${COMPANION_PANEL_ID} .ohcp-tabs{display:flex;border-bottom:1px solid var(--oh-panel-border,rgba(148,163,184,.34))}
#${COMPANION_PANEL_ID} .ohcp-tab{flex:1;text-align:center;padding:5px 0;cursor:pointer;opacity:.6}
#${COMPANION_PANEL_ID} .ohcp-tab.on{opacity:1;border-bottom:2px solid var(--oh-accent,#60a5fa)}
#${COMPANION_PANEL_ID} .ohcp-body{padding:8px;max-height:60vh;overflow:auto}
#${COMPANION_PANEL_ID} .ohcp-row{display:flex;align-items:center;gap:6px;padding:3px 0}
#${COMPANION_PANEL_ID} .ohcp-row.sub{padding-left:14px;opacity:.92}
#${COMPANION_PANEL_ID} .ohcp-label{flex:1}
#${COMPANION_PANEL_ID} .ohcp-sw{width:30px;height:16px;border-radius:8px;background:#475569;
  position:relative;cursor:pointer;flex:none}
#${COMPANION_PANEL_ID} .ohcp-sw.on{background:var(--oh-accent,#60a5fa)}
#${COMPANION_PANEL_ID} .ohcp-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;
  height:12px;border-radius:50%;background:#fff;transition:left .12s}
#${COMPANION_PANEL_ID} .ohcp-sw.on::after{left:16px}
#${COMPANION_PANEL_ID} .ohcp-input{width:62px;background:rgba(0,0,0,.3);color:inherit;
  border:1px solid var(--oh-panel-border,rgba(148,163,184,.34));border-radius:4px;padding:2px 4px}
#${COMPANION_PANEL_ID} .ohcp-input.wide{width:100%}
#${COMPANION_PANEL_ID} .ohcp-sec{margin-top:6px;font-weight:600;opacity:.85}
#${COMPANION_PANEL_ID} .ohcp-log{font:11px/1.5 monospace;white-space:pre-wrap;word-break:break-word}
#${COMPANION_PANEL_ID} .ohcp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:2px}
#${COMPANION_PANEL_ID} .ohcp-grid button{background:rgba(0,0,0,.25);border:1px solid transparent;
  border-radius:4px;cursor:pointer;font-size:15px;padding:2px}
#${COMPANION_PANEL_ID} .ohcp-warn{color:#fbbf24}
#${COMPANION_PANEL_ID} .ohcp-sec-h{display:flex;align-items:center;gap:4px;cursor:pointer;
  margin-top:6px;padding:3px 0;font-weight:600;opacity:.9;border-top:1px solid var(--oh-panel-border,rgba(148,163,184,.28))}
#${COMPANION_PANEL_ID} .ohcp-chev{width:10px;display:inline-block;text-align:center;opacity:.7}
#${COMPANION_PANEL_ID} .ohcp-sec-b{display:none;padding-left:2px}
#${COMPANION_PANEL_ID} .ohcp-sec-b.open{display:block}
#${COMPANION_PANEL_ID} .ohcp-tip{width:13px;height:13px;flex:none;border-radius:50%;
  border:1px solid var(--oh-panel-border,rgba(148,163,184,.5));font-size:9px;line-height:12px;
  text-align:center;opacity:.6;cursor:help}
#${COMPANION_PANEL_ID} .ohcp-row{padding:2px 0}
#${COMPANION_PANEL_ID} .ohcp-select{background:rgba(0,0,0,.3);color:inherit;
  border:1px solid var(--oh-panel-border,rgba(148,163,184,.34));border-radius:4px;padding:2px 4px}
`;
    document.head.appendChild(style);
  }

  function companionModeRow() {
    const s = companionSettings();
    return `<div class="ohcp-row"><span class="ohcp-label">${companionEsc(companionTr("Mode"))}</span>
<select class="ohcp-input" data-cp-mode>
<option value="passive"${s.mode === "passive" ? " selected" : ""}>${companionEsc(companionTr("Passive"))}</option>
<option value="active"${s.mode === "active" ? " selected" : ""}>${companionEsc(companionTr("Active"))}</option>
</select></div>`;
  }

  // Accordion section: a clickable header (chevron + title + one ?) over a body
  // that is shown/hidden by collapsedSections[key].
  function companionSection(key, title, tipKey, bodyHtml) {
    const collapsed = Boolean((companionSettings().collapsedSections || {})[key]);
    return `<div class="ohcp-sec-h" data-cp-section="${key}">
<span class="ohcp-chev">${collapsed ? "▸" : "▾"}</span>
<span class="ohcp-label">${companionEsc(companionTr(title))}</span>${companionTip(tipKey)}
</div><div class="ohcp-sec-b${collapsed ? "" : " open"}">${bodyHtml}</div>`;
  }

  // The spawn row differs by mode: passive keeps the "Spawn near boss" toggle;
  // active shows the strategy dropdown, and radius only when hugging the boss.
  function companionSpawnRows() {
    const s = companionSettings();
    if (s.mode !== "active") {
      return companionSwitch("autoSpawn", companionTr("Spawn near boss"))
        + companionNumber("spawnMinRadius", companionTr("Min radius"))
        + companionNumber("spawnMaxRadius", companionTr("Max radius"));
    }
    const strat = s.spawnStrategy === "auto" ? "auto" : "boss";
    let html = `<div class="ohcp-row"><span class="ohcp-label">${companionEsc(companionTr("Spawn type"))}${companionTip("spawnStrategy")}</span>
<select class="ohcp-select" data-cp-spawnstrategy>
<option value="boss"${strat === "boss" ? " selected" : ""}>${companionEsc(companionTr("Hug boss"))}</option>
<option value="auto"${strat === "auto" ? " selected" : ""}>${companionEsc(companionTr("Auto-bot optimal"))}</option>
</select></div>`;
    if (strat === "boss") {
      html += companionNumber("spawnMinRadius", companionTr("Min radius"))
        + companionNumber("spawnMaxRadius", companionTr("Max radius"));
    }
    return html;
  }

  // Clone of the RAW stored emojiBindings (as opposed to companionBindings(),
  // which resolves defaults and drops disabled ids). Any patch that writes back
  // to settings must start from this, not from companionBindings() — the latter
  // has already stripped out every disabled id, so patching from it would erase
  // the `null` markers of every OTHER disabled action the moment any one binding
  // changes.
  function companionRawEmojiBindings() {
    const raw = companionSettings().emojiBindings;
    return raw && typeof raw === "object" ? Object.assign({}, raw) : {};
  }

  function companionSwitch(key, label, sub, tipKey) {
    const on = Boolean(companionSettings()[key]);
    return `<div class="ohcp-row${sub ? " sub" : ""}"><span class="ohcp-label">${companionEsc(label)}${companionTip(tipKey || key)}</span>
<div class="ohcp-sw${on ? " on" : ""}" data-cp-toggle="${key}"></div></div>`;
  }

  function companionNumber(key, label) {
    return `<div class="ohcp-row sub"><span class="ohcp-label">${companionEsc(label)}</span>
<input class="ohcp-input" type="number" data-cp-num="${key}" value="${Number(companionSettings()[key])}"></div>`;
  }

  // Hover text for the "?" icon on each row. Keys are setting keys; values go
  // through companionTr() so they translate. A row with no entry gets no icon.
  const COMPANION_TIPS = {
    autoSpawn: "Spawn next to the boss during the spawn phase.",
    spawnStrategy: "Active mode: hug the boss, or let the auto-bot pick the best spot.",
    autoAlliance: "Accept (and request) an alliance only with the boss.",
    autoTroops: "Donate troops to the boss when the boss runs low.",
    autoGold: "Donate gold to the boss.",
    autoFactory: "Build a factory, then keep upgrading it toward the level cap.",
    emojiControl: "Let the boss command this bot with emoji.",
    tickMs: "How often the bot re-evaluates, in milliseconds.",
  };

  function companionTip(key) {
    const text = COMPANION_TIPS[key];
    if (!text) return "";
    return ` <span class="ohcp-tip" title="${companionEsc(companionTr(text))}">?</span>`;
  }

  function companionRenderControl() {
    const s = companionSettings();
    const st = companionState.bossStatus;
    const statusText = st === "found" ? companionTr("Boss found")
      : st === "missing" ? companionTr("Boss not found")
      : st === "self" ? companionTr("This tab is the boss")
      : companionTr("No boss set");

    const core = [
      `<div class="ohcp-row"><span class="ohcp-label">${companionEsc(companionTr("Companion mode"))}</span>
<div class="ohcp-sw${companionState.enabled ? " on" : ""}" data-cp-enabled></div></div>`,
      companionModeRow(),
      `<div class="ohcp-row"><span class="ohcp-label">${companionEsc(companionTr("Boss"))}</span></div>`,
      `<div class="ohcp-row"><input class="ohcp-input wide" type="text" data-cp-boss
value="${companionEsc(s.bossName)}" placeholder="${companionEsc(companionTr("Boss name"))}"></div>`,
      `<div class="ohcp-row"><span class="ohcp-label ${st === "missing" ? "ohcp-warn" : ""}">${companionEsc(statusText)}</span>
<button class="ohcp-input" data-cp-pick>▾</button></div>`,
    ].join("");

    const support = companionSpawnRows()
      + companionSwitch("autoAlliance", companionTr("Accept boss alliance"))
      + companionSwitch("autoTroops", companionTr("Donate troops"))
      + companionNumber("troopNeedPct", companionTr("Boss below %"))
      + companionNumber("troopSendPct", companionTr("Send %"))
      + companionSwitch("autoGold", companionTr("Donate gold"))
      + companionNumber("goldBuildingPct", companionTr("While building %"))
      + companionNumber("goldIdlePct", companionTr("When done %"));

    const economy = companionSwitch("autoFactory", companionTr("Auto factory"))
      + companionNumber("maxFactoryLevel", companionTr("Max factory level"))
      + `<div class="ohcp-row sub"><span class="ohcp-label">${companionEsc(companionTr("Current level"))}</span>
<span>${companionState.factoryLevel}</span></div>`;

    const advanced = companionSwitch("emojiControl", companionTr("Emoji commands"))
      + companionNumber("tickMs", companionTr("Tick (ms)"));

    return core
      + companionSection("support", "Support", "autoAlliance", support)
      + companionSection("economy", "Economy", "autoFactory", economy)
      + companionSection("advanced", "Advanced", "emojiControl", advanced);
  }

  function companionRenderEmoji() {
    const bindings = companionBindings();
    const labels = {
      donateAllGold: companionTr("Send all gold"),
      donateAllTroops: companionTr("Send all troops"),
      breakAlliance: companionTr("Break alliance"),
      requestAlliance: companionTr("Request alliance"),
      attackBossTarget: companionTr("Attack boss's target"),
      buildFactory: companionTr("Build/upgrade factory"),
      pause: companionTr("Pause"),
      resume: companionTr("Resume"),
    };
    const rows = COMPANION_ACTION_IDS.map(function (id) {
      const on = Object.prototype.hasOwnProperty.call(bindings, id);
      const emoji = on ? bindings[id] : COMPANION_DEFAULT_BINDINGS[id];
      return `<div class="ohcp-row"><button class="ohcp-input" data-cp-emoji="${id}"
style="width:34px">${companionEsc(emoji)}</button>
<span class="ohcp-label">${companionEsc(labels[id] || id)}</span>
<div class="ohcp-sw${on ? " on" : ""}" data-cp-emoji-toggle="${id}"></div></div>`;
    }).join("");
    return rows + `<div class="ohcp-row sub">${companionEsc(
      companionTr("Emoji to one bot targets it; emoji to All players targets every bot."))}</div>`;
  }

  function companionRenderLog() {
    const sockOk = typeof isSocketConnected === "function" ? isSocketConnected() : null;
    const head = `<div class="ohcp-row"><span class="ohcp-label">${companionEsc(companionTr("Socket"))}</span>
<span class="${sockOk === false ? "ohcp-warn" : ""}">${companionEsc(sockOk === null ? "?" : sockOk ? "OK" : companionTr("disconnected"))}</span></div>`;
    const fail = companionState.lastSendFailedAt
      ? `<div class="ohcp-row ohcp-warn">${companionEsc(companionTr("Last send failed"))}: ${
          new Date(companionState.lastSendFailedAt).toLocaleTimeString()}</div>`
      : "";
    const lines = companionState.log.map(function (e) {
      return companionEsc(new Date(e.at).toLocaleTimeString() + "  " + e.text);
    }).join("\n");
    return head + fail + `<div class="ohcp-log">${lines}</div>`;
  }

  // Build the panel chrome (header + tabs + empty body) exactly once, then only
  // ever rewrite .ohcp-body. The old code re-set the whole panel.innerHTML on
  // every refresh, which destroyed the header the drag handler was attached to —
  // so the panel could not be dragged after the first tab switch or tick sync.
  //
  // The three chrome nodes (head / tabs / body) are built with createElement so
  // each is a stable object: the head the drag handler attaches to is never
  // replaced, and rewriting the body cannot touch it. (The head's OWN inner
  // markup is set once via head.innerHTML — that never changes after creation.)
  function companionBuildPanel() {
    companionEnsureStyles();
    let panel = document.getElementById(COMPANION_PANEL_ID);
    const s = companionSettings();
    if (s.hidden) {
      if (panel) panel.remove();
      return null;
    }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = COMPANION_PANEL_ID;

      const head = document.createElement("div");
      head.className = "ohcp-head";
      head.innerHTML = `<span class="ohcp-dot"></span>
<span class="ohcp-title">🤝 ${companionEsc(companionTr("Companion"))}</span>
<button class="ohcp-close" data-cp-close>✕</button>`;
      panel.appendChild(head);

      const tabsEl = document.createElement("div");
      tabsEl.className = "ohcp-tabs";
      panel.appendChild(tabsEl);

      const bodyEl = document.createElement("div");
      bodyEl.className = "ohcp-body";
      panel.appendChild(bodyEl);

      document.body.appendChild(panel);

      // Drag is wired to the head node ONCE; that node is never replaced again.
      if (typeof makeGoldStatPanelDraggable === "function") {
        makeGoldStatPanelDraggable(panel, head, COMPANION_PANEL_POS_KEY);
      }
      if (typeof applyStoredGoldStatPanelPosition === "function") {
        applyStoredGoldStatPanelPosition(panel, COMPANION_PANEL_POS_KEY);
      }

      // Close button lives in the fixed chrome, wired once.
      const close = head.querySelector("[data-cp-close]");
      if (close) {
        close.addEventListener("click", function () {
          companionPatchSettings({ hidden: true });
          panel.remove();
          try {
            window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
              detail: { key: "showCompanionPanel", value: false },
            }));
          } catch (_error) { /* ignore */ }
        });
      }
    }

    companionRenderTabs(panel);
    companionRenderBody(panel);
    companionUpdateChrome(panel);
    return panel;
  }

  // The tab strip is fixed chrome too; build it once, then only toggle `on`.
  function companionRenderTabs(panel) {
    const tabsEl = panel.querySelector(".ohcp-tabs");
    if (!tabsEl) return;
    if (!tabsEl.innerHTML) {
      const defs = [["control", "Control"], ["emoji", "Emoji"], ["log", "Log"]];
      tabsEl.innerHTML = defs.map(function (d) {
        return `<div class="ohcp-tab" data-cp-tab="${d[0]}">${companionEsc(companionTr(d[1]))}</div>`;
      }).join("");
      tabsEl.querySelectorAll("[data-cp-tab]").forEach(function (el) {
        el.addEventListener("click", function () {
          companionPatchSettings({ activeTab: el.dataset.cpTab });
          companionRenderBody(panel);
          companionUpdateChrome(panel);
        });
      });
    }
  }

  // Cheap, non-destructive updates to the fixed chrome (dot colour, active tab).
  function companionUpdateChrome(panel) {
    const dot = panel.querySelector(".ohcp-dot");
    if (dot) dot.className = "ohcp-dot " + companionEsc(companionState.bossStatus);
    const active = (companionSettings().activeTab) || "control";
    panel.querySelectorAll("[data-cp-tab]").forEach(function (el) {
      el.classList.toggle("on", el.dataset.cpTab === active);
    });
  }

  // Rewrite ONLY the body for the active tab, and wire the body's own controls.
  function companionRenderBody(panel) {
    const bodyEl = panel.querySelector(".ohcp-body");
    if (!bodyEl) return;
    const tab = (companionSettings().activeTab) || "control";
    bodyEl.innerHTML = tab === "emoji" ? companionRenderEmoji()
      : tab === "log" ? companionRenderLog()
      : companionRenderControl();
    companionBindBodyEvents(panel);
  }

  function companionBindBodyEvents(panel) {
    const enabled = panel.querySelector("[data-cp-enabled]");
    if (enabled) {
      enabled.addEventListener("click", function () {
        const next = !companionState.enabled;
        setCompanionEnabled(next);
        try {
          window.dispatchEvent(new CustomEvent("ofh-quick-panel-setting", {
            detail: { key: "companionEnabled", value: next },
          }));
        } catch (_error) { /* ignore */ }
        companionRenderBody(panel);
        companionUpdateChrome(panel);
      });
    }

    panel.querySelectorAll("[data-cp-toggle]").forEach(function (el) {
      el.addEventListener("click", function () {
        const key = el.dataset.cpToggle;
        const patch = {};
        patch[key] = !companionSettings()[key];
        companionPatchSettings(patch);
        companionRenderBody(panel);
      });
    });

    panel.querySelectorAll("[data-cp-num]").forEach(function (el) {
      el.addEventListener("change", function () {
        const patch = {};
        patch[el.dataset.cpNum] = Number(el.value);
        companionPatchSettings(patch);
      });
    });

    const bossInput = panel.querySelector("[data-cp-boss]");
    if (bossInput) {
      bossInput.addEventListener("change", function () {
        companionPatchSettings({ bossName: bossInput.value });
        companionRenderBody(panel);
        companionUpdateChrome(panel);
      });
    }

    const mode = panel.querySelector("[data-cp-mode]");
    if (mode) {
      mode.addEventListener("change", function () {
        companionPatchSettings({ mode: mode.value });
        if (typeof companionSyncAutobot === "function") companionSyncAutobot();
        companionRenderBody(panel);
        companionUpdateChrome(panel);
      });
    }

    panel.querySelectorAll("[data-cp-section]").forEach(function (el) {
      el.addEventListener("click", function () {
        const key = el.dataset.cpSection;
        const cur = (companionSettings().collapsedSections || {})[key];
        const patch = { collapsedSections: {} };
        patch.collapsedSections[key] = !cur;
        companionPatchSettings(patch);
        companionRenderBody(panel);
      });
    });

    const spawnStrat = panel.querySelector("[data-cp-spawnstrategy]");
    if (spawnStrat) {
      spawnStrat.addEventListener("change", function () {
        companionPatchSettings({ spawnStrategy: spawnStrat.value });
        companionRenderBody(panel);
      });
    }

    const pick = panel.querySelector("[data-cp-pick]");
    if (pick) {
      pick.addEventListener("click", function () {
        const game = typeof getOpenFrontGameContext === "function"
          ? (getOpenFrontGameContext() || {}).game : null;
        const names = companionHumanPlayers(game).map(function (p) {
          try { return p.name(); } catch (_e) { return null; }
        }).filter(Boolean);
        if (names.length === 0) {
          companionLog(companionTr("No human players found"));
          companionPatchSettings({ activeTab: "log" });
          companionRenderBody(panel);
          companionUpdateChrome(panel);
          return;
        }
        companionShowPicker(panel, names, function (name) {
          companionPatchSettings({ bossName: name });
          companionRenderBody(panel);
        });
      });
    }

    panel.querySelectorAll("[data-cp-emoji]").forEach(function (el) {
      el.addEventListener("click", function () {
        const table = typeof emojiTable !== "undefined" && Array.isArray(emojiTable)
          ? emojiTable : null;
        if (!table) return;
        companionShowPicker(panel, table.flat(), function (emoji) {
          const patch = companionRawEmojiBindings();
          patch[el.dataset.cpEmoji] = emoji;
          companionPatchSettings({ emojiBindings: patch });
          companionRenderBody(panel);
        }, true);
      });
    });

    panel.querySelectorAll("[data-cp-emoji-toggle]").forEach(function (el) {
      el.addEventListener("click", function () {
        const id = el.dataset.cpEmojiToggle;
        const on = Object.prototype.hasOwnProperty.call(companionBindings(), id);
        const patch = companionRawEmojiBindings();
        patch[id] = on ? null : COMPANION_DEFAULT_BINDINGS[id];
        companionPatchSettings({ emojiBindings: patch });
        companionRenderBody(panel);
      });
    });
  }

  // Minimal inline chooser reused by the boss picker and the emoji grid.
  function companionShowPicker(panel, items, onPick, grid) {
    const body = panel.querySelector(".ohcp-body");
    if (!body) return;
    const html = items.map(function (it) {
      return `<button class="ohcp-input" data-cp-pickitem="${companionEsc(it)}"
style="${grid ? "" : "width:100%;text-align:left;"}margin:1px">${companionEsc(it)}</button>`;
    }).join("");
    body.innerHTML = grid ? `<div class="ohcp-grid">${html}</div>` : html;
    body.querySelectorAll("[data-cp-pickitem]").forEach(function (el) {
      el.addEventListener("click", function () {
        onPick(el.dataset.cpPickitem);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Always-on warning banner
  // ---------------------------------------------------------------------------

  // The panel can be hidden; this cannot. With several tabs open the one question
  // that matters is "is this tab a bot or is it me?", and getting it wrong means
  // typing into the wrong window or leaving a bot running unnoticed.
  function companionSyncBanner() {
    let el = document.getElementById(COMPANION_BANNER_ID);
    if (!companionState.enabled) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = COMPANION_BANNER_ID;
      document.body.appendChild(el);
    }

    const s = companionSettings();
    let bg = "rgba(180,120,20,.95)";
    let text;
    if (companionState.paused) {
      bg = "rgba(90,100,110,.95)";
      text = "— " + companionTr("paused");
    } else if (companionState.bossStatus === "self") {
      bg = "rgba(90,100,110,.95)";
      text = "— " + companionTr("this tab is the boss");
    } else if (companionState.bossStatus === "found") {
      text = "→ " + s.bossName;
    } else if (companionState.bossStatus === "idle") {
      // Enabled but no boss name typed in yet — there is nothing to have failed
      // to find, so this must not read like the "missing" (typo'd/not joined) red
      // state below.
      bg = "rgba(90,100,110,.95)";
      text = "— " + companionTr("No boss set");
    } else {
      bg = "rgba(180,50,50,.95)";
      text = "— " + companionTr("no boss");
    }

    el.style.cssText = [
      "position:fixed", "top:0", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483100",
      // The banner sits over the map; it must never swallow a click.
      "pointer-events:none",
      "padding:3px 14px", "border-radius:0 0 6px 6px",
      "font:700 12px/1.5 Aptos,system-ui,sans-serif", "letter-spacing:.4px",
      "color:#fff", "white-space:nowrap",
      "box-shadow:0 2px 10px rgba(0,0,0,.45)",
      "background:" + bg,
    ].join(";");
    el.textContent = `🤝 ${companionTr("COMPANION")} ${text}`;
  }

  function companionRefreshPanel() {
    try {
      companionBuildPanel();
    } catch (error) {
      console.warn("[Companion] panel render failed:", error);
    }
    try {
      companionSyncBanner();
    } catch (error) {
      console.warn("[Companion] banner render failed:", error);
    }
  }
