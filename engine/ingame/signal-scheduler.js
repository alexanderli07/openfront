// Outgoing intent scheduler — paces emoji/target intents under the server rate
// limit (10/sec, 150/min per ClientMsgRateLimiter) plus per-recipient game
// cooldowns measured in GAME TICKS (emojiMessageCooldown=50, targetCooldown=150).
// Shared by helper-users-panel.js (TN1) and sos-defense.js (TN2). Mirrors the atom
// macro's ATOM_SAFE_GAP_MS / rolling-minute pacing (auto-bot/lifecycle.js). FIFO,
// but skips a cooldown-blocked head so an urgent SOS isn't starved behind TN1's
// signature broadcast. Low volume (TN1: 3 emoji once per match; TN2: a few / 10-15s).

  const SIGNAL_MIN_GAP_MS = 200; // ~5/sec, safely under the 10/sec server cap (wall-clock)
  const SIGNAL_PER_MIN_CAP = 120; // safely under the 150/min server cap (wall-clock)
  const SIGNAL_TICK_MS = 200; // scheduler wake interval
  const SIGNAL_MAX_ATTEMPTS = 400; // drop an item after this many blocked ticks (~80s)
  // Per-recipient cooldowns are measured in GAME TICKS, not wall-clock ms. The
  // game gates emoji/target by ticks (emojiMessageCooldown=50, targetCooldown=150),
  // and the client sim can run slower than real time (network jitter / early game),
  // so a wall-clock 5s can elapse before 50 game ticks do — releasing an emoji the
  // game then silently rejects while we've already dequeued it (lost forever). A
  // few ticks of margin ("du di") over the game's own values guarantees acceptance.
  const SIGNAL_COOLDOWN_TICKS = { emoji: 55, target: 160 };

  const _signalQueue = [];
  const _signalLastSentByKey = new Map(); // `${kind}:${recipientKey}` -> game tick
  const _signalFireTimes = []; // rolling-minute emit timestamps (ms)
  let _signalLastEmitAt = 0;
  let _signalIntervalId = null;

  function _signalRecipientKey(recipient) {
    if (recipient === AllPlayers) return "ALL";
    try {
      const sid = recipient?.smallID?.();
      if (sid !== undefined && sid !== null) return "s" + sid;
      const id = recipient?.id?.();
      if (id !== undefined && id !== null) return "i" + id;
    } catch (_e) {
      /* ignore */
    }
    return "unknown";
  }

  function _signalPerMinuteOk() {
    const now = performance.now();
    while (_signalFireTimes.length && now - _signalFireTimes[0] > 60000) {
      _signalFireTimes.shift();
    }
    return _signalFireTimes.length < SIGNAL_PER_MIN_CAP;
  }

  function _signalCtorFor(kind, ctors) {
    if (kind === "emoji") return ctors.emoji;
    if (kind === "target") return ctors.target;
    return null;
  }

  function _signalCurrentTick() {
    try {
      const game = getOpenFrontGameContext()?.game;
      const t = Number(game?.ticks?.());
      return Number.isFinite(t) ? t : null;
    } catch (_e) {
      return null;
    }
  }

  function _runSignalScheduler() {
    if (_signalQueue.length === 0) return;

    const now = performance.now();
    if (now - _signalLastEmitAt < SIGNAL_MIN_GAP_MS) return; // wall-clock server-rate gate
    if (!_signalPerMinuteOk()) return; // wall-clock server-rate gate

    // Per-recipient cooldown is evaluated in GAME TICKS; without a live tick we
    // cannot know whether the game will accept the intent, so wait rather than
    // release blindly (which is exactly how emojis got silently dropped before).
    const curTick = _signalCurrentTick();
    if (curTick === null) return;

    const ctors = discoverCtors(getEventBus());
    if (!ctors) return;

    // Find the first sendable item (ctor ready + per-recipient game-tick cooldown
    // elapsed). Skipping a cooldown-blocked head keeps a throttled item (TN1's
    // signature broadcast) from starving an urgent one (TN2 SOS).
    let readyIndex = -1;
    for (let i = 0; i < _signalQueue.length; i += 1) {
      const it = _signalQueue[i];
      const c = _signalCtorFor(it.kind, ctors);
      let blocked = false;
      if (!c) {
        blocked = true;
      } else {
        const k = it.kind + ":" + _signalRecipientKey(it.recipient);
        const cdTicks = SIGNAL_COOLDOWN_TICKS[it.kind] || 0;
        const lastTick = _signalLastSentByKey.get(k);
        if (lastTick !== undefined) {
          const dt = curTick - lastTick;
          // dt < 0 means the game clock reset (new match) → prior cooldown is moot.
          if (dt >= 0 && dt < cdTicks) blocked = true;
        }
      }
      if (blocked) {
        it.attempts += 1;
        continue;
      }
      readyIndex = i;
      break;
    }

    // Drop items blocked past the attempt ceiling (anywhere in the queue).
    for (let i = _signalQueue.length - 1; i >= 0; i -= 1) {
      if (_signalQueue[i].attempts > SIGNAL_MAX_ATTEMPTS) {
        _signalQueue.splice(i, 1);
        if (i <= readyIndex) readyIndex -= 1;
      }
    }

    if (readyIndex < 0 || readyIndex >= _signalQueue.length) return;

    const item = _signalQueue.splice(readyIndex, 1)[0];
    const ctor = _signalCtorFor(item.kind, ctors);
    const key = item.kind + ":" + _signalRecipientKey(item.recipient);
    const ok = emitIntent(ctor, ...item.args);
    if (ok) {
      _signalLastEmitAt = now;
      _signalLastSentByKey.set(key, curTick);
      _signalFireTimes.push(now);
    } else {
      // Transient emit failure — requeue at the front (bounded) so a once-only
      // signature signal isn't silently lost.
      item.attempts += 1;
      if (item.attempts <= SIGNAL_MAX_ATTEMPTS) _signalQueue.unshift(item);
    }
  }

  function _ensureSignalSchedulerRunning() {
    if (_signalIntervalId !== null) return;
    _signalIntervalId = window.setInterval(_runSignalScheduler, SIGNAL_TICK_MS);
  }

  function enqueueSignal(kind, recipient, args) {
    _signalQueue.push({ kind, recipient, args: args || [], attempts: 0 });
    _ensureSignalSchedulerRunning();
  }
