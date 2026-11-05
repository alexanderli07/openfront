'use strict';
// Keep source modules readable and translate the emitted interface namespace in
// one place. Persistence keys and userscript identity intentionally remain stable.
function renameInterfaceIdentifiers(source){
 source=source.replaceAll('openfront-helper-auto-bot-panel','openfront-helper-control-panel')
  .replaceAll('openfront-helper-auto-bot-styles','openfront-helper-control-styles');
 source=source.replace(/openfront-helper-[A-Za-z0-9-]*/g,name=>
  /(?:-pos|-v\d+|-settings|-config-scroll|-match-history)$/.test(name)?name:name.replace('openfront-helper-','ui-kit-'));
 const names=[
  ['__OFH_autobot','__UIK_controller'],['__OFH','__UIK'],
  ['OpenFrontHelperSettings','InterfaceKitSettings'],['OpenFrontHelperI18n','InterfaceKitI18n'],
  ['__openfrontAutoBotLoaded','__uiKitControllerReady'],['__openfrontAutoJoinBridgeReady','__uiKitLobbyReady'],
  ['__ofhAtomMacroInstalled','__uiKitBatchReady'],['__ohActiveSocket','__uiKitSocket'],['__ohLastKnownTile','__uiKitLastTile']
 ];
 for(const [before,after] of names)source=source.split(before).join(after);
 return source;
}
module.exports={renameInterfaceIdentifiers};
