// Send 1% Boat context menu macro.
// Right-click anywhere on the map to send a transport with 1% of troops,
// then restores the previous attack ratio.

  const BOAT_MACRO_CONTEXT_MENU_ID = "openfront-helper-boat-macro-menu";
  const BOAT_MACRO_CONTEXT_MENU_STYLE_ID = "openfront-helper-boat-macro-menu-styles";

  let send1PercentBoatEnabled = false;
  let send1PercentBoatContextMenu = true;
  let boatMacroContextMenuInstalled = false;
  let boatMacroContextMenuParams = null;
  let boatMacroLastMouseX = 0;
  let boatMacroLastMouseY = 0;

  function getBoatMacroRadialElement() {
    return document.querySelector("main-radial-menu");
  }

  function getBoatMacroUiState(radialMenuElement) {
    // Try direct access (works if field names aren't mangled)
    if (radialMenuElement?.uiState?.attackRatio !== undefined) {
      return radialMenuElement.uiState;
    }
    // Fall back to buildMenu.uiState — BuildMenu declares uiState as public,
    // so it is never mangled.
    const buildMenu = radialMenuElement?.buildMenu || document.querySelector("build-menu");
    if (buildMenu?.uiState?.attackRatio !== undefined) {
      return buildMenu.uiState;
    }
    return null;
  }

  function findPlayerActionHandler(radialMenuElement) {
    // Try direct access first (works if private field name is preserved)
    if (typeof radialMenuElement?.playerActionHandler?.handleBoatAttack === "function") {
      return radialMenuElement.playerActionHandler;
    }
    // Scan own properties for an object with handleBoatAttack method.
    if (radialMenuElement) {
      for (const key of Object.getOwnPropertyNames(radialMenuElement)) {
        const val = radialMenuElement[key];
        if (val && typeof val.handleBoatAttack === "function") {
          return val;
        }
      }
    }
    return null;
  }

  // Finds the SendBoatAttackIntentEvent constructor by scanning the EventBus
  // listener map. Identified by structural signature: constructor(dst, troops)
  // where the resulting instance has { dst, troops } properties.
  function findBoatAttackEventCtor(eventBus) {
    if (!eventBus) return null;
    // EventBus.listeners is private but field name is preserved (no property mangling in vite config).
    let listenersMap = eventBus.listeners instanceof Map ? eventBus.listeners : null;
    if (!listenersMap) {
      for (const key of Object.getOwnPropertyNames(eventBus)) {
        if (eventBus[key] instanceof Map) { listenersMap = eventBus[key]; break; }
      }
    }
    if (!listenersMap) return null;
    for (const ctor of listenersMap.keys()) {
      try {
        const inst = new ctor(0, 100);
        if (inst && inst.dst === 0 && inst.troops === 100) return ctor;
      } catch { /* skip ctors that throw */ }
    }
    return null;
  }

  function getBoatMacroContextParamsFromEvent(event) {
    const radialMenuElement = getBoatMacroRadialElement();
    const game = radialMenuElement?.game || lastOpenFrontGameContext?.game;
    const transform =
      radialMenuElement?.transformHandler ||
      radialMenuElement?.transform ||
      lastOpenFrontGameContext?.transform;
    const myPlayer = game?.myPlayer?.();

    if (
      !game ||
      !transform?.screenToWorldCoordinates ||
      !myPlayer?.isPlayer?.()
    ) {
      return null;
    }

    let worldCoords = null;
    try {
      worldCoords = transform.screenToWorldCoordinates(event.clientX, event.clientY);
      if (!game.isValidCoord?.(worldCoords.x, worldCoords.y)) {
        return null;
      }
    } catch (_error) {
      return null;
    }

    let tile = null;
    try {
      tile = game.ref(worldCoords.x, worldCoords.y);
      if (tile == null) {
        return null;
      }
    } catch (_error) {
      return null;
    }

    return { myPlayer, tile, radialMenuElement };
  }

  function hideBoatMacroContextMenu() {
    const menu = document.getElementById(BOAT_MACRO_CONTEXT_MENU_ID);
    if (menu) {
      menu.hidden = true;
    }
  }

  function ensureBoatMacroContextMenuStyles() {
    if (document.getElementById(BOAT_MACRO_CONTEXT_MENU_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = BOAT_MACRO_CONTEXT_MENU_STYLE_ID;
    style.textContent = `
      #${BOAT_MACRO_CONTEXT_MENU_ID} {
        position: fixed;
        z-index: 9000;
        min-width: 180px;
        padding: 6px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        background: rgba(13, 18, 24, 0.96);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        color: #f8fafc;
        font: 800 12px/1.15 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${BOAT_MACRO_CONTEXT_MENU_ID}[hidden] {
        display: none;
      }
      #${BOAT_MACRO_CONTEXT_MENU_ID} button {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
        font: inherit;
        letter-spacing: 0;
      }
      #${BOAT_MACRO_CONTEXT_MENU_ID} button:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      #${BOAT_MACRO_CONTEXT_MENU_ID} button:active {
        background: rgba(255, 255, 255, 0.14);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBoatMacroContextMenu() {
    ensureBoatMacroContextMenuStyles();
    let menu = document.getElementById(BOAT_MACRO_CONTEXT_MENU_ID);
    if (menu) {
      return menu;
    }

    menu = document.createElement("div");
    menu.id = BOAT_MACRO_CONTEXT_MENU_ID;
    menu.hidden = true;
    menu.innerHTML = `<button type="button">⚓ Send 1% Boat <span style="opacity:0.5;font-weight:400;font-size:10px">[N]</span></button>`;
    menu.addEventListener("click", (event) => {
      const btn = event.target?.closest("button");
      if (!btn) {
        return;
      }
      const params = boatMacroContextMenuParams;
      hideBoatMacroContextMenu();
      if (params) {
        executeSend1PercentBoat(params);
      }
    });
    document.body.appendChild(menu);
    return menu;
  }

  function executeSend1PercentBoat(params) {
    const { myPlayer, tile, radialMenuElement } = params;
    const buildMenu = radialMenuElement?.buildMenu || document.querySelector("build-menu");
    const eventBus = buildMenu?.eventBus;

    // Primary: emit SendBoatAttackIntentEvent directly via the EventBus.
    // This avoids needing playerActionHandler and keeps uiState untouched.
    if (eventBus) {
      const BoatAttackCtor = findBoatAttackEventCtor(eventBus);
      if (BoatAttackCtor) {
        const troops = 0.01 * (myPlayer.troops?.() || 0);
        eventBus.emit(new BoatAttackCtor(tile, troops));
        return;
      }
    }

    // Fallback: use playerActionHandler with attackRatio temporarily set to 1%.
    const uiState = getBoatMacroUiState(radialMenuElement);
    const playerActionHandler = findPlayerActionHandler(radialMenuElement);
    if (!playerActionHandler) {
      console.warn("[OpenFront Helper] Send 1% Boat: could not find playerActionHandler or eventBus");
      return;
    }
    const prevRatio = uiState ? uiState.attackRatio : null;
    if (uiState) uiState.attackRatio = 0.01;
    try {
      playerActionHandler.handleBoatAttack(myPlayer, tile);
    } finally {
      if (uiState && prevRatio !== null) uiState.attackRatio = prevRatio;
    }
  }

  function showBoatMacroContextMenu(x, y, params) {
    const menu = ensureBoatMacroContextMenu();
    boatMacroContextMenuParams = params;
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";

    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(6, x), window.innerWidth - rect.width - 6);
    const top = Math.min(Math.max(6, y), window.innerHeight - rect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function handleBoatMacroContextMenu(event) {
    if (!send1PercentBoatEnabled || !send1PercentBoatContextMenu) {
      return;
    }
    const params = getBoatMacroContextParamsFromEvent(event);
    if (!params) {
      hideBoatMacroContextMenu();
      return;
    }
    showBoatMacroContextMenu(event.clientX + 108, event.clientY - 58, params);
  }

  function handleBoatMacroPointerDown(event) {
    const menu = document.getElementById(BOAT_MACRO_CONTEXT_MENU_ID);
    if (!menu || menu.hidden || menu.contains(event.target)) {
      return;
    }
    hideBoatMacroContextMenu();
  }

  function handleBoatMacroMouseMove(event) {
    boatMacroLastMouseX = event.clientX;
    boatMacroLastMouseY = event.clientY;
  }

  function isBoatMacroEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable ||
      Boolean(target.closest('[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'))
    );
  }

  function isBoatMacroTypingEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.some((target) => isBoatMacroEditableTarget(target))) {
      return true;
    }
    return isBoatMacroEditableTarget(document.activeElement);
  }

  function isBoatMacroHotkey(event) {
    return (
      event.code === "KeyN" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !isBoatMacroTypingEvent(event)
    );
  }

  // Single keydown handler: blocks the game's N handler AND fires the boat send.
  function handleBoatMacroKeyDown(event) {
    if (event.key === "Escape") {
      hideBoatMacroContextMenu();
      return;
    }
    if (isBoatMacroHotkey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const syntheticEvent = { clientX: boatMacroLastMouseX, clientY: boatMacroLastMouseY };
      const params = getBoatMacroContextParamsFromEvent(syntheticEvent);
      if (params) {
        hideBoatMacroContextMenu();
        executeSend1PercentBoat(params);
      }
    }
  }

  // Keyup blocker: prevents the game's keyup N handler from firing.
  function handleBoatMacroKeyUp(event) {
    if (isBoatMacroHotkey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function installBoatMacroContextMenu() {
    if (boatMacroContextMenuInstalled) {
      return;
    }
    boatMacroContextMenuInstalled = true;
    document.addEventListener("contextmenu", handleBoatMacroContextMenu, true);
    document.addEventListener("pointerdown", handleBoatMacroPointerDown, true);
    window.addEventListener("keydown", handleBoatMacroKeyDown, true);
    window.addEventListener("keyup", handleBoatMacroKeyUp, true);
    document.addEventListener("mousemove", handleBoatMacroMouseMove, { passive: true });
    window.addEventListener("wheel", hideBoatMacroContextMenu, true);
  }

  function uninstallBoatMacroContextMenu() {
    if (!boatMacroContextMenuInstalled) {
      return;
    }
    boatMacroContextMenuInstalled = false;
    document.removeEventListener("contextmenu", handleBoatMacroContextMenu, true);
    document.removeEventListener("pointerdown", handleBoatMacroPointerDown, true);
    window.removeEventListener("keydown", handleBoatMacroKeyDown, true);
    window.removeEventListener("keyup", handleBoatMacroKeyUp, true);
    document.removeEventListener("mousemove", handleBoatMacroMouseMove);
    window.removeEventListener("wheel", hideBoatMacroContextMenu, true);
    hideBoatMacroContextMenu();
  }

  function setSend1PercentBoatEnabled(enabled, contextMenu = true) {
    send1PercentBoatEnabled = Boolean(enabled);
    send1PercentBoatContextMenu = Boolean(contextMenu);
    if (enabled) {
      installBoatMacroContextMenu();
    } else {
      uninstallBoatMacroContextMenu();
    }
  }
