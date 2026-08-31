// Quick panel state: accordion restore, dotted keys, debounced sliders, theme sweep.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Deep review round 3, UI/settings fixes — real sliced functions where they can be run,
// source assertions where they cannot. Run from the repo root.
import { source, suite } from "./lib/harness.mjs";
const QP = source("engine/ingame/quick-panel.js");
const AJ = source("engine/lobby/auto-join.js");
const ST = source("engine/shared/settings.js");
const VP = source("src/shell/viewport.ts");
const LN = source("src/shell/popup/launcher.ts");
const ABC = source("engine/ingame/auto-bot/core.js");
const LBC = source("engine/lobby/core.js");

const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function cut(src, a0, b0, label) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start " + label);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end " + label);
  return src.slice(a, b + b0.length);
}

// Slice a whole function by cutting up to the START of the next one and trimming back to
// the final closing brace. Ending a slice on "  }" lands on the first nested block and
// silently produces unbalanced code.
function fnUpTo(src, start, nextDecl, label) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error("start " + label);
  const b = src.indexOf(nextDecl, a + start.length);
  if (b < 0) throw new Error("end " + label);
  const body = src.slice(a, b);
  const last = body.lastIndexOf("}");
  if (last < 0) throw new Error("brace " + label);
  return body.slice(0, last + 1);
}

const t = suite("panel-quick");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

t.section("1. the panel no longer opens fully collapsed");
{
  const fn = fnUpTo(
    QP,
    "function _restoreAccordionState(states) {",
    "function _bindEvents",
    "restore",
  );
  // Model the DOM the real function walks.
  // Simpler faithful stand-in.
  const makeSec = (id, open) => {
    const secCls = new Set(open ? ["open"] : []);
    const bodyCls = new Set(open ? ["open"] : []);
    return {
      dataset: { qpSection: id },
      classList: {
        add: (c) => secCls.add(c),
        remove: (c) => secCls.delete(c),
        contains: (c) => secCls.has(c),
      },
      nextElementSibling: {
        classList: { add: (c) => bodyCls.add(c), remove: (c) => bodyCls.delete(c) },
      },
      isOpen: () => secCls.has("open"),
      bodyOpen: () => bodyCls.has("open"),
    };
  };
  const run = (states, secs) => {
    const restore = new Function(
      "env",
      `
      const { document, quickPanelActiveTab, QUICK_PANEL_ID } = env;
      ${fn}
      return _restoreAccordionState;
    `,
    )({
      QUICK_PANEL_ID: "qp",
      quickPanelActiveTab: "helpers",
      document: {
        getElementById: () => ({
          querySelector: () => ({ querySelectorAll: () => secs }),
        }),
      },
    });
    restore(states);
  };
  // The first render: renderer opened all four, snapshot was taken on an EMPTY body.
  let secs = ["panels", "map", "combat", "tools"].map((k) => makeSec(k, true));
  run({}, secs);
  check(
    "an empty snapshot leaves the rendered sections OPEN",
    secs.every((s) => s.isOpen()),
    secs.map((s) => s.isOpen()).join(","),
  );
  check(
    "...and their bodies too",
    secs.every((s) => s.bodyOpen()),
  );
  // A real saved state must still be honoured, in both directions.
  secs = ["panels", "map"].map((k) => makeSec(k, true));
  run({ panels: false, map: true }, secs);
  check("a saved collapse is still applied", secs[0].isOpen() === false);
  check("a saved expand is still applied", secs[1].isOpen() === true);
}

