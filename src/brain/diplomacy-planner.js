'use strict';

function createDiplomacyPlanner(deps) {
  const WINDOW_SIZE = 79; // The engine permits 80 candidates, including wait.
  const rules = [
    'regular-bot', 'confused', 'traitor', 'far-nation', 'alliance-cap', 'threat',
    'team-reject', 'hostile-relation', 'friendly-relation', 'enough-alliances',
    'early-game', 'similar-strength'
  ];
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Do not decide this alliance request here' };
  const safe = (read, fallback = null) => { try { return read(); } catch { return fallback; } };
  const pass = reason => ({ matched: false, reason });
  const finish = (accepted, reason) => ({ matched: true, accepted: !!accepted, reason });

  function evaluate(actor, target, incoming, rule) {
    switch (rule) {
      case 'regular-bot':
        return actor.isRegularBot(target) ? finish(false, 'Regular Bot requests are rejected') : pass('Target is not a regular Bot');
      case 'confused':
        return actor.isConfused() ? finish(actor.random.chance(2), 'Confused behavior made the decision') : pass('Confused behavior did not trigger');
      case 'traitor':
        if (!target.isTraitor() || actor.random.nextInt(0, 100) < 10) return pass('Traitor rejection did not trigger');
        if (incoming && actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.confused);
        return finish(false, 'Traitor rejected after the original mercy roll');
      case 'far-nation':
        if (!deps.settings().winFixes || !actor.isFarNation(target)) return pass('Far-nation win-fix does not apply');
        return finish(!actor.isDominantForDiplomacy(), 'Far nation accepted unless already dominant');
      case 'alliance-cap':
        return actor.hasTooManyAlliances(target) ? finish(false, 'Target already has too many alliances') : pass('Alliance cap not reached');
      case 'threat':
        if (!actor.isAlliancePartnerThreat(target)) return pass('Target is not an alliance threat');
        if (!incoming && actor.random.chance(6)) actor.emojiBehavior.sendEmoji(target, deps.emojis.scared);
        if (incoming && actor.random.chance(6)) actor.emojiBehavior.sendEmoji(target, deps.emojis.love);
        return finish(true, 'Threatening alliance partner accepted');
      case 'team-reject':
        return actor.shouldRejectInTeamGame() ? finish(false, 'Team-game rejection triggered') : pass('Team-game rejection did not trigger');
      case 'hostile-relation':
        if (actor.player.relation(target) >= deps.neutralRelation) return pass('Relation is neutral or better');
        if (incoming && actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.confused);
        return finish(false, 'Negative relation rejected');
      case 'friendly-relation':
        if (!actor.isAlliancePartnerFriendly(target)) return pass('Friendly-partner rule did not match');
        if (actor.random.chance(3)) actor.emojiBehavior.sendEmoji(target, deps.emojis.handshake);
        return finish(true, 'Friendly alliance partner accepted');
      case 'enough-alliances':
        return actor.checkAlreadyEnoughAlliances(target) ? finish(false, 'Existing alliances are sufficient') : pass('More alliances are allowed');
      case 'early-game':
        return actor.isEarlygame() ? finish(true, 'Early-game alliance accepted') : pass('Early-game rule did not match');
      case 'similar-strength':
        return finish(actor.isAlliancePartnerSimilarlyStrong(target), 'Final similarly-strong comparison');
      default:
        throw new Error('Unknown alliance rule: ' + rule);
    }
  }

  function decide(actor, target, incoming, hooks) {
    if (!hooks.allowed()) return { accepted: false, stopped: true, decisionId: null };
    let remaining = rules.map((rule, priority) => ({
      id: `alliance:${rule}`, kind: 'alliance-rule', rule, priority, eligible: true, readiness: 'unchecked',
      reason: `Original alliance rule ${priority + 1}: ${rule}; evaluate only if selected`
    }));
    while (remaining.length) {
      if (!hooks.allowed()) return { accepted: false, stopped: true, decisionId: null };
      const choice = hooks.choose('alliance-rule', [...remaining, wait], {
        targetId: safe(() => typeof target?.id === 'function' ? target.id() : target.smallID()), incoming: !!incoming
      });
      const selected = remaining.find(candidate => candidate.id === choice?.selectedId);
      if (!selected) return { accepted: false, stopped: true, decisionId: choice?.decisionId ?? null };
      const result = hooks.execute(choice.decisionId, () => evaluate(actor, target, incoming, selected.rule));
      hooks.record('diplomacy-rule-result', {
        decisionId: choice.decisionId, rule: selected.rule,
        status: result.matched ? result.accepted ? 'accepted' : 'rejected' : 'unmatched', reason: result.reason
      });
      if (!hooks.allowed()) return { accepted: false, stopped: true, decisionId: choice.decisionId };
      if (result.matched) return { accepted: result.accepted, stopped: false, decisionId: choice.decisionId };
      remaining = remaining.filter(candidate => candidate !== selected);
    }
    return { accepted: false, stopped: true, decisionId: null };
  }

  const combatResult = (completed, stopped, decisionId) => ({ completed: !!completed, stopped: !!stopped, decisionId: decisionId ?? null });
  const candidateId = (prefix, index) => `${prefix}:${index}`;

  async function assist(actor, hooks) {
    if (!hooks.allowed()) return combatResult(false, true, null);
    if (actor.game.config().disableAlliances()) return combatResult(false, false, null);
    const allies = actor.player.allies();
    let remainingAllies = allies.map((ally, index) => ({ ally, candidate: {
      id: candidateId('assist-ally', index), kind: 'assist-ally', priority: index, eligible: true,
      reason: 'Inspect this ally at its original position'
    } }));
    let lastDecisionId = null;
    while (remainingAllies.length) {
      if (!hooks.allowed()) return combatResult(false, true, lastDecisionId);
      const visible = remainingAllies.slice(0, WINDOW_SIZE);
      const choice = hooks.choose('assist-ally', [...visible.map(entry => entry.candidate), wait], {
        remainingAllies: remainingAllies.length, visibleAllies: visible.length,
        hiddenAllies: remainingAllies.length - visible.length
      });
      lastDecisionId = choice?.decisionId ?? lastDecisionId;
      const selected = visible.find(entry => entry.candidate.id === choice?.selectedId);
      if (!selected) return combatResult(false, true, lastDecisionId);
      remainingAllies = remainingAllies.filter(entry => entry !== selected);
      if (!hooks.allowed()) return combatResult(false, true, lastDecisionId);
      const allyResult = await hooks.execute(choice.decisionId, async () => {
        const firstTargets = selected.ally.targets();
        const allyFacts = { targetCount: firstTargets.length };
        const allyOutcome = (result, outcome) => ({ ...result, outcome, facts: allyFacts });
        if (firstTargets.length === 0) return allyOutcome(combatResult(false, false, choice.decisionId), 'no-targets');
        allyFacts.relation = actor.player.relation(selected.ally);
        allyFacts.friendlyThreshold = deps.friendlyRelation;
        if (allyFacts.relation < deps.friendlyRelation) {
          actor.emojiBehavior.sendEmoji(selected.ally, deps.emojis.assistLow);
          return allyOutcome(combatResult(false, false, choice.decisionId), 'relation-too-low');
        }
        let remainingTargets = selected.ally.targets().map((target, index) => ({ target, candidate: {
          id: candidateId(`${selected.candidate.id}:target`, index), kind: 'assist-target', priority: index, eligible: true,
          reason: 'Try this requested target at its original position'
        } }));
        let targetDecisionId = choice.decisionId;
        while (remainingTargets.length) {
          if (!hooks.allowed()) return allyOutcome(combatResult(false, true, targetDecisionId), 'stopped');
          const targetVisible = remainingTargets.slice(0, WINDOW_SIZE);
          const targetChoice = hooks.choose('assist-target', [...targetVisible.map(entry => entry.candidate), wait], {
            allyIndex: selected.candidate.priority, remainingTargets: remainingTargets.length,
            visibleTargets: targetVisible.length, hiddenTargets: remainingTargets.length - targetVisible.length
          });
          targetDecisionId = targetChoice?.decisionId ?? targetDecisionId;
          const targetEntry = targetVisible.find(entry => entry.candidate.id === targetChoice?.selectedId);
          if (!targetEntry) return allyOutcome(combatResult(false, true, targetDecisionId), 'policy-wait');
          remainingTargets = remainingTargets.filter(entry => entry !== targetEntry);
          if (!hooks.allowed()) return allyOutcome(combatResult(false, true, targetDecisionId), 'stopped');
          const targetResult = await hooks.execute(targetChoice.decisionId, async () => {
            const target = targetEntry.target;
            if (target.isPlayer() && target.smallID() === actor.player.smallID()) {
              actor.emojiBehavior.sendEmoji(selected.ally, deps.emojis.assistMe);
              return { completed: false, outcome: 'target-is-self' };
            }
            if (actor.player.isFriendly(target)) {
              actor.emojiBehavior.sendEmoji(selected.ally, deps.emojis.assistAlly);
              return { completed: false, outcome: 'target-is-friendly' };
            }
            if (!await actor.sendAttack(target)) return { completed: false, outcome: 'attack-failed' };
            if (!hooks.allowed()) return { completed: false, outcome: 'stale-after-attack' };
            actor.player.updateRelation(selected.ally, -20);
            actor.emojiBehavior.sendEmoji(selected.ally, deps.emojis.assistAccept);
            return { completed: true, outcome: 'attack-accepted', relationDelta: -20 };
          });
          hooks.record('diplomacy-combat-result', { domain: 'assist-target', decisionId: targetChoice.decisionId,
            status: targetResult.completed ? 'completed' : targetResult.outcome === 'stale-after-attack' ? 'stopped' : 'unfulfilled',
            outcome: targetResult.outcome, ...(targetResult.relationDelta ? { relationDelta: targetResult.relationDelta } : {}),
            allyIndex: selected.candidate.priority, targetIndex: targetEntry.candidate.priority });
          if (!hooks.allowed()) return allyOutcome(combatResult(false, true, targetDecisionId), 'stopped');
          if (targetResult.completed) return allyOutcome(combatResult(true, false, targetDecisionId), 'assistance-completed');
        }
        return allyOutcome(combatResult(false, false, targetDecisionId), 'targets-exhausted');
      });
      hooks.record('diplomacy-combat-result', { domain: 'assist-ally', decisionId: choice.decisionId,
        status: allyResult.stopped ? 'wait' : allyResult.completed ? 'completed' : 'unfulfilled',
        outcome: allyResult.outcome, facts: allyResult.facts, allyIndex: selected.candidate.priority });
      lastDecisionId = allyResult.decisionId ?? lastDecisionId;
      if (allyResult.stopped || allyResult.completed) return allyResult;
    }
    return combatResult(false, false, lastDecisionId);
  }

  function shouldBetray(actor, target, totalOpponents) {
    const facts = { totalOpponents, troopReads: [], selfTroopReads: [] };
    const targetTroops = () => { const value = target.troops(); facts.troopReads.push(value); return value; };
    const selfTroops = () => { const value = actor.player.troops(); facts.selfTroopReads.push(value); return value; };
    const finishBetrayal = (matched, condition) => ({ matched, condition, facts });
    const settings = deps.settings();
    facts.featureEnabled = !(settings.features && settings.features.betray === false);
    if (!facts.featureEnabled) return finishBetrayal(false, 'feature-disabled');
    facts.allied = actor.player.isAlliedWith(target);
    if (!facts.allied) return finishBetrayal(false, 'not-allied');
    const difficulty = deps.difficulty();
    facts.difficulty = difficulty;
    const easy = difficulty === deps.difficulties.easy;
    const medium = difficulty === deps.difficulties.medium;
    if (!easy && !medium) {
      const capacity = actor.game.config().maxTroops(target);
      const outgoing = target.outgoingAttacks().reduce((sum, attack) => sum + attack.troops(), 0);
      Object.assign(facts, { capacity, outgoingTroops: outgoing, weakCapacityThreshold: capacity * .2 });
      if (targetTroops() + outgoing < capacity * .2 && targetTroops() < selfTroops()) return finishBetrayal(true, 'weak-capacity');
    }
    if (easy || medium) {
      const easyHuman = easy && (facts.targetType = target.type()) === deps.humanType;
      if (!easyHuman && selfTroops() >= targetTroops() * 10) {
        return finishBetrayal(true, 'ten-times-strength');
      }
    }
    if (!easy) {
      facts.traitor = target.isTraitor();
      if (facts.traitor && targetTroops() < selfTroops() * 1.2) return finishBetrayal(true, 'traitor');
    }
    if (!easy && totalOpponents === 1 && targetTroops() * 3 < selfTroops()) return finishBetrayal(true, 'sole-opponent');
    return finishBetrayal(false, 'no-condition-matched');
  }

  async function betray(actor, friends, enemies, hooks) {
    if (!hooks.allowed()) return combatResult(false, true, null);
    if (actor.game.config().disableAlliances()) return combatResult(false, false, null);
    let remaining = friends.map((target, index) => ({ target, candidate: {
      id: candidateId('betray-target', index), kind: 'betray-target', priority: index, eligible: true,
      reason: 'Evaluate this ally for betrayal at its original position'
    } }));
    let lastDecisionId = null;
    const totalOpponents = friends.length + enemies.length;
    while (remaining.length) {
      if (!hooks.allowed()) return combatResult(false, true, lastDecisionId);
      const visible = remaining.slice(0, WINDOW_SIZE);
      const choice = hooks.choose('betray-target', [...visible.map(entry => entry.candidate), wait], {
        remainingTargets: remaining.length, visibleTargets: visible.length,
        hiddenTargets: remaining.length - visible.length, totalOpponents
      });
      lastDecisionId = choice?.decisionId ?? lastDecisionId;
      const selected = visible.find(entry => entry.candidate.id === choice?.selectedId);
      if (!selected) return combatResult(false, true, lastDecisionId);
      remaining = remaining.filter(entry => entry !== selected);
      if (!hooks.allowed()) return combatResult(false, true, lastDecisionId);
      const evaluation = await hooks.execute(choice.decisionId,
        () => shouldBetray(actor, selected.target, totalOpponents));
      if (!hooks.allowed()) {
        hooks.record('diplomacy-combat-result', { domain: 'betray-target', decisionId: choice.decisionId,
          status: 'stopped', outcome: 'stale-after-evaluation', condition: evaluation.condition,
          facts: evaluation.facts, targetIndex: selected.candidate.priority });
        return combatResult(false, true, choice.decisionId);
      }
      if (!evaluation.matched) {
        hooks.record('diplomacy-combat-result', { domain: 'betray-target', decisionId: choice.decisionId,
          status: 'unfulfilled', condition: evaluation.condition, facts: evaluation.facts,
          targetIndex: selected.candidate.priority });
        continue;
      }
      const attacked = await hooks.execute(choice.decisionId, async () => {
        actor.allianceBehavior.betray(selected.target);
        return actor.sendAttack(selected.target, true);
      });
      if (!hooks.allowed()) {
        hooks.record('diplomacy-combat-result', { domain: 'betray-target', decisionId: choice.decisionId,
          status: 'stopped', outcome: 'stale-after-attack', condition: evaluation.condition,
          facts: evaluation.facts, targetIndex: selected.candidate.priority });
        return combatResult(false, true, choice.decisionId);
      }
      hooks.record('diplomacy-combat-result', { domain: 'betray-target', decisionId: choice.decisionId,
        status: attacked ? 'completed' : 'unfulfilled', condition: evaluation.condition, facts: evaluation.facts,
        targetIndex: selected.candidate.priority });
      return combatResult(attacked, false, choice.decisionId);
    }
    return combatResult(false, false, lastDecisionId);
  }

  return { decide, assist, betray };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createDiplomacyPlanner;
