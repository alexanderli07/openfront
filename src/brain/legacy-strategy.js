'use strict';

function createLegacyStrategy() {
  return {
    id: 'legacy-v1',
    name: 'Original algorithm',
    version: '1.84.0-plans.38',
    decide(snapshot, candidates) {
      if (['team-opening-attack', 'social-reaction', 'alliance-event-action', 'alliance-event-target', 'alliance-event-response', 'social-cooldown', 'social-message', 'social-message-pool', 'social-attack-message', 'social-winner-response', 'social-phase', 'social-recipient', 'social-small-attack-target', 'warship-tracking', 'warship-transport-outgoing-target', 'warship-transport-outgoing-response', 'warship-trade-outgoing-target', 'warship-trade-outgoing-response', 'warship-invasion-source', 'warship-loss-source', 'warship-trade-source', 'warship-transport-target', 'warship-transport-response', 'warship-maintenance', 'salvo-order', 'salvo-window', 'salvo-count', 'salvo-schedule', 'nuke-arc', 'nuke-request-ally', 'nuke-request-player', 'nuke-hostile-player', 'nuke-duel-player', 'nuke-majority-player', 'spawn-action', 'spawn-source', 'spawn-companion', 'spawn-heatmap-spot', 'spawn-neighborhood', 'spawn-random', 'embargo-target', 'embargo-action', 'embargo-relation-target', 'embargo-relation-response', 'free-boat-site', 'free-boat-allocation', 'attack-route', 'targeted-boat-site', 'targeted-boat-allocation', 'land-reserve', 'land-allocation', 'forced-allocation', 'bot-allocation', 'donation-target', 'donation-amount', 'outreach-target', 'far-outreach-target', 'warship-home', 'warship-home-tile', 'warship-nuke-dodge', 'warship-nuke-threat', 'warship-nuke-escape', 'warship-target', 'warship-destination', 'warship-waypoint', 'warship-port', 'warship-placement', 'warship-unit', 'boat-origin', 'boat-destination', 'boat-search', 'boat-allocation', 'attack-sequence', 'takeover-target', 'structure-phase', 'structure-action', 'structure-upgrade', 'defense-placement'].includes(snapshot.domain)) {
        const chosen = candidates.filter(c => c.kind === snapshot.domain && c.eligible && !c.adaptiveOnly).sort((a,b) => a.priority-b.priority)[0];
        return { selectedId: chosen?.id ?? '$wait', reason: chosen?.reason ?? 'No eligible building action remains',
          evaluations: candidates.map(c => ({ id: c.id,
            verdict: c === chosen || !chosen && c.id === '$wait' ? 'select' : c.eligible === false ? 'ineligible' : 'not-selected', reason: c.reason })) };
      }
      if (['turn-plan', 'structure-plan', 'structure-placement', 'bot-target', 'attack-plan', 'attack-target', 'attack-geography', 'naval-landing', 'naval-action', 'warship-patrol', 'warship-combat', 'warship-retaliation', 'warship-deployment', 'warship-infestation', 'mirv-plan', 'nuke-weapon', 'nuke-site', 'nuke-action', 'nuke-target', 'sam-target', 'sam-upgrade', 'strike-silo', 'mirv-target', 'nuke-player', 'alliance-rule', 'assist-ally', 'assist-target', 'betray-target'].includes(snapshot.domain)) {
        const ranked = candidates.filter(c => c.kind === snapshot.domain && c.eligible &&
          !c.adaptiveOnly)
          .sort((a, b) => a.priority - b.priority);
        const chosen = ranked[0];
        return { selectedId: chosen?.id ?? '$wait',
          reason: chosen ? chosen.reason : 'No eligible plan remains; wait',
          evaluations: candidates.map(c => ({ id: c.id, priority: c.priority ?? null,
            verdict: c === chosen || !chosen && c.id === '$wait' ? 'select' : c.eligible === false ? 'ineligible' : 'not-selected',
            reason: c.reason })) };
      }
      const proposed = candidates.find(candidate => candidate.kind !== 'wait' && candidate.eligible !== false);
      return {
        selectedId: proposed?.id ?? null,
        reason: proposed ? `Keep the command proposed by ${proposed.source}; preserve the original strategy.` : 'Original behavior proposed no command.',
        evaluations: candidates.map(candidate => ({ id: candidate.id,
          verdict: candidate === proposed ? 'select' : 'not-selected',
          reason: candidate === proposed ? 'Original behavior reached its dispatch point' : 'Original behavior chose to act' }))
      };
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createLegacyStrategy;
