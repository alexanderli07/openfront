'use strict';

function createTurnPlanner(deps = {}) {
  const fullOrder = ['casual-emoji', 'embargo-relations', 'bot-alliance-requests', 'alliance-requests',
    'mirv', 'structure', 'warship-deployment', 'embargo', 'attack', 'warship-infestation', 'nuke'];
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Stop the remaining phases in this turn pass' };
  const warshipAutoSpawn = deps.warshipAutoSpawn || (() => true);

  function phaseGate(bot, phase) {
    switch (phase) {
      case 'alliance-requests': return { name: 'alliance', enabled: bot.feat('alliance') };
      case 'mirv': return { name: 'nuke', enabled: bot.feat('nuke') };
      case 'structure': return { name: 'build', enabled: bot.feat('build') };
      case 'warship-deployment':
      case 'warship-infestation': return { name: 'warship', enabled: bot.feat('warship') && warshipAutoSpawn() };
      case 'embargo': return { name: 'embargo', enabled: bot.feat('embargo') };
      case 'attack': return { name: 'expand-or-boat', enabled: bot.feat('expand') || bot.feat('boat') };
      case 'nuke': return { name: 'nuke', enabled: bot.feat('nuke') };
      default: return { name: 'unconditional', enabled: true };
    }
  }

  async function executePhase(bot, phase) {
    switch (phase) {
      case 'structure-secondary': return bot.structureBehavior.handleStructures();
      case 'casual-emoji': return bot.emojiBehavior.maybeSendCasualEmoji();
      case 'embargo-relations': return bot.updateRelationsFromEmbargos();
      case 'bot-alliance-requests': return bot.allianceBehavior.handleAllianceRequestsFromBots();
      case 'alliance-requests':
        bot.allianceBehavior.handleAllianceRequests();
        return bot.allianceBehavior.handleAllianceExtensionRequests();
      case 'mirv': return bot.mirvBehavior.considerMIRV();
      case 'structure': return bot.structureBehavior.handleStructures();
      case 'warship-deployment': return bot.warshipBehavior.maybeSpawnWarship();
      case 'embargo': return bot.handleEmbargoesToHostileNations();
      case 'attack': return bot.attackBehavior.maybeAttack();
      case 'warship-infestation': return bot.warshipBehavior.counterWarshipInfestation();
      case 'nuke': return bot.nukeBehavior.maybeSendNuke();
      default: throw new Error('Unknown turn phase: ' + phase);
    }
  }

  function candidates(context) {
    const phases = context.path === 'build-only' ? ['structure-secondary'] :
      context.path === 'full' ? fullOrder : null;
    if (!phases) throw new Error('Unknown turn path: ' + context.path);
    return phases.map((phase, priority) => {
      return { id: `turn:${context.path}:${phase}`, kind: 'turn-plan', phase, priority, eligible: true,
        readiness: 'unchecked', reason: `Original ${context.path} phase ${priority + 1}: ${phase}` };
    });
  }

  const primitiveResult = result => result === null || ['string', 'number', 'boolean'].includes(typeof result) ? result :
    result === undefined ? 'undefined' : '[non-primitive result]';

  async function run(bot, context, hooks) {
    const completed = [];
    const stop = (decisionId, phase, reason) => {
      hooks.record('turn-plan-result', { decisionId: decisionId ?? null, phase: phase ?? null,
        status: 'stopped', reason });
      return { stopped: true, completed, decisionId: decisionId ?? null };
    };
    if (!hooks.allowed()) return stop(null, null, 'Bot stopped or ownership changed before turn selection');
    let remaining = candidates(context), lastDecisionId = null;
    while (remaining.length) {
      if (!hooks.allowed()) return stop(lastDecisionId, null, 'Bot stopped or ownership changed before turn selection');
      const eligible = remaining.filter(candidate => candidate.eligible);
      if (eligible.length === 0) break;
      const facts = { path: context.path, tick: context.tick ?? null, attackRate: context.attackRate ?? null,
        remainingPhases: remaining.length, visiblePhases: remaining.length, eligiblePhases: eligible.length };
      let choice;
      try {
        choice = hooks.choose('turn-plan', [...remaining, wait], facts);
      } catch (error) {
        return stop(lastDecisionId, null, `Policy selection threw: ${String(error?.message || error)}`);
      }
      lastDecisionId = choice?.decisionId ?? lastDecisionId;
      const selected = remaining.find(candidate => candidate.id === choice?.selectedId);
      if (!selected || !selected.eligible) return stop(lastDecisionId, null,
        choice?.selectedId === '$wait' ? 'Policy selected wait' : 'Policy selected an invalid turn phase');
      if (!hooks.allowed()) return stop(lastDecisionId, selected.phase,
        'Bot stopped or ownership changed after turn selection');
      remaining = remaining.filter(candidate => candidate !== selected);
      try {
        const gate = phaseGate(bot, selected.phase);
        if (!gate.enabled) {
          hooks.record('turn-plan-result', { decisionId: choice.decisionId, phase: selected.phase,
            status: 'skipped', gate: gate.name, enabled: false });
          continue;
        }
        const result = await hooks.execute(choice.decisionId, () => executePhase(bot, selected.phase));
        if (!hooks.allowed()) {
          hooks.record('turn-plan-result', { decisionId: choice.decisionId, phase: selected.phase,
            status: 'stopped', reason: 'Bot stopped or ownership changed during the selected phase' });
          return { stopped: true, completed, decisionId: choice.decisionId };
        }
        completed.push(selected.phase);
        hooks.record('turn-plan-result', { decisionId: choice.decisionId, phase: selected.phase,
          status: 'completed', executorResult: primitiveResult(result) });
      } catch (error) {
        hooks.record('turn-plan-result', { decisionId: choice.decisionId, phase: selected.phase, status: 'threw' });
        throw error;
      }
    }
    return { stopped: false, completed, decisionId: lastDecisionId };
  }

  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createTurnPlanner;
