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
  // Content signature of the delivered bundle. Empty string on purpose: any real
  // bundle serializes to at least "{}", so the FIRST delivery still counts as a
  // change and still relocalizes.
  let autoBotBundleSignature = "";

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
  // the language actually changed or the bundle CONTENT changed.
  //
  // This compared `bundle !== autoBotBundle` — object IDENTITY — which can never be
  // false here: the bundle arrives via window.postMessage (posted in lobby/core.js,
  // received in bootstrap.js), and postMessage structured-clones its payload, so every
  // post delivers a brand-new object. bundleChanged was therefore true 100% of the
  // time, and since relocalizeAutoBotPanel() does `panel.remove(); buildPanel();`,
  // EVERY settings write tore the panel down and rebuilt it — resetting the config
  // pane's scroll position and the log list, dropping input focus, and killing the
  // live tooltip. syncHelpers() runs unconditionally from a storage-change handler,
  // so that was every few seconds in practice.
  function setAutoBotI18n(language, bundle) {
    const nextLang = language || "en";
    const languageChanged = nextLang !== autoBotLang;
    const hasBundle = bundle && typeof bundle === "object";
    let nextSignature = autoBotBundleSignature;
    if (hasBundle) {
      try {
        nextSignature = JSON.stringify(bundle);
      } catch (_e) {
        // Unserializable (cycle) — leave the signature alone so we do NOT rebuild on
        // every post. A genuine language switch still comes through languageChanged.
        nextSignature = autoBotBundleSignature;
      }
    }
    const bundleChanged = hasBundle && nextSignature !== autoBotBundleSignature;
    autoBotLang = nextLang;
    if (hasBundle) {
      autoBotBundle = bundle;
      autoBotBundleSignature = nextSignature;
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
