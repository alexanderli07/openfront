'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const location = path.join(__dirname, '../scripts/build.js');
const build = fs.existsSync(location) ? require(location) : null;
test('active builder targets the central decision engine', () => assert.equal(typeof build?.buildSource, 'function'));
test('tactical boat search and sampled destinations route through central adapters',()=>{
  const {source}=build.buildSource();
  assert.ok(source.includes('function createBoatPlanner'));
  assert.ok(source.includes('return ofhBrainRuntime.planTacticalBoat(this,t,e)'));
  assert.ok(source.includes('return ofhBrainRuntime.planBoatSites(this,o,{mode:"random",origin:e})'));
});
test('outer attack shortcuts route through the sequence planner',()=>{
  const {source}=build.buildSource();
  assert.ok(source.includes('function createAttackSequencePlanner'));
  assert.ok(source.includes('return ofhBrainRuntime.planAttackSequence(this,{all:i,friends:s,enemies:r,openLand:l,expand:c,boat:d,alliance:f})'));
});
test('building phase, investment action, upgrade and defense site route through central adapters', () => {
  const {source} = build.buildSource();
  assert.ok(source.includes('function createBuildingPlanner'));
  assert.ok(source.includes('async handleStructures(){return ofhBrainRuntime.planBuilding(this,"handle")}'));
  assert.ok(source.includes('return ofhBrainRuntime.planBuilding(this,"action",e,s)'));
  assert.ok(source.includes('async findBestStructureToUpgrade(e){return ofhBrainRuntime.planBuilding(this,"upgrade",e)}'));
  assert.ok(source.includes('await ofhBrainRuntime.planBuilding(this,"defense",v,{threatRatio:o'));
});

test('standalone build registers the adaptive gameplay strategy', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('function createAdaptiveStrategy'));
  assert.ok(source.includes('strategies: [createAdaptiveStrategy(createLegacyStrategy())]'));
  assert.ok(source.includes('// @version      1.84.74'));
  assert.ok(source.includes('transportType: UNIT.TransportShip'));
  assert.ok(source.includes('isTransportIntent: ctor => ctor === _ctors.boat'));
});

test('ordinary structure tile selection routes through the central placement planner', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('function createStructurePlacementPlanner'));
  assert.ok(source.includes('structurePlacementPlanner: createStructurePlacementPlanner('));
  assert.ok(source.includes('async structureSpawnTile(e){return ofhBrainRuntime.planStructurePlacement(this,e)}'));
});

test('structure choice routes through the batch planner in the standalone build', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('return ofhBrainRuntime.planStructures(this,{cityLevels:a,cityDisabled:t,sharedWater:i})'));
  assert.ok(source.includes('function createStructurePlanner'));
  assert.ok(source.includes('// @version      1.84.74'));
});

test('bot attack target selection routes through the planner', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('async attackBots(){return ofhBrainRuntime.planBotTargets(this)}'));
  assert.ok(source.includes('function createBotTargetPlanner'));
});

test('attack purpose and target methods route through the central planner', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('async attackBestTarget(e,t){return ofhBrainRuntime.planAttacks(this,e,t)}'));
  assert.ok(source.includes('findIncomingAttackPlayer(){return ofhBrainRuntime.selectAttackTarget(this,"incoming")}'));
  for (const mode of ['traitor', 'victim', 'weak']) assert.ok(source.includes(`selectAttackTarget(this,"${mode}",e)`));
  assert.ok(source.includes('function createAttackPlanner'));
});

test('distant and disconnected landing probes use central selection', () => {
  const { source } = build.buildSource();
  for (const mode of ['distant', 'disconnected']) {
    assert.ok(source.includes(`return ofhBrainRuntime.planNavalLanding(this,a,{mode:"${mode}",probeCap:i})`));
  }
  assert.ok(source.includes('function createNavalLandingPlanner'));
});

test('opportunistic naval actions use central selection after original early gates', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('if(r)return false;if(o)return false;if(d.length===0)return false;return ofhBrainRuntime.planNavalActions(this,{now:a,fill:u,surplusFill:c,shore:d})'));
  assert.ok(source.includes('function createNavalActionPlanner'));
});

test('deployment and infestation use central selection and preserve early gates', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('if(!this.random.chance(50)){return false}return ofhBrainRuntime.planWarshipDeployment(this)'));
  assert.ok(source.includes('if(!this.isRichPlayer(e)){return}await ofhBrainRuntime.planWarshipInfestation(this,e)'));
  for (const teamGame of ['true', 'false']) assert.ok(source.includes(`selectWarshipInfestation(this,${teamGame})`));
  assert.ok(source.includes('function createWarshipDeploymentPlanner'));
});

