'use strict';

// The inherited timer wrote these same variable references to every helper ID
// every two seconds. Let the browser cascade do the work: changes to variables,
// newly inserted/replaced panels and changed IDs need no JS scan or observer.
// Keep every inherited exception, including non-panel helper widgets.
const PANEL_THEME_SELECTOR='[id^="openfront-helper-"]:not(style):not(canvas):not(svg)'+
 ['-layer','-styles','-range','atom-macro','-overlay','-launcher'].map(fragment=>':not([id*="'+fragment+'"])').join('');
function ensurePanelThemeStyle(doc){
 const id='openfront-helper-background-work-styles';
 const existing=doc.getElementById(id);
 if(existing)return existing;
 const style=doc.createElement('style');
 style.id=id;
 style.textContent=PANEL_THEME_SELECTOR+'{background:var(--oh-panel-bg, rgba(12,18,20,0.92))!important;border-color:var(--oh-panel-border, rgba(148,163,184,0.34))!important}';
 (doc.head||doc.documentElement).appendChild(style);
 return style;
}

// These are gameplay/lobby housekeeping jobs, so their one-second cadence must
// continue in hidden tabs. Only combine the clocks; retain each callback's own
// occupancy, enabled-state, timeout and reward gating logic.
function startBackgroundHousekeeping(tasks,options={}){
 const set=options.setInterval||globalThis.setInterval.bind(globalThis);
 const clear=options.clearInterval||globalThis.clearInterval.bind(globalThis);
 const onError=options.onError||(error=>console.error('[ofh] Background housekeeping failed:',error));
 const timer=set(()=>{for(const task of tasks){try{task()}catch(error){onError(error)}}},1000);
 return {stop(){clear(timer)}};
}
if(typeof module!=='undefined')module.exports={ensurePanelThemeStyle,startBackgroundHousekeeping,PANEL_THEME_SELECTOR};
