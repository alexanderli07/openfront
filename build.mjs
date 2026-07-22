// Build the standalone userscript.
//
//   metadata header
//   window.__OFH_ASSETS = { version, enLocale }
//   [shell IIFE]   esbuild(src/shell/index.ts) -> chrome shim, audio, launcher
//   [lobby IIFE]   concat(engine: map-data + shared + lobby)  (sloppy mode)
//   [ingame IIFE]  concat(engine/ingame/**)                   (sloppy mode)
//
// The two engine IIFEs are NOT "use strict" (the originals were classic scripts).
// The lobby layer is emitted before the in-game layer so auto-join survives an
// in-game fault.

import { build as esbuild, transform } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

// Raw/debug build: skip all minification so the engine keeps its original
// formatting, identifiers, and console.log debug output for in-browser
// debugging. Trigger with `npm run build:raw` (--raw) or OFH_DEBUG=1.
const RAW = process.argv.includes("--raw") || Boolean(process.env.OFH_DEBUG);

// Lobby layer (formerly "content"): map data, shared settings/i18n, auto-join,
// and the floating auto-join panel.
const LOBBY_FILES = [
  "engine/map-data.js",
  "engine/shared/settings.js",
  "engine/shared/i18n.js",
  "__I18N_OVERRIDE__",
  "engine/lobby/core.js",
  "engine/lobby/floating-autojoin.js",
  "engine/lobby/auto-join.js",
];

// In-game layer (formerly "page-bridge"): overlays, helper panels, and the
// auto-bot. Order matters (see the auto-bot README).
const INGAME_FILES = [
  "anti-afk.js",
  "runtime.js",
  "ws-hook.js",
  "panel-layout.js",
  "shared-utils.js",
  "selective-trade-policy.js",
  "alliances.js",
  "alliance-requests-panel.js",
  "bot-markers.js",
  "gold-per-minute.js",
  "team-build-stats.js",
  "trade-balances.js",
  "nuke-prediction.js",
  "nuke-suggestions.js",
  "boat-prediction.js",
  "warship-routes.js",
  "boat-panel.js",
  "estate-panel.js",
  "auto-leave.js",
  "boat-macro.js",
  "heatmaps.js",
  "auto-bot/core.js",
  "auto-bot/i18n.js",
  "auto-bot/helpers.js",
  "auto-bot/context.js",
  "auto-bot/sensing.js",
  "auto-bot/portutil.js",
  "auto-bot/gameApi.js",
  "auto-bot/emojiBehavior.js",
  "auto-bot/allianceBehavior.js",
  "auto-bot/mirvBehavior.js",
  "auto-bot/warshipBehavior.js",
  "auto-bot/structureBehavior.js",
  "auto-bot/attackBehavior.js",
  "auto-bot/nukeBehavior.js",
  "auto-bot/nationExecution.js",
  "auto-bot/engine.js",
  "auto-bot/panel.js",
  "auto-bot/lifecycle.js",
  "signal-scheduler.js",
  "helper-users-panel.js",
  "sos-defense.js",
  "map-overlay-scheduler.js",
  "advisor-intel.js",
  "name-overlay.js",
  "attack-highlight.js",
  "nuke-trajectory.js",
  "advisor-panel.js",
  "retaliation-hud.js",
  "hide-ads.js",
  "attack-ratio-hotkey.js",
  "alliance-policy.js",
  "right-click-conquest.js",
  "round-logger.js",
  "network-logger.js",
  "build-timer.js",
  "enemy-intent-intel.js",
  "spawn-heatmap.js",
  "game-time-alert.js",
  "silo-sam-tracker.js",
  "auto-donate.js",
  "companion/core.js",
  "companion/commands.js",
  "companion/actions.js",
  "companion/engine.js",
  "companion/panel.js",
  "quick-panel.js",
  "bootstrap.js",
].map((f) => `engine/ingame/${f}`);

const I18N_OVERRIDE =
  "\n;(window.__OFH && window.__OFH.installI18nOverride && window.__OFH.installI18nOverride());\n";

function readLobbyFile(rel) {
  if (rel === "__I18N_OVERRIDE__") return I18N_OVERRIDE;
  return `\n// ===== ${rel} =====\n${read(rel)}\n`;
}

function wrapIife(body, label) {
  const msg = JSON.stringify(`[ofh] ${label} section error:`);
  return `\n;(function(){\ntry {\n${body}\n} catch (e) { console.error(${msg}, e); }\n})();\n`;
}

// Minify an engine layer: strip whitespace/comments and mangle nested-local
// identifiers. Syntax folding is intentionally OFF — these are sloppy-mode
// classic scripts concatenated into a single scope, and minifySyntax is the
// transform most likely to perturb their semantics for only a ~2% size gain
// (measured). Top-level names are script-scope and preserved/consistently
// renamed within the layer, so cross-file bare-name references survive; the
// engine has no string-based name access (eval / window["…"] / .name), so
// mangling is safe. charset:"utf8" keeps emoji keys (⚔️ ☢️ ⛵) from bloating to
// \uXXXX. `npm run build:raw` (RAW) skips this for a debuggable build.
async function minifyLayer(code) {
  if (RAW) return code;
  const r = await transform(code, {
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: false,
    legalComments: "none",
    charset: "utf8",
  });
  return r.code;
}

