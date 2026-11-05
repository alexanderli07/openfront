'use strict';
const fs=require('node:fs'),path=require('node:path');
function integrateOverlayRuntime(source){
 function once(before,after){const parts=source.split(before);if(parts.length!==2)throw Error('Overlay integration anchor changed: '+before.slice(0,80));source=parts.join(after);}
 const file=name=>fs.readFileSync(path.join(__dirname,'../src/ui',name),'utf8').replace(/^if\(typeof module.*$/m,'');
 const connection=file('game-connection-status.js'),status=file('panel-status.js'),monitor=file('performance-monitor.js');
 once('const _NativeSend=_NativeWS.prototype.send;',
  'const _NativeSend=_NativeWS.prototype.send;'+monitor+';window.__OFH_performance=createPerformanceMonitor();'+connection+status+
  ';const ofhGameConnection=createGameConnectionStatus({baseUrl:window.location.href,openState:_NativeWS.OPEN||1,onChange:()=>ofhRefreshConnectionDot()});'+
  'window.__OFH_gameConnectionStatus=ofhGameConnection;window.__OFH_panelIndicatorStatus=panelIndicatorStatus;'+
  'function ofhRefreshConnectionDot(){const dot=document.getElementById("ohqp-connection");if(dot){const status=panelIndicatorStatus(typeof quickPanelEnabled!=="undefined"&&quickPanelEnabled,ofhGameConnection.connected());dot.dataset.status=status;dot.dataset.panelStatus=status;dot.title=status==="off"?"Helper off":status==="connected"?"Helper on — connected to game server":"Helper on — waiting for game server"}}');
 once('var t=e!==void 0?new _NativeWS(n,e):new _NativeWS(n);t.addEventListener("close",','var t=e!==void 0?new _NativeWS(n,e):new _NativeWS(n);ofhGameConnection.track(t,n);t.addEventListener("close",');
 once('function _setWsConnectionState(n){_wsConnectionState=n;try{var e=document.getElementById("ohqp-connection");if(e)e.dataset.status=n?"connected":"disconnected"}catch(t){}}','function _setWsConnectionState(n){_wsConnectionState=n;ofhRefreshConnectionDot()}');
 once('i=typeof isSocketConnected==="function"&&isSocketConnected()===true','i=ofhGameConnection.connected()');
 once('a.title="Game connection — green while you are in a game, grey between games"','a.title=i?"Connected to the game server":"No game server connection (singleplayer runs locally)"');
 once('_qpApplyStoredPos(n);_renderActiveTab();_themeFromSettings();return n}','_qpApplyStoredPos(n);_renderActiveTab();_themeFromSettings();ofhRefreshConnectionDot();return n}');
 once('function setQuickPanelEnabled(n){quickPanelEnabled=!!n;','function setQuickPanelEnabled(n){quickPanelEnabled=!!n;ofhRefreshConnectionDot();');
 once('const NUKE_TRAJ_PARABOLA_TYPES=new Set(["Atom Bomb","Hydrogen Bomb"]);','');
 const start=source.indexOf('function computeNukeTrajectoryPath('),end=source.indexOf('registerMapOverlayLayer({id:"nuke-trajectory"',start);
 if(start<0||end<start)throw Error('Nuke overlay boundaries changed');
 source=source.slice(0,start)+file('nuke-trajectory.js')+'\nconst _nukeTrajectoryProjector=createNukeTrajectoryProjector();\n'+file('nuke-overlay.js')+source.slice(end);
 once('function setNukeTrajectoryEnabled(n){nukeTrajectoryEnabled=Boolean(n);',
  'function setNukeTrajectoryEnabled(n){nukeTrajectoryEnabled=Boolean(n);if(!nukeTrajectoryEnabled){_nukeTrajectoryProjector.clear();_nukeTrajScan=[];}');
 once('function setNukePredictionEnabled(n){nukePredictionEnabled=Boolean(n);if(!nukePredictionEnabled){',
  'function setNukePredictionEnabled(n){nukePredictionEnabled=Boolean(n);if(!nukePredictionEnabled){_nukeTrajectoryProjector.clear();_nukeTrajScan=[];');
 once('r.scan(e.game,e.transform,t)',
  '(window.__OFH_performance.active()?window.__OFH_performance.measure("overlay.scan:"+r.id,()=>r.scan(e.game,e.transform,t)):r.scan(e.game,e.transform,t))');
 once('r.draw(n,e.game,e.transform,t)',
  '(window.__OFH_performance.active()?window.__OFH_performance.measure("overlay.draw:"+r.id,()=>r.draw(n,e.game,e.transform,t)):r.draw(n,e.game,e.transform,t))');
 return source;
}
module.exports={integrateOverlayRuntime};