t.section("2. dotted setting keys round-trip");
{
  const get = fnUpTo(QP, "function _getSetting(key, fallback) {", "function _setAndNotify", "get");
  const mk = (cache, defaults) =>
    new Function(
      "env",
      `
    const { window } = env;
    let _quickPanelSettingsCache = ${JSON.stringify(cache)};
    ${get}
    return _getSetting;
  `,
    )({ window: { OpenFrontHelperSettings: { DEFAULT_SETTINGS: defaults } } });

  const defaults = { collapsedHelperCategories: { panels: false, tools: true }, antiAfk: true };
  let g = mk({ collapsedHelperCategories: { panels: true } }, defaults);
  check(
    "a nested value is READ from the cache",
    g("collapsedHelperCategories.panels", false) === true,
  );
  check(
    "an absent nested key falls back to DEFAULT_SETTINGS",
    g("collapsedHelperCategories.tools", false) === true,
  );
  check(
    "an unknown nested key returns the fallback",
    g("collapsedHelperCategories.nope", "F") === "F",
  );
  check("flat keys are unaffected", g("antiAfk", false) === true);
  // Before the fix a flat lookup could never match a nested store.
  const flatOnly = (cache, key, fb) => (key in cache ? cache[key] : fb);
  check(
    "the OLD flat lookup never matched (the bug)",
    flatOnly(
      { collapsedHelperCategories: { panels: true } },
      "collapsedHelperCategories.panels",
      "MISS",
    ) === "MISS",
  );

  const set = fnUpTo(QP, "function _setAndNotify(key, value) {", "/** Range inputs fire", "set");
  const cache = { collapsedHelperCategories: { panels: false } };
  new Function(
    "env",
    `
    const { cache, _notifySettingChanged, _applySettingLocally } = env;
    let _quickPanelSettingsCache = cache;
    ${set}
    _setAndNotify("collapsedHelperCategories.tools", true);
    _setAndNotify("antiAfk", false);
  `,
  )({ cache, _notifySettingChanged: () => {}, _applySettingLocally: () => {} });
  check(
    "a dotted WRITE lands nested, not as a flat key",
    cache.collapsedHelperCategories.tools === true && !("collapsedHelperCategories.tools" in cache),
    JSON.stringify(cache),
  );
  check("the existing nested sibling survives", cache.collapsedHelperCategories.panels === false);
  check("flat writes still work", cache.antiAfk === false);
}

t.section("3. panel ids the animation actually looks up");
{
  const ids = cut(QP, "var _PANEL_IDS = {", "};", "ids");
  const real = {
    autoBot: (ABC.match(/const PANEL_ID = "([^"]+)"/) || [])[1],
    autoJoin: (LBC.match(/const FLOATING_AUTOJOIN_PANEL_ID = "([^"]+)"/) || [])[1],
  };
  check(
    "auto-bot id matches the panel that exists",
    ids.includes('"' + real.autoBot + '"'),
    real.autoBot,
  );
  check(
    "auto-join id matches the panel that exists",
    ids.includes('"' + real.autoJoin + '"'),
    real.autoJoin,
  );
  check(
    "the old truncated ids are gone",
    !ids.includes("openfront-helper-autobot-panel") &&
      !ids.includes('"openfront-helper-floating-autojoin"'),
  );
}

t.section("4. the theme sweep leaves alone what owns its colour");
{
  const fn = fnUpTo(QP, "function _applyThemeToAllPanels() {", "// ---- Styles", "sweep");
  const painted = [];
  const el = (id, tag) => ({
    id,
    tagName: tag || "DIV",
    style: {
      setProperty: (k) => {
        if (k === "background") painted.push(id);
      },
    },
  });
  const els = [
    el("openfront-helper-quick-panel"),
    el("openfront-helper-popup-overlay"),
    el("openfront-helper-launcher"),
    el("openfront-helper-nuke-range"),
    el("openfront-helper-atom-macro-banner"),
    el("openfront-helper-overlay-layer"),
    el("openfront-helper-styles", "STYLE"),
  ];
  new Function(
    "env",
    `
    const { document, setInterval } = env;
    let _panelThemeTimer = 1;
    ${fn}
    _applyThemeToAllPanels();
  `,
  )({ document: { querySelectorAll: () => els }, setInterval: () => 1 });
  check("a real panel IS themed", painted.includes("openfront-helper-quick-panel"));
  check(
    "the popup scrim is NOT repainted",
    !painted.includes("openfront-helper-popup-overlay"),
    painted.join(","),
  );
  check("the launcher ring is NOT repainted", !painted.includes("openfront-helper-launcher"));
  check("range overlays still excluded", !painted.includes("openfront-helper-nuke-range"));
  check(
    "the atom macro banner still excluded",
    !painted.includes("openfront-helper-atom-macro-banner"),
  );
}

t.section("5. the kill-shot hotkey is reachable and switchable");
{
  check(
    "the setting exists with the behaviour-preserving default",
    /killShotEnabled: true,/.test(ST),
  );
  check(
    "the handler is gated by it",
    /if \(!_getSetting\("killShotEnabled", true\)\) return;/.test(decomment(QP)),
  );
  check(
    "and it has a switch in Combat & Automation",
    /\["killShotEnabled", _tr\("Kill-shot hotkey \(Shift\+K\)"\)\]/.test(QP),
  );
  // The gate itself: default armed, explicit false disarms.
  const gate = (v) => !(v === false);
  check("default (undefined) stays armed — behaviour unchanged", gate(undefined) === true);
  check("switching it off really disarms", gate(false) === false);
  // normalizeSettings must carry an unlisted boolean through.
  check(
    "normalizeSettings spreads defaults+source, so the new key survives",
    /\.\.\.DEFAULT_SETTINGS,\s*\n\s*\.\.\.source,/.test(ST),
  );
}

