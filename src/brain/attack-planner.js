'use strict';

function createAttackPlanner(deps) {
  const orders = {
    Easy: ['crater', 'bots', 'counter', 'assist', 'betray', 'hostile', 'weakest'],
    Medium: ['bots', 'crater', 'counter', 'assist', 'betray', 'hostile', 'disconnected', 'traitor', 'weakest', 'island', 'donate'],
    Hard: ['bots', 'counter', 'pocket', 'assist', 'betray', 'crater', 'traitor', 'disconnected', 'hostile', 'weak', 'victim', 'weakest', 'island', 'donate'],
    Impossible: ['counter', 'pocket', 'bots', 'weak', 'assist', 'traitor', 'disconnected', 'betray', 'victim', 'crater', 'hostile', 'weakest', 'island', 'donate']
  };
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Do not select an action here' };
  const WAIT = Symbol('strategy-wait');
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

  function select(actor, mode, supplied = [], hooks) {
    if (!hooks.allowed()) return { target: null, stop: true };
    let inputs;
    if (mode === 'incoming') inputs = actor.player.incomingAttacks().map(attack => ({ target: attack.attacker(), attack }));
    else if (mode === 'hostile') inputs = actor.player.allRelationsSorted().map(r => ({ target: r.player, relation: r.relation }));
    else inputs = (mode === 'weakest' ? supplied.slice(0, 1) : supplied).map(target => ({ target }));
    const alliancesDisabled = mode === 'traitor' && actor.game.config().disableAlliances();
    const entries = inputs.map((input, index) => {
      const t = input.target;
      const c = { id: `target:${mode}:${index}`, kind: 'attack-target', mode, inputIndex: index,
        targetId: safe(() => t.id()), priority: index, eligible: false, facts: {}, reason: '' };
      try {
        const reject = reason => { c.reason = reason; };
        if (alliancesDisabled) reject('Alliances disabled; original traitor rule is inactive');
        else if (mode === 'incoming') {
          if (actor.player.isFriendly(t)) reject('Incoming attacker is friendly');
          else if (actor.player.type() !== deps.botType && t.type() === deps.botType) reject('Original counter rule excludes Bot attackers for non-Bot players');
          else {
            c.facts.incomingTroops = input.attack.troops();
            c.eligible = c.facts.incomingTroops > 0;
            c.reason = c.eligible ? 'Largest individual incoming attack; preserve first tie' : 'Incoming attack has no positive troops';
          }
        } else {
          // These are exact original predicates; don't call random attack or
          // opening checks while merely comparing targets.
          if (mode === 'hostile' && (input.relation !== deps.hostileRelation || actor.player.isFriendly(t))) {
            reject('Not a hostile, unfriendly relation');
          } else if (mode === 'traitor' && !t.isTraitor()) reject('Target is not a traitor');
          else if (mode === 'disconnected' && !t.isDisconnected()) reject('Target is connected');
          else {
            const troops = t.troops(), selfTroops = actor.player.troops(), ffa = actor.isFFA();
            Object.assign(c.facts, { troops, selfTroops, ffa });
            if (mode === 'weak') {
              const cap = actor.game.config().maxTroops(t);
              Object.assign(c.facts, { capacity: cap, capacityThreshold: cap * .15, relativeThreshold: selfTroops * 1.2 });
              c.eligible = troops < cap * .15 && (!ffa || troops < selfTroops * 1.2);
              c.reason = c.eligible ? 'Below 15% capacity and within original relative-strength limit' : 'Requires troops <15% capacity and, in FFA, <1.2x own troops';
            } else if (mode === 'victim') {
              c.facts.relativeThreshold = selfTroops * 1.2;
              if (ffa && troops > selfTroops * 1.2) reject('FFA victim exceeds 1.2x own troops');
              else {
                c.facts.incomingTroops = t.incomingAttacks().reduce((sum, attack) => sum + attack.troops(), 0);
                c.facts.pressureThreshold = troops * .5;
                c.eligible = c.facts.incomingTroops > troops * .5;
                c.reason = c.eligible ? 'Incoming attack troops exceed half the target army' : 'Requires incoming attack troops >50% of target army';
              }
            } else if (['traitor', 'disconnected', 'hostile', 'weakest'].includes(mode)) {
              const multiplier = mode === 'traitor' ? 1.2 : mode === 'weakest' ? 1 : 3;
              c.facts.relativeThreshold = selfTroops * multiplier;
              c.eligible = !ffa || (mode === 'hostile' ? troops <= c.facts.relativeThreshold : troops < c.facts.relativeThreshold);
              c.reason = c.eligible ? `Original ${mode} target within relative-strength limit; preserve input order` :
                `FFA strength limit failed (${mode === 'hostile' ? '<=' : '<'} ${multiplier}x own troops required)`;
            } else throw new Error(`Unknown target mode: ${mode}`);
          }
        }
      } catch {
        c.eligible = false; c.reason = 'Target rule data unavailable';
      }
      return { target: t, candidate: c };
    });
    // Put the legacy winner inside the bounded window, even with >79 supplied
    // targets. Input indices remain visible; ties are stable.
    entries.sort((a, b) => Number(b.candidate.eligible) - Number(a.candidate.eligible) ||
      (mode === 'incoming' ? (b.candidate.facts.incomingTroops || 0) - (a.candidate.facts.incomingTroops || 0) : 0) ||
      a.candidate.inputIndex - b.candidate.inputIndex);
    if (mode === 'incoming') entries.forEach((entry, rank) => { entry.candidate.priority = rank; });
    const visible = entries.slice(0, 79);
    const choice = hooks.choose('attack-target', [...visible.map(e => e.candidate), wait], {
      mode, totalTargets: entries.length, visibleTargets: visible.length, hiddenTargets: entries.length - visible.length
    });
    const selected = visible.find(e => e.candidate.id === choice.selectedId);
    if (selected && !selected.candidate.eligible) hooks.record('plan-blocked', {
      domain: 'attack-target', decisionId: choice.decisionId, reason: selected.candidate.reason });
    return { target: selected?.candidate.eligible ? selected.target : null, decisionId: choice.decisionId,
      stop: !selected?.candidate.eligible && (choice.selectedId === null || !!selected || entries.some(e => e.candidate.eligible)) };
  }

  function order() {
    const difficulty = deps.difficulty();
    if (!orders[difficulty]) throw new Error('unreachable difficulty: ' + difficulty);
    const result = [...orders[difficulty]];
    if (deps.settings().winFixes) {
      result.splice(result.indexOf('crater'), 1);
      result.splice(result.indexOf('weakest') + 1, 0, 'crater');
    }
    return result;
  }

  async function run(actor, friends, enemies, hooks) {
    const sendSelected = async (mode, list, ...flags) => {
      const choice = select(actor, mode, list, hooks);
      if (choice.stop) return WAIT;
      if (!choice.target || !hooks.allowed()) return false;
      return hooks.execute(choice.decisionId, () => actor.sendAttack(choice.target, ...flags));
    };
    const executePurpose = async purpose => {
      switch (purpose) {
        case 'structured-bots': return actor.hasNeighboringBotWithStructures() ? actor.attackBots() : false;
        case 'priority-counter': {
          if (!deps.settings().counterAttackFirst) return false;
          let incoming = false;
          try { incoming = actor.player.incomingAttacks().length > 0; } catch { /* Original fallback. */ }
          return incoming && actor.counterReady() ? sendSelected('incoming', [], true, true) : false;
        }
        case 'counter': return actor.counterReady() ? sendSelected('incoming', [], true) : false;
        case 'pocket': {
          if (!deps.settings().encirclePockets) return false;
          const choice = await hooks.geography('pocket');
          if (choice.stop) return WAIT;
          if (!choice.target || !hooks.allowed()) return false;
          return choice.decisionId === null ? actor.sendAttack(choice.target, true) :
            hooks.execute(choice.decisionId, () => actor.sendAttack(choice.target, true));
        }
        case 'bots': return actor.attackBots();
        case 'assist': return actor.assistAllies();
        case 'betray': return actor.maybeBetrayAndAttack(friends, enemies);
        case 'crater': return actor.isBorderingNukedTerritory() ? actor.sendAttack(actor.game.terraNullius()) : false;
        case 'traitor': case 'disconnected': case 'victim': case 'weak': case 'weakest':
          return sendSelected(purpose, enemies);
        case 'hostile': return sendSelected('hostile', []);
        case 'island': {
          if (enemies.length) return false;
          const choice = await hooks.geography('island');
          if (choice.stop) return WAIT;
          if (!choice.target || !hooks.allowed()) return false;
          return choice.decisionId === null ? actor.sendAttack(choice.target) :
            hooks.execute(choice.decisionId, () => actor.sendAttack(choice.target));
        }
        case 'donate': return actor.donateTroops();
        default: throw new Error('Unknown attack purpose: ' + purpose);
      }
    };
    const phase = async (names, phaseName) => {
      let remaining = names.map((purpose, priority) => ({ id: `attack:${phaseName}:${purpose}`, kind: 'attack-plan',
        purpose, priority, eligible: true, readiness: 'unchecked',
        reason: `Original ${phaseName} order: ${purpose}; check prerequisites only after selection` }));
      while (remaining.length) {
        if (!hooks.allowed()) return 'wait';
        const choice = hooks.choose('attack-plan', [...remaining, wait], { phase: phaseName, difficulty: deps.difficulty() });
        const plan = remaining.find(p => p.id === choice.selectedId);
        if (!plan || !hooks.allowed()) return 'wait';
        try {
          const result = await hooks.execute(choice.decisionId, () => executePurpose(plan.purpose));
          hooks.record('plan-result', { domain: 'attack-plan', decisionId: choice.decisionId, purpose: plan.purpose,
            status: result === WAIT ? 'wait' : result ? 'completed' : 'unfulfilled',
            reason: 'Original purpose routine result; consult target, rule and dispatch records' });
          if (result === WAIT) return 'wait';
          if (result) return 'success';
        } catch (error) {
          hooks.record('plan-result', { domain: 'attack-plan', decisionId: choice.decisionId, purpose: plan.purpose, status: 'threw' });
          throw error;
        }
        remaining = remaining.filter(p => p !== plan);
      }
      return 'exhausted';
    };
    if (await phase(['structured-bots', 'priority-counter'], 'preflight') !== 'exhausted' || !hooks.allowed()) return;
    const reserve = actor.hasReserveRatioTroops();
    hooks.record('attack-gate', { gate: 'reserve', allowed: !!reserve });
    if (!reserve) return;
    const trigger = actor.hasTriggerRatioTroops();
    const randomOverride = !trigger && actor.random.chance(10);
    hooks.record('attack-gate', { gate: 'trigger', trigger: !!trigger, randomSampled: !trigger, randomOverride: !!randomOverride });
    if (!trigger && !randomOverride) return;
    await phase(order(), 'normal');
    // Preserve attackBestTarget's original undefined return value.
  }
  return { select, order, run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createAttackPlanner;
