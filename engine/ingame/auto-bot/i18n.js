// Auto-Bot — internationalization.
// The bot runs in the PAGE context and cannot fetch locale bundles itself
// (no chrome.* there), so the content script loads the bundle for the current
// language and posts it over (SET_AUTO_BOT_I18N → setAutoBotI18n). Keys are the
// English source text — the same convention the rest of the extension uses — so
// a missing translation falls back to readable English. {placeholders} in a
// string are interpolated here. Loaded right after core.js (which declares
// PANEL_ID) and before every module that calls tr() at runtime.
//
// The translation function is named `tr`, NOT `t`: `t` is used pervasively
// across the bot modules as a TileRef variable, and a global `t` would be
// shadowed by (or shadow) those locals.

"use strict";

  // { englishKey: translatedValue } for the active language; null until the
  // content script posts a bundle (tr() then returns the English key verbatim).
  let autoBotBundle = null;
  let autoBotLang = "en";

  function tr(key, params) {
    let text = (autoBotBundle && autoBotBundle[key]) || key;
    if (params) {
      for (const name in params) {
        text = text.split("{" + name + "}").join(String(params[name]));
      }
    }
    return text;
  }

  // Called when the content script delivers (or updates) the language bundle.
  // The content script posts on every syncHelpers() (so delivery is reliable
  // regardless of injection timing), so we only do the costly panel rebuild when
  // the language actually changed or the very first bundle arrived.
  function setAutoBotI18n(language, bundle) {
    const nextLang = language || "en";
    const languageChanged = nextLang !== autoBotLang;
    const bundleChanged = bundle && typeof bundle === "object" && bundle !== autoBotBundle;
    autoBotLang = nextLang;
    if (bundle && typeof bundle === "object") {
      autoBotBundle = bundle;
    }
    if (languageChanged || bundleChanged) {
      relocalizeAutoBotPanel();
    }
  }

  // The panel's static labels are built once, so a language change rebuilds it
  // from t(). All UI state (settings, position, log, active tab) lives in the
  // shared `state` object, so the rebuild is lossless. buildPanel / renderStatus
  // / renderLog live in panel.js (loaded later) and are only invoked here at
  // runtime, so the forward reference resolves by the time a bundle arrives.
  function relocalizeAutoBotPanel() {
    // While idle the status holds a translated literal; clear it so the watcher
    // re-sets it in the new language (otherwise it'd keep the old locale until
    // the bot is enabled). Live readouts refresh on the next tick anyway.
    if (!state.settings.enabled) {
      state.status = "";
    }
    const panel = document.getElementById(PANEL_ID);
    if (panel && typeof buildPanel === "function") {
      panel.remove();
      buildPanel();
    }
    if (typeof renderStatus === "function") renderStatus();
    if (typeof renderLog === "function") renderLog();
  }
