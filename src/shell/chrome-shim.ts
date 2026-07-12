// Assembles a chrome.* (and browser.*) shim and installs it.
//
// A FRESH object is used — never mutate the page's window.chrome.runtime, which
// on Chrome is a non-writable browser getter (assigning onto it throws or
// silently fails, which would disable auto-join). The content engine reads the
// shim through window.__OFH.chrome regardless of whether window.chrome takes.

import { injected, resolveAsset } from "./assets";
import { runtimeOnMessage, runtimeSendMessage, tabs } from "./messaging";
import { installCrossTabSync, storageLocal, storageOnChanged } from "./storage";

// Sentinel the Audio shim recognizes as "play the synthesized chime".
export const BEEP_SENTINEL = "ofh:beep";

function getURL(path: string): string {
  if (path === "assets/autojoin.mp3") return BEEP_SENTINEL;
  return resolveAsset(path) ?? path;
}

const runtime = {
  id: "openfront-helper",
  lastError: undefined as undefined,
  getURL,
  getManifest: () => ({
    name: "OpenFront Helper",
    version: injected.version,
    manifest_version: 3,
  }),
  sendMessage: runtimeSendMessage,
  onMessage: runtimeOnMessage,
  onInstalled: { addListener() {}, removeListener() {} },
};

const chromeShim = {
  runtime,
  storage: { local: storageLocal, onChanged: storageOnChanged },
  tabs,
  action: { setIcon() {} },
  windows: { create() {} },
};

export function installChromeShim(): typeof chromeShim {
  const w = window as unknown as Record<string, unknown>;
  try {
    w.chrome = chromeShim;
  } catch (error) {
    console.warn("[ofh] could not set window.chrome:", error);
  }
  try {
    if (typeof w.browser === "undefined") w.browser = chromeShim;
  } catch {
    /* ignore */
  }
  installCrossTabSync();
  return chromeShim;
}
