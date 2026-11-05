'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildSource}=require('./build');
const s=buildSource().source;
function slice(a,b){const p=s.indexOf(a),q=s.indexOf(b,p);if(p<0||q<p)throw Error(a);return s.slice(p,q);}
const pieces=[
 slice('function ensureQuickPanelStyles(){','var _panelAnimTimers='),
 slice('function ensureFloatingAutoJoinStyles(){','function formatAutoJoinDuration('),
 slice('function createFloatingAutoJoinPanel(){','function installFloatingAutoJoinDrag('),
 slice('function ensureQuickPanel(){','function _onTabClick('),
 slice('function _swHtml(','function _bindThemeEvents('),
 slice('function _renderConfigTab(){','function _saveAccordionState(')
];
const html=`<!doctype html><meta charset="utf-8"><title>OpenFront shared UI preview</title>
<style>
:root{--oh-panel-bg:rgba(12,18,20,.97);--oh-panel-text:#e2e8f0;--oh-panel-text-dim:#94a3b8;--oh-panel-border:rgba(148,163,184,.34);--oh-panel-header-border:rgba(148,163,184,.18);--oh-accent:#f97316;--oh-accent-soft:rgba(249,115,22,.18);--oh-accent-muted:rgba(249,115,22,.6)}
body{margin:0;background:#20272b;color:#e2e8f0;font:14px Segoe UI,sans-serif}header{padding:14px 20px}#errors{color:#fca5a5;white-space:pre-wrap}
#ui-kit-quick-panel{left:20px!important;top:75px!important;display:flex!important}
#ui-kit-floating-autojoin-panel{left:320px!important;top:75px!important}
#preview-note{position:absolute;left:20px;top:530px;max-width:580px;color:#94a3b8;font-size:12px}
@media(max-width:620px){#ui-kit-floating-autojoin-panel{left:20px!important;top:530px!important}#preview-note{top:1000px}}
</style><header>Shared panel preview · <button id="helpers">Helper controls</button> <button id="config">Helper config</button> <button id="theme">Switch accent</button> <button id="long">Long labels</button></header><pre id="errors"></pre><p id="preview-note">Local fixture using the generated panel styles and native Helper/Auto Join render functions. No game connection or saved settings.</p>
<script>
window.onerror=(m)=>document.getElementById('errors').textContent+=m+'\\n';
const QUICK_PANEL_ID='ui-kit-quick-panel',QUICK_PANEL_STYLE_ID='quick-style',FLOATING_AUTOJOIN_PANEL_ID='ui-kit-floating-autojoin-panel',FLOATING_AUTOJOIN_STYLE_ID='join-style',OFH_PANEL_HEIGHT_PX=420;
let quickPanelActiveTab='helpers',_qpPopoverEl=null,settings={enabled:true,floatingAutoJoinFiltersCollapsed:false,floatingAutoJoinForecastCollapsed:false};
function ofhRefreshConnectionDot(){}
const _themePresets={orange:'#f97316',blue:'#60a5fa',green:'#4ade80',pink:'#f472b6'},_quickPanelSettingsCache={};
const _getSetting=(k,d)=>Object.hasOwn(_quickPanelSettingsCache,k)?_quickPanelSettingsCache[k]:d;
const _tr=x=>x,t=x=>x,tr=x=>x,_esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const _showQpPopover=()=>{},_hideQpPopover=()=>{},_qpMakeDraggable=()=>{},_qpApplyStoredPos=()=>{},_themeFromSettings=()=>{},_onTabClick=()=>{},_bindThemeEvents=()=>{},_bindLanguageEvents=()=>{},installFloatingAutoJoinDrag=()=>{},saveSettings=async x=>{settings=x};
function _renderActiveTab(){quickPanelActiveTab==='helpers'?_renderHelpersTab():_renderConfigTab()}
function _bindEvents(n){n.querySelectorAll('[data-qp-section]').forEach(h=>h.onclick=()=>{h.classList.toggle('open');h.nextElementSibling.classList.toggle('open')});n.querySelectorAll('.ohqp-sw').forEach(el=>el.onclick=()=>el.classList.toggle('on'))}
${pieces.join('\n')}
try{
 const helper=ensureQuickPanel();helper.dataset.visible='true';
 const join=createFloatingAutoJoinPanel();document.body.append(join);join.dataset.armed='true';
 join.querySelector('[data-role="power"]').dataset.enabled='true';join.querySelector('.ofh-aj-power-label').textContent='Auto Join enabled';
 document.getElementById('helpers').onclick=()=>{quickPanelActiveTab='helpers';_renderActiveTab();document.querySelectorAll('.ohqp-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===quickPanelActiveTab));document.querySelectorAll('.ohqp-body > div').forEach(b=>b.classList.toggle('active',b.dataset.panel===quickPanelActiveTab))};
 document.getElementById('config').onclick=()=>{quickPanelActiveTab='config';_renderActiveTab();document.querySelectorAll('.ohqp-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===quickPanelActiveTab));document.querySelectorAll('.ohqp-body > div').forEach(b=>b.classList.toggle('active',b.dataset.panel===quickPanelActiveTab))};
 document.getElementById('theme').onclick=()=>{document.documentElement.style.setProperty('--oh-accent','#60a5fa');document.documentElement.style.setProperty('--oh-accent-soft','rgba(96,165,250,.18)');document.documentElement.style.setProperty('--oh-accent-muted','rgba(96,165,250,.6)')};
 document.getElementById('long').onclick=()=>{join.querySelector('[data-role="maps"]').textContent='Madagascar, Northwest Passage, Strait of Gibraltar';document.querySelector('.ohqp-label').textContent='An unusually long translated helper control label'};
}catch(e){document.getElementById('errors').textContent+=e.stack}
</script>`;
const out=path.join(__dirname,'../work/diagnostics/panels-preview.html');fs.writeFileSync(out,html);console.log(out);
