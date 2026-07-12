// "Lobby found" notification — replaces the extension's background popup window.
//
// Two layers, because auto-join is meant to run while you do something else:
//   1) a native OS Notification (if permission was granted) — survives tab switches
//      and page navigation, so you see it even when OpenFront isn't the focused tab;
//   2) an in-page toast — the visible cue when you ARE on the tab / denied permission.
// The chime is rung by the content engine (auto-join) so a custom sound is honored.

const TITLE = "⊕ OpenFront Helper";

/** Ask for OS-notification permission. Must be called from a user gesture (toggle /
 *  popup open); a no-op once the user has already granted or denied it. */
export function requestJoinNotificationPermission(): void {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* some embedders throw on Notification access — ignore */
  }
}

function showOsNotification(text: string): boolean {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(TITLE, { body: text, tag: "ofh-lobby-found" });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        n.close();
      };
      return true;
    }
  } catch {
    /* fall through to the in-page toast */
  }
  return false;
}

function showToast(text: string): void {
  const id = "openfront-helper-join-toast";
  document.getElementById(id)?.remove();
  const el = document.createElement("div");
  el.id = id;
  el.textContent = text;
  el.setAttribute(
    "style",
    [
      "position:fixed",
      "top:16px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483646",
      "background:linear-gradient(135deg,#16a34a,#0d9488)",
      "color:#f0fdf4",
      "font:600 14px/1.4 'Aptos','Segoe UI',system-ui,sans-serif",
      "padding:12px 20px",
      "border-radius:10px",
      "border:1px solid rgba(187,247,208,.4)",
      "box-shadow:0 10px 30px rgba(0,0,0,.5)",
      "cursor:pointer",
      "transition:opacity .3s",
    ].join(";"),
  );
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 350);
  }, 5000);
}

export function showJoinNotification(text: string): void {
  // Always show the in-page toast (cheap, visible on-tab); add the OS notification on top
  // when allowed so the user is alerted even with the tab in the background.
  showOsNotification(text);
  showToast(text);
}
