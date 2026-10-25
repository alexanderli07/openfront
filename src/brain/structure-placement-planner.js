'use strict';

function createStructurePlacementPlanner(deps) {
  const U = deps.units;
  const wait = { id: '$wait', kind: 'wait', eligible: true, priority: 999,
    reason: 'Do not place this structure during the current pass' };
  const WINDOW_SIZE = 79;

  function sourceTiles(actor, unitType) {
    const settings = deps.settings();
    let random = unitType === U.Port ? actor.randCoastalTileArray(25) :
      deps.randomTerritoryTiles(actor.random, actor.game, actor.player, 25);
    const sources = [];
    if (settings.safePlacement && (unitType === U.City || unitType === U.Factory)) {
      sources.push(...actor.tilesDeepInTerritory(25));
    }
    if (unitType === U.MissileSilo && settings.winFixes ||
        settings.safePlacement && settings.samUmbrella && (unitType === U.City || unitType === U.Factory)) {
      sources.unshift(...actor.tilesNearFriendlySams(25));
    }
    sources.push(...random);
    return sources;
  }

  function trainRanges(actor) {
    const config = actor.game.config();
    const min = Math.max(0, Number(config.trainStationMinRange()) || 0);
    const max = Math.max(min, Number(config.trainStationMaxRange()) || min);
    return { min, max, minSquared: min * min, maxSquared: max * max };
  }

  function factories(actor) {
    const result = [];
    const self = actor.player;
    const selfId = self.smallID();
    try {
      for (const owner of actor.game.players()) {
        if (!owner?.isPlayer?.() || !owner?.isAlive?.()) continue;
        const own = owner.smallID() === selfId;
        if (!own && self.isFriendly(owner) !== true) continue;
        for (const unit of owner.units(U.Factory)) {
          if (unit.isUnderConstruction?.()) continue;
          result.push({ tile: unit.tile(), own });
        }
      }
    } catch {}
    return result;
  }

  function sampledRouteTiles(actor, center, unitType, ranges) {
    const game = actor.game;
    const ownerId = actor.player.smallID();
    const radii = [...new Set([ranges.min, Math.round((ranges.min + ranges.max) / 2), ranges.max])];
    const result = [];
    const x = game.x(center), y = game.y(center);
    for (const radius of radii) {
      if (!(radius > 0)) continue;
      for (let step = 0; step < 16; step++) {
        const angle = step * Math.PI / 8;
        const px = Math.round(x + Math.cos(angle) * radius);
        const py = Math.round(y + Math.sin(angle) * radius);
        if (!game.isValidCoord(px, py)) continue;
        const tile = game.ref(px, py);
        if (!game.isLand(tile) || game.ownerID(tile) !== ownerId) continue;
        if (unitType === U.Port && !game.isShore(tile)) continue;
        result.push(tile);
      }
    }
    return result;
  }

  function samCoverage(actor, tile) {
    let own = 0, allied = 0;
    const selfId = actor.player.smallID();
    try {
      for (const unit of actor.game.units(U.SAMLauncher) || []) {
        if (unit.isUnderConstruction?.()) continue;
        const owner = unit.owner?.();
        if (!owner) continue;
        const level = Math.max(1, Number(unit.level?.()) || 1);
        const range = Number(actor.game.config().samRange(level)) || 0;
        if (!(range > 0) || actor.game.euclideanDistSquared(tile, unit.tile()) > range * range) continue;
        if (owner.smallID?.() === selfId) own += level;
        else if (actor.player.isFriendly(owner) === true) allied += level;
      }
    } catch {}
    return { own, allied };
  }

  function futureRouteCapacity(actor, tile, ranges) {
    return sampledRouteTiles(actor, tile, U.City, ranges).length;
  }

  function prepare(actor, unitType) {
    const seen = new Set();
    const scorer = actor.structureSpawnTileValue(unitType);
    const safeScorer = actor.safePlacementScorer(unitType);
    const base = sourceTiles(actor, unitType);
    const baseSet = new Set(base);
    const shared = actor._sharedWaterComponents === undefined ? {} : {sharedWater:actor._sharedWaterComponents !== null};
    const opening = deps.opening?.observe(actor.game,actor.player,shared);
    const factoryLinePriority = opening?.economyMode === 'factory' && opening.cities >= opening.cityTarget &&
      opening.factories >= Math.max(1,opening.factoryTarget);
    const mode = opening?.economyMode || (actor._sharedWaterComponents === undefined ? undefined : actor._sharedWaterComponents === null ? 'factory' : 'coastal');
    const sam = unitType === U.SAMLauncher ? deps.samPlacement?.prepare(actor,mode) : null;
    const rear = deps.geography?.placementContext(actor.game, actor.player);
    const rearTiles = deps.geography && [U.City, U.Port, U.Factory].includes(unitType) ?
      deps.geography.rearTiles(actor.game, actor.player, unitType, rear) : [];
    const anchors = factories(actor);
    const ranges = trainRanges(actor);
    const routeTiles = [];
    if (unitType === U.City || unitType === U.Port || unitType === U.Factory) {
      const routeSeen = new Set();
      for (const anchor of anchors) {
        for (const tile of sampledRouteTiles(actor, anchor.tile, unitType, ranges)) {
          if (routeSeen.has(tile)) continue;
          routeSeen.add(tile); routeTiles.push(tile);
          if (routeTiles.length >= 160) break;
        }
        if (routeTiles.length >= 160) break;
      }
    }
    const stations = (() => { try { return actor.getOrBuildReachableStations() || []; } catch { return []; } })();
    const hasOwnSam = (() => { try { return actor.player.units(U.SAMLauncher).length > 0; } catch { return false; } })();
    const entries = [];
    for (const tile of [...base, ...routeTiles, ...rearTiles, ...(sam?.tiles || [])]) {
      if (seen.has(tile)) continue;
      seen.add(tile);
      if(unitType===U.Port&&deps.portWaterAccess&&!deps.portWaterAccess.assess(actor.game,tile).allowed)continue;
      let ownedFactoryRoutes = 0, alliedFactoryRoutes = 0;
      for (const anchor of anchors) {
        const distance = actor.game.euclideanDistSquared(tile, anchor.tile);
        if (distance < ranges.minSquared || distance > ranges.maxSquared) continue;
        if (anchor.own) ownedFactoryRoutes++;
        else alliedFactoryRoutes++;
      }
      const clusters = new Set();
      for (const station of stations) {
        const distance = actor.game.euclideanDistSquared(tile, station.tile);
        if (distance >= ranges.minSquared && distance <= ranges.maxSquared && station.cluster !== null && station.cluster !== undefined) {
          clusters.add(String(station.cluster));
        }
      }
      const coverage = samCoverage(actor, tile);
      entries.push({ tile, ...(sam ? sam.metrics(tile) : {}), factoryLinePriority,
        economyMode:opening?.economyMode || (sam?.anchorKind === 'Port' ? 'coastal' : sam?.anchorKind === 'City' ? 'factory' : null),
        ...(deps.geography && [U.City, U.Port, U.Factory].includes(unitType) ?
        deps.geography.rearMetrics(actor.game, tile, rear, unitType) : {}),
        originalScore: Number(scorer(tile)) || 0, safeScore: Number(safeScorer(tile)) || 0,
        ownedFactoryRoutes, alliedFactoryRoutes, routeClusters: clusters.size,
        futureRouteCapacity: futureRouteCapacity(actor, tile, ranges), ownSamCoverage: coverage.own,
        alliedSamCoverage: coverage.allied, hasOwnSam, adaptiveOnly: !baseSet.has(tile), inputIndex: entries.length });
    }
    entries.sort((a, b) => b.originalScore - a.originalScore || a.inputIndex - b.inputIndex);
    return entries.map((entry, priority) => ({ ...entry,
      id: `placement:${String(unitType)}:${entry.inputIndex}`, kind: 'structure-placement',
      source: 'StructurePlacementPlanner', unitType, eligible: true, priority,
      reason: 'Buildable candidate ranked by the original placement score' }));
  }

  function visibleWindow(remaining, unitType) {
    const economy = unitType === U.City || unitType === U.Port || unitType === U.Factory;
    const sam = unitType === U.SAMLauncher && remaining.some(c=>c.samAnchorKind);
    if (!sam && (!economy || !remaining.some(candidate => candidate.hasOwnSam || candidate.frontline || candidate.factoryLinePriority))) return remaining.slice(0, WINDOW_SIZE);
    const routeCount = candidate => candidate.ownedFactoryRoutes + candidate.alliedFactoryRoutes;
    const adaptive = [...remaining].sort((left, right) => {
      if (sam) return (left.samAnchorProtection ?? Infinity) - (right.samAnchorProtection ?? Infinity) ||
        (left.samAnchorDistance ?? Infinity) - (right.samAnchorDistance ?? Infinity) ||
        right.originalScore - left.originalScore || left.priority - right.priority;
      let result = (right.rearBand || 0) - (left.rearBand || 0) ||
        (routeCount(right) > 0 ? 1 : 0) - (routeCount(left) > 0 ? 1 : 0) ||
        right.ownSamCoverage - left.ownSamCoverage || right.alliedSamCoverage - left.alliedSamCoverage;
      if (!result && unitType === U.Factory) {
        result = right.routeClusters - left.routeClusters || right.futureRouteCapacity - left.futureRouteCapacity;
      }
      return result || right.originalScore - left.originalScore || left.priority - right.priority;
    });
    const visible = [], included = new Set();
    const add = candidate => {
      if (!candidate || included.has(candidate.id) || visible.length >= WINDOW_SIZE) return;
      included.add(candidate.id); visible.push(candidate);
    };
    add(remaining.find(c=>c.samSearchPlan));
    adaptive.slice(0, 40).forEach(add);
    remaining.filter(candidate => !candidate.adaptiveOnly).slice(0, 39).forEach(add);
    adaptive.forEach(add);
    return visible;
  }

  async function quoteSam(actor, unitType, requests, hooks, decisionId, maxProbes) {
    maxProbes = Math.min(79,maxProbes);
    // Search several distance bands: repeatedly invalid nearest requests must
    // not consume every pass before a feasible farther band is examined.
    const bins = Array.from({length:6},()=>[]);
    const sorted = [...requests].sort((a,b)=>a.samAnchorDistance-b.samAnchorDistance || a.priority-b.priority);
    for (const candidate of sorted) {
      const distance = candidate.samAnchorDistance;
      const band = [3,8,16,32,64].findIndex(limit=>distance<=limit);
      bins[band<0?5:band].push(candidate);
    }
    const samples = [], used = new Set();
    const add = c => { if (c && !used.has(c.id) && samples.length<maxProbes) { used.add(c.id); samples.push(c); } };
    for (const bin of bins) bin.slice(0,2).forEach(add);
    sorted.forEach(add);
    const quotes = new Map();
    for (const request of samples) {
      if (!hooks.allowed()) return null;
      let quote;
      try { quote = await actor.buildableFor(unitType,request.tile); }
      catch (error) {
        hooks.record('structure-placement-result',{decisionId,unitType,tile:request.tile,status:'threw'}); throw error;
      }
      if (!hooks.allowed()) {
        hooks.record('structure-placement-result',{decisionId,unitType,status:'stopped'}); return null;
      }
      if (quote===null || quote.canBuild===false) {
        hooks.record('structure-placement-result',{decisionId,unitType,tile:request.tile,status:'unbuildable'}); continue;
      }
      const tile = typeof quote.canBuild==='number' ? quote.canBuild : request.tile;
      quotes.set(tile,{quote,request});
      hooks.record('structure-placement-result',{decisionId,unitType,requestedTile:request.tile,tile,status:'sam-quoted'});
    }
    if (!quotes.size) {
      hooks.record('structure-placement-result',{decisionId,unitType,status:'no-buildable-tile',probed:samples.length}); return null;
    }
    const mode = requests.find(c=>c.economyMode)?.economyMode;
    const fresh = deps.samPlacement.prepare(actor,mode);
    if (!fresh.anchorKind || !hooks.allowed()) {
      hooks.record('structure-placement-result',{decisionId,unitType,status:'anchors-changed-or-stopped'}); return null;
    }
    const score = actor.structureSpawnTileValue(unitType);
    const choices = [...quotes].map(([tile,{request}],priority)=>({...request,...fresh.metrics(tile),
      id:'sam-quote:'+priority,tile,requestedTile:request.tile,priority,originalScore:Number(score(tile)) || 0,quoted:true,
      reason:'Worker-confirmed actual SAM site; rank actual distance to priority economy anchors'}));
    const decision = hooks.choose([...choices,wait],{unitType,samQuoteSearch:true,probed:samples.length,actualSites:choices.length});
    const selected = choices.find(c=>c.id===decision.selectedId);
    if (!selected || !hooks.allowed()) {
      hooks.record('structure-placement-result',{decisionId:decision.decisionId,unitType,status:hooks.allowed()?'wait':'stopped',probed:samples.length}); return null;
    }
    const result = quotes.get(selected.tile).quote;
    hooks.remember(result,decision.decisionId);
    hooks.record('structure-placement-result',{decisionId:decision.decisionId,unitType,tile:selected.tile,
      requestedTile:selected.requestedTile,samAnchorDistance:selected.samAnchorDistance,status:'selected',probed:samples.length});
    return result;
  }

  async function run(actor, unitType, hooks) {
    if (!hooks.allowed()) return null;
    let remaining = prepare(actor, unitType);
    if (unitType===U.SAMLauncher && remaining.some(c=>c.samAnchorKind)) remaining.push({
      id:'sam:quote-search',kind:'structure-placement',unitType,eligible:true,adaptiveOnly:true,samSearchPlan:true,
      priority:1000,reason:'Quote candidate sites across distance bands, then choose the closest actual SAM site'});
    const totalCandidates = remaining.length;
    const maxProbes = Math.max(1, deps.maxProbes || 12);
    let probed = 0;
    if (remaining.length === 0) {
      hooks.record('structure-placement-result', { decisionId: null, unitType,
        status: 'no-buildable-tile', totalCandidates, probed });
      return null;
    }
    while (remaining.length && probed < maxProbes) {
      const visible = visibleWindow(remaining, unitType);
      const choice = hooks.choose([...visible, wait], { unitType, totalCandidates,
        remainingCandidates: remaining.length, visibleCandidates: visible.length,
        hiddenCandidates: remaining.length - visible.length, probed });
      const selected = visible.find(candidate => candidate.id === choice.selectedId);
      if (!selected) {
        hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
          status: 'wait', reason: choice.reason, totalCandidates, probed });
        return null;
      }
      if (!hooks.allowed()) {
        hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
          tile: selected.tile, status: 'stopped', probed });
        return null;
      }
      if (selected.samSearchPlan) {
        const execute = () => quoteSam(actor,unitType,remaining.filter(c=>!c.samSearchPlan),hooks,choice.decisionId,maxProbes);
        return hooks.execute ? hooks.execute(choice.decisionId,execute) : execute();
      }
      remaining = remaining.filter(candidate => candidate !== selected);
      probed++;
      try {
        const buildable = await actor.buildableFor(unitType, selected.tile);
        if (!hooks.allowed()) {
          hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
            tile: selected.tile, status: 'stopped', probed });
          return null;
        }
        if (buildable === null || buildable.canBuild === false) {
          hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
            tile: selected.tile, status: 'unbuildable', probed });
          continue;
        }
        if(unitType===U.Port&&deps.portWaterAccess){
          const tile=typeof buildable.canBuild==='number'?buildable.canBuild:selected.tile;
          const water=deps.portWaterAccess.assess(actor.game,tile);
          if(!water.allowed){hooks.record('structure-placement-result',{decisionId:choice.decisionId,unitType,
            requestedTile:selected.tile,tile,status:'invalid-port-water',reason:water.reason});continue;}
        }
        hooks.remember(buildable, choice.decisionId);
        hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
          tile: selected.tile, status: 'selected', probed });
        return buildable;
      } catch (error) {
        hooks.record('structure-placement-result', { decisionId: choice.decisionId, unitType,
          tile: selected.tile, status: 'threw', probed, error: String(error?.message || error) });
        throw error;
      }
    }
    hooks.record('structure-placement-result', { decisionId: null, unitType,
      status: 'no-buildable-tile', totalCandidates, probed });
    return null;
  }

  return { prepare, run };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStructurePlacementPlanner;
