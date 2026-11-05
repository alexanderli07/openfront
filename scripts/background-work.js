'use strict';
const fs=require('node:fs'),path=require('node:path');

function optimizeBackgroundWork(source){
 function once(before,after){
  const parts=source.split(before);
  if(parts.length!==2)throw new Error('Background work anchor changed: '+before.slice(0,100));
  source=parts.join(after);
 }
 const runtime=fs.readFileSync(path.join(__dirname,'../src/ui/background-work.js'),'utf8')
  .replace(/^if\(typeof module.*$/m,'');
 // These are separate closure scopes, so include only the relevant runtime in
 // each. No globals, gameplay timers or lifecycle/archive handlers are replaced.
 const theme=runtime.slice(0,runtime.indexOf('// These are gameplay/lobby'));
 const housekeeping=runtime.slice(runtime.indexOf('function startBackgroundHousekeeping'));
 const old='var _lastPanelTheme="";var _panelThemeTimer=null;function _applyThemeToAllPanels(){var n="var(--oh-panel-bg, rgba(12,18,20,0.92))";var e="var(--oh-panel-border, rgba(148,163,184,0.34))";var t=n+"|"+e;var a=document.querySelectorAll(\'[id^="openfront-helper-"]\');for(var i=0;i<a.length;i++){var s=a[i];if(s.tagName==="STYLE"||s.tagName==="CANVAS"||s.tagName==="SVG")continue;if(s.id.indexOf("-layer")!==-1||s.id.indexOf("-styles")!==-1)continue;if(s.id.indexOf("-range")!==-1)continue;if(s.id.indexOf("atom-macro")!==-1)continue;if(s.id.indexOf("-overlay")!==-1)continue;if(s.id.indexOf("-launcher")!==-1)continue;s.style.setProperty("background",n,"important");s.style.setProperty("border-color",e,"important")}if(!_panelThemeTimer){_panelThemeTimer=setInterval(function(){_applyThemeToAllPanels()},2e3)}}';
 once(old,theme+'\nfunction _applyThemeToAllPanels(){ensurePanelThemeStyle(document)}');
 // Reward polling originally starts before asynchronous lobby initialization.
 // Keep that lifecycle: failed/slow settings loads must not disable claiming.
 once('window.setInterval(()=>ofhPostMatchRewards.hold(),1000);',
  housekeeping+'\nconst ofhHousekeepingTasks=[()=>ofhPostMatchRewards.hold()];'+
  'startBackgroundHousekeeping(ofhHousekeepingTasks,{setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window)});');
 once('window.setInterval(resetPendingJoinIfExpired,1e3);window.setInterval(pollAutoJoinResume,1e3)',
  'ofhHousekeepingTasks.push(resetPendingJoinIfExpired,pollAutoJoinResume)');
 return source;
}
module.exports={optimizeBackgroundWork};