t.section("6. sliders bind once, and persist is debounced");
{
  const q = decomment(QP);
  check(
    "both range binders claim their nodes",
    (q.match(/qpRangeBound/g) || []).length >= 4,
    (q.match(/qpRangeBound/g) || []).length,
  );
  check(
    "the config tab binds theme handlers FIRST (superset wins)",
    /_bindThemeEvents\(el\);\s*\n\s*_bindEvents\(el\);/.test(q),
  );
  check(
    "range input persists through the debounced path",
    /_setAndNotifyRange\(this\.dataset\.qpRange/.test(q),
  );
  const fn = fnUpTo(
    QP,
    "function _setAndNotifyRange(key, value) {",
    "function _resolveSetter",
    "range",
  );
  let notified = 0,
    applied = 0;
  const cache = {};
  const setRange = new Function(
    "env",
    `
    const { cache, _notifySettingChanged, _applySettingLocally, setTimeout, clearTimeout } = env;
    let _quickPanelSettingsCache = cache;
    let _rangeNotifyTimer = null;
    let _rangeNotifyPending = {};
    ${fn}
    return _setAndNotifyRange;
  `,
  )({
    cache,
    _notifySettingChanged: () => notified++,
    _applySettingLocally: () => applied++,
    setTimeout,
    clearTimeout,
  });
  for (let i = 0; i < 40; i++) setRange("guiOpacity", 0.5 + i / 100);
  check("40 pointer moves apply locally 40 times (drag stays live)", applied === 40, applied);
  check("...and persist ZERO times so far (debounced)", notified === 0, notified);
  await new Promise((r) => setTimeout(r, 200));
  check("one persist lands after the debounce window", notified === 1, notified);
  check(
    "and the final value is the one kept",
    Math.abs(cache.guiOpacity - 0.89) < 1e-9,
    cache.guiOpacity,
  );
}

t.section("7. controls that were unreachable now render");
{
  const cfg = cut(QP, "function _renderConfigTab() {", "_bindEvents(el);", "config");
  check("Overlay Opacity renders in the Config tab", /data-qp-range="overlayOpacity"/.test(cfg));
  check("Reset Layout renders in the Config tab", /data-qp-action="resetLayout"/.test(cfg));
  check("the dead theme tab is gone", !/function _renderThemeTab\(\)/.test(QP));
  check(
    "nothing still targets the non-existent theme panel",
    !/\[data-panel='theme'\]/.test(decomment(QP)),
  );
  check(
    "overlayOpacity is still pushed to the canvas overlays",
    /ofhSetOverlayAlpha\(ovOpacity\)/.test(QP),
  );
}

t.section("8. the remembered tab");
{
  check(
    "seeded when the panel is built",
    /var savedTab = _getSetting\("quickPanelActiveTab", "helpers"\);/.test(QP),
  );
  check(
    "only valid tabs are accepted",
    /if \(savedTab === "helpers" \|\| savedTab === "config"\) quickPanelActiveTab = savedTab;/.test(
      QP,
    ),
  );
  check(
    "and written on a tab click",
    /_setAndNotify\("quickPanelActiveTab", quickPanelActiveTab\);/.test(QP),
  );
  const guard = (v) => (v === "helpers" || v === "config" ? v : "helpers");
  check("a junk stored value cannot break the panel", guard("theme") === "helpers");
}

t.section("9. the rest of the wiring");
{
  check(
    "storage changes resync the quick panel",
    /syncHelpers\(\);\s*\n(\s*\/\/.*\n)*\s*syncQuickPanelSettings\(\);/.test(AJ),
  );
  check(
    "rainbow mode is replayed on settings load",
    /_toggleRainbowMode\(_getSetting\("rainbowMode", false\)\);/.test(QP),
  );
  check(
    "the launcher no longer wipes the panel position",
    !/removeItem\("openfront-helper-quick-panel-pos"\)/.test(decomment(LN)),
  );
  check(
    "Reset Layout is still the deliberate way to clear it",
    /localStorage\.removeItem\(QUICK_PANEL_POS_KEY\)/.test(QP),
  );
  check("the quick panel is clamped back on-screen", /"#openfront-helper-quick-panel"/.test(VP));
  check(
    "tooltips no longer advertise stripped features",
    !/hide ads, round logger, network logger/.test(QP) &&
      !/stats, trade, advisor, boat, estate/.test(QP) &&
      !/combat features, alerts, and tools/.test(QP),
  );
}

t.done();
