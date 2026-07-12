// Popup styling — slate-glass (not green) to match the quick-panel theme.
// Uses CSS custom properties from :root set by the quick-panel theme engine,
// with fallbacks to the default slate-blue palette. All rules scoped under
// #openfront-helper-popup / .ofh- so nothing leaks.

export const POPUP_STYLE_ID = "openfront-helper-popup-styles";

export const POPUP_CSS = `
#openfront-helper-popup-overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 30%, rgba(12,18,20,.55), rgba(0,0,0,.72));
  backdrop-filter: blur(2px);
  animation: ofh-fade .16s ease-out;
}
@keyframes ofh-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ofh-rise { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }

#openfront-helper-popup {
  width: min(720px, 94vw); max-height: 88vh; display: flex; flex-direction: column;
  color: var(--oh-panel-text, #e2e8f0);
  font-family: "Aptos", "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.34));
  border-radius: 14px;
  background: var(--oh-panel-bg, rgba(12,18,20,0.97));
  box-shadow: 0 24px 64px rgba(0,0,0,.55), inset 0 1px 0 var(--oh-accent-soft, rgba(148,163,184,0.12));
  animation: ofh-rise .2s cubic-bezier(.2,.8,.2,1);
  overflow: hidden;
}

#openfront-helper-popup .ofh-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--oh-panel-header-border, rgba(148,163,184,0.18));
  background: rgba(12,18,20,0.6);
}
#openfront-helper-popup .ofh-head h1 {
  margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .3px; color: var(--oh-panel-text, #e2e8f0);
  display: flex; align-items: center; gap: 8px;
}
#openfront-helper-popup .ofh-head .ofh-ver {
  font-size: 11px; font-weight: 600; color: var(--oh-panel-text-dim, rgba(148,163,184,0.55));
  border: 1px solid rgba(148,163,184,0.2); border-radius: 999px; padding: 1px 8px;
}
#openfront-helper-popup .ofh-spacer { flex: 1; }
#openfront-helper-popup .ofh-x {
  cursor: pointer; border: 1px solid rgba(248,113,113,.34); color: #fecaca;
  background: rgba(69,10,10,.4); border-radius: 8px; width: 30px; height: 30px;
  font-size: 16px; line-height: 1; display: grid; place-items: center; transition: .15s;
}
#openfront-helper-popup .ofh-x:hover { background: rgba(127,29,29,.6); }

#openfront-helper-popup .ofh-tabs {
  display: flex; gap: 4px; padding: 10px 14px 0; flex-wrap: wrap;
}
#openfront-helper-popup .ofh-tab {
  cursor: pointer; border: 1px solid transparent; border-radius: 9px 9px 0 0;
  padding: 8px 14px; font-size: 12px; font-weight: 700; letter-spacing: .4px;
  text-transform: uppercase; color: var(--oh-panel-text-dim, rgba(148,163,184,0.6)); background: transparent;
  transition: .15s;
}
#openfront-helper-popup .ofh-tab:hover { color: var(--oh-panel-text, #e2e8f0); }
#openfront-helper-popup .ofh-tab.active {
  color: var(--oh-panel-text, #e2e8f0); background: var(--oh-accent-soft, rgba(96,165,250,0.14));
  border-color: var(--oh-accent-muted, rgba(96,165,250,0.28)); border-bottom-color: transparent;
}

/* sub-tabs (Filters / Maps under Auto-Join) */
#openfront-helper-popup .ofh-subtabs { display: flex; gap: 6px; margin-bottom: 14px; }
#openfront-helper-popup .ofh-subtab {
  cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: .3px;
  padding: 6px 13px; border-radius: 999px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.6));
  background: rgba(12,18,20,0.6); border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.16)); transition: .14s;
}
#openfront-helper-popup .ofh-subtab:hover { color: var(--oh-panel-text, #e2e8f0); border-color: var(--oh-accent-muted, rgba(96,165,250,0.3)); }
#openfront-helper-popup .ofh-subtab.on {
  color: var(--oh-panel-text, #e2e8f0); background: var(--oh-accent-muted, rgba(96,165,250,0.6));
  border-color: var(--oh-accent-muted, rgba(96,165,250,0.5));
}

/* searchable language dropdown */
#openfront-helper-popup .ofh-dd { position: relative; max-width: 300px; }
#openfront-helper-popup .ofh-dd-btn {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; font: 600 13px "Aptos", "Segoe UI", sans-serif; color: var(--oh-panel-text, #e2e8f0);
  background: rgba(0,0,0,0.3); border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.2));
  border-radius: 9px; padding: 9px 12px; transition: .14s;
}
#openfront-helper-popup .ofh-dd-btn:hover { border-color: var(--oh-accent-muted, rgba(96,165,250,0.4)); }
#openfront-helper-popup .ofh-dd-caret { opacity: .6; font-size: 10px; }
#openfront-helper-popup .ofh-dd-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 5;
  background: #0f172a; border: 1px solid var(--oh-accent-muted, rgba(96,165,250,0.28)); border-radius: 10px;
  box-shadow: 0 14px 34px rgba(0,0,0,.55); overflow: hidden;
}
#openfront-helper-popup .ofh-dd-menu[hidden] { display: none; }
#openfront-helper-popup .ofh-dd-search {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; color: var(--oh-panel-text, #e2e8f0);
  background: rgba(0,0,0,.3); border: none;
  border-bottom: 1px solid var(--oh-panel-border, rgba(148,163,184,0.16)); padding: 9px 12px; outline: none;
}
#openfront-helper-popup .ofh-dd-list { max-height: 220px; overflow-y: auto; }
#openfront-helper-popup .ofh-dd-list::-webkit-scrollbar { width: 8px; }
#openfront-helper-popup .ofh-dd-list::-webkit-scrollbar-thumb { background: var(--oh-accent-soft, rgba(96,165,250,.22)); border-radius: 999px; }
#openfront-helper-popup .ofh-dd-item {
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; padding: 8px 12px; font-size: 13px; color: rgba(226,232,240,.85); transition: .12s;
}
#openfront-helper-popup .ofh-dd-item:hover { background: var(--oh-accent-soft, rgba(96,165,250,.14)); color: var(--oh-panel-text, #e2e8f0); }
#openfront-helper-popup .ofh-dd-item.on { color: var(--oh-panel-text, #e2e8f0); background: var(--oh-accent-muted, rgba(96,165,250,0.6)); }
#openfront-helper-popup .ofh-dd-code { font-size: 10px; opacity: .55; font-weight: 700; letter-spacing: .5px; }
#openfront-helper-popup .ofh-dd-empty { padding: 12px; text-align: center; font-size: 12px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.5)); }

#openfront-helper-popup .ofh-body { padding: 16px 18px 20px; overflow-y: auto; }
#openfront-helper-popup .ofh-body::-webkit-scrollbar { width: 9px; }
#openfront-helper-popup .ofh-body::-webkit-scrollbar-thumb {
  background: var(--oh-accent-soft, rgba(96,165,250,.22)); border-radius: 999px;
}

#openfront-helper-popup .ofh-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  color: var(--oh-panel-text-dim, rgba(148,163,184,0.5)); margin: 4px 0 10px;
}
/* collapsible section header */
#openfront-helper-popup .ofh-section-head {
  display: flex; align-items: center; gap: 7px;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  transition: color .15s;
}
#openfront-helper-popup .ofh-section-head:hover { color: var(--oh-panel-text, rgba(226,232,240,0.85)); }
#openfront-helper-popup .ofh-sec-chevron { font-size: 10px; width: 10px; display: inline-block; }
#openfront-helper-popup input.ofh-num:disabled,
#openfront-helper-popup input.ofh-num.disabled { opacity: .4; cursor: not-allowed; }
#openfront-helper-popup .ofh-grid { display: grid; gap: 8px; }
#openfront-helper-popup .ofh-grid.cols2 { grid-template-columns: 1fr 1fr; }

/* row: label + control */
#openfront-helper-popup .ofh-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.14));
  background: rgba(12,18,20,0.6);
  transition: .15s;
}
#openfront-helper-popup .ofh-row:hover { border-color: var(--oh-accent-muted, rgba(96,165,250,0.26)); background: rgba(12,18,20,0.8); }
#openfront-helper-popup .ofh-row .ofh-txt { flex: 1; min-width: 0; }
#openfront-helper-popup .ofh-row .ofh-name { font-size: 13px; font-weight: 600; color: var(--oh-panel-text, #e2e8f0); }
#openfront-helper-popup .ofh-row .ofh-desc { font-size: 11px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.55)); margin-top: 2px; line-height: 1.4; }
#openfront-helper-popup .ofh-row.ofh-sub { margin-left: 16px; border-left: 2px solid var(--oh-accent-muted, rgba(96,165,250,0.22)); border-top-left-radius: 4px; border-bottom-left-radius: 4px; }

/* pill switch */
#openfront-helper-popup .ofh-switch {
  position: relative; width: 40px; height: 22px; flex: none; cursor: pointer;
  border-radius: 999px; background: rgba(120,120,120,.28);
  border: 1px solid rgba(255,255,255,.1); transition: .18s;
}
#openfront-helper-popup .ofh-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #e5e7eb; transition: .18s;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
#openfront-helper-popup .ofh-switch.on { background: var(--oh-accent-muted, rgba(96,165,250,0.6)); border-color: var(--oh-accent-muted, rgba(96,165,250,0.5)); }
#openfront-helper-popup .ofh-switch.on::after { left: 20px; background: var(--oh-panel-text, #e2e8f0); }
#openfront-helper-popup .ofh-switch.disabled { opacity: .4; cursor: not-allowed; }

/* chip toggle (filters / presets) */
#openfront-helper-popup .ofh-chips { display: flex; flex-wrap: wrap; gap: 7px; }
#openfront-helper-popup .ofh-chip {
  cursor: pointer; user-select: none; font-size: 12px; font-weight: 600;
  padding: 7px 12px; border-radius: 999px; transition: .14s;
  border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.18)); background: rgba(12,18,20,0.6); color: rgba(226,232,240,.8);
}
#openfront-helper-popup .ofh-chip:hover { border-color: var(--oh-accent-muted, rgba(96,165,250,0.3)); }
#openfront-helper-popup .ofh-chip.on {
  color: var(--oh-panel-text, #e2e8f0); background: var(--oh-accent-muted, rgba(96,165,250,0.6));
  border-color: var(--oh-accent-muted, rgba(96,165,250,0.6)); box-shadow: 0 4px 14px rgba(96,165,250,.25);
}
#openfront-helper-popup .ofh-chip.exclude.on {
  color: var(--oh-panel-text, #e2e8f0); background: linear-gradient(135deg,rgba(248,113,113,0.7),rgba(248,113,113,0.6));
  border-color: rgba(254,202,202,.6);
  box-shadow: 0 4px 14px rgba(248,113,113,.25);
}

#openfront-helper-popup .ofh-field { display: flex; align-items: center; gap: 8px; }
#openfront-helper-popup .ofh-field label { font-size: 12px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.7)); }
#openfront-helper-popup input.ofh-num {
  width: 70px; font: inherit; font-size: 13px; color: var(--oh-panel-text, #e2e8f0);
  background: rgba(0,0,0,0.3); border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.2));
  border-radius: 8px; padding: 6px 8px;
}
#openfront-helper-popup input.ofh-num:focus { outline: none; border-color: var(--oh-accent-muted, rgba(96,165,250,0.6)); }

/* map grid */
#openfront-helper-popup .ofh-maps {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px;
}
#openfront-helper-popup .ofh-map {
  cursor: pointer; border-radius: 10px; overflow: hidden; position: relative;
  border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.16)); background: rgba(0,0,0,0.3); transition: .15s;
}
#openfront-helper-popup .ofh-map:hover { transform: translateY(-2px); border-color: var(--oh-accent-muted, rgba(96,165,250,0.3)); }
#openfront-helper-popup .ofh-map.on { border-color: var(--oh-accent-muted, rgba(96,165,250,0.8)); box-shadow: 0 0 0 2px var(--oh-accent-soft, rgba(96,165,250,0.3)); }
#openfront-helper-popup .ofh-map .ofh-thumb {
  width: 100%; aspect-ratio: 2/1; object-fit: cover; display: block; background: rgba(0,0,0,.3);
}
#openfront-helper-popup .ofh-map .ofh-noimg {
  width: 100%; aspect-ratio: 2/1; display: grid; place-items: center;
  font-size: 22px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.4)); background: rgba(12,18,20,0.7);
}
#openfront-helper-popup .ofh-map .ofh-mapname {
  font-size: 11px; font-weight: 600; text-align: center; padding: 6px 4px;
  color: var(--oh-panel-text, #e2e8f0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#openfront-helper-popup .ofh-map .ofh-check {
  position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border-radius: 50%;
  background: var(--oh-accent, #60a5fa); color: var(--oh-panel-text, #e2e8f0); display: none; place-items: center;
  font-size: 13px; font-weight: 800;
}
#openfront-helper-popup .ofh-map.on .ofh-check { display: grid; }

#openfront-helper-popup .ofh-note {
  font-size: 11px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.5)); margin: 12px 2px 0; line-height: 1.5;
}

/* external link card (About → GitHub) */
#openfront-helper-popup .ofh-link {
  display: flex; align-items: center; gap: 11px; margin-top: 10px; text-decoration: none;
  padding: 11px 13px; border-radius: 10px; color: var(--oh-panel-text, #e2e8f0);
  border: 1px solid var(--oh-panel-border, rgba(148,163,184,0.18)); background: rgba(12,18,20,0.6); transition: .15s;
}
#openfront-helper-popup .ofh-link:hover {
  border-color: var(--oh-accent-muted, rgba(96,165,250,0.4)); background: rgba(12,18,20,0.8); transform: translateY(-1px);
}
#openfront-helper-popup .ofh-link-ico {
  flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px;
  font-size: 15px; color: var(--oh-accent, #60a5fa); background: var(--oh-accent-soft, rgba(96,165,250,.12)); border: 1px solid var(--oh-accent-muted, rgba(96,165,250,.25));
}
#openfront-helper-popup .ofh-link-body { flex: 1; min-width: 0; }
#openfront-helper-popup .ofh-link-title { font-size: 13px; font-weight: 700; }
#openfront-helper-popup .ofh-link-sub { font-size: 11px; color: var(--oh-panel-text-dim, rgba(148,163,184,0.55)); margin-top: 1px; }
#openfront-helper-popup .ofh-link-arrow { flex: none; opacity: .5; font-size: 14px; }
#openfront-helper-popup .ofh-link:hover .ofh-link-arrow { opacity: .9; }
#openfront-helper-popup .ofh-btn {
  cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
  padding: 8px 14px; border-radius: 9px; color: var(--oh-panel-text, #e2e8f0);
  border: 1px solid var(--oh-accent-muted, rgba(96,165,250,0.3)); background: var(--oh-accent-soft, rgba(96,165,250,0.16)); transition: .15s;
}
#openfront-helper-popup .ofh-btn:hover { background: var(--oh-accent-soft, rgba(96,165,250,0.28)); }

/* atom tab — danger accent */
#openfront-helper-popup .ofh-atom-hero {
  display: flex; gap: 13px; align-items: flex-start;
  padding: 13px 14px; border-radius: 12px; margin-bottom: 2px;
  border: 1px solid rgba(248,113,113,.22);
  background: linear-gradient(135deg, rgba(248,113,113,.10), transparent 55%), rgba(12,18,20,0.55);
}
#openfront-helper-popup .ofh-atom-hero-ico {
  flex: none; font-size: 22px; line-height: 1; margin-top: 1px;
  filter: drop-shadow(0 0 8px rgba(248,113,113,.5));
}
#openfront-helper-popup .ofh-atom-hero-body { flex: 1; min-width: 0; }
#openfront-helper-popup .ofh-atom-hero-desc { font-size: 12px; line-height: 1.55; color: rgba(226,232,240,.82); }
#openfront-helper-popup .ofh-atom-keyrow { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
#openfront-helper-popup .ofh-atom-keylbl {
  font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--oh-panel-text-dim, rgba(148,163,184,0.5));
}
#openfront-helper-popup .ofh-kbd {
  display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 7px;
  font: 800 13px/1 "Aptos", "Consolas", monospace; color: #fecaca;
  border: 1px solid rgba(248,113,113,.4); border-bottom-width: 2px; border-radius: 6px;
  background: rgba(127,29,29,.28); box-shadow: 0 1px 0 rgba(0,0,0,.3);
}
#openfront-helper-popup .ofh-cad {
  font-size: 12px; font-weight: 800; letter-spacing: .3px; color: var(--oh-accent, #60a5fa); white-space: nowrap;
  padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--oh-accent-muted, rgba(96,165,250,.28)); background: var(--oh-accent-soft, rgba(96,165,250,.10)); transition: .15s;
}
#openfront-helper-popup .ofh-cad.max { color: var(--oh-accent, #60a5fa); border-color: rgba(96,165,250,.3); background: rgba(96,165,250,.10); }

/* launcher icon */
#openfront-helper-launcher {
  position: fixed; z-index: 2147483645; width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  color: var(--oh-accent, #60a5fa); cursor: grab; user-select: none; touch-action: none;
  border-radius: 50%;
  border: 1px solid var(--oh-accent-muted, rgba(96,165,250,.34));
  background: var(--oh-panel-bg, rgba(12,18,20,0.94));
  box-shadow: 0 6px 18px rgba(0,0,0,.5), inset 0 1px 0 var(--oh-accent-soft, rgba(148,163,184,.14));
  transition: transform .12s, box-shadow .12s;
}
#openfront-helper-launcher:hover { transform: scale(1.08); box-shadow: 0 8px 24px rgba(96,165,250,.35); }
`;
