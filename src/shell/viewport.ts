// Keep floating panels inside the viewport.
//
// Panels remember the position you dragged them to. If you arrange them on a
// large monitor and then move the browser tab to a smaller secondary screen,
// a saved position can fall outside the new viewport and the panel "disappears".
// On every resize we nudge any out-of-bounds panel back into view.

const PANEL_SELECTORS = [
  "#openfront-helper-auto-bot-panel",
  "#openfront-helper-floating-autojoin-panel",
  "#openfront-helper-floating-helpers-panel",
  "#openfront-helper-team-build-stats",
  "#openfront-helper-alliance-request-panel",
  "#openfront-helper-auto-nuke-process",
  "#openfront-helper-stats-container", // gold-per-minute
  "#openfront-helper-trade-balance-badge",
  "#openfront-helper-launcher",
];

const MARGIN = 8;

function clampOne(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return; // hidden / not laid out
  const maxLeft = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
  const left = Math.min(Math.max(rect.left, MARGIN), maxLeft);
  const top = Math.min(Math.max(rect.top, MARGIN), maxTop);
  if (Math.round(left) !== Math.round(rect.left) || Math.round(top) !== Math.round(rect.top)) {
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }
}

function clampAll(): void {
  for (const sel of PANEL_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(clampOne);
  }
}

export function installViewportClamp(): void {
  let scheduled = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      clampAll();
    });
  };
  window.addEventListener("resize", schedule);
  // Moving between monitors (DPI/resolution change) doesn't always fire a clean
  // window 'resize'; these catch the rest.
  window.addEventListener("focus", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
}
