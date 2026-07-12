// Node smoke test for the shell. Mocks just enough of the browser (including the
// real-page hazard of a non-writable window.chrome.runtime and the game's
// ASSET_MANIFEST), runs the bundled shell IIFE, and asserts the shims wire up.
import { build as esbuild } from "esbuild";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const makeEl = () => ({
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {},
  getAttribute() {},
  appendChild: (c) => c,
  append() {},
  replaceWith() {},
  remove() {},
  addEventListener() {},
  setPointerCapture() {},
  releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  querySelector: () => null,
  querySelectorAll: () => [],
  replaceChildren() {},
  set innerHTML(_v) {},
  set textContent(_v) {},
});

globalThis.document = {
  readyState: "complete",
  body: makeEl(),
  documentElement: makeEl(),
  head: makeEl(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener() {},
  removeEventListener() {},
};

const win = {
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  setTimeout: () => 0,
  clearTimeout() {},
  // real-page hazard: non-writable runtime getter
  chrome: {
    get runtime() {
      return Object.freeze({ id: undefined, sendMessage() {} });
    },
  },
  OpenFrontHelperI18n: { DEFAULT_TRANSLATIONS: { hi: "hi" } },
  ASSET_MANIFEST: {
    "maps/world/thumbnail.webp": "/_assets/maps/world/thumbnail.abc.webp",
    "images/CityIconWhite.svg": "/_assets/images/CityIconWhite.def.svg",
  },
  CDN_BASE: "https://cdn.ofedge.io/game_assets",
};
globalThis.window = win;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.location = { href: "https://openfront.io/", reload() {} };
globalThis.__OFH_ASSETS = { version: "1.0.0", locales: { en: { a: "1" }, vi: { a: "2" } } };

const result = await esbuild({
  entryPoints: [path.resolve(__dirname, "../src/shell/index.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
});
new Function(result.outputFiles[0].text)();

const chrome = win.chrome;
assert.equal(chrome.runtime.id, "openfront-helper", "runtime.id set on fresh shim");
assert.equal(chrome.runtime.getManifest().version, "1.0.0", "manifest version");
assert.equal(chrome.runtime.getURL("assets/autojoin.mp3"), "ofh:beep", "audio -> beep sentinel");
assert.equal(
  chrome.runtime.getURL("maps/world/thumbnail.webp"),
  "https://cdn.ofedge.io/game_assets/_assets/maps/world/thumbnail.abc.webp",
  "manifest asset resolves",
);

await chrome.storage.local.set({ settings: { enabled: true } });
const got = await chrome.storage.local.get("settings");
assert.deepEqual(got.settings, { enabled: true }, "storage roundtrip");

let fired = null;
chrome.storage.onChanged.addListener((c) => (fired = c));
await chrome.storage.local.set({ settings: { enabled: false } });
assert.ok(fired?.settings, "onChanged fires same-context");

const __OFH = globalThis.__OFH;
assert.ok(typeof __OFH.Audio === "function", "__OFH.Audio is a class");
assert.equal(
  globalThis.__OFH_gameIconUrl("City"),
  "https://cdn.ofedge.io/game_assets/_assets/images/CityIconWhite.def.svg",
  "game icon resolves via manifest",
);

// The live game moved the manifest/CDN base out of the top-level globals into
// window.BOOTSTRAP_CONFIG. Drop the legacy globals and assert resolution still
// works via BOOTSTRAP_CONFIG (resolveAsset reads them live on each call).
delete win.ASSET_MANIFEST;
delete win.CDN_BASE;
win.BOOTSTRAP_CONFIG = {
  assetManifest: {
    "maps/world/thumbnail.webp": "/_assets/maps/world/thumbnail.bootstrap.webp",
    "images/CityIconWhite.svg": "/_assets/images/CityIconWhite.bootstrap.svg",
  },
  cdnBase: "https://cdn.ofedge.io/game_assets",
};
assert.equal(
  chrome.runtime.getURL("maps/world/thumbnail.webp"),
  "https://cdn.ofedge.io/game_assets/_assets/maps/world/thumbnail.bootstrap.webp",
  "manifest asset resolves via BOOTSTRAP_CONFIG",
);
assert.equal(
  globalThis.__OFH_gameIconUrl("City"),
  "https://cdn.ofedge.io/game_assets/_assets/images/CityIconWhite.bootstrap.svg",
  "game icon resolves via BOOTSTRAP_CONFIG",
);

__OFH.installI18nOverride();
const viBundle = await win.OpenFrontHelperI18n.loadBundle("vi");
assert.equal(viBundle.a, "2", "i18n returns the Vietnamese bundle when requested");
assert.equal(viBundle.hi, "hi", "i18n keeps DEFAULT_TRANSLATIONS");
const enBundle = await win.OpenFrontHelperI18n.loadBundle("en");
assert.equal(enBundle.a, "1", "i18n returns English for en");

console.log("SMOKE OK — standalone shell wires up cleanly");
