// Right-click conquest menu: when right-clicking on the map near an enemy
// player, shows a compact context menu with:
//   • Capture assessment (easy/moderate/risky) based on troop ratio
//   • "Attack N troops" button (one-click conquest using emitIntent)
//   • "Favourite" / "Blacklist" alliance policy buttons
//
// The menu appears at the cursor position and auto-dismisses on click-away.
// Uses the same intent API (discoverCtors / emitIntent) as auto-bot/boat-macro.

  function ensureRightClickStyles() {
    if (document.getElementById(RIGHT_CLICK_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = RIGHT_CLICK_STYLE_ID;
    style.textContent = `
      #${RIGHT_CLICK_MENU_ID} {
        position: fixed;
        z-index: 9000;
        min-width: 180px;
        border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
        border-radius: 8px;
        background: var(--oh-panel-bg, rgba(12,18,20,0.92));
        color: var(--oh-panel-text, #e2e8f0);
        font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        font-size: 11px; font-weight: 700;
        box-shadow: 0 10px 26px rgba(0,0,0,0.5), 0 0 16px var(--oh-accent-soft, rgba(96,165,250,0.15));
        pointer-events: auto; user-select: none;
        padding: 6px;
        display: none;
      }
      #${RIGHT_CLICK_MENU_ID}[data-open="true"] { display: block; }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-header {
        display: flex; align-items: center; gap: 6px;
        padding: 4px 6px 6px; margin-bottom: 4px;
        border-bottom: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-name {
        flex: 1; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-tier {
        padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 900;
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 5px 8px; margin: 2px 0; border-radius: 6px;
        cursor: pointer; white-space: nowrap;
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-btn:hover { background: var(--oh-panel-header-border, rgba(148,163,184,0.18)); }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-sep {
        height: 1px; background: rgba(148,163,184,0.14); margin: 4px 0;
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-attack {
        color: var(--oh-panel-text, #e2e8f0); font-weight: 800;
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-attack:hover {
        background: rgba(248,113,113,0.2);
      }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-fav { color: var(--oh-accent, #60a5fa); }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-bl { color: var(--oh-panel-text, #e2e8f0); }
      #${RIGHT_CLICK_MENU_ID} .ofh-rc-reason {
        padding: 4px 6px; color: rgba(148,163,184,0.85); font-size: 10px;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureRightClickMenu() {
    ensureRightClickStyles();
    let menu = document.getElementById(RIGHT_CLICK_MENU_ID);
    if (!menu) {
      menu = document.createElement("div");
      menu.id = RIGHT_CLICK_MENU_ID;
      (document.body || document.documentElement).appendChild(menu);
    }
    return menu;
  }

  function closeRightClickMenu() {
    const menu = document.getElementById(RIGHT_CLICK_MENU_ID);
    if (menu) {
      menu.dataset.open = "false";
      menu.replaceChildren();
    }
  }

  function captureTierStyle(tier) {
    switch (tier) {
      case "easy":
        return { bg: "rgba(20,83,45,0.6)", fg: "var(--oh-accent, #60a5fa)", label: tr("easy") };
      case "risky":
        return { bg: "rgba(127,29,29,0.6)", fg: "var(--oh-panel-text, #e2e8f0)", label: tr("risky") };
      default:
        return { bg: "rgba(148,163,184,0.28)", fg: "#e2e8f0", label: tr("moderate") };
    }
  }

  // Find the nearest enemy player to a world coordinate by scanning all living
  // players and picking the one with the smallest manhattan distance to their
  // nameLocation.
  function findNearestEnemy(game, worldX, worldY) {
    const players = getCachedPlayerViews(game);
    const me = game.myPlayer ? game.myPlayer() : null;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      let rel = "enemy";
      try { rel = getPlayerRelationToMyPlayer(game, p) || "enemy"; } catch (_e) { rel = "enemy"; }
      if (rel !== "enemy") continue;
      let loc = null;
      try { loc = p.nameLocation ? p.nameLocation() : null; } catch (_e) { loc = null; }
      if (!loc) continue;
      const d = Math.abs(loc.x - worldX) + Math.abs(loc.y - worldY);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  function showRightClickMenu(screenX, screenY, game, transform, targetPlayer) {
    const menu = ensureRightClickMenu();
    menu.style.left = `${screenX}px`;
    menu.style.top = `${screenY}px`;
    menu.dataset.open = "true";
    menu.replaceChildren();

    const me = game.myPlayer ? game.myPlayer() : null;
    const myTroops = me ? advTroops(me) : 0;
    const targetTroops = advTroops(targetPlayer);
    const maxTroops = advMaxTroops(game, targetPlayer);

    // Capture assessment: easy if we have >=2x their troops, risky if <1x.
    let tier = "moderate";
    if (myTroops >= 2 * Math.max(1, targetTroops)) tier = "easy";
    else if (myTroops < targetTroops) tier = "risky";

    const ts = captureTierStyle(tier);
    let name = "?";
    try { name = getPlayerDisplayName ? getPlayerDisplayName(targetPlayer) : targetPlayer.name && targetPlayer.name(); } catch (_e) { name = "?"; }

    // Header: name + tier badge.
    const header = document.createElement("div");
    header.className = "ofh-rc-header";
    const nameEl = document.createElement("div");
    nameEl.className = "ofh-rc-name";
    nameEl.textContent = name;
    const tierEl = document.createElement("div");
    tierEl.className = "ofh-rc-tier";
    tierEl.style.background = ts.bg;
    tierEl.style.color = ts.fg;
    tierEl.textContent = ts.label;
    header.appendChild(nameEl);
    header.appendChild(tierEl);
    menu.appendChild(header);

    // Attack button (one-click conquest).
    const safeTroops = Math.max(0, Math.floor(advEvaluateSelfEconomy(game, me)?.safeSpendableTroops || 0));
    const attackTroops = Math.min(safeTroops, Math.max(1, Math.floor(targetTroops * 1.2)));
    const attackBtn = document.createElement("div");
    attackBtn.className = "ofh-rc-btn ofh-rc-attack";
    attackBtn.textContent = `⚔ ${tr("Attack")} ${troopsDisplay(attackTroops)}`;
    attackBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fireOneClickAttack(game, targetPlayer, attackTroops);
      closeRightClickMenu();
    });
    menu.appendChild(attackBtn);

    // Separator.
    const sep = document.createElement("div");
    sep.className = "ofh-rc-sep";
    menu.appendChild(sep);

    // Alliance policy buttons.
    const sid = targetPlayer.smallID ? targetPlayer.smallID() : null;
    const currentPolicy = sid != null ? getAlliancePolicyFor(sid) : null;

    const favBtn = document.createElement("div");
    favBtn.className = "ofh-rc-btn ofh-rc-fav";
    favBtn.textContent = currentPolicy === "favourite" ? "★ Favourited" : "★ Favourite";
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sid != null) setAlliancePolicyFor(sid, currentPolicy === "favourite" ? null : "favourite");
      closeRightClickMenu();
    });
    menu.appendChild(favBtn);

    const blBtn = document.createElement("div");
    blBtn.className = "ofh-rc-btn ofh-rc-bl";
    blBtn.textContent = currentPolicy === "blacklist" ? "⛔ Blacklisted" : "⛔ Blacklist";
    blBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sid != null) setAlliancePolicyFor(sid, currentPolicy === "blacklist" ? null : "blacklist");
      closeRightClickMenu();
    });
    menu.appendChild(blBtn);
  }

  function fireOneClickAttack(game, targetPlayer, troops) {
    try {
      if (typeof discoverCtors !== "function" || typeof getEventBus !== "function") return;
      const eventBus = getEventBus();
      if (!eventBus) return;
      const ctors = discoverCtors(eventBus);
      if (!ctors.attack) return;
      const targetId = targetPlayer.id ? targetPlayer.id() : null;
      if (targetId != null) {
        emitIntent(ctors.attack, targetId, troops);
      }
    } catch (_error) {
      // Silent.
    }
  }

  function handleRightClick(event) {
    if (!rightClickMenuEnabled) return;
    // Only intercept right-clicks on the game canvas (not on our panels).
    if (event.target.closest(`#${RIGHT_CLICK_MENU_ID}, [id^="openfront-helper-"]`)) return;
    let context = null;
    try { context = getOpenFrontGameContext(); } catch (_error) { context = null; }
    if (!context?.game || !context?.transform) return;

    // Convert screen coords to world coords.
    const screenX = event.clientX;
    const screenY = event.clientY;
    let worldPoint = null;
    try {
      // worldToScreenCoordinates goes world→screen; we need the inverse.
      // Approximate by iterating players and finding the nearest by screen dist.
      // (A proper inverse-transform would require the game's transform object
      // which may not expose screenToWorldCoordinates.)
    } catch (_error) { /* ignore */ }

    // Find nearest enemy by screen distance (more intuitive than world distance
    // when zoomed in).
    const players = getCachedPlayerViews(context.game);
    const me = context.game.myPlayer ? context.game.myPlayer() : null;
    let best = null;
    let bestScreenDist = 80; // max click radius in px
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      if (!p || !p.isAlive || !p.isAlive()) continue;
      let rel = "enemy";
      try { rel = getPlayerRelationToMyPlayer(context.game, p) || "enemy"; } catch (_e) { rel = "enemy"; }
      if (rel !== "enemy") continue;
      let loc = null;
      try { loc = p.nameLocation ? p.nameLocation() : null; } catch (_e) { loc = null; }
      if (!loc) continue;
      let sp = null;
      try { sp = context.transform.worldToScreenCoordinates(loc); } catch (_e) { sp = null; }
      if (!sp) continue;
      const d = Math.hypot(sp.x - screenX, sp.y - screenY);
      if (d < bestScreenDist) {
        bestScreenDist = d;
        best = p;
      }
    }

    if (!best) {
      closeRightClickMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showRightClickMenu(screenX, screenY, context.game, context.transform, best);
  }

  // Close menu on any left-click or Escape.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(`#${RIGHT_CLICK_MENU_ID}`)) {
      closeRightClickMenu();
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRightClickMenu();
  }, true);

  function setRightClickMenuEnabled(enabled) {
    rightClickMenuEnabled = Boolean(enabled);
    if (!rightClickMenuEnabled) {
      closeRightClickMenu();
    }
  }