function metadataHeader(version) {
  const repo = "https://github.com/nguyenvancaokyfpt/openfront-helper-userscript";
  const raw = `https://raw.githubusercontent.com/nguyenvancaokyfpt/openfront-helper-userscript/main/openfront-helper.user.js`;
  return `// ==UserScript==
// @name         OpenFront Helper (userscript)
// @namespace    openfront-helper
// @version      ${version}
// @description  Auto-join lobbies + in-game helper overlays and a private-lobby auto-bot for OpenFront.io. Standalone userscript build with a multi-language UI.
// @author       nguyenvancaokyfpt (https://github.com/nguyenvancaokyfpt)
// @license      AGPL-3.0-or-later
// @homepageURL  ${repo}
// @supportURL   ${repo}/issues
// @updateURL    ${raw}
// @downloadURL  ${raw}
// @contributionURL https://greasyfork.org/en/scripts/581664-openfront-tactical-assistant
// Credits: in-game overlays adapted from phil0010-gh/openfront-helper; several
// helper/auto-bot features (spawn scoring/heatmap, advisor, threat intel, map
// overlays) reference OpenFront Tactical Assistant:
//   https://greasyfork.org/en/scripts/581664-openfront-tactical-assistant
// @match        https://openfront.io/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==
`;
}

async function main() {
  const pkg = JSON.parse(read("package.json"));
  const version = pkg.version || "0.0.0";

  console.log("[build] discovering locales…");
  // Auto-discover every locales/<code>/common.json and inline them all. Adding a
  // new language is just dropping in a folder — no code change. English is the
  // fallback (loadBundle layers DEFAULT_TRANSLATIONS + en + <lang>).
  const localesDir = path.resolve(__dirname, "locales");
  const locales = {};
  for (const code of fs.readdirSync(localesDir)) {
    const p = path.join(localesDir, code, "common.json");
    if (fs.statSync(path.join(localesDir, code)).isDirectory() && fs.existsSync(p)) {
      locales[code] = JSON.parse(fs.readFileSync(p, "utf8"));
    }
  }
  if (!locales.en) throw new Error("locales/en/common.json is required (English fallback)");
  console.log(`[build] locales: ${Object.keys(locales).join(", ")}`);
  const assetsLiteral = `window.__OFH_ASSETS = ${JSON.stringify({ version, locales })};\n`;

  console.log("[build] bundling shell (esbuild)…");
  const shellResult = await esbuild({
    entryPoints: [path.resolve(__dirname, "src/shell/index.ts")],
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: !RAW,
    charset: "utf8",
    write: false,
    legalComments: "none",
  });
  const shell = shellResult.outputFiles[0].text;

  console.log("[build] concatenating lobby layer…");
  const lobbyPrelude =
    "const chrome = (window.__OFH && window.__OFH.chrome) || window.chrome;\n" +
    "const Audio = (window.__OFH && window.__OFH.Audio) || window.Audio;\n" +
    // floating-helpers.js was removed; stub the two functions core/auto-join call.
    "function syncFloatingHelpersPanel(){}\n" +
    "function positionFloatingHelpersPanel(){}\n";
  const lobby = lobbyPrelude + LOBBY_FILES.map(readLobbyFile).join("");

  console.log("[build] concatenating in-game layer…");
  const ingame = INGAME_FILES.map((rel) => `\n// ===== ${rel} =====\n${read(rel)}\n`).join("");

  console.log(RAW ? "[build] minify OFF (raw/debug build)…" : "[build] minifying…");
  const out =
    metadataHeader(version) +
    assetsLiteral +
    shell +
    wrapIife(await minifyLayer(lobby), "lobby") +
    wrapIife(await minifyLayer(ingame), "ingame");

  const outPath = path.resolve(__dirname, "openfront-helper.user.js");
  fs.writeFileSync(outPath, out, "utf8");
  const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(0);
  console.log(`[build] wrote ${outPath} (${kb} KB)`);

  // Copy to clipboard for quick Tampermonkey paste.
  try {
    const { execSync } = await import("node:child_process");
    if (process.platform === "win32") {
      execSync("powershell -Command \"Set-Clipboard -Value ([System.IO.File]::ReadAllText('" + outPath.replace(/\\/g, "\\\\") + "'))\"");
      console.log("[build] copied to clipboard");
    } else if (process.platform === "darwin") {
      execSync("pbcopy < \"" + outPath + "\"");
      console.log("[build] copied to clipboard");
    }
  } catch (e) {
    console.log("[build] clipboard copy skipped:", e.message);
  }
}

main().catch((e) => {
  console.error("[build] FAILED:", e);
  process.exit(1);
});
