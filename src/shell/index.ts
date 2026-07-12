// Userscript shell entry — runs before the bundled engine. Installs the chrome.*
// shim, exposes the helpers the content prelude needs (chrome + Audio + the
// English i18n override), wires the "lobby found" toast, and mounts the launcher.

import { unitIconUrl } from "./assets";
import { installAudio, WebAudioElement } from "./audio";
import { installChromeShim } from "./chrome-shim";
import { installI18nOverride } from "./i18n";
import { requestJoinNotificationPermission, showJoinNotification } from "./notification";
import { installLauncher } from "./popup/launcher";
import { openPanelTo } from "./popup/panel";
import { installViewportClamp } from "./viewport";

export function bootShell(): void {
  const chromeShim = installChromeShim();
  const AudioCtor = installAudio();

  (globalThis as Record<string, unknown>).__OFH = {
    chrome: chromeShim,
    Audio: AudioCtor,
    WebAudioElement,
    installI18nOverride,
  };

  // The bundled team-build-stats engine resolves its unit icons through this
  // (the game's live asset manifest), since this build ships no bundled icons.
  (globalThis as Record<string, unknown>).__OFH_gameIconUrl = unitIconUrl;

  // Let the in-game floating auto-join panel open the main settings popup
  // (optionally on a specific tab / sub-tab).
  (globalThis as Record<string, unknown>).__OFH_openPopup = openPanelTo;
  // Exposed so the in-game floating panel's notification toggle can prompt for OS-
  // notification permission from its own user gesture (the engine can't import shell code).
  (globalThis as Record<string, unknown>).__OFH_requestNotifyPermission =
    requestJoinNotificationPermission;

  chromeShim.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; text?: string };
    if (msg?.type === "SHOW_JOIN_NOTIFICATION") {
      showJoinNotification(msg.text || "OpenFront Helper: lobby found — joining!");
    }
  });

  installLauncher();
  installViewportClamp();
}

bootShell();
