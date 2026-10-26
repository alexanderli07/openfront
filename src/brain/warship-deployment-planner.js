'use strict';

function createWarshipDeploymentPlanner(deps) {
  const inFlight = new WeakSet(), pending = new WeakMap();
  const wait = { id: '$wait', kind: 'wait', reason: 'Wait for another opportunity' };
  function randomUnit(actor, units, domain, parentDecisionId, hooks) {
    const winner = actor.random.randElement(units);
    const entries = [winner, ...units.filter(unit => unit !== winner)].slice(0,79);
    const candidates = entries.map((unit, priority) => ({ id: `unit:${priority}`, kind: domain,
      priority, eligible: true, unitId: unit.id?.(), tile: unit.tile(),
      reason: priority === 0 ? 'Original random draw' : 'Alternative unit from the same pool' }));
    const decision = hooks.choose(domain, [...candidates,wait], { candidateLimit: 79 }, parentDecisionId);
    const index = candidates.findIndex(c => c.id === decision.selectedId);
    hooks.record(`${domain}-result`, { decisionId: decision.decisionId, status: index < 0 ? 'wait' : 'selected', unitId: candidates[index]?.unitId });
    return { unit: index < 0 || !hooks.allowed() ? null : entries[index], decision };
  }
  async function deploy(actor, hooks) {
    if (!hooks.allowed()) return false;
    const ports = actor.player.units(deps.portType);
    const ships = actor.player.units(deps.warshipType);
    const ticket = pending.get(actor);
    if (ticket && (ships.length > ticket.count || actor.game.ticks() - ticket.tick >= 40)) pending.delete(actor);
    const reserve=()=>BigInt(hooks.reserve?.()??0n);
    const waiting=hooks.hotspotMode&&hooks.waitingReplacement?.();
    const eligible = !waiting&&(!hooks.hotspotMode||hooks.hasTradePost?.(ports)!==false)&&ports.length > 0 && ships.length === 0 && actor.player.gold() > actor.cost(deps.warshipType) &&
      (!hooks.hotspotMode || !inFlight.has(actor) && !pending.has(actor) &&
        BigInt(actor.player.gold()) >= BigInt(actor.cost(deps.warshipType)) + reserve());
    const candidate = { id: 'deploy:first', kind: 'warship-deployment', priority: 0, eligible,
      reason: eligible ? 'Build first warship from an existing port' : 'Requires a port, no warships and gold above cost' };
    const naval = hooks.naval?.();
    const strategicEligible = !waiting&&naval?.island && naval.fleetNeeded && !inFlight.has(actor) && !pending.has(actor) &&
      ports.some(p => (!p.isActive || p.isActive()) && !p.isUnderConstruction?.()) &&
      BigInt(actor.player.gold()) >= BigInt(actor.cost(deps.warshipType)) + BigInt(naval.reserve);
    const replacement=hooks.hotspotMode?hooks.replacement?.():null;
    const replaceEligible=!!replacement&&ports.length>0&&ships.length<10&&!inFlight.has(actor)&&!pending.has(actor)&&
      BigInt(actor.player.gold())>=BigInt(actor.cost(deps.warshipType))+reserve();
    const choices = [{id:'deploy:replacement',kind:'warship-deployment',priority:-1,eligible:replaceEligible,
      postKey:replacement?.key,postTile:replacement?.tile,reason:'Replace the lost piracy-post ship while preserving economy/SAM cash'},candidate];
    if (naval?.island) choices.push({ id:'deploy:island', kind:'warship-deployment', priority:100, adaptiveOnly:true,
      eligible:!!strategicEligible, reason:'Bounded island fleet; keep the next economy/SAM purchase in reserve',
      reserve:naval.reserve, targetShips:naval.targetShips, ships:naval.ships });
    const decision = hooks.choose('warship-deployment', [...choices, wait], { ports: ports.length, warships: ships.length });
    const report = (status, details = {}) => hooks.record('warship-deployment-result', { decisionId: decision.decisionId, status, ...details });
    const selected = choices.find(c => c.id === decision.selectedId && c.eligible);
    if (!selected) { report('wait', { reason: decision.reason }); return false; }
    const strategic = selected.id === 'deploy:island',replacing=selected.id==='deploy:replacement';
    if (!hooks.allowed()) { report('stopped'); return false; }
    try {
      if (strategic||hooks.hotspotMode) inFlight.add(actor);
      const rejected = new Set();
      for (let attempt=0; attempt<(strategic ? 8 : 1); attempt++) {
        if (!hooks.allowed()) { report('stopped'); return false; }
        let site;
        if(replacing)site=hooks.tradeSite?.(ports,decision.decisionId,replacement)||{tile:null};
        else if (strategic) site = hooks.strategicSite(ports, decision.decisionId, rejected);
        else {
          site=hooks.tradeSite?.(ports,decision.decisionId);
          if(!site&&hooks.hotspotMode&&hooks.hasTradePost){report('no-viable-piracy-post');return false;}
          if(!site){
            const { unit: port, decision: portDecision } = randomUnit(actor, ports, 'warship-port', decision.decisionId, hooks);
            if (!port) { report('wait'); return false; }
            site = hooks.spawn ? hooks.spawn(port.tile(), 250, portDecision.decisionId) :
              { tile: actor.warshipSpawnTile(port.tile(), 250), decisionId: portDecision.decisionId };
          }
        }
        const { tile } = site;
        if (tile === null) { report('no-site'); return false; }
        const buildable = await actor.buildableWarship(tile);
        if (!hooks.allowed()) { report('stopped'); return false; }
        if (buildable == null || buildable.canBuild === false) {
          report('unbuildable', { tile });
          if (strategic) { rejected.add(tile); continue; }
          return false;
        }
        if (strategic) {
          const fresh = hooks.naval();
          const cost = BigInt(buildable.cost ?? actor.cost(deps.warshipType));
          if (!fresh?.island || !fresh.fleetNeeded || BigInt(actor.player.gold()) < cost + BigInt(fresh.reserve)) {
            report('reserve-or-fleet-changed', {tile}); return false;
          }
        }
        if(hooks.hotspotMode&&BigInt(actor.player.gold())<BigInt(buildable.cost??actor.cost(deps.warshipType))+reserve()){
          report('reserve-changed',{tile});return false;
        }
        if(replacing&&hooks.replacement?.()?.key!==replacement.key){report('replacement-changed',{tile});return false;}
        const result = hooks.execute(site.decisionId, () => actor._deployWarshipReady(tile, buildable));
        if(result&&replacing)hooks.deployed?.(replacement);
        if ((strategic||hooks.hotspotMode) && result) pending.set(actor, {tick:actor.game.ticks(),count:ships.length});
        report(result ? 'build-attempted' : 'not-built', { tile });
        return result;
      }
      report('sites-exhausted'); return false;
    } catch (error) { report('threw', { error: String(error?.message || error) }); throw error; }
    finally { if (strategic||hooks.hotspotMode) inFlight.delete(actor); }
  }

  function select(actor, teamGame, hooks) {
    if (!hooks.allowed()) return { target: null };
    const entries = [];
    if (teamGame) {
      const teams = new Map();
      for (const player of actor.game.players()) {
        if (actor.player.isFriendly(player) || player.id() === actor.player.id()) continue;
        const team = player.team();
        if (team === null) continue;
        const key = team.toString();
        if (!teams.has(key)) teams.set(key, { count: 0, players: [] });
        const group = teams.get(key);
        group.count += player.units(deps.warshipType).length;
        group.players.push(player);
      }
      for (const [team, group] of teams) {
        if (group.count <= 15) continue;
        const player = group.players.reduce((best, next) => next.units(deps.warshipType).length > (best ? best.units(deps.warshipType).length : 0) ? next : best, null);
        if (!player) continue;
        const fleet = player.units(deps.warshipType);
        if (fleet.length > 3) entries.push({ player, fleet, team, teamShips: group.count });
        if (entries.length === 79) break;
      }
    } else {
      const enemies = actor.game.players().filter(player => !actor.player.isFriendly(player) && player.id() !== actor.player.id());
      for (const player of enemies) {
        const fleet = player.units(deps.warshipType);
        if (fleet.length > 10) entries.push({ player, fleet });
        if (entries.length === 79) break;
      }
    }
    const candidates = entries.map((entry, priority) => ({ id: `infestation:${priority}`, kind: 'warship-infestation',
      priority, eligible: true, targetId: entry.player.id(), warships: entry.fleet.length,
      team: entry.team, teamWarships: entry.teamShips,
      reason: teamGame ? 'Strongest fleet on qualifying hostile team, in original team order' : 'Hostile fleet above ten warships, in original player order' }));
    const decision = hooks.choose('warship-infestation', [...candidates, wait], { teamGame, candidateLimit: 79 });
    const index = candidates.findIndex(c => c.id === decision.selectedId);
    if (index < 0) {
      hooks.record('warship-infestation-result', { decisionId: decision.decisionId, status: 'wait', reason: decision.reason });
      return { target: null, decision };
    }
    if (!hooks.allowed()) {
      hooks.record('warship-infestation-result', { decisionId: decision.decisionId, status: 'stopped' });
      return { target: null, decision };
    }
    const entry = entries[index];
    const selection = randomUnit(actor, entry.fleet, 'warship-unit', decision.decisionId, hooks);
    const target = selection.unit ? { player: entry.player, warship: selection.unit } : null;
    return { target, decision, unitDecision: selection.decision };
  }

  async function counter(actor, teamGame, hooks) {
    const { target, decision, unitDecision } = select(actor, teamGame, hooks);
    if (target === null) return;
    const report = (status, details = {}) => hooks.record('warship-infestation-result', { decisionId: decision.decisionId, status, ...details });
    try {
      const tile = target.warship.tile();
      const buildable = await actor.buildableWarship(tile);
      if (!hooks.allowed()) { report('stopped'); return; }
      const outcome = hooks.execute(unitDecision.decisionId, () => actor._counterWarshipReady(tile, buildable));
      report('response-completed', { tile, outcome: outcome === false ? 'declined' : outcome });
    } catch (error) { report('threw', { error: String(error?.message || error) }); throw error; }
  }
  return { deploy, select, counter };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createWarshipDeploymentPlanner;
