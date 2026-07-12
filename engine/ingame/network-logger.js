// Network logger — hooks fetch() and XMLHttpRequest to record network metadata
// (URL, status, timing) without capturing response bodies. Runs under @grant
// none so it hooks the page-context fetch/XHR directly. Events are written to
// the round-logger when both are enabled; standalone use just logs to console.

  const NETWORK_LOG_URL_FILTER = /openfront|game|api|lobby|match/i;
  const NETWORK_LOG_MAX_ENTRIES = 500;
  let _networkLogEntries = [];
  let _networkLogOriginalFetch = null;
  let _networkLogOriginalXhrOpen = null;
  let _networkLogOriginalXhrSend = null;

  function networkLogRecord(entry) {
    if (!networkLoggerEnabled) return;
    _networkLogEntries.push(entry);
    if (_networkLogEntries.length > NETWORK_LOG_MAX_ENTRIES) {
      _networkLogEntries = _networkLogEntries.slice(-NETWORK_LOG_MAX_ENTRIES);
    }
    // Forward to round-logger if available.
    if (typeof roundLogRecord === "function" && roundLoggerEnabled) {
      roundLogRecord("network", entry);
    }
  }

  function installNetworkHooks() {
    if (_networkLogOriginalXhrOpen) return; // already hooked
    // NOTE: We intentionally do NOT patch window.fetch — the game's binary
    // asset loader (cdn.ofedge.io) breaks when fetch is wrapped, even with a
    // passthrough. XHR hooking is sufficient for network logging.

    _networkLogOriginalXhrOpen = XMLHttpRequest.prototype.open;
    _networkLogOriginalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ofhNetUrl = url;
      this.__ofhNetMethod = method;
      return _networkLogOriginalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const start = performance.now();
      const url = this.__ofhNetUrl || "";
      this.addEventListener("loadend", () => {
        if (NETWORK_LOG_URL_FILTER.test(url)) {
          networkLogRecord({
            type: "xhr",
            method: this.__ofhNetMethod,
            url: url.slice(0, 200),
            status: this.status,
            ok: this.status >= 200 && this.status < 300,
            ms: Math.round(performance.now() - start),
          });
        }
      });
      return _networkLogOriginalXhrSend.apply(this, args);
    };
  }

  function uninstallNetworkHooks() {
    if (_networkLogOriginalXhrOpen) {
      XMLHttpRequest.prototype.open = _networkLogOriginalXhrOpen;
      _networkLogOriginalXhrOpen = null;
    }
    if (_networkLogOriginalXhrSend) {
      XMLHttpRequest.prototype.send = _networkLogOriginalXhrSend;
      _networkLogOriginalXhrSend = null;
    }
  }

  function setNetworkLoggerEnabled(enabled) {
    networkLoggerEnabled = Boolean(enabled);
    if (networkLoggerEnabled) {
      installNetworkHooks();
    } else {
      uninstallNetworkHooks();
      _networkLogEntries = [];
    }
  }
