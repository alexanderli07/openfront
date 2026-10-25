'use strict';

function createAttackSequencePlanner(deps) {
  const phases = ['takeover', 'opening-bots', 'opportunistic-boat', 'donation', 'far-alliance',
    'open-land', 'random-boat', 'enemy-alliance', 'main'];
  const wait = { id: '$wait', kind: 'wait', eligible: true, reason: 'Hold the remaining attack pass' };
  const result = (status, finish = false) => ({ status, finish });
  async function takeover(actor, context, hooks) {
    const targets = context.all.filter(target => {
      try { return target.isPlayer() && target.isDisconnected && target.isDisconnected(); }
      catch { return false; }
    }).sort((a,b) => a.troops()-b.troops());
    if (!targets.length) return result('skipped');
    const candidates = targets.slice(0,79).map((target,priority) => ({
      id: `takeover:${priority}`, kind: 'takeover-target', eligible: true, priority,
      targetId: target.id(), troops: target.troops(),
      reason: 'Original disconnected-neighbor takeover; weakest army first, stable ties'
    }));
    const choice = hooks.choose('takeover-target', [...candidates, wait], { totalTargets: targets.length });
    const index = candidates.findIndex(candidate => candidate.id === choice.selectedId);
    if (index < 0 || !hooks.allowed()) {
      hooks.record('attack-sequence-result', { domain: 'takeover-target', decisionId: choice.decisionId, status: 'stopped' });
      return result('stopped',true);
    }
    const target = targets[index];
    deps.debug('[Takeover] disconnected neighbour → grabbing land:', target.name?.() ?? target.smallID?.());
    try {
      const sent = await hooks.execute(choice.decisionId, () => actor.sendAttack(target));
      const status = !hooks.allowed() ? 'stopped' : sent ? 'attempt-completed' : 'unfulfilled';
      hooks.record('attack-sequence-result', { domain: 'takeover-target', decisionId: choice.decisionId,
        targetId: candidates[index].targetId, status });
      return result(status, status === 'stopped' || !!sent);
    } catch (error) {
      hooks.record('attack-sequence-result', { domain: 'takeover-target', decisionId: choice.decisionId, status: 'threw' });
      throw error;
    }
  }
  async function run(actor, context, hooks) {
    const settings = () => deps.state.settings;
    const execute = async phase => {
      switch (phase) {
        case 'river-crossing': {
          const sent=await hooks.crossWilderness();
          return result(sent?'attempt-completed':'unfulfilled');
        }
        case 'wilderness-only': {
          const sent = await actor.sendAttack(actor.game.terraNullius());
          return result(sent ? 'attempt-completed' : 'unfulfilled', true);
        }
        case 'takeover': return context.expand && settings().winFixes ? takeover(actor,context,hooks) : result('skipped');
        case 'opening-bots': {
          if (!(context.expand && settings().winFixes && context.enemies.some(target => target.isPlayer() && target.type() === deps.botType))) return result('skipped');
          const sent = await actor.attackBots();
          return result(sent ? 'attempt-completed' : 'unfulfilled',!!sent);
        }
        case 'opportunistic-boat':
          if (!settings().winFixes) return result('skipped');
          await actor.maybeOpportunisticBoat(); return result('completed');
        case 'donation': {
          let opening = false;
          // Original observation occurs even when donation is disabled.
          try { const snap = actor.openingSnapshot(); opening = !!(snap && snap.applies && !snap.over && !snap.built); } catch {}
          const posture=hooks.supportPosture?.();
          if(posture){opening=!(posture.donationReady??posture.ready);
            if(posture.conserve||opening)return {...result('skipped'),reason:posture.donationHoldReason||posture.reason};}
          if (!(settings().winFixes && settings().features.donate && !opening)) return {...result('skipped'),
            reason:!settings().winFixes?'Donation automation requires win fixes':!settings().features.donate?'Troop donation disabled':'Opening economy is still protected'};
          const now = deps.now();
          const throttle=posture?Math.min(settings().donateThrottleMs||3000,posture.donationThrottleMs):settings().donateThrottleMs||3000;
          if (now - (deps.state.lastDonateMs || 0) <= throttle) return {...result('skipped'),reason:'Donation throttle has not elapsed'};
          const sent=actor.donateTroops();
          if (sent) deps.state.lastDonateMs = now;
          return {...result('completed'),reason:sent?'Donation command submitted; server acceptance unconfirmed':'Donation held or command not submitted'};
        }
        case 'far-alliance':
          if (!(context.alliance && settings().winFixes)) return result('skipped');
          actor.allianceBehavior.reachOutToFarNations(); return result('completed');
        case 'open-land': {
          if (!(context.expand && context.openLand)) return result('skipped');
          const sent = await actor.sendAttack(actor.game.terraNullius());
          return result(sent ? 'attempt-completed' : 'unfulfilled',!!sent);
        }
        case 'random-boat': {
          if (!context.boat || !actor.random.chance(context.enemies.length === 0 ? 5 : 10)) return result('skipped');
          const sent = context.enemies.length ? await actor.attackWithRandomBoat(context.enemies) : await actor.attackWithRandomBoat();
          return result(sent ? 'attempt-completed' : 'unfulfilled',context.enemies.length > 0 && !!sent);
        }
        case 'enemy-alliance':
          if (!context.enemies.length || !context.alliance) return result('skipped');
          actor.allianceBehavior.maybeSendAllianceRequests(context.enemies); return result('completed');
        case 'main':
          if (!context.expand) return result('skipped');
          await actor.attackBestTarget(context.friends,context.enemies); return result('completed');
        default: throw new Error('Unknown attack sequence phase: '+phase);
      }
    };
    let remaining = phases.map((phase,priority) => ({ id: `sequence:${phase}`, kind: 'attack-sequence', phase,
      eligible: true, priority, readiness: 'unchecked', reason: `Original outer attack order: ${phase}; check gates only after selection` }));
    if (context.teamOpening) remaining.push({ id: 'sequence:wilderness-only', kind: 'attack-sequence',
      phase: 'wilderness-only', adaptiveOnly: true, priority: 100,
      eligible: !!context.expand && context.teamOpening.borderKnown && context.teamOpening.wilderness,
      reason: 'Expand reachable wilderness and finish this attack pass even if the attempt fails' });
    if(context.teamOpening&&hooks.crossWilderness)remaining.push({id:'sequence:river-crossing',kind:'attack-sequence',
      phase:'river-crossing',adaptiveOnly:true,priority:99,
      eligible:!!context.boat&&context.teamOpening.borderKnown&&!context.teamOpening.frontline,
      reason:'Try a nearby neutral river crossing alongside land expansion'});
    while (remaining.length) {
      if (!hooks.allowed()) return;
      const choice = hooks.choose('attack-sequence', [...remaining, wait], {
        expand: context.expand, boat: context.boat, alliance: context.alliance, openLand: context.openLand,
        friendlyCount: context.friends.length, enemyCount: context.enemies.length });
      const selected = remaining.find(candidate => candidate.id === choice.selectedId);
      if (!selected || !hooks.allowed()) {
        hooks.record('attack-sequence-result', { domain: 'attack-sequence', decisionId: choice.decisionId, status: 'stopped' });
        return;
      }
      try {
        const outcome = await hooks.execute(choice.decisionId, () => execute(selected.phase));
        const status = hooks.allowed() ? outcome.status : 'stopped';
        hooks.record('attack-sequence-result', { domain: 'attack-sequence', decisionId: choice.decisionId, phase: selected.phase, status,
          ...(outcome.reason?{reason:outcome.reason}:{}) });
        if (outcome.finish || status === 'stopped') return;
      } catch (error) {
        hooks.record('attack-sequence-result', { domain: 'attack-sequence', decisionId: choice.decisionId, phase: selected.phase,
          status: 'threw', error: String(error?.message || error) });
        throw error;
      }
      remaining = remaining.filter(candidate => candidate !== selected);
    }
    // maybeAttack originally returns undefined on every path.
  }
  return { run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createAttackSequencePlanner;
