'use strict';

function createBotTargetPlanner(deps) {
  const WINDOW_SIZE = 79; // The engine permits 80 candidates, including wait.
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Stop this bot attack wave' };
  const hostileBot = (actor, target) => target.isPlayer() &&
    actor.player.isFriendly(target) === false && target.type() === deps.botType;

  async function run(actor, hooks) {
    if (!hooks.allowed()) return false;
    const targets = actor.player.nearby().filter(target => hostileBot(actor, target));
    if (targets.length === 0) {
      hooks.choose([wait], { remainingTargets: 0, visibleTargets: 0, hiddenTargets: 0, attemptLimit: 0, attempts: 0 });
      return false; // Preserve the original early return before resetting counters.
    }
    actor.botAttackTroopsSent = 0;
    let remaining = targets.map((target, index) => {
      const troops = target.troops(), tiles = target.numTilesOwned();
      return { target, candidate: { id: `bot-target:${index}`, kind: 'bot-target', source: 'BotTargetPlanner',
        targetId: target.id(), troops, tiles, troopDensity: troops / tiles,
        hasStructures: target.units().some(unit => deps.attackStructures.has(unit.type())), eligible: true } };
    }).sort((a, b) => Number(b.candidate.hasStructures) - Number(a.candidate.hasStructures) ||
      a.candidate.troopDensity - b.candidate.troopDensity);
    remaining.forEach((entry, priority) => Object.assign(entry.candidate, { priority,
      reason: entry.candidate.hasStructures ? 'Original priority: bot with structures, then lower troop density' :
        'Original priority: lower troop density after bots with structures' }));
    const attemptLimit = actor.getBotAttackMaxParallelism(); // Preserve one difficulty/random sample per wave.
    let attempts = 0;
    while (remaining.length && attempts < attemptLimit) {
      if (!hooks.allowed()) break;
      const visible = remaining.slice(0, WINDOW_SIZE);
      const choice = hooks.choose([...visible.map(entry => entry.candidate), wait], {
        remainingTargets: remaining.length, visibleTargets: visible.length,
        hiddenTargets: remaining.length - visible.length, attemptLimit, attempts,
        ranking: 'Initial wave order: structures first, then troop density; not reranked during the wave'
      });
      const selected = visible.find(entry => entry.candidate.id === choice.selectedId);
      if (!selected) break; // Explicit wait or a failed/invalid strategy decision.
      if (!hooks.allowed()) break;
      remaining = remaining.filter(entry => entry !== selected);
      attempts++;
      const details = { domain: 'bot-target', decisionId: choice.decisionId,
        planId: selected.candidate.id, targetId: selected.candidate.targetId };
      try {
        if (!hostileBot(actor, selected.target) || selected.target.isAlive?.() === false) {
          hooks.record('plan-result', { ...details, status: 'skipped', reason: 'Target is no longer a live hostile bot' });
          continue;
        }
        const result = await hooks.execute(selected.candidate, choice.decisionId, () => actor.sendAttack(selected.target));
        hooks.record('plan-result', { ...details, status: 'attempted', executorResult: result,
          reason: 'Original sendAttack completed; consult linked command and rule records for the outcome' });
      } catch (error) {
        hooks.record('plan-result', { ...details, status: 'threw' });
        throw error;
      }
    }
    hooks.record('plan-wave-result', { domain: 'bot-target', attempts, attemptLimit,
      remainingTargets: remaining.length, legacyTroopCounter: actor.botAttackTroopsSent,
      counterMeaning: 'Original allocation bookkeeping; may include failed submissions, not confirmed troops sent',
      reason: !hooks.allowed() ? 'Bot stopped or ownership changed' :
        attempts >= attemptLimit ? 'Original difficulty attempt limit reached' :
          remaining.length === 0 ? 'Target pool exhausted' : 'Strategy stopped the wave' });
    return actor.botAttackTroopsSent > 0;
  }
  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createBotTargetPlanner;
