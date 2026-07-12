// WebSocket hook — intercept game packets for direct actions (kill shot, embargo,
// donate, chat) and skin unlocker. Modeled after Project Blon's NativeWS technique.
// Runs early in the INGAME_FILES order so it captures the game's WebSocket before
// the first connect.

  // ---- WebSocket capture (Blon technique) ----

  const _NativeWS = window.WebSocket;
  const _NativeSend = _NativeWS.prototype.send;
  var _activeSocket = null;
  var _lastKnownTile = null;
  var _wsConnectionState = false;

  // Replace the WebSocket constructor so we can track the active game socket.
  window.WebSocket = function(url, protocols) {
    var sock = protocols !== void 0 ? new _NativeWS(url, protocols) : new _NativeWS(url);
    sock.addEventListener("close", function() {
      if (_activeSocket === sock) {
        _activeSocket = null;
        try { if (window.top) window.top.__ohActiveSocket = null; } catch (e) {}
        _setWsConnectionState(false);
        // Leaving a game → restore native JSON.parse so the lobby stays fast.
        try { _uninstallParseHook(); } catch (e) {}
        _resolvedSkin = null;
        _desiredCosmetics = null;
      }
    });
    return sock;
  };
  window.WebSocket.prototype = _NativeWS.prototype;
  Object.getOwnPropertyNames(_NativeWS).forEach(function(k) {
    try { window.WebSocket[k] = _NativeWS[k]; } catch (_) {}
  });

  // Hook send to detect the active game socket and track last-known tile.
  _NativeWS.prototype.send = function(data) {
    var payload = data;
    if (typeof data === "string") {
      try {
        var msg = JSON.parse(data);
        if (msg) {
          var isGameMsg = (msg.type === "intent" && msg.intent)
                       || msg.type === "quick_chat"
                       || msg.type === "ping";
          if (isGameMsg && _activeSocket !== this) {
            _activeSocket = this;
            try { if (window.top) window.top.__ohActiveSocket = this; } catch (e) {}
            _setWsConnectionState(true);
          }
          var intent = msg.intent || msg;
          if (typeof intent.tile === "number") _setLastKnownTile(intent.tile);
          if (typeof intent.dst  === "number") _setLastKnownTile(intent.dst);
          if (typeof intent.src  === "number") _setLastKnownTile(intent.src);

          // Skin unlocker (Blon 1:1): ALWAYS capture username from join; when
          // enabled, remember the desired cosmetic REFS and strip them from the
          // outgoing join so the server never validates them — the JSON.parse
          // hook re-injects the resolved skin into start/lobby_info locally.
          // PERF: the JSON.parse hook is installed HERE (on join), not at load —
          // so at the lobby/menu (before any join) JSON.parse stays NATIVE and
          // V8 keeps its fast path. Only once we're actually entering a game do
          // we swap in the JS hook, matching the window where it's needed.
          if (msg.type === "join") {
            _myUsername = msg.username;
            if (_skinUnlockerEnabled) {
              _desiredCosmetics = msg.cosmetics || {};
              if (_cosmeticsData) _resolvedSkin = _resolveSkin(_desiredCosmetics);
              msg.cosmetics = {};
              payload = JSON.stringify(msg);
              _installParseHook();
            }
          }
        }
      } catch (e) {}
    }
    return _NativeSend.call(this, payload);
  };

  function _setWsConnectionState(state) {
    _wsConnectionState = state;
    try {
      var el = document.getElementById("ohqp-connection");
      if (el) el.dataset.status = state ? "connected" : "disconnected";
    } catch (e) {}
  }

  function _setLastKnownTile(tile) {
    _lastKnownTile = tile;
    try { if (window.top) window.top.__ohLastKnownTile = tile; } catch (e) {}
  }

  function getActiveSocket() {
    if (_activeSocket && _activeSocket.readyState === (_NativeWS.OPEN || 1)) return _activeSocket;
    try {
      if (window.top && window.top.__ohActiveSocket
          && window.top.__ohActiveSocket.readyState === (_NativeWS.OPEN || 1))
        return window.top.__ohActiveSocket;
    } catch (e) {}
    return null;
  }

  function getLastKnownTile() {
    try {
      if (window.top && window.top.__ohLastKnownTile != null)
        return window.top.__ohLastKnownTile;
    } catch (e) {}
    return _lastKnownTile;
  }

  function isSocketConnected() {
    var sock = getActiveSocket();
    return !!(sock && sock.readyState === (_NativeWS.OPEN || 1));
  }

  // Send a game intent packet directly through the WebSocket. The object is
  // wrapped as {type:"intent", intent:obj}. Returns true on success.
  function sendGamePacket(obj) {
    var sock = getActiveSocket();
    if (!sock || sock.readyState !== (_NativeWS.OPEN || 1)) return false;
    try {
      _NativeSend.call(sock, JSON.stringify({ type: "intent", intent: obj }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Send a raw top-level packet (no intent wrapper). Use for quick_chat, ping,
  // and other messages that are NOT game intents.
  function sendRawPacket(obj) {
    var sock = getActiveSocket();
    if (!sock || sock.readyState !== (_NativeWS.OPEN || 1)) return false;
    try {
      _NativeSend.call(sock, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Skin unlocker (fetch + JSON.parse hooks) — 1:1 port from Project Blon ----

  // Blon reads cfg.features?.skinUnlocker LIVE on every hook call (cfg is loaded
  // from localStorage at script start). Mirror that: read the persisted settings
  // directly so the hook is armed from page load — the join message fires BEFORE
  // any UI toggle could call a setter. The setter below just refreshes the cache.
  var _skinUnlockerEnabled = false;
  try {
    var _rawSettings = localStorage.getItem("ofh:settings");
    if (_rawSettings) {
      var _parsedSettings = JSON.parse(_rawSettings);
      _skinUnlockerEnabled = !!(_parsedSettings && _parsedSettings.skinUnlocker);
    }
  } catch (e) {}

  var _cosmeticsData = null;
  var _desiredCosmetics = null;
  var _resolvedSkin = null;
  var _myUsername = null;

  var _originalFetch = window.fetch;
  var _originalParse = JSON.parse;

  // resolveSkin — Blon 1:1: refs = {flag, color, patternName, patternColorPaletteName}
  // (the REFS the game's join message carries). flag/color are copied/wrapped
  // DIRECTLY; the pattern is looked up BY NAME across cosmeticsData.patterns and
  // emitted as result.pattern = {name, patternData, colorPalette}.
  function _resolveSkin(refs) {
    if (!refs || !_cosmeticsData) return null;
    var result = {};
    if (refs.flag) result.flag = refs.flag;
    if (refs.color && typeof refs.color === "string") result.color = { color: refs.color };
    if (refs.patternName) {
      for (var key in _cosmeticsData.patterns) {
        var p = _cosmeticsData.patterns[key];
        if (p.name === refs.patternName) {
          var patternObj = {
            name: p.name,
            patternData: p.pattern
          };
          var pPalette = _cosmeticsData.colorPalettes ? _cosmeticsData.colorPalettes[refs.patternColorPaletteName] : null;
          if (pPalette) {
            patternObj.colorPalette = pPalette;
          } else if (refs.patternColorPaletteName) {
            patternObj.colorPalette = {
              name: refs.patternColorPaletteName || "fallback",
              primaryColor: "#00ff00",
              secondaryColor: "#00aa00"
            };
          }
          result.pattern = patternObj;
          break;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  // hookedFetch — Blon 1:1: cache cosmetics.json; mod /users/@me json()/text() to
  // inject pattern:* flare + donor role. Gate on the live enabled flag per-call.
  var _hookedFetch = function(input, init) {
    var url = input && typeof input === "object" ? (input.url || (input instanceof URL ? input.href : "")) : (typeof input === "string" ? input : "");
    if (_skinUnlockerEnabled) {
      if (url.indexOf("cosmetics.json") !== -1) {
        return _originalFetch.call(window, input, init).then(function(res) {
          var clone = res.clone();
          clone.json().then(function(data) {
            _cosmeticsData = data;
          }).catch(function() {});
          return res;
        });
      }
      if (url.indexOf("/users/@me") !== -1) {
        return _originalFetch.call(window, input, init).then(function(response) {
          var moddedResponse = new Response(response.body, response);
          var asyncJson = function() {
            return response.clone().text().then(function(text) {
              var data = _originalParse(text);
              if (data && data.player) {
                data.player.flares = data.player.flares || [];
                if (data.player.flares.indexOf("pattern:*") === -1) data.player.flares.push("pattern:*");
                data.player.roles = data.player.roles || [];
                if (data.player.roles.indexOf("donor") === -1) data.player.roles.push("donor");
              }
              return data;
            });
          };
          moddedResponse.json = asyncJson;
          moddedResponse.text = function() { return asyncJson().then(function(d) { return JSON.stringify(d); }); };
          return moddedResponse;
        });
      }
    }
    return _originalFetch.call(window, input, init);
  };
  // Blon locks fetch via defineProperty (writable:false) so the game can't
  // overwrite the hook; configurable:true keeps it re-hookable on reload.
  try {
    Object.defineProperty(window, "fetch", {
      value: _hookedFetch,
      writable: false,
      configurable: true
    });
  } catch (e) {
    window.fetch = _hookedFetch;
  }

  // hookedParse — Blon 1:1: inject resolved skin into MY player entry inside
  // start/lobby_info messages. Prefer clientID match, fallback to username.
  // PERF: this hook wraps EVERY JSON.parse the game does (every WS message,
  // every asset, the lobby list poll). Fast-path out unless BOTH the unlocker
  // is on AND a join already captured cosmetics to re-inject — before a join
  // there is nothing to do, so the lobby's heavy parses stay zero-cost.
  var _hookedParse = function(text, reviver) {
    var obj = _originalParse.call(this, text, reviver);
    if (!_skinUnlockerEnabled) return obj;
    try {
      if (obj && typeof obj === "object") {
        var t = obj.type;
        if (t === "start" || t === "lobby_info") {
          var myClientID = obj.myClientID || obj.clientID;
          if (_resolvedSkin || _desiredCosmetics) {
            if (!_resolvedSkin && _desiredCosmetics && _cosmeticsData) {
              _resolvedSkin = _resolveSkin(_desiredCosmetics);
            }
            if (_resolvedSkin) {
              var players = [];
              if (t === "start") {
                players = (obj.gameStartInfo && obj.gameStartInfo.players) || [];
              } else {
                players = (obj.lobby && (obj.lobby.clients || obj.lobby.players)) || [];
              }
              var me = null;
              if (myClientID) {
                me = players.find(function(p) { return p.clientID === myClientID; });
              }
              if (!me && _myUsername) {
                me = players.find(function(p) { return p.username === _myUsername; });
              }
              if (me) {
                me.cosmetics = _resolvedSkin;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[SkinUnlocker] Error during JSON parse hook:", e);
    }
    return obj;
  };

  // LAZY INSTALL (perf): replacing JSON.parse with a JS function DEFEATS V8's
  // native fast-path for the WHOLE PAGE. The lobby/menu parses large JSON (the
  // room list poll, map metadata) every second — with the hook live, dragging
  // panels there lags. So the JSON.parse hook is installed ONLY when a join is
  // sent (see the send() hook above) and removed when the unlocker is toggled
  // off. Before joining, JSON.parse stays native and V8 keeps its fast path.
  var _parseHooked = false;
  function _installParseHook() {
    if (_parseHooked) return;
    _parseHooked = true;
    try {
      Object.defineProperty(JSON, "parse", { value: _hookedParse, writable: false, configurable: true });
    } catch (e) { JSON.parse = _hookedParse; }
  }
  function _uninstallParseHook() {
    if (!_parseHooked) return;
    _parseHooked = false;
    try {
      Object.defineProperty(JSON, "parse", { value: _originalParse, writable: true, configurable: true });
    } catch (e) { JSON.parse = _originalParse; }
  }

  function _setSkinUnlockerEnabled(on) {
    _skinUnlockerEnabled = !!on;
    // Turning OFF always restores native parse. Turning ON does NOT install
    // immediately — the join hook installs it right before entering a game, so
    // the lobby stays fast.
    if (!_skinUnlockerEnabled) _uninstallParseHook();
  }

  // ---- API exported to the rest of the engine ----
  // These are set as globals (sloppy-mode shared scope) so any ingame file can
  // call sendGamePacket / isSocketConnected / getLastKnownTile directly.
