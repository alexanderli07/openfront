'use strict';
function panelIndicatorStatus(enabled,connected){
 return !enabled?'off':connected?'connected':'waiting';
}
if(typeof module!=='undefined'&&module.exports)module.exports=panelIndicatorStatus;
