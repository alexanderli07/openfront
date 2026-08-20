// Anti-AFK: prevents the server from marking the player as disconnected when
// the browser tab is in the background.
//
// PROBLEM: Chrome throttles setInterval in BOTH the main thread AND Web Workers
// after ~5 min in a background tab (5s → 60s). The game's 5-second ping becomes
// a ~60-second ping, exceeding the server's 30-second timeout.
//
// SOLUTION: Override window.setInterval so ALL timers (including the game's own
// 5-second ping) delegate to a Web Worker. The worker manages the actual timing
// and posts messages back — setInterval callbacks execute via the worker's tick,
// bypassing Chrome's throttling of main-thread timers.
//
// Also sends an extra keep-alive ping every 15s when the tab is hidden, as a
// safety net in case the game's own ping interval somehow stalls.

(function initAntiAfk() {
  var _worker = null;
  var _intervalCallbacks = {};   // workerId → callback
  var _intervalDelays = {};      // workerId → delay
  var _nextId = 1;
  var _nativeSetInterval = window.setInterval.bind(window);
  var _nativeClearInterval = window.clearInterval.bind(window);
  var _workerReady = false;
  var _keepAliveInterval = null;

  // ---- Web Worker that manages all timers ----

  function _createWorker() {
    try {
      // The worker accepts "start" and "stop" commands and fires ticks back.
      var code = [
        'var timers = {};',
        'self.onmessage = function(e) {',
        '  var d = e.data;',
        '  if (d.cmd === "start") {',
        '    if (timers[d.id]) clearInterval(timers[d.id]);',
        '    timers[d.id] = setInterval(function() {',
        '      self.postMessage({id: d.id});',
        '    }, d.ms);',
        '  } else if (d.cmd === "stop") {',
        '    if (timers[d.id]) { clearInterval(timers[d.id]); delete timers[d.id]; }',
        '  }',
        '};',
      ].join('\n');
      var blob = new Blob([code], { type: "application/javascript" });
      var url = URL.createObjectURL(blob);
      _worker = new Worker(url);
      URL.revokeObjectURL(url);

      _worker.onmessage = function(ev) {
        var id = ev.data && ev.data.id;
        if (id && _intervalCallbacks[id]) {
          try { _intervalCallbacks[id](); } catch (e) {}
        }
      };

      _worker.onerror = function(ev) {
        console.error("[AntiAFK] Worker error:", ev.message);
      };

      _workerReady = true;
      ofhDebug("[AntiAFK] Worker timer hub started");
    } catch (e) {
      console.warn("[AntiAFK] Web Worker unavailable:", e);
      _workerReady = false;
    }
  }

  // ---- Override setInterval / clearInterval ----

  function _workerSetInterval(fn, ms) {
    if (!_workerReady || typeof fn !== "function") {
      // Fallback to native if worker isn't available
      return _nativeSetInterval(fn, ms);
    }
    // Ensure minimum delay of 100ms to avoid flooding the worker
    if (typeof ms !== "number" || ms < 100) ms = 100;
    var id = _nextId++;
    _intervalCallbacks[id] = fn;
    _intervalDelays[id] = ms;
    _worker.postMessage({ cmd: "start", id: id, ms: ms });
    return id;
  }

  function _workerClearInterval(id) {
    if (_intervalCallbacks[id]) {
      delete _intervalCallbacks[id];
      delete _intervalDelays[id];
      if (_workerReady) {
        _worker.postMessage({ cmd: "stop", id: id });
      }
    }
    // Also clear native in case this ID was a native fallback
    _nativeClearInterval(id);
  }

  // Install the overrides
  window.setInterval = _workerSetInterval;
  window.clearInterval = _workerClearInterval;

  // ---- Extra keep-alive ping when tab is hidden ----

  function _sendKeepAlivePing() {
    if (!antiAfkEnabled) return;
    if (typeof isSocketConnected !== "function" || !isSocketConnected()) return;
    if (typeof sendRawPacket !== "function") return;
    try {
      sendRawPacket({ type: "ping" });
      ofhDebug("[AntiAFK] keep-alive ping sent");
    } catch (e) {}
  }

  function _startKeepAlive() {
    if (_keepAliveInterval !== null) return;
    // Send a keep-alive every 15s when tab is hidden, as a safety net
    _keepAliveInterval = _nativeSetInterval(function() {
      if (document.hidden) {
        _sendKeepAlivePing();
      }
    }, 15000);
  }

  function _stopKeepAlive() {
    if (_keepAliveInterval !== null) {
      _nativeClearInterval(_keepAliveInterval);
      _keepAliveInterval = null;
    }
  }

  // ---- Feature toggle ----

  function setAntiAfkEnabled(enabled) {
    antiAfkEnabled = !!enabled;
    if (antiAfkEnabled) {
      _startKeepAlive();
      ofhDebug("[AntiAFK] Enabled — setInterval overridden via Web Worker");
    } else {
      _stopKeepAlive();
      ofhDebug("[AntiAFK] Disabled");
    }
  }

  // ---- Bootstrap ----

  _createWorker();
  // Note: antiAfkEnabled is declared in runtime.js (loaded after this file).
  // It starts as false; the lobby's syncAntiAfkHelper() will call
  // setAntiAfkEnabled(true) once settings are synced. The setInterval override
  // is always active regardless — it routes ALL timers through the worker.
  _startKeepAlive();
  ofhDebug("[AntiAFK] Loaded — all setInterval calls routed through Web Worker");
})();
