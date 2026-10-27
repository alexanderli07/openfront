'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { simplifyConfigPanel } = require('./config-panel');
const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'vendor/openfront-helper-1.84.0.user.js');
const expectedHash = '863068bc00d0e6a9610e3c1199ea2c6fe8f5ae3c6ea6cca8d051abe74ffcfad8';

function closeParen(text, start) {
  let depth = 0, quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  throw new Error('Unbalanced command call in baseline');
}
function buildSource(baseline = fs.readFileSync(baselinePath)) {
  if (crypto.createHash('sha256').update(baseline).digest('hex') !== expectedHash) {
    throw new Error('Baseline hash changed; review the integration before rebuilding.');
  }
  let source = baseline.toString('utf8');
  const counts = { intents: 0, builds: 0, callbacks: 0 };
  const classes = ['EmojiBehavior', 'AllianceBehavior', 'MirvBehavior', 'WarshipBehavior',
    'StructureBehavior', 'AttackBehavior', 'NukeBehavior', 'NationBot'];
  const regions = classes.map((name, index) => ({ name, start: source.indexOf(`class ${name}{`),
    end: index + 1 < classes.length ? source.indexOf(`class ${classes[index + 1]}{`) : source.indexOf('"use strict";let _api=null;') }));
  if (regions.some(r => r.start < 0 || r.end <= r.start)) throw new Error('Baseline class boundaries changed.');
  for (const region of regions.reverse()) {
    let body = source.slice(region.start, region.end);
    const replacements = [];
    for (const match of body.matchAll(/\bemitIntent\(/g)) {
      const open = match.index + match[0].length - 1;
      const end = closeParen(body, open);
      const args = body.slice(open + 1, end);
      const standalone = /[;{}]\s*$/.test(body.slice(0, match.index));
      replacements.push({ start: match.index, end: end + 1,
        text: `ofhBrainRuntime.intent(this,"${region.name}",${args})` +
          (standalone ? ';if(ofhBrainRuntime.wasDeclined(this))return false' : '') });
      counts.intents++;
    }
    for (const match of body.matchAll(/\b(\w+)\.sendBuildOrUpgrade\(/g)) {
      const open = match.index + match[0].length - 1;
      const end = closeParen(body, open);
      replacements.push({ start: match.index, end: end + 1,
        text: `ofhBrainRuntime.build(this,"${region.name}",${match[1]},${body.slice(open + 1, end)});if(ofhBrainRuntime.wasDeclined(this))return false` });
      counts.builds++;
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      body = body.slice(0, replacement.start) + replacement.text + body.slice(replacement.end);
    }
    source = source.slice(0, region.start) + body + source.slice(region.end);
  }
  if (counts.intents !== 17 || counts.builds !== 9) throw new Error(`Unexpected baseline command counts: ${JSON.stringify(counts)}`);
  function replaceOne(before, after) {
    const parts = source.split(before);
    if (parts.length !== 2) throw new Error(`Expected one baseline anchor: ${before.slice(0, 100)}`);
    source = parts.join(after);
  }
  const mapCatalog=JSON.parse(fs.readFileSync(path.join(root,'src/lobby/maps.json'),'utf8')).maps;
  const mapCatalogStart=source.indexOf('(function(){const e=[{id:"achiran"');
  const mapArrayStart=source.indexOf('[',mapCatalogStart),mapArrayEnd=source.indexOf('];globalThis.OPENFRONT_MAPS',mapArrayStart);
  if(mapCatalogStart<0||mapArrayEnd<mapArrayStart)throw new Error('Lobby map catalog anchor changed');
  const oldIds=[...source.slice(mapArrayStart,mapArrayEnd).matchAll(/id:"([^"]+)"/g)].map(m=>m[1]);
  if(oldIds.some(id=>!mapCatalog.some(map=>map.id===id)))throw new Error('Map catalog would drop saved map ids');
  replaceOne(source.slice(mapArrayStart,mapArrayEnd+1),JSON.stringify(mapCatalog));
  const liveMapModules=['live-map-catalog.js','live-map-runtime.js'].map(name=>
    fs.readFileSync(path.join(root,'src/lobby',name),'utf8').replace(/^if\(typeof module.*$/m,'')).join('\n');
  replaceOne('globalThis.OPENFRONT_MAPS=Object.freeze(e)',
    'globalThis.OPENFRONT_MAPS=Object.freeze(e);'+liveMapModules+';installLiveMapCatalog(e,globalThis)');
  replaceOne('const o=n.map(u=>u.id);','const o=globalThis.__OFH_liveMaps.ids;');
  replaceOne('function O(u={},r=null){','function O(u={},r=null){u=globalThis.__OFH_liveMaps.normalizeFilters(u);');
  replaceOne('latestLobbySnapshot=a.payload;',
    'latestLobbySnapshot=a.payload;globalThis.__OFH_liveMaps.lobbies(latestLobbySnapshot);');
  replaceOne('globalThis.__OFH_openPopup=xe,',
    'globalThis.__OFH_openPopup=xe,window.addEventListener("ofh-map-catalog-update",()=>{if(f){l=F().normalizeSettings(l);if(N==="autojoin"&&H==="maps")w()}}),');
  replaceOne('function handleBridgeMessage(e){',
    'window.addEventListener("ofh-map-catalog-update",()=>{settings=normalizeSettings(settings);lobbyForecastModelCache.signature="";syncFloatingAutoJoinPanel()});function handleBridgeMessage(e){');
  const oldWeightsStart=source.indexOf('const FORECAST_MAP_FREQUENCY='),oldWeightsEnd=source.indexOf('const FORECAST_WATER_NUKES_BOOSTED_MAPS=',oldWeightsStart);
  if(oldWeightsStart<0||oldWeightsEnd<=oldWeightsStart)throw new Error('Obsolete map forecast constants changed');
  replaceOne(source.slice(oldWeightsStart,oldWeightsEnd),'');
  replaceMethodRange('function getLobbyMapTokens(', 'function pruneCooldowns()',
    fs.readFileSync(path.join(root,'src/lobby/map-filters.js'),'utf8')+'\n');
  replaceMethodRange('function getForecastMapsForType(', 'function pickWeighted(',
    'function getForecastMapsForType(type){return MAPS.map(map=>({id:map.id,weight:5}))}');
  replaceMethodRange('function randomTeamConfigForMap(', 'function teamConfigToTeamSize(',
    'function randomTeamConfigForMap(mapId){const preferred=MAPS.find(map=>map.id===mapId)?.specialTeamCount;'+
    'if(preferred&&Math.random()<.75)return preferred;const entry=pickWeighted(FORECAST_TEAM_WEIGHTS);return entry?entry.config:2}');
  replaceOne('<strong data-role="eta">—</strong>',
    '<strong data-role="eta" title="Approximate: server map weights are private and change independently. Uses equal-map priors and observed lobby matches.">—</strong>');
  const rewardsModule=fs.readFileSync(path.join(root,'src/lobby/post-match-rewards.js'),'utf8')
    .replace(/^if\(typeof module.*$/m,'');
  replaceOne('keepAutoJoinAfterMatch:true,','keepAutoJoinAfterMatch:true,autoClaimPostMatchRewards:false,');
  replaceOne('function tryAutoJoin(){',rewardsModule+'\n'+
    'const ofhPostMatchRewards=createPostMatchRewards({enabled:()=>settings.autoClaimPostMatchRewards===true,modal:()=>document.querySelector("win-modal")});'+
    'window.__OFH_postMatchRewards=ofhPostMatchRewards;'+
    'window.setInterval(()=>ofhPostMatchRewards.hold(),1000);'+
    'function tryAutoJoin(){if(ofhPostMatchRewards.hold())return;');
  replaceOne('autoLeaveFired=true;try{window.location.href="/"}',
    'if(window.__OFH_postMatchRewards?.hold())return;autoLeaveFired=true;try{window.location.href="/"}');
  replaceOne('e.append(y("Auto-leave on team win",',
    'e.append(y("Auto claim post-match rewards","Claim available match rewards before automatically leaving. Waits up to 60 seconds.",!!l.autoClaimPostMatchRewards,i=>{l.autoClaimPostMatchRewards=i,m()})),e.append(y("Auto-leave on team win",');
  const rewardRow='<label class="ofh-aj-notif"><span class="ofh-aj-notif-text">Auto claim post-match rewards</span><input type="checkbox" data-role="claim-rewards"><span class="ofh-aj-switch"></span></label>';
  replaceOne('<div class="ofh-aj-summary ${settings.floatingAutoJoinFiltersCollapsed?',
    rewardRow+'<div class="ofh-aj-summary ${settings.floatingAutoJoinFiltersCollapsed?');
  replaceOne('function applyFloatingAutoJoinPanelState(){',
    'function applyFloatingAutoJoinPanelState(){const rewardToggle=document.querySelector(\'[data-role="claim-rewards"]\');if(rewardToggle){rewardToggle.checked=settings.autoClaimPostMatchRewards===true;if(!rewardToggle.ofhWired){rewardToggle.ofhWired=true;rewardToggle.addEventListener("change",()=>saveSettings({...settings,autoClaimPostMatchRewards:rewardToggle.checked}).catch(error=>console.error("Failed to save reward setting",error)))}}');
  replaceOne('_ctors.embargo&&_ctors.donateTroops','_ctors.embargo&&_ctors.embargoAll&&_ctors.donateTroops');
  replaceOne('if(!_ctors.embargo){try{',
    'if(!_ctors.embargoAll){try{const a=new t("start"),i=new t("stop");if(a?.action==="start"&&i?.action==="stop"&&Object.keys(a).length===1&&Object.keys(i).length===1){_ctors.embargoAll=t;continue}}catch(a){}}if(!_ctors.embargo){try{');
  replaceMethodRange('maybeSendCasualEmoji(){','checkOverwhelmedByAttacks(){',
    'maybeSendCasualEmoji(){return ofhBrainRuntime.planSocial(this)}');
  replaceMethodRange('for(const a of e){const i=a.attacker();','congratulateWinner(){',
    'return ofhBrainRuntime.planSmallAttackEmoji(this,e,t,{human:PlayerType.Human,confused:EMOJI_CONFUSED,bored:EMOJI_BORED})}');
  for(const [method,end] of [['charmAllies(){','annoyTraitors(){'],['annoyTraitors(){','findRat(){'],['findRat(){','greetNearbyPlayers(){'],['greetNearbyPlayers(){','maybeSendEmoji(e,t){']]){
    const start=source.indexOf(method),stop=source.indexOf(end,start),body=source.slice(start,stop);
    if(start<0||stop<=start)throw new Error('Social recipient anchors changed');
    if((body.match(/this\.random\.randElement\([ea]\)/g)||[]).length!==1)throw new Error('Social random recipient anchor changed');
    const updated=body.replace(/this\.random\.randElement\(([ea])\)/,(_match,pool)=>'ofhBrainRuntime.selectSocialRecipient(this,'+pool+',"'+method.slice(0,-3)+'")')
      .replace(';const a=this.random.chance(3)', ';if(t===null)return;const a=this.random.chance(3)')
      .replace('this.sendEmoji(', 'ofhBrainRuntime.socialRecipientAction(this,()=>this.sendEmoji(')
      .replace(/\)\}$/, '))}');
    const variable=method==='findRat(){'?'i':'t';
    const guarded=updated.replace(`;this.sendEmoji`, `;if(${variable}===null)return;this.sendEmoji`);
    // The action wrapper begins after the recipient declaration (or message draw).
    replaceOne(body,guarded.replace(';ofhBrainRuntime.socialRecipientAction',`;if(${variable}===null)return;ofhBrainRuntime.socialRecipientAction`));
  }
  replaceOne('const a=this.game.players().filter(i=>i.type()===PlayerType.Nation).sort((i,s)=>s.numTilesOwned()-i.numTilesOwned())[0];',
    'const ofhWinners=this.game.players().filter(i=>i.type()===PlayerType.Nation).sort((i,s)=>s.numTilesOwned()-i.numTilesOwned());const a=ofhBrainRuntime.selectSocialRecipient(this,ofhWinners,"winner");');
  replaceOne('this.sendEmoji(e,EMOJI_CONGRATULATE)}}brag(){',
    'ofhBrainRuntime.socialRecipientAction(this,()=>this.sendEmoji(e,EMOJI_CONGRATULATE))}}brag(){');
  replaceOne('congratulateWinner(){','congratulateWinner(){return ofhBrainRuntime.planSocialWinner(this,()=>this._congratulateWinner())}_congratulateWinner(){');
  replaceOne('this.gameOver=true;const t=this.game.config().gameConfig().gameMode===GameMode.Team;',
    'if(!ofhBrainRuntime.markSocialWinner(this))return;const t=this.game.config().gameConfig().gameMode===GameMode.Team;');
  replaceMethodRange('maybeSendEmoji(e,t){','maybeSendAttackEmoji(e){',
    'maybeSendEmoji(e,t){return ofhBrainRuntime.planEmojiRequest(this,e,t,false,{})}');
  replaceMethodRange('maybeSendAttackEmoji(e){','sendEmoji(e,t){',
    'maybeSendAttackEmoji(e){return ofhBrainRuntime.planEmojiRequest(this,e,undefined,true,{neutral:Relation.Neutral,aggressive:EMOJI_AGGRESSIVE_ATTACK,attack:EMOJI_ATTACK})}');
  replaceMethodRange('shouldSendEmoji(e,t=true){','function respondToEmoji(',
    'shouldSendEmoji(e,t=true){return ofhBrainRuntime.emojiPermission(this,e,t,{all:AllPlayers,bot:PlayerType.Bot,human:PlayerType.Human})}}');
  replaceOne('const s=this.random.randElement(t);return}canSendEmoji(e){','ofhBrainRuntime.selectSocialMessage(this,t);return}canSendEmoji(e){');
  replaceMethodRange('function respondToMIRV(n,e,t){','function recipientCanSendEmoji(',
    'function respondToMIRV(n,e,t,ofhActor){return ofhBrainRuntime.planSocialReaction(ofhActor,()=>{if(!e.chance(8))return;if(!recipientCanSendEmoji(t,AllPlayers))return;ofhBrainRuntime.selectSocialMessage(ofhActor,EMOJI_OVERWHELMED)})}');
  replaceOne('respondToMIRV(this.game,this.random,e)','respondToMIRV(this.game,this.random,e,this)');
  replaceOne('const a=this.random.chance(3)?EMOJI_LOVE:EMOJI_CHARM_ALLIES;',
    'const ofhPool=this.random.chance(3)?EMOJI_LOVE:EMOJI_CHARM_ALLIES;const a=ofhBrainRuntime.selectSocialPool(this,[EMOJI_LOVE,EMOJI_CHARM_ALLIES],ofhPool,"charm");if(a===null)return;');
  replaceOne('s.action();_allianceBehaviorActioned.add(e);',
    'ofhBrainRuntime.diplomacyCallback(this,"renewal","AllianceBehavior.renew",s,"action");if(ofhBrainRuntime.allianceEventStopped(this))return false;_allianceBehaviorActioned.add(e);');
  replaceOne('runAndCaptureAllianceCtor(()=>c.action());_allianceBehaviorActioned.add(a);',
    'runAndCaptureAllianceCtor(()=>ofhBrainRuntime.diplomacyCallback(this,"incoming","AllianceBehavior.accept",c,"action"));if(ofhBrainRuntime.allianceEventStopped(this))return false;_allianceBehaviorActioned.add(a);');
  replaceOne('c.action();_allianceBehaviorActioned.add(a)',
    'ofhBrainRuntime.diplomacyCallback(this,"incoming","AllianceBehavior.reject",c,"action");if(ofhBrainRuntime.allianceEventStopped(this))return false;_allianceBehaviorActioned.add(a)');
  counts.callbacks = 3;
  replaceOne('this.attackTick=this.random.nextInt(0,this.attackRate)}getAttackRate()',
    'this.attackTick=this.random.nextInt(0,this.attackRate);ofhBrainRuntime.attach(this)}getAttackRate()');
  replaceOne('async tick(e){this.player=this.mg.myPlayer();',
    'async tick(e){this.player=this.mg.myPlayer();ofhBrainRuntime.begin(this);');
  replaceOne('try{if(state.settings.warshipAutoSpawn!==false){this.warshipBehavior.trackShipsAndRetaliate()}if(state.settings.winFixes){if(state.settings.warshipNukeDodge!==false){this.warshipBehavior.dodgeNukes()}this.warshipBehavior.smartWarshipPatrol();this.warshipBehavior.smartWarshipCombat()}}catch(c){console.error("[AutoBot] trackShips error:",c)}',
    'try{ofhBrainRuntime.planWarshipMaintenance(this,e)}catch(c){console.error("[AutoBot] trackShips error:",c)}');
  replaceOne('this.behaviorsInitialized=true}currentSpawnTopKey()',
    'this.behaviorsInitialized=true;ofhBrainRuntime.attachBehaviors(this)}currentSpawnTopKey()');
  const structureStart = source.indexOf('async doHandleStructures(){');
  const choiceStart = source.indexOf('const s=!e.isUnitDisabled(UNIT.MissileSilo);', structureStart);
  const choiceEnd = source.indexOf('}hasHighStartingGold(){', choiceStart);
  if (structureStart < 0 || choiceStart < structureStart || choiceEnd < choiceStart) {
    throw new Error('Structure planning integration anchors changed');
  }
  // Preserve the original preparation; replace only its sequential choice tail.
  replaceOne(source.slice(choiceStart, choiceEnd),
    'return ofhBrainRuntime.planStructures(this,{cityLevels:a,cityDisabled:t,sharedWater:i})');
  replaceMethodRange('async structureSpawnTile(e){', 'async buildableFor(e,t){',
    'async structureSpawnTile(e){return ofhBrainRuntime.planStructurePlacement(this,e)}');
  replaceMethodRange('async handleStructures(){', 'async tryBuildDefensePost(){',
    'async handleStructures(){return ofhBrainRuntime.planBuilding(this,"handle")}');
  replaceMethodRange('async findBestStructureToUpgrade(e){', 'async structureSpawnTile(e){',
    'async findBestStructureToUpgrade(e){return ofhBrainRuntime.planBuilding(this,"upgrade",e)}');
  replaceOne('if(this.getTotalStructureDensity()>UPGRADE_DENSITY_THRESHOLD&&this.game.config().unitInfo(e).upgradable){if(await this.maybeUpgradeStructure(s)){return true}if(s.length>0){return false}}const r=await this.structureSpawnTile(e);',
    'return ofhBrainRuntime.planBuilding(this,"action",e,s)}async _placeNewStructure(e){const r=await this.structureSpawnTile(e);if(!ofhBrainRuntime.buildingAllowed(this))return false;');
  replaceOne('const t=await this.findBestStructureToUpgrade(e);if(t!==null){',
    'const t=await this.findBestStructureToUpgrade(e);if(!ofhBrainRuntime.buildingAllowed(this))return false;if(t!==null){');
  const defenseStart = source.indexOf('for(const T of v){const x=await this.buildableFor(UNIT.DefensePost,T);');
  const defenseEnd = source.indexOf('dpLandAttacks(){', defenseStart);
  if (defenseStart < 0 || defenseEnd <= defenseStart) throw new Error('Defense placement anchors changed');
  const defenseBody = source.slice(defenseStart, defenseEnd);
  const defenseSubmit = defenseBody.slice(defenseBody.indexOf('const I=getBuildMenu();'), defenseBody.lastIndexOf('return true}') + 'return true'.length);
  replaceOne(defenseBody, 'const x=await ofhBrainRuntime.planBuilding(this,"defense",v,{threatRatio:o,targetPosts:d,frontTiles:h.length,minDepth:g});if(x===null||!ofhBrainRuntime.buildingAllowed(this))return false;' + defenseSubmit + '}');
  const botAttackStart = source.indexOf('async attackBots(){');
  const botAttackEnd = source.indexOf('getBotAttackMaxParallelism(){', botAttackStart);
  if (botAttackStart < 0 || botAttackEnd <= botAttackStart) throw new Error('Bot-target integration anchors changed');
  replaceOne(source.slice(botAttackStart, botAttackEnd), 'async attackBots(){return ofhBrainRuntime.planBotTargets(this)}');
  function replaceMethodRange(start, next, replacement) {
    const begin = source.indexOf(start);
    const end = source.indexOf(next, begin + start.length);
    if (begin < 0 || end <= begin) throw new Error(`Attack integration anchors changed: ${start}`);
    replaceOne(source.slice(begin, end), replacement);
  }
  replaceOne('if(this.getAllianceDecision(t,true)){e.accept()}else{e.reject()}',
    'const a=this.getAllianceDecision(t,true,"incoming");if(ofhBrainRuntime.allianceDecisionStopped(this))continue;if(a){e.accept()}else{e.reject()}');
  replaceOne('if(!this.getAllianceDecision(i,true))continue;', 'if(!this.getAllianceDecision(i,true,"renewal"))continue;');
  const requestsStart=source.indexOf('incomingAllianceRequests(){'),requestsEnd=source.indexOf('canSendAllianceRequest(e){',requestsStart);
  const pushStart=source.indexOf('e.push({__ev:a',requestsStart),pushEnd=source.indexOf('})}return e}',pushStart);
  if(requestsStart<0||requestsEnd<=requestsStart||pushStart<=requestsStart||pushEnd<=pushStart)throw new Error('Incoming event factory anchors changed');
  const requestFactory=source.slice(pushStart+'e.push('.length,pushEnd+1)
    .replace('accept:()=>{','accept:()=>ofhBrainRuntime.planAllianceEvents(this,"action","accept",()=>{')
    .replace('},reject:()=>{','},ofhRequest),reject:()=>ofhBrainRuntime.planAllianceEvents(this,"action","reject",()=>{')
    .replace(/\}\}$/, '},ofhRequest)}');
  replaceOne(source.slice(requestsStart,requestsEnd),
    'incomingAllianceRequests(){return ofhBrainRuntime.planAllianceEvents(this,"collect")}_makeIncomingAllianceRequest(a,s,r,l,o){const ofhRequest='+requestFactory+';return ofhRequest;}');
  replaceMethodRange('handleAllianceRequests(){','handleAllianceRequestsFromBots(){',
    'handleAllianceRequests(){return ofhBrainRuntime.planAllianceEvents(this,"requests")}');
  replaceMethodRange('handleAllianceRequestsFromBots(){','handleAllianceExtensionRequests(){',
    'handleAllianceRequestsFromBots(){return ofhBrainRuntime.planAllianceEvents(this,"bots")}_markAllianceEvent(e){_allianceBehaviorActioned.add(e)}');
  const renewStart=source.indexOf('handleAllianceExtensionRequests(){'),renewEnd=source.indexOf('maybeSendAllianceRequests(e){',renewStart);
  const renewReadyStart=source.indexOf('try{ofhBrainRuntime.diplomacyCallback(this,"renewal"',renewStart);
  if(renewStart<0||renewReadyStart<=renewStart||renewEnd<=renewReadyStart)throw new Error('Renewal response anchors changed');
  const renewReady=source.slice(renewReadyStart,renewEnd).slice(0,-3);
  replaceOne(source.slice(renewStart,renewEnd),
    'handleAllianceExtensionRequests(){return ofhBrainRuntime.planAllianceEvents(this,"renewal")}_renewAllianceEvent(e,s,i){return ofhBrainRuntime.planAllianceEvents(this,"action","renew",()=>{'+renewReady+'})}');
  replaceOne('this.getAllianceDecision(t,false)', 'this.getAllianceDecision(t,false,"outgoing")');
  const outgoingStart = source.indexOf('maybeSendAllianceRequests(e){');
  const outgoingEnd = source.indexOf('isFarNation(e){', outgoingStart);
  if (outgoingStart < 0 || outgoingEnd <= outgoingStart) throw new Error('Alliance outgoing anchors changed');
  const outgoing = source.slice(outgoingStart, outgoingEnd);
  replaceOne(outgoing, outgoing.replace('ofhBrainRuntime.intent(this,"AllianceBehavior",',
    'ofhBrainRuntime.diplomacyIntent(this,"outgoing","AllianceBehavior",'));
  const outgoingBody=source.slice(source.indexOf('maybeSendAllianceRequests(e){'),source.indexOf('isFarNation(e){',source.indexOf('maybeSendAllianceRequests(e){')));
  const outgoingReady=outgoingBody.slice(outgoingBody.indexOf('if(this.random.chance(30)'),-2);
  replaceOne(outgoingBody,
    'maybeSendAllianceRequests(e){if(this.game.config().disableAlliances())return;return ofhBrainRuntime.planAllianceOutreach(this,e)}'+
    '_outgoingAllianceCandidate(t){'+outgoingReady.replace(';setLastAction(tr("🤝➡️ Send alliance',
      ';if(ofhBrainRuntime.wasDeclined(this))return;setLastAction(tr("🤝➡️ Send alliance')+'}');
  const farStart=source.indexOf('reachOutToFarNations(){'),farChoice=source.indexOf('const r=this.random.randElement(s);',farStart);
  const farEnd=source.indexOf('getAllianceDecision(e,t){',farChoice);
  if(farStart<0||farChoice<=farStart||farEnd<=farChoice)throw new Error('Far outreach anchors changed');
  const farReady=source.slice(farChoice+'const r=this.random.randElement(s);'.length,farEnd);
  replaceOne(source.slice(farChoice,farEnd),'return ofhBrainRuntime.planFarOutreach(this,s,e,a)}_farOutreachReady(r,e,a){'+
    farReady.replace(';setLastAction(tr("🤝➡️ Trade-ally',
      ';if(ofhBrainRuntime.wasDeclined(this))return;setLastAction(tr("🤝➡️ Trade-ally'));
  const donationStart=source.indexOf('donateTroops(){'),donationChoice=source.indexOf('const a=t.map(g=>{',donationStart);
  const donationReady=source.indexOf('const p=discoverCtors(getEventBus());',donationChoice);
  const donationEnd=source.indexOf('const SALVO_GAP_MS=',donationReady);
  if(donationStart<0||donationChoice<=donationStart||donationReady<=donationChoice||donationEnd<=donationReady)throw new Error('Donation anchors changed');
  const donationTail=source.slice(donationReady,donationEnd);
  replaceOne(source.slice(donationChoice,donationEnd),'return ofhBrainRuntime.planDonation(this,t)}_donateReady(r,c){'+
    donationTail.replace('setLastAction(tr("🎁 Donate troops"),"combat")',
      'setLastAction(tr("🎁 Donate troops"),"combat");return true').replace('return true}}','return false}}'));
  replaceMethodRange('getAllianceDecision(e,t){', 'hasTooManyAlliances(e){',
    'getAllianceDecision(e,t,a){return ofhBrainRuntime.decideAlliance(this,e,t,a)}');
  replaceMethodRange('async attackBestTarget(e,t){', 'hasNeighboringBotWithStructures(){',
    'async attackBestTarget(e,t){return ofhBrainRuntime.planAttacks(this,e,t)}');
  replaceMethodRange('if(c&&state.settings.winFixes){const p=i.filter', 'async attackWithRandomBoat(e=[]){',
    'return ofhBrainRuntime.planAttackSequence(this,{all:i,friends:s,enemies:r,openLand:l,expand:c,boat:d,alliance:f})}');
  replaceMethodRange('const a=this.random.randElement(t);let i=await this.findRandomBoatTarget(a,e,true);', 'async maybeOpportunisticBoat(){',
    'return ofhBrainRuntime.planTacticalBoat(this,t,e)}_launchTacticalBoat(i,r){const s=discoverCtors(getEventBus());if(this.openingVetoesTile(i))return false;if(s.boat&&ofhBrainRuntime.intent(this,"AttackBehavior",s.boat,i,r)){state.stats.attacks++;setLastAction(tr("⛵ Random boat"),"naval");return true}return false}');
  replaceMethodRange('for(const l of o){if(l.owner.isPlayer()&&r.has(l.owner.id()))', 'async attackBestTarget(e,t){',
    'return ofhBrainRuntime.planBoatSites(this,o,{mode:"random",origin:e})}');
  replaceMethodRange('const i=this.player.smallID();for(let s=state.recentMirvHits.length-1;', 'async findRandomBoatTarget(e,t,a=false){',
    'return ofhBrainRuntime.chooseBoatCrater(this,state.recentMirvHits)}');
  replaceMethodRange('findIncomingAttackPlayer(){', 'async attackBots(){',
    'findIncomingAttackPlayer(){return ofhBrainRuntime.selectAttackTarget(this,"incoming")}');
  replaceMethodRange('async assistAllies(){', 'findTraitor(e){',
    'async assistAllies(){if(this.emojiBehavior===void 0)throw new Error("not initialized");return ofhBrainRuntime.planAssist(this)}');
  replaceMethodRange('findTraitor(e){', 'async maybeBetrayAndAttack(e,t){',
    'findTraitor(e){return ofhBrainRuntime.selectAttackTarget(this,"traitor",e)}');
  replaceMethodRange('async maybeBetrayAndAttack(e,t){', 'isBorderingNukedTerritory(){',
    'async maybeBetrayAndAttack(e,t){if(this.allianceBehavior===void 0)throw new Error("not initialized");return ofhBrainRuntime.planBetray(this,e,t)}');
  replaceMethodRange('findVictim(e){', 'findVeryWeakEnemy(e){',
    'findVictim(e){return ofhBrainRuntime.selectAttackTarget(this,"victim",e)}');
  replaceMethodRange('findVeryWeakEnemy(e){', 'async findNearestIslandEnemy(){',
    'findVeryWeakEnemy(e){return ofhBrainRuntime.selectAttackTarget(this,"weak",e)}');
  replaceMethodRange('async findSealablePocket(){', 'hostileWaveRemaining(){',
    'async findSealablePocket(){return ofhBrainRuntime.selectAttackGeography(this,"pocket")}');
  replaceMethodRange('async findNearestIslandEnemy(){', 'isFFA(){',
    'async findNearestIslandEnemy(){return ofhBrainRuntime.selectAttackGeography(this,"island")}');
  function replaceLandingLoop(method, loopAnchor, nextMethod, mode) {
    const start = source.indexOf(method);
    const loop = source.indexOf(loopAnchor, start);
    const end = source.indexOf(nextMethod, loop);
    if (start < 0 || loop <= start || end <= loop) throw new Error(`Landing integration anchors changed: ${method}`);
    replaceOne(source.slice(loop, end), `return ofhBrainRuntime.planNavalLanding(this,a,{mode:"${mode}",probeCap:i})}`);
  }
  replaceLandingLoop('async findDisconnectedBoatTarget(){', 'for(let s=0;s<a.length&&s<i;s++){',
    'async findDistantBoatTarget(){', 'disconnected');
  replaceLandingLoop('async findDistantBoatTarget(){', 'const s="__probe_timeout__";',
    'emitBoat(e,t,a){', 'distant');
  replaceOne('async findDistantBoatTarget(){','async findDistantBoatTarget(ofhCoastal=false){if(ofhCoastal)return ofhBrainRuntime.findEnemyProbeTarget(this);');
  const navalStart = source.indexOf('async maybeOpportunisticBoat(){');
  const navalChoiceStart = source.indexOf('const f=state.beachhead;', navalStart);
  const navalEnd = source.indexOf('boatTargetTaken(e){', navalChoiceStart);
  if (navalStart < 0 || navalChoiceStart <= navalStart || navalEnd <= navalChoiceStart) throw new Error('Naval action integration anchors changed');
  replaceOne(source.slice(navalChoiceStart, navalEnd),
    'return ofhBrainRuntime.planNavalActions(this,{now:a,fill:u,surplusFill:c,shore:d})}');
  replaceOne('const i=state.settings.oppBoatThrottleMs||1200;',
    'const i=ofhBrainRuntime.probeThrottle(this,state.settings.oppBoatThrottleMs||1200);');
  replaceMethodRange('for(const y of f){const b=Math.floor(this.game.x(y.tile)/g)', 'findInvasionThreat(){',
    'return ofhBrainRuntime.planWarshipPatrol(this,f,{smart:e,tick:i,cellSize:g,serviceTicks:m})}');
  replaceMethodRange('findInvasionThreat(){','findLossZone(e){',
    'findInvasionThreat(){return ofhBrainRuntime.selectWarshipThreat(this,"invasion")}');
  replaceMethodRange('findLossZone(e){','moveBestWarshipTo(e,t,a,i){',
    'findLossZone(e){return ofhBrainRuntime.selectWarshipThreat(this,"loss",e)}');
  replaceOne('smartWarshipPatrol(){','smartWarshipPatrol(){return ofhBrainRuntime.planWarshipThreatPass(this,()=>this._smartWarshipPatrol())}_smartWarshipPatrol(){');
  replaceOne('const h=this.findInvasionThreat();if(h!==null)f.push(h);',
    'const h=this.findInvasionThreat();if(!ofhBrainRuntime.warshipThreatAllowed(this))return;if(h!==null)f.push(h);');
  replaceMethodRange('if(e.raids.length>0){const y=e.raids[e.raids.length-1];','const p=this.findLossZone(e.losses);',
    'const ofhTrade=ofhBrainRuntime.selectWarshipThreat(this,"trade",e.raids);if(!ofhBrainRuntime.warshipThreatAllowed(this))return;if(ofhTrade!==null)f.push({tile:ofhTrade,kind:"trade-lane"});');
  replaceOne('const p=this.findLossZone(e.losses);if(p!==null)',
    'const p=this.findLossZone(e.losses);if(!ofhBrainRuntime.warshipThreatAllowed(this))return;if(p!==null)');
  replaceMethodRange('maybeRetaliateWithWarship(e,t,a){', 'async _retaliateBuildAsync(e,t,a){',
    'maybeRetaliateWithWarship(e,t,a,ofhOnDecline){return ofhBrainRuntime.planWarshipRetaliation(this,e,t,a,ofhOnDecline)}');
  replaceMethodRange('trackIncomingTransportsAndRetaliate(){', 'maybeRetaliateWithWarship(e,t,a,ofhOnDecline){',
    'trackIncomingTransportsAndRetaliate(){return ofhBrainRuntime.planIncomingTransports(this)}');
  replaceMethodRange('trackShipsAndRetaliate(){','trackTransportShipsAndRetaliate(){',
    'trackShipsAndRetaliate(){return ofhBrainRuntime.planWarshipTracking(this)}');
  replaceMethodRange('trackTransportShipsAndRetaliate(){','trackTradeShipsAndRetaliate(){',
    'trackTransportShipsAndRetaliate(){return ofhBrainRuntime.planOutgoingShips(this,"transport")}');
  replaceMethodRange('trackTradeShipsAndRetaliate(){','trackIncomingTransportsAndRetaliate(){',
    'trackTradeShipsAndRetaliate(){return ofhBrainRuntime.planOutgoingShips(this,"trade")}');
  replaceOne('async _retaliateBuildAsync(e,t,a){try{const i=await this.buildableWarship(e);',
    '_retaliateBuildReady(e,t,a,i){try{');
  const readyStart = source.indexOf('_retaliateBuildReady(e,t,a,i){');
  const readyEnd = source.indexOf('maybeMoveWarship(e){', readyStart);
  const ready = source.slice(readyStart, readyEnd);
  replaceOne(ready, ready
    .replace('this.maybeMoveWarship(e);return', 'this.maybeMoveWarship(e);return "fallback-unbuildable"')
    .replace('this.maybeMoveWarship(e);return}', 'this.maybeMoveWarship(e);return "fallback-menu"}')
    .replace('this.player.updateRelation(t,a==="trade"?-7.5:-15)', 'this.player.updateRelation(t,a==="trade"?-7.5:-15);return "build-attempted"')
    .replace('catch(i){}', 'catch(i){return "failed"}'));
  replaceMethodRange('let V=null;if(x<I*c){', 'moveWarship(e,t){',
    'ofhBrainRuntime.planWarshipCombat(this,{ship:b,smart:i,health:x,maxHealth:I,retreatRatio:c,evade:G,enemies:B,trades:p,home:g,homeDecisionId:ofhHome.decisionId,hunt:h,patrol:M})}catch(v){}}}');
  replaceMethodRange('let g=null;const m=[];const y=e.units(UNIT.Port)||[];', 'for(const b of o){try{const v=b.id();',
    'const ofhHome=ofhBrainRuntime.selectWarshipHome(this,o[0]);if(ofhHome.held)return;const g=ofhHome.tile;');
  const dodgeStart=source.indexOf('dodgeNukes(){');
  const dodgeLoop=source.indexOf('const l=this.ensureSmartState();for(const u of e){',dodgeStart);
  const dodgeReady=source.indexOf('const m=discoverCtors(getEventBus());if(!m.moveWarship)continue;',dodgeLoop);
  const dodgeEnd=source.indexOf('simulateBattle(e,t,a,i){',dodgeReady);
  if(dodgeStart<0||dodgeLoop<=dodgeStart||dodgeReady<=dodgeLoop||dodgeEnd<=dodgeReady)throw new Error('Nuke dodge anchors changed');
  const dodgeTail=source.slice(dodgeReady,dodgeEnd);
  if(!dodgeTail.endsWith('}catch(c){}}}'))throw new Error('Nuke dodge return changed');
  replaceOne(source.slice(dodgeLoop,dodgeEnd),
    'return ofhBrainRuntime.planWarshipNukeDodge(this,e,{tick:t,zones:i,eta:r,smart:this.ensureSmartState()})}' +
    '_dodgeWarshipReady(u,p,t,l){'+dodgeTail.replace('if(!m.moveWarship)continue;','if(!m.moveWarship)return false;')
      .replace(';l.cooldown.set(u.id(),t);',';if(ofhBrainRuntime.wasDeclined(this))return false;l.cooldown.set(u.id(),t);')
      .replace(/\}catch\(c\)\{\}\}\}$/, ';return true}'));
  replaceMethodRange('findNukeEscapeTile(e,t,a,i){','dodgeNukes(){',
    'findNukeEscapeTile(e,t,a,i){return ofhBrainRuntime.selectWarshipNukeEscape(this,e,t,a,i)}');
  replaceMethodRange('findSafeWaypoint(e,t,a){','smartWarshipCombat(){',
    'findSafeWaypoint(e,t,a){return ofhBrainRuntime.selectWarshipWaypoint(this,e,t,a)}');
  const deployStart = source.indexOf('async maybeSpawnWarship(){');
  const deployChoice = source.indexOf('const e=this.player.units(UNIT.Port);', deployStart);
  const deployReady = source.indexOf('const r=getBuildMenu();', deployChoice);
  const deployEnd = source.indexOf('warshipSpawnTile(e,t){', deployReady);
  if (deployStart < 0 || deployChoice <= deployStart || deployReady <= deployChoice || deployEnd <= deployReady) throw new Error('Deployment anchors changed');
  const deployTail = source.slice(deployReady, deployEnd);
  if (!deployTail.endsWith('return true}return false}')) throw new Error('Deployment return changed');
  replaceOne(source.slice(deployChoice, deployEnd), 'return ofhBrainRuntime.planWarshipDeployment(this)}_deployWarshipReady(i,s){' +
    deployTail.replace(/return true}return false}$/, 'return true}'));
  replaceOne('const t=this.findWarshipInfestationCounterTarget(e);if(t!==null){await this.buildCounterWarship(t)}',
    'await ofhBrainRuntime.planWarshipInfestation(this,e)');
  replaceMethodRange('findTeamGameWarshipTarget(){', 'findFreeForAllWarshipTarget(){',
    'findTeamGameWarshipTarget(){return ofhBrainRuntime.selectWarshipInfestation(this,true)}');
  replaceMethodRange('findFreeForAllWarshipTarget(){', 'async buildCounterWarship(e){',
    'findFreeForAllWarshipTarget(){return ofhBrainRuntime.selectWarshipInfestation(this,false)}');
  replaceOne('async buildCounterWarship(e){const t=e.warship.tile();const a=await this.buildableWarship(t);',
    'async buildCounterWarship(e){const t=e.warship.tile();const a=await this.buildableWarship(t);const r=this._counterWarshipReady(t,a);if(r===false)return false}_counterWarshipReady(t,a){');
  const counterStart = source.indexOf('_counterWarshipReady(t,a){');
  const counterEnd = source.indexOf('async buildableWarship(e){', counterStart);
  const counterReady = source.slice(counterStart, counterEnd);
  replaceOne(counterReady, counterReady
    .replace('this.maybeMoveWarship(t);return', 'this.maybeMoveWarship(t);return "fallback-unbuildable"')
    .replace('this.maybeMoveWarship(t);return}', 'this.maybeMoveWarship(t);return "fallback-menu"}')
    .replace('this.emojiBehavior.sendEmoji(AllPlayers,EMOJI_WARSHIP_RETALIATION)', 'this.emojiBehavior.sendEmoji(AllPlayers,EMOJI_WARSHIP_RETALIATION);return "build-attempted"'));
  replaceMethodRange('warshipSpawnTile(e,t){', 'trackShipsAndRetaliate(){',
    'warshipSpawnTile(e,t){return ofhBrainRuntime.selectWarshipSpawn(this,e,t)}');
  replaceMethodRange('maybeMoveWarship(e){', 'async counterWarshipInfestation(){',
    'maybeMoveWarship(e){ofhBrainRuntime.selectMovingWarship(this,e,{})}');
  const moveStart = source.indexOf('moveBestWarshipTo(e,t,a,i){');
  const moveReady = source.indexOf('const c=discoverCtors(getEventBus());',moveStart);
  const moveEnd = source.indexOf('computeNukeRemainingTicks(e,t){',moveReady);
  if (moveStart < 0 || moveReady <= moveStart || moveEnd <= moveReady) throw new Error('Warship movement anchors changed');
  const moveTail = source.slice(moveReady,moveEnd);
  replaceOne(source.slice(moveStart,moveEnd),
    'moveBestWarshipTo(e,t,a,i){return ofhBrainRuntime.selectMovingWarship(this,e,{purpose:t,smart:a,tick:i})}' +
    '_moveSelectedWarship(u,e,t,a,i){if(!a){const c=discoverCtors(getEventBus());if(c.moveWarship){return ofhBrainRuntime.intent(this,"WarshipBehavior",c.moveWarship,[u.id()],e)}return false}' + moveTail);
  replaceMethodRange('const e=await this.cost(UNIT.MIRV);if(state.settings.winFixes){', 'selectCounterMirvTarget(){',
    'const e=await this.cost(UNIT.MIRV);return ofhBrainRuntime.planMirv(this,e)}');
  replaceOne('const a=this.findBestNukeTarget();',
    'const ofhTargetSelection={};const a=this.findBestNukeTarget(ofhTargetSelection);');
  replaceMethodRange('let o;if(!this.game.config().isUnitDisabled(UNIT.HydrogenBomb)', 'const l=this.game.config().nukeMagnitudes(o).outer;',
    'const ofhWeaponSelection={};const o=await ofhBrainRuntime.selectNukeWeapon(this,{available:r,hydroCost:i,atomCost:s,parentDecisionId:ofhTargetSelection.decisionId},ofhWeaponSelection);if(o===null)return;');
  replaceMethodRange('let v=null;let T=null;let x=true;for(const M of b){', 'findBestNukeTarget(){',
    'return ofhBrainRuntime.planNuke(this,b,{target:a,weapon:o,difficulty:d,parentDecisionId:ofhWeaponSelection.decisionId??ofhTargetSelection.decisionId})}');
  replaceOne('this.chooseNukeArc(k,M):', 'this.chooseNukeArc(k,M,undefined,ofhWeaponSelection.decisionId):');
  replaceOne('b.push({tile:M,value:G,interceptable:B,arcUp:N.arcUp})',
    'b.push({tile:M,value:G,interceptable:B,arcUp:N.arcUp,arcDecisionId:ofhBrainRuntime.strikeDecisionId(N)})');
  replaceOne('async maybeSendMIRV(e){', 'async maybeSendMIRV(e,ofhDecisionId){');
  replaceOne('async sendNuke(e,t,a,i=0,s=false,r=true){', 'async sendNuke(e,t,a,i=0,s=false,r=true,ofhDecisionId){');
  replaceOne('async maybeDestroyEnemySam(e){', 'async maybeDestroyEnemySam(e,ofhDecisionId){');
  replaceOne('async maybeUpgradeHelpfulSilo(e){', 'async maybeUpgradeHelpfulSilo(e,ofhDecisionId){');
  replaceOne('await this.maybeUpgradeHelpfulSilo(l)', 'await this.maybeUpgradeHelpfulSilo(l,ofhDecisionId)');
  replaceOne('await this.sendNuke(c,UNIT.AtomBomb,e,d.waitTicksPerBomb[f],true,d.arcUpPerBomb?d.arcUpPerBomb[f]!==false:true);await salvoPace(f,d.bombsToFire)',
    'if(!ofhBrainRuntime.strikeAllowed(this))return;await this.sendNuke(c,UNIT.AtomBomb,e,d.waitTicksPerBomb[f],true,d.arcUpPerBomb?d.arcUpPerBomb[f]!==false:true,ofhDecisionId);if(!ofhBrainRuntime.strikeAllowed(this))return;await salvoPace(f,d.bombsToFire)');
  replaceOne('setLastAction(tr("☢️ Salvo ×{n} → SAM break",',
    'if(!ofhBrainRuntime.strikeAllowed(this))return;setLastAction(tr("☢️ Salvo ×{n} → SAM break",');
  for (const type of ['AtomBomb', 'HydrogenBomb']) {
    replaceOne(`const p=await this.cost(UNIT.${type});if(p)`,
      `const p=await this.cost(UNIT.${type});if(!ofhBrainRuntime.strikeAllowed(this))return;if(p)`);
  }
  for (const name of ['NukeBehavior', 'MirvBehavior']) {
    const start = source.indexOf(`class ${name}{`), end = source.indexOf('"use strict";', start);
    const body = source.slice(start, end);
    replaceOne(body, body.replaceAll(`ofhBrainRuntime.build(this,"${name}",`, `ofhBrainRuntime.strikeBuild(this,ofhDecisionId,"${name}",`));
  }
  replaceMethodRange('findBestNukeTarget(){', 'isRichestNation(){',
    'findBestNukeTarget(ofhSelection){return ofhBrainRuntime.selectNukeTarget(this,ofhSelection)}');
  const samStart = source.indexOf('async maybeDestroyEnemySam(e,ofhDecisionId){');
  const samChoice = source.indexOf('let o=false;let l=null;for(const u of r){', samStart);
  const samEnd = source.indexOf('findEnemySamsCoveringTile(e){', samChoice);
  if (samStart < 0 || samChoice <= samStart || samEnd <= samChoice) throw new Error('SAM planning anchors changed');
  replaceOne(source.slice(samChoice,samEnd), 'return ofhBrainRuntime.planSamClear(this,e,r,{cost:a,silos:s,parentDecisionId:ofhDecisionId})}');
  const upgradeStart = source.indexOf('async maybeUpgradeHelpfulSilo(e,ofhDecisionId){');
  const upgradeReady = source.indexOf('if(r!==null){let l;try{', upgradeStart);
  const upgradeEnd = source.indexOf('async cost(e){', upgradeReady);
  if (upgradeStart < 0 || upgradeReady <= upgradeStart || upgradeEnd <= upgradeReady) throw new Error('Silo selection anchors changed');
  const readyUpgrade = source.slice(upgradeReady + 'if(r!==null){'.length, upgradeEnd);
  if (!readyUpgrade.endsWith('}}}')) throw new Error('Silo ready tail changed');
  replaceOne(source.slice(upgradeStart,upgradeEnd),
    'async maybeUpgradeHelpfulSilo(e,ofhDecisionId){return ofhBrainRuntime.planHelpfulSilo(this,{...e,parentDecisionId:ofhDecisionId})}async _upgradeSiloReady(r,ofhDecisionId){' + readyUpgrade.slice(0,-1));
  replaceMethodRange('chooseNukeArc(e,t,a){', 'canSetNukeArc(){',
    'chooseNukeArc(e,t,a,ofhDecisionId){return ofhBrainRuntime.selectNukeArc(this,{fromTile:e,targetTile:t,ignoredSamIds:a,parentDecisionId:ofhDecisionId})}');
  replaceOne('const B=N.intercepted;if(B&&!y)', 'if(N.stopped)return;const B=N.intercepted;if(B&&!y)');
  replaceOne('planSaturationSalvo(e,t,a){', 'planSaturationSalvo(e,t,a,ofhDecisionId){');
  replaceOne('const J=this.chooseNukeArc(C.tile(),e,s);const ue=J.intercepted;',
    'const J=this.chooseNukeArc(C.tile(),e,s,ofhDecisionId);if(J.stopped)return{ok:false,stopped:true};const ue=J.intercepted;');
  replaceOne('async planSaturationSalvoFor(e){', 'async planSaturationSalvoFor(e,ofhDecisionId){');
  replaceOne('try{i=this.planSaturationSalvo(e,a,t)}catch(s){return null}return i&&i.ok?i:null',
    'if(!ofhBrainRuntime.strikeAllowed(this))return{ok:false,stopped:true};try{i=this.planSaturationSalvo(e,a,t,ofhDecisionId)}catch(s){return null}return i&&i.stopped?i:i&&i.ok?i:null');
  const salvoStart=source.indexOf('planSaturationSalvo(e,t,a,ofhDecisionId){');
  const salvoSort=source.indexOf('u.sort((C,F)=>',salvoStart);
  const salvoEnd=source.indexOf('async planSaturationSalvoFor(',salvoSort);
  if(salvoStart<0||salvoSort<=salvoStart||salvoEnd<=salvoSort)throw new Error('Salvo measurement anchors changed');
  const salvoMeasurements=source.slice(salvoStart+'planSaturationSalvo(e,t,a,ofhDecisionId){'.length,salvoSort);
  replaceOne(source.slice(salvoStart,salvoEnd),
    'planSaturationSalvo(e,t,a,ofhDecisionId){return ofhBrainRuntime.planSaturationSalvo(this,{targetTile:e,cost:t,silos:a,parentDecisionId:ofhDecisionId})}'+
    '_measureSalvoSilos(e,a,ofhDecisionId){'+salvoMeasurements+'return{silos:u,coveringSamIds:s,requiredBase:o}}');
  for (const [start,next,method,mode] of [
    ['selectCounterMirvTarget(){','selectVictoryDenialTarget(){','selectCounterMirvTarget()','counter'],
    ['selectVictoryDenialTarget(){','selectSteamrollStopTarget(){','selectVictoryDenialTarget()','denial'],
    ['selectSteamrollStopTarget(){','teamHasWon(){','selectSteamrollStopTarget()','steamroll'],
    ['selectWinFixMirvTarget(e){','wasRecentlyMirved(e){','selectWinFixMirvTarget(e)','win-fix'],
    ['findHighDensityTarget(){','findFFACrownTarget(){','findHighDensityTarget()','density'],
    ['findFFACrownTarget(){','findStrongestTeamTarget(){','findFFACrownTarget()','crown'],
    ['findStrongestTeamTarget(){','async getPerceivedNukeCost(e){','findStrongestTeamTarget()','team']
  ]) replaceMethodRange(start,next,`${method}{return ofhBrainRuntime.selectStrikePlayer(this,"${mode}")}`);
  replaceOne('if(!l){if(u&&this.feat("build")){await this.structureBehavior.handleStructures()}return}',
    'if(!l){if(u&&this.feat("build")){await ofhBrainRuntime.planTurn(this,{path:"build-only",tick:e,attackRate:i})}return}');
  const turnChainStart = source.indexOf('this.emojiBehavior.maybeSendCasualEmoji();', source.indexOf('class NationBot{'));
  const turnChainEnd = source.indexOf('}catch(c){console.error("[AutoBot] decision chain error:",c)}', turnChainStart);
  if (turnChainStart < 0 || turnChainEnd <= turnChainStart) throw new Error('Turn coordinator integration anchors changed');
  replaceOne(source.slice(turnChainStart, turnChainEnd),
    'await ofhBrainRuntime.planTurn(this,{path:"full",tick:e,attackRate:i})');
  const landStart=source.indexOf('sendLandAttack(e,t=false){');
  const landReserveEnd=source.indexOf('const o=a*r;',landStart);
  const landReady=source.indexOf('if(e.isPlayer()&&this.player.type()===PlayerType.Nation){',landReserveEnd);
  const landEnd=source.indexOf('async sendBoatAttack(e){',landReady);
  if(landStart<0||landReserveEnd<=landStart||landReady<=landReserveEnd||landEnd<=landReady)throw new Error('Land allocation anchors changed');
  const reserveFacts=source.slice(landStart,landReserveEnd).replace('sendLandAttack(e,t=false){','_landReserveFacts(e,t=false){');
  replaceOne(source.slice(landStart,landEnd),
    'sendLandAttack(e,t=false){return ofhBrainRuntime.planAttackAllocation(this,"land",e,t)}'+
    reserveFacts+'return {capacity:a,ratio:r}}_landAttackReady(e,t,l){'+source.slice(landReady,landEnd));
  replaceMethodRange('calculateBotAttackTroops(e,t){','donateTroops(){',
    'calculateBotAttackTroops(e,t){return ofhBrainRuntime.planAttackAllocation(this,"bot",e,t)}');
  replaceOne('forceSendAttack(e){const t=discoverCtors(getEventBus());const a=this.player.troops()/2;',
    'forceSendAttack(e){ofhBrainRuntime.planAttackAllocation(this,"forced",e)}_forcedAttackReady(e,a){const t=discoverCtors(getEventBus());');
  const routeStart=source.indexOf('async sendAttack(e,t=false,a=false){');
  const routeChoice=source.indexOf('if(e.isPlayer()){',routeStart);
  const routeEnd=source.indexOf('hasLandBorderWithTerraNullius(){',routeChoice);
  if(routeStart<0||routeChoice<=routeStart||routeEnd<=routeChoice)throw new Error('Attack route anchors changed');
  replaceOne(source.slice(routeChoice,routeEnd),'return await ofhBrainRuntime.planAttackRoute(this,e,a)}');
  const boatStart=source.indexOf('async sendBoatAttack(e){');
  const boatChoice=source.indexOf('await this.game.ensureBorderTiles(e);',boatStart);
  const boatReady=source.indexOf('if(e.isPlayer()&&this.player.type()===PlayerType.Nation){',boatChoice);
  const boatEnd=source.indexOf('calculateBotAttackTroops(e,t){',boatReady);
  if(boatStart<0||boatChoice<=boatStart||boatReady<=boatChoice||boatEnd<=boatReady)throw new Error('Targeted boat anchors changed');
  replaceOne(source.slice(boatChoice,boatEnd),'return await ofhBrainRuntime.planTargetedBoat(this,e)}'+
    '_targetedBoatReady(e,t,i){'+source.slice(boatReady,boatEnd));
  const freeStart=source.indexOf('async sendBoatAttackToNearbyTerraNullius(){');
  const freeChoice=source.indexOf('for(const i of a){const s=await withTimeout(',freeStart);
  const freeReady=source.indexOf('const o=discoverCtors(getEventBus());',freeChoice);
  const freeEnd=source.indexOf('shouldAttack(e){',freeReady);
  if(freeStart<0||freeChoice<=freeStart||freeReady<=freeChoice||freeEnd<=freeReady)throw new Error('Free boat anchors changed');
  const freeTail=source.slice(freeReady,freeEnd);
  if(!freeTail.endsWith('return l}return false}'))throw new Error('Free boat tail changed');
  replaceOne(source.slice(freeChoice,freeEnd),'return await ofhBrainRuntime.planFreeBoat(this,a)}_freeBoatReady(i,r){'+
    freeTail.replace(/return l}return false}$/,'return l}'));
  const embargoStart=source.indexOf('handleEmbargoesToHostileNations(){');
  const embargoLoop=source.indexOf('t.forEach(r=>{',embargoStart);
  const embargoEnd=source.indexOf('embargoIsWorthIt(e){',embargoLoop);
  if(embargoStart<0||embargoLoop<=embargoStart||embargoEnd<=embargoLoop)throw new Error('Embargo loop anchors changed');
  const embargoBody=source.slice(embargoLoop+'t.forEach(r=>{'.length,embargoEnd);
  if(!embargoBody.endsWith('})}'))throw new Error('Embargo loop tail changed');
  replaceOne(source.slice(embargoLoop,embargoEnd),'return ofhBrainRuntime.planEmbargos(this,t,{mode:"outgoing",hard:i,team:s})}'+
    '_embargoAction(r,i,s){const e=this.player;'+embargoBody.slice(0,-3)
      .replaceAll('this.addEmbargo(r,false)','return "start"').replaceAll('this.stopEmbargo(r)','return "stop"')+'}');
  const relationStart=source.indexOf('updateRelationsFromEmbargos(){');
  const relationLoop=source.indexOf('t.forEach(i=>{',relationStart);
  const relationEnd=source.indexOf('handleEmbargoesToHostileNations(){',relationLoop);
  if(relationStart<0||relationLoop<=relationStart||relationEnd<=relationLoop)throw new Error('Embargo relation anchors changed');
  const relationBody=source.slice(relationLoop+'t.forEach(i=>{'.length,relationEnd);
  if(!relationBody.endsWith('})}'))throw new Error('Embargo relation tail changed');
  const penalty='e.updateRelation(i,a);this.embargoMalusApplied.add(i.smallID())';
  const restoration='e.updateRelation(i,-a);this.embargoMalusApplied.delete(i.smallID())';
  if(!relationBody.includes(penalty)||!relationBody.includes(restoration))throw new Error('Embargo relation effects changed');
  replaceOne(source.slice(relationLoop,relationEnd),'return ofhBrainRuntime.planEmbargos(this,t,{mode:"relations"})}'+
    '_embargoRelationAction(i){const e=this.player;'+relationBody.slice(0,-3)
      .replace(penalty,'return "penalty"').replace(restoration,'return "restore"')+'}'+
    '_embargoRelationReady(i,response){const e=this.player;const a=-20;if(response==="penalty"){'+penalty+'}else{'+restoration+'}}');
  const spawnTick=source.indexOf('if(this.mg.inSpawnPhase()){',source.indexOf('class NationBot{'));
  const spawnTickEnd=source.indexOf('if(!t.isAlive()){',spawnTick);
  if(spawnTick<0||spawnTickEnd<=spawnTick)throw new Error('Spawn tick anchors changed');
  replaceOne(source.slice(spawnTick,spawnTickEnd),'if(this.mg.inSpawnPhase()){ofhBrainRuntime.planSpawn(this,"tick",e);this.status=tr("Spawn phase…");return}');
  replaceOne('doSpawn(){const e=this.pickSpawnCenter();',
    'doSpawn(){return ofhBrainRuntime.planSpawn(this,"dispatch")}_spawnReady(e){');
  const spawnPick=source.indexOf('pickSpawnCenter(){');
  const spawnFacts=source.indexOf('const e=this.mg;',spawnPick);
  const spawnNeighborhood=source.indexOf('const c=(h,p)=>{',spawnFacts);
  const spawnHeatmap=source.indexOf('if(l){let h=null;',spawnNeighborhood);
  const spawnHeatmapLoop=source.indexOf('if(h&&h.length>0){',spawnHeatmap);
  const spawnScore=source.indexOf('scoreSpawnTile(e,t,a,i,s){',spawnHeatmapLoop);
  if(spawnPick<0||spawnFacts<=spawnPick||spawnNeighborhood<=spawnFacts||spawnHeatmap<=spawnNeighborhood||spawnHeatmapLoop<=spawnHeatmap||spawnScore<=spawnHeatmapLoop)throw new Error('Spawn site anchors changed');
  const companion=source.slice(spawnPick+'pickSpawnCenter(){'.length,spawnFacts);
  const facts=source.slice(spawnFacts,spawnNeighborhood);
  const heatmap=source.slice(spawnHeatmap+'if(l){'.length,spawnHeatmapLoop);
  replaceOne(source.slice(spawnPick,spawnScore),'pickSpawnCenter(){return ofhBrainRuntime.planSpawn(this,"pick")}' +
    '_spawnCompanion(){'+companion+'return null}_spawnFacts(){'+facts+
    'return {game:e,width:t,height:a,team:s,players:r,smart:l,valid:u,tooClose:o}}'+
    '_spawnHeatmap(){const e=this.mg;'+heatmap+'return h}');
  replaceOne('T=new Proxy(S,{get(P,q){if(q==="maxTroops")return W=>S.maxTroops(l(W));const L=P[q];return typeof L==="function"?L.bind(P):L}})',
    'T=createGameConfigAdapter(S,l)');
  replaceOne('donateNeedThreshold:.8,','donateNeedThreshold:.65,');
  replaceOne('<input type="range" min="0" max="100" step="5" value="${Math.round((state.settings.donateNeedThreshold||.8)*100)}" data-cfg-range="donateNeedThreshold"',
    '<input type="range" min="0" max="65" step="5" value="${Math.round(Math.min(state.settings.donateNeedThreshold??.65,.65)*100)}" data-cfg-range="donateNeedThreshold"');
  replaceOne('${Math.round((state.settings.donateNeedThreshold||.8)*100)}%',
    '${Math.round(Math.min(state.settings.donateNeedThreshold??.65,.65)*100)}%');
  const modules = ['sam-placement.js', 'team-geography.js', 'two-team-opening.js', 'port-water-access.js', 'game-config-compat.js', 'engine.js', 'command-guard.js', 'spending-ledger.js', 'defense-economy.js', 'reactive-sam.js', 'sam-defense-observer.js', 'sam-development.js', 'support-posture.js', 'wilderness-crossing.js', 'match-summary.js', 'match-archive.js', 'legacy-strategy.js', 'adaptive-strategy.js', 'turn-planner.js', 'social-planner.js', 'alliance-event-planner.js', 'warship-maintenance-planner.js', 'warship-transport-planner.js', 'warship-threat-planner.js', 'structure-planner.js', 'building-planner.js', 'structure-placement-planner.js', 'bot-target-planner.js', 'attack-geography-planner.js', 'attack-planner.js', 'attack-allocation-planner.js', 'opening-expansion.js', 'attack-routing-planner.js', 'attack-sequence-planner.js', 'diplomacy-planner.js', 'diplomacy-details-planner.js', 'embargo-planner.js', 'spawn-planner.js', 'naval-landing-planner.js', 'naval-action-planner.js', 'boat-planner.js', 'warship-details-planner.js', 'warship-patrol-planner.js', 'warship-trade-hotspots.js', 'warship-combat-planner.js', 'warship-safety-planner.js', 'warship-deployment-planner.js', 'strike-planner.js', 'strike-target-planner.js', 'strike-ranking.js', 'runtime.js', 'bootstrap.js'].map(name =>
    fs.readFileSync(path.join(root, 'src/brain', name), 'utf8').replace(/^if \(typeof module !== 'undefined'.*$/m, '')).join('\n');
  source = simplifyConfigPanel(source);
  replaceOne('async maybeSpawnStructure(e){if(!autoBotBuildAllowed(e))return false;const t=this.getPerceivedCost(e);let a=this.player.gold();const i=mirvReserveHold(a);',
    'async maybeSpawnStructure(e){if(!autoBotBuildAllowed(e))return false;const t=this.getPerceivedCost(e);let a=this.player.gold();const i=ofhBrainRuntime.defenseEconomyFacts(this)?0n:mirvReserveHold(a);');
  replaceOne('class NationBot{', `\n// BEGIN CENTRAL BRAIN\n${modules}\n// END CENTRAL BRAIN\nclass NationBot{`);
  replaceOne('<div class="ab-pane" data-pane="log">', `<div class="ab-pane" data-pane="log">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="flex:1;font-size:10px">Match history · local autosave / recent detail</span>
            <button type="button" class="ab-trace-export" data-role="brain-summary" title="Download compact full-match actions and aggregated holds; resumes saved history after refresh">Match summary</button>
            <button type="button" class="ab-trace-export" data-role="brain-export" title="Download bounded recent candidates, calculations and debug detail">Detailed trace</button>
          </div>`);
  replaceOne('function wirePanel(n){', 'function wirePanel(n){n.querySelector(\'[data-role="brain-summary"]\')?.addEventListener("click",ofhExportMatchSummary);n.querySelector(\'[data-role="brain-export"]\')?.addEventListener("click",ofhExportBrainTrace);');
  const filterBinding = 'n.querySelectorAll(".ab-chip").forEach(f=>{f.addEventListener("click",()=>{state.logFilter=f.dataset.filter;n.querySelectorAll(".ab-chip").forEach(h=>h.classList.toggle("on",h.dataset.filter===state.logFilter));renderLog()})})';
  replaceOne(filterBinding, filterBinding.replaceAll('.ab-chip', '.ab-chip[data-filter]'));
  replaceOne('#${PANEL_ID} .ab-chip {', '#${PANEL_ID} .ab-chip,\n      #${PANEL_ID} .ab-trace-export {');
  replaceOne('#${PANEL_ID} .ab-chip:hover { background: rgba(255,255,255,0.09); }',
    '#${PANEL_ID} .ab-chip:hover,\n      #${PANEL_ID} .ab-trace-export:hover { background: rgba(255,255,255,0.09); }\n' +
    '      #${PANEL_ID} .ab-trace-export { appearance: none; font-family: inherit; }\n' +
    '      #${PANEL_ID} .ab-trace-export:focus-visible { outline: 2px solid var(--oh-accent, #60a5fa); outline-offset: 2px; }\n' +
    '      #${PANEL_ID} .ab-trace-export:active { background: var(--oh-accent-soft, rgba(96,165,250,0.18)); }');
  replaceOne('openingVetoesTile(e){','openingVetoesTile(e){const ofhVeto=ofhBrainRuntime.twoTeamOpeningTileVeto(this,e);if(ofhVeto!==undefined)return ofhVeto;');
  replaceOne('openingVetoes(e,t){','openingVetoes(e,t){const ofhVeto=ofhBrainRuntime.twoTeamOpeningVeto(this,e);if(ofhVeto!==undefined)return ofhVeto;');
  const originalHeader=source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if(!originalHeader)throw new Error('Userscript header missing');
  const version='1.84.76';
  const header=fs.readFileSync(path.join(root,'src/userscript-header.txt'),'utf8').replace(/\r\n/g,'\n').trimEnd().replace('__VERSION__',version);
  source=source.replace(originalHeader[0],header);
  replaceOne('window.__OFH_ASSETS = {"version":"1.84.0"',`window.__OFH_ASSETS = {"version":"${version}"`);
  source=source.replace(/\r\n/g,'\n');
  return { source, metadata:header+'\n', counts };
}
module.exports = { buildSource };
if (require.main === module) {
  const { source, metadata, counts } = buildSource();
  const destination = path.join(root, 'openfront-helper.user.js');
  const metadataDestination=path.join(root,'openfront-helper.meta.js');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(destination, 'utf8') !== source) throw new Error('Userscript differs from sources. Run node scripts/build.js');
    if (fs.readFileSync(metadataDestination,'utf8')!==metadata)throw new Error('Update metadata differs from userscript. Run node scripts/build.js');
    console.log('Standalone userscript and update metadata match source modules.');
  } else {
    fs.writeFileSync(destination, source);
    fs.writeFileSync(metadataDestination,metadata);
    console.log(`Built decision engine: ${counts.intents} event gateways, ${counts.builds} build gateways, ${counts.callbacks} alliance callbacks.`);
  }
}
