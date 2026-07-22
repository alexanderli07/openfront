// Draggable launcher icon. Click opens the settings popup; drag repositions it
// (position persisted in localStorage). The icon is an inline <svg> (no <img>,
// so the page's data:-free img-src CSP is irrelevant).

import { POPUP_CSS, POPUP_STYLE_ID } from "./styles";

const ICON_ID = "openfront-helper-launcher";
const POS_KEY = "ofh:iconPos";

const ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9"></circle>
  <circle cx="12" cy="12" r="3.4"></circle>
  <line x1="12" y1="1.5" x2="12" y2="5"></line>
  <line x1="12" y1="19" x2="12" y2="22.5"></line>
  <line x1="1.5" y1="12" x2="5" y2="12"></line>
  <line x1="19" y1="12" x2="22.5" y2="12"></line>
</svg>`;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function readPos(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePos(pos: { left: number; top: number }): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function ensureStyle(): void {
  if (document.getElementById(POPUP_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = POPUP_STYLE_ID;
  style.textContent = POPUP_CSS;
  (document.head || document.documentElement).appendChild(style);
}

function createIcon(): void {
  if (document.getElementById(ICON_ID)) return;
  ensureStyle();

  const icon = document.createElement("div");
  icon.id = ICON_ID;
  icon.setAttribute("role", "button");
  icon.setAttribute("aria-label", "OpenFront Helper");
  icon.title = "OpenFront Helper — click to open, drag to move";
  icon.innerHTML = ICON_SVG;

  const size = 44;
  const saved = readPos();
  const left = saved ? clamp(saved.left, 0, innerWidth - size) : 16;
  const top = saved ? clamp(saved.top, 0, innerHeight - size) : innerHeight - 60;
  icon.style.left = `${left}px`;
  icon.style.top = `${top}px`;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  icon.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const r = icon.getBoundingClientRect();
    originLeft = r.left;
    originTop = r.top;
    icon.setPointerCapture(e.pointerId);
    icon.style.cursor = "grabbing";
    e.preventDefault();
  });

  icon.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    icon.style.left = `${clamp(originLeft + dx, 0, innerWidth - size)}px`;
    icon.style.top = `${clamp(originTop + dy, 0, innerHeight - size)}px`;
    window.dispatchEvent(new CustomEvent("ofh-reposition-quick-panel"));
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    icon.style.cursor = "grab";
    try {
      icon.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (moved) {
      const r = icon.getBoundingClientRect();
      writePos({ left: r.left, top: r.top });
      try { localStorage.removeItem("openfront-helper-quick-panel-pos"); } catch { /* ignore */ }
    } else {
      // Toggle Quick Panel with animation (instead of popup)
      window.dispatchEvent(new CustomEvent("ofh-toggle-quick-panel"));
    }
  };
  icon.addEventListener("pointerup", end);
  icon.addEventListener("pointercancel", end);

  document.body.appendChild(icon);
}

export function installLauncher(): void {
  if (document.body) createIcon();
  else document.addEventListener("DOMContentLoaded", createIcon, { once: true });
}