test('strike planners route main choices and forward explicit command parents', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('return ofhBrainRuntime.planMirv(this,e)'));
  assert.ok(source.includes('selectNukeWeapon(this,{available:r,hydroCost:i,atomCost:s,parentDecisionId:ofhTargetSelection.decisionId},ofhWeaponSelection)'));
  assert.ok(source.includes('planNuke(this,b,{target:a,weapon:o,difficulty:d,parentDecisionId:ofhWeaponSelection.decisionId??ofhTargetSelection.decisionId})'));
  for (const name of ['MirvBehavior', 'NukeBehavior']) assert.ok(source.includes(`strikeBuild(this,ofhDecisionId,"${name}",`));
  assert.ok(source.includes('maybeUpgradeHelpfulSilo(upgrade,decision.decisionId)'));
  assert.ok(source.includes('selectNukeTarget(this,ofhSelection)'));
  assert.ok(source.includes('planSamClear(this,e,r,{cost:a,silos:s,parentDecisionId:ofhDecisionId})'));
  assert.ok(source.includes('planHelpfulSilo(this,{...e,parentDecisionId:ofhDecisionId})'));
});

test('all seven strike player selectors route through ranking adapter', () => {
  const { source } = build.buildSource();
  for (const mode of ['counter','denial','steamroll','win-fix','density','crown','team']) {
    assert.ok(source.includes(`selectStrikePlayer(this,"${mode}")`));
  }
  assert.ok(source.includes('function createStrikeRanking'));
});
test('alliance rule decisions route through the diplomacy planner with explicit caller contexts', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('getAllianceDecision(e,t,a){return ofhBrainRuntime.decideAlliance(this,e,t,a)}'));
  assert.ok(source.includes("actor.getAllianceDecision(player,true,'incoming')"));
  assert.ok(source.includes("actor.getAllianceDecision(player,true,'renewal')"));
  assert.ok(source.includes('getAllianceDecision(t,false,"outgoing")'));
  assert.ok(source.includes('hooks.allianceStopped()'));
  assert.ok(source.includes('function createDiplomacyPlanner'));
});
test('combat assistance and betrayal route through diplomacy planners', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('async assistAllies(){if(this.emojiBehavior===void 0)throw new Error("not initialized");return ofhBrainRuntime.planAssist(this)}'));
  assert.ok(source.includes('async maybeBetrayAndAttack(e,t){if(this.allianceBehavior===void 0)throw new Error("not initialized");return ofhBrainRuntime.planBetray(this,e,t)}'));
  assert.ok(source.includes("version: '1.84.0-plans.38'"));
});
test('NationBot play cadences route through the turn coordinator', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('function createTurnPlanner'));
  assert.ok(source.includes('turnPlanner: createTurnPlanner({ warshipAutoSpawn: () => state.settings.warshipAutoSpawn !== false })'));
  assert.ok(source.includes('planTurn(this,{path:"build-only",tick:e,attackRate:i})'));
  assert.ok(source.includes('planTurn(this,{path:"full",tick:e,attackRate:i})'));
  assert.ok(source.includes("case 'alliance-requests': return { name: 'alliance', enabled: bot.feat('alliance') }"));
  assert.ok(source.includes("case 'attack': return { name: 'expand-or-boat', enabled: bot.feat('expand') || bot.feat('boat') }"));
  assert.ok(source.includes("version: '1.84.0-plans.38'"));
});
test('pocket and island searches route through attack geography', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('function createAttackGeographyPlanner'));
  assert.ok(source.includes('attackGeographyPlanner: createAttackGeographyPlanner('));
  assert.ok(source.includes('async findSealablePocket(){return ofhBrainRuntime.selectAttackGeography(this,"pocket")}'));
  assert.ok(source.includes('async findNearestIslandEnemy(){return ofhBrainRuntime.selectAttackGeography(this,"island")}'));
  assert.ok(source.includes("version: '1.84.0-plans.38'"));
  assert.match(source, /@version\s+1\.84\.74/);
});
test('standalone build contains all bot command gateways and no economy experiment', () => {
  const { source, counts } = build.buildSource();
  assert.deepEqual(counts, { intents: 17, builds: 9, callbacks: 3 });
  assert.equal(source.includes('createEconomyPlanner'), false);
  assert.equal(source.includes('economyPlanner'), false);
  assert.equal(source.includes('ofhBrainRuntime'), true);
  new vm.Script(source);
});
test('baseline mutation fails loudly instead of patching the wrong code', () => {
  assert.throws(() => build.buildSource(Buffer.from('changed input')), /baseline/i);
});
test('active script retains original match, permissions and disabled lobby predicate', () => {
  const { source } = build.buildSource();
  assert.ok(source.includes('// @match        https://openfront.io/*'));
  assert.ok(source.includes('// @grant        none'));
  assert.ok(source.includes('function isPublicLobby(n){return false}'));
  assert.ok(source.includes('if(isPublicLobby(n)){setStatus(tr("⛔ Blocked in a public lobby"))'));
  assert.ok(source.includes('data-role="brain-export"'));
});
