// TN1 — Detect other players running this script via a fixed 3-emoji broadcast
// "signature" and list them in a draggable panel. The game's deterministic sim
// puts every emoji into updatesSinceLastTick() on every client, so we recognise
// each other without any server of our own.
//
// Broadcast (recipient = AllPlayers, i.e. clicking yourself + an emoji) does NOT
// add a line to anyone's events-display message box (game blocks it at
// EventsDisplay.ts:516) — it only floats on the sender's own nameplate for ~5s
// (name-pass WebGL, recipientID === "AllPlayers"). So the signature is low-noise.

  const HELPER_SIGNATURE_SEQUENCE = ["🤝", "🕊️", "🐔"]; // order matters
  const HELPER_DETECT_WINDOW_MS = 45000; // max gap between consecutive signature emoji (per-step, not whole-sequence)
  const HELPER_USERS_STYLE_ID = "openfront-helper-users-styles";
  const HELPER_USERS_BADGE_ID = "openfront-helper-users-panel";
  const HELPER_USERS_POS_KEY = "openfront-helper-users-pos";

  let helperUsersEnabled = false;
  const HELPER_SAMPLE_MS = 80; // < game turn (~100ms) so no emoji turn is skipped
  let _helperIntervalId = null;
  let _helperSignatureSentKey = null;
  let _helperLastProcessedTick = null;
  let _helperLastGameKey = null;
  let _helperUsersRenderSig = null;
  const _helperSeqProgress = new Map(); // senderSmallID -> { step, lastAt }
  const _helperUsers = new Set(); // confirmed script-user smallIDs (this match)

  // ---- Signature broadcast (once per match) --------------------------------

  function _helperGameKey(game) {
    try {
      const id = game?.gameID?.() ?? game?.id?.() ?? null;
      if (id !== null && id !== undefined) return String(id);
    } catch (_e) {
      /* ignore */
    }
    return "default";
  }

  function _maybeSendHelperSignature(game) {
    const key = _helperGameKey(game);
    if (_helperSignatureSentKey === key) return;
    const me = game?.myPlayer?.();
    if (!me || !me.isAlive?.()) return; // wait until spawned/alive
    // Wait until the spawn phase is over. EmojiExecution.activeDuringSpawnPhase()
    // is false, so emojis sent during spawn are HELD (uninitialised) and all fire
    // in the same tick once spawn ends — the game's 50-tick emoji cooldown then
    // rejects every broadcast after the first, so only the 1st emoji survives.
    if (game.inSpawnPhase?.()) return;
    const players = getCachedPlayerViews(game);
    if (!players || players.length < 2) return; // need an audience
    _helperSignatureSentKey = key;
    for (const emojiStr of HELPER_SIGNATURE_SEQUENCE) {
      enqueueSignal("emoji", AllPlayers, [AllPlayers, emojiId(emojiStr)]);
    }
  }

  // ---- Signature detection --------------------------------------------------

  function _recordHelperEmoji(senderSmallId, emojiStr, nowMs) {
    if (!Number.isFinite(senderSmallId)) return;
    if (_helperUsers.has(senderSmallId)) return; // already confirmed
    const seq = HELPER_SIGNATURE_SEQUENCE;
    let rec = _helperSeqProgress.get(senderSmallId);
    if (rec && nowMs - rec.lastAt > HELPER_DETECT_WINDOW_MS) rec = null; // stale
    if (!rec) rec = { step: 0, lastAt: nowMs };

    if (emojiStr === seq[rec.step]) {
      rec.step += 1;
      rec.lastAt = nowMs;
      if (rec.step >= seq.length) {
        _helperUsers.add(senderSmallId);
        _helperSeqProgress.delete(senderSmallId);
        return;
      }
    } else if (emojiStr === seq[0]) {
      rec.step = 1;
      rec.lastAt = nowMs;
    }
    // else: an out-of-order signature emoji — ignore, keep current progress.
    _helperSeqProgress.set(senderSmallId, rec);
  }

  function _helperMaybeResetForNewMatch(game) {
    const key = _helperGameKey(game);
    if (key === _helperLastGameKey) return;
    _helperLastGameKey = key;
    _helperUsers.clear();
    _helperSeqProgress.clear();
    _helperUsersRenderSig = null;
    _helperLastProcessedTick = null;
  }

  function _processHelperEmojiUpdates(game) {
    let currentTick = Number.NaN;
    try {
      currentTick = Number(game?.ticks?.());
    } catch (_e) {
      currentTick = Number.NaN;
    }
    if (Number.isFinite(currentTick)) {
      if (currentTick === _helperLastProcessedTick) return; // same game tick
      _helperLastProcessedTick = currentTick;
    }

    const updates = game?.updatesSinceLastTick?.();
    if (!updates) return;
    const nowMs = performance.now();
    const mySid = getPlayerSmallId(game?.myPlayer?.(), Number.NaN); // exclude self

    for (const group of Object.values(updates)) {
      if (!Array.isArray(group)) continue;
      for (const ev of group) {
        // EmojiUpdate: nested { emoji: {senderID, message} } OR flat {senderID, message}.
        const em = ev && ev.emoji && typeof ev.emoji === "object" ? ev.emoji : ev;
        if (!em || typeof em.senderID !== "number" || typeof em.message !== "string") {
          continue;
        }
        if (em.senderID === mySid) continue; // don't list yourself
        if (!HELPER_SIGNATURE_SEQUENCE.includes(em.message)) continue;
        _recordHelperEmoji(em.senderID, em.message, nowMs);
      }
    }
  }

  // ---- Panel ---------------------------------------------------------------

  function ensureHelperUsersStyles() {
    if (document.getElementById(HELPER_USERS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HELPER_USERS_STYLE_ID;
    style.textContent = `
      #${HELPER_USERS_BADGE_ID} {
        display: none;
        position: fixed;
        z-index: 9000;
        top: 120px;
        left: 12px;
        width: min(240px, calc(100vw - 16px));
        max-height: 46vh;
        overflow-y: auto;
        padding: 7px 9px;
        border: 1px solid rgba(129, 140, 248, 0.4);
        border-radius: 8px;
        background: rgba(15, 18, 40, 0.92);
        color: #e0e7ff;
        font-family: "Aptos", "Trebuchet MS", "Segoe UI", sans-serif;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        cursor: move;
        user-select: none;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(129, 140, 248, 0.16);
      }
      #${HELPER_USERS_BADGE_ID}[data-visible="true"] { display: grid; gap: 5px; }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-title {
        color: rgba(165, 180, 252, 0.85);
        font-size: 10px;
        text-transform: uppercase;
      }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-rows { display: grid; gap: 3px; }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-row {
        display: grid;
        grid-template-columns: 11px minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        cursor: pointer;
      }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
      }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-name {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-rel {
        font-size: 9px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-rel[data-rel="self"] { color: #a5b4fc; }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-rel[data-rel="ally"] { color: #4ade80; }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-rel[data-rel="enemy"] { color: #f87171; }
      #${HELPER_USERS_BADGE_ID} .ofh-hu-empty { color: rgba(224, 231, 255, 0.6); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHelperUsersBadge() {
    ensureHelperUsersStyles();
    let badge = document.getElementById(HELPER_USERS_BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = HELPER_USERS_BADGE_ID;
      badge.innerHTML =
        `<span class="ofh-hu-title">${tr("Script users")}</span>` +
        `<span class="ofh-hu-rows"></span>`;
    }
    if (badge.parentElement !== document.body) {
      (document.body || document.documentElement).appendChild(badge);
      makeGoldStatPanelDraggable(badge, badge, HELPER_USERS_POS_KEY);
      applyStoredGoldStatPanelPosition(badge, HELPER_USERS_POS_KEY);
    }
    return badge;
  }

  function _helperEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
  }

  function _helperRelLabel(rel) {
    if (rel === "self") return tr("you");
    if (rel === "ally") return tr("ally");
    if (rel === "enemy") return tr("enemy");
    return tr("neutral");
  }

  function _focusHelperUser(smallId) {
    if (!Number.isFinite(smallId)) return;
    try {
      const target =
        document.querySelector("actionable-events") ||
        document.querySelector("events-display");
      if (target && typeof target.emitGoToPlayerEvent === "function") {
        target.emitGoToPlayerEvent(Number(smallId));
      }
    } catch (_e) {
      /* ignore */
    }
  }

  function _renderHelperUsersList(game, badge) {
    const rows = badge.querySelector(".ofh-hu-rows");
    if (!rows) return;

    const players = game ? getCachedPlayerViews(game) : [];
    const bySid = new Map();
    for (const p of players) bySid.set(getPlayerSmallId(p, Number.NaN), p);

    const items = [];
    for (const sid of _helperUsers) {
      const p = bySid.get(sid);
      if (!p) continue;
      const name = getPlayerDisplayName(p);
      let color = getPlayerColor(p, game) || "#818cf8";
      if (!/^#[0-9a-fA-F]{3,8}$/.test(String(color))) color = "#818cf8";
      const rel = getPlayerRelationToMyPlayer(game, p) || "neutral";
      items.push({ sid, name, color, rel });
    }

    const sig = items.map((i) => `${i.sid}|${i.name}|${i.color}|${i.rel}`).join("~");
    if (sig === _helperUsersRenderSig) return; // no change — skip DOM work
    _helperUsersRenderSig = sig;

    if (items.length === 0) {
      rows.innerHTML = `<span class="ofh-hu-empty">${tr("No script users detected yet.")}</span>`;
      return;
    }

    rows.innerHTML = items
      .map(
        (i) =>
          `<span class="ofh-hu-row" data-sid="${i.sid}">` +
          `<span class="ofh-hu-dot" style="background:${i.color}"></span>` +
          `<span class="ofh-hu-name">${_helperEscapeHtml(i.name)}</span>` +
          `<span class="ofh-hu-rel" data-rel="${i.rel}">${_helperRelLabel(i.rel)}</span>` +
          `</span>`,
      )
      .join("");

    for (const row of rows.querySelectorAll(".ofh-hu-row")) {
      row.addEventListener("click", () => _focusHelperUser(Number(row.dataset.sid)));
    }
  }

  function updateHelperUsersPanel() {
    const badge = ensureHelperUsersBadge();
    if (!helperUsersEnabled) {
      if (badge.dataset.visible !== "false") badge.dataset.visible = "false";
      return;
    }
    const context = getOpenFrontGameContext();
    const game = context?.game || null;
    if (game) {
      _helperMaybeResetForNewMatch(game);
      _processHelperEmojiUpdates(game);
      _maybeSendHelperSignature(game);
    }
    _renderHelperUsersList(game, badge);
    // Only show the panel once at least one other script user is detected.
    const vis = _helperUsers.size > 0 ? "true" : "false";
    if (badge.dataset.visible !== vis) badge.dataset.visible = vis;
  }

  function setHelperUsersEnabled(enabled) {
    helperUsersEnabled = Boolean(enabled);
    if (!helperUsersEnabled) {
      if (_helperIntervalId !== null) {
        window.clearInterval(_helperIntervalId);
        _helperIntervalId = null;
      }
      const badge = document.getElementById(HELPER_USERS_BADGE_ID);
      if (badge) badge.dataset.visible = "false";
      return;
    }
    if (_helperIntervalId === null) {
      _helperIntervalId = window.setInterval(updateHelperUsersPanel, HELPER_SAMPLE_MS);
      updateHelperUsersPanel(); // run once immediately
    }
  }

  // In-browser smoke hook (mirrors window.__autoBotDiag).
  window.__helperUsersDiag = () => ({
    enabled: helperUsersEnabled,
    signatureSentKey: _helperSignatureSentKey,
    inProgress: _helperSeqProgress.size,
    detected: Array.from(_helperUsers),
  });
