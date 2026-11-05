'use strict';
const fs=require('node:fs'),path=require('node:path');

// These panels live in separate closures. Install the same scoped CSS from each
// existing style installer, so the first panel opened never determines the theme.
function unifyPanelTheme(source){
 const css=fs.readFileSync(path.join(__dirname,'../src/ui/shared-panels.css'),'utf8');
 function once(before,after){
  const parts=source.split(before);
  if(parts.length!==2)throw new Error('Panel theme anchor changed: '+before.slice(0,90));
  source=parts.join(after);
 }
 for(const [start,end,node] of [
  ['function ensureFloatingAutoJoinStyles(){','function formatAutoJoinDuration(', 'e'],
  ['function ensureQuickPanelStyles(){','var _panelAnimTimers=', 'n'],
  ['function ensureStyles(){','const FEAT_TIP=', 'n']
 ]){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  if(a<0||b<a)throw new Error('Panel style boundaries changed: '+start);
  const before=source.slice(a,b),anchor='(document.head||document.documentElement).appendChild('+node+')';
  if(before.split(anchor).length!==2)throw new Error('Panel style append changed: '+start);
  once(before,before.replace(anchor,node+'.textContent+='+JSON.stringify('\n'+css)+';'+anchor));
 }
 once('e.id=D,e.textContent=de,','e.id=D,e.textContent=de+'+JSON.stringify('\n'+css)+',');
 // Reuse Auto-Bot's cancellable fade/slide instead of the old launcher zoom.
 // The helper is a separate closure, so give its controller a local name.
 const motion=fs.readFileSync(path.join(__dirname,'../src/ui/panel-motion.js'),'utf8')
  .replace(/^if\(typeof module.*$/m,'').replace('createPanelMotion','createHelperPanelMotion');
 const a=source.indexOf('function _animateOpen(n){'),b=source.indexOf('window.addEventListener("ofh-toggle-quick-panel"',a);
 if(a<0||b<a)throw new Error('Helper motion boundaries changed');
 once(source.slice(a,b),motion+'\nconst ofhHelperMotion=createHelperPanelMotion();'+
  'function _animateOpen(n){_qpInTransition=false;ofhHelperMotion.disclose(n,true,()=>{n.style.display="flex";n.style.opacity="";n.style.transform="";n.dataset.visible="true";_renderActiveTab();_themeFromSettings();_placePanel(n)})}'+
  'function _animateClose(n){_qpInTransition=false;ofhHelperMotion.disclose(n,false,()=>{n.style.display="none";n.dataset.visible="false";quickPanelEnabled=false;_notifySettingChanged("showQuickPanel",false);n.style.transform="";n.style.opacity=""})}');
 return source;
}
module.exports={unifyPanelTheme};
