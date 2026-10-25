'use strict';

// Bounded measurements only. The selected central strategy makes the choices.
function createTeamGeography(deps) {
  const U = deps.units;
  const scans = new WeakMap(), fronts = new WeakMap();
  const active = unit => !unit.isActive || unit.isActive();
  const ready = unit => active(unit) && !unit.isUnderConstruction?.();
  const sample = (items, limit) => items.filter((_, index) => index % Math.max(1, Math.ceil(items.length / limit)) === 0).slice(0, limit);
  function applies(game, self) {
    if (game.config().gameConfig().gameMode !== deps.teamMode) return false;
    const teams = new Set(game.players().filter(p => p.type() !== deps.botType).map(p => p.team()).filter(t => t != null));
    return teams.size === 2 && teams.has(self.team());
  }
  function waterAt(game, tile) {
    return game.neighbors(tile).filter(t => game.isWater(t) && game.getWaterComponent(t) != null);
  }
  function usefulWater(game, start) {
    if (game.isOcean(start)) return true;
    const seen = new Set([start]), queue = [start];
    for (let i = 0; i < queue.length && i < 24; i++) {
      for (const t of game.neighbors(queue[i])) if (game.isWater(t) && !seen.has(t)) { seen.add(t); queue.push(t); }
    }
    return seen.size >= 24;
  }
  function spawnMetrics(game, self, tile, players) {
    const seen = new Set([tile]), queue = [tile];
    let open = 0, waterAccess = false;
    for (let i = 0; i < queue.length && i < 256; i++) {
      const current = queue[i];
      open++;
      for (const next of game.neighbors(current)) {
        if (game.isWater(next)) {
          if (!waterAccess && usefulWater(game, next)) waterAccess = true;
        } else if (game.isLand(next) && !game.hasOwner(next) && !game.hasFallout(next) && !seen.has(next) &&
          Math.abs(game.x(tile) - game.x(next)) <= 12 && Math.abs(game.y(tile) - game.y(next)) <= 12) {
          seen.add(next); queue.push(next);
        }
      }
    }
    let allyDistance = 100000, enemyDistance = 100000, teammates = 0;
    for (const other of players) {
      if (other.smallID() === self.smallID() || other.type() === deps.botType) continue;
      const location = other.nameLocation();
      if (!location) continue;
      const distance = Math.abs(location.x - game.x(tile)) + Math.abs(location.y - game.y(tile));
      if (other.team() === self.team()) { allyDistance = Math.min(allyDistance, distance); if (distance <= 160) teammates++; }
      else enemyDistance = Math.min(enemyDistance, distance);
    }
    return { openSpace: open / 256, waterAccess, allyDistance, enemyDistance, teammates,
      edgeDistance: Math.min(game.x(tile), game.y(tile), game.width() - 1 - game.x(tile), game.height() - 1 - game.y(tile)) };
  }
  function placementContext(game, self) {
    if (!applies(game, self)) return null;
    const tick = game.ticks(), border = self.borderTiles();
    const cached = fronts.get(self);
    if (cached && cached.game === game && cached.tick === tick && cached.border === border) return cached;
    const enemyIds = new Set(game.players().filter(p => p.isAlive() && p.type() !== deps.botType &&
      p.smallID() !== self.smallID() && !self.isFriendly(p)).map(p => p.smallID()));
    let front = [];
    for (const tile of border) if (game.neighbors(tile).some(n => game.isLand(n) && enemyIds.has(game.ownerID(n)))) front.push(tile);
    const incoming = self.incomingAttacks().some(a => Number(a.troops()) > 0);
    if (!front.length && incoming) {
      // No land contact (e.g. a landing): approximate the threatened side from
      // visible hostile centers until an actual enemy border is established.
      const centers = game.players().filter(p => enemyIds.has(p.smallID())).map(p => p.nameLocation()).filter(Boolean);
      const distance = tile => Math.min(...centers.map(c => Math.abs(game.x(tile) - c.x) + Math.abs(game.y(tile) - c.y)));
      front = sample([...border], 256).sort((a, b) => distance(a) - distance(b)).slice(0, 8);
    }
    const value = { game, tick, border, frontline: front.length > 0 || incoming, front: sample(front, 128) };
    fronts.set(self, value); return value;
  }
  function rearMetrics(game, tile, context, unitType) {
    if (!context?.frontline || !context.front.length) return { frontline: false, rearDistance: 0, rearBand: 0 };
    const distance = Math.min(...context.front.map(front => game.manhattanDist(tile, front)));
    return { frontline: true, rearDistance: distance, rearBand: Math.floor(Math.min(180, distance) / (unitType === U.City ? 20 : 30)) };
  }
  function rearTiles(game, self, type, context) {
    if (!context?.frontline) return [];
    const border = [...context.border];
    if (!border.length) return [];
    let tiles;
    if (type === U.Port) tiles = sample(border.filter(t => game.isShore(t)), 160);
    else {
      const xs = border.map(t => game.x(t)), ys = border.map(t => game.y(t));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      tiles = [];
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const px = Math.round(minX + (maxX - minX) * x / 11), py = Math.round(minY + (maxY - minY) * y / 11);
        if (game.isValidCoord(px, py)) tiles.push(game.ref(px, py));
      }
    }
    return [...new Set(tiles)].filter(t => game.isLand(t) && game.ownerID(t) === self.smallID() && !game.hasFallout(t))
      .sort((a, b) => rearMetrics(game, b, context, type).rearDistance - rearMetrics(game, a, context, type).rearDistance).slice(0, 64);
  }
  function landRegion(game, self) {
    const seed = [...self.borderTiles()].find(t => game.isLand(t));
    if (seed === undefined) return { complete: false, cursor: 0, seen: new Set() };
    let scan = scans.get(self);
    if (!scan || scan.game !== game || scan.complete && !scan.seen.has(seed)) {
      scan = { game, seen: new Set([seed]), queue: [seed], cursor: 0, complete: false, tick: null };
      scans.set(self, scan);
    }
    if (!scan.complete && scan.tick !== game.ticks()) {
      scan.tick = game.ticks();
      const end = scan.cursor + (deps.landBudget || 6000);
      while (scan.cursor < scan.queue.length && scan.cursor < end) {
        const tile = scan.queue[scan.cursor++];
        for (const next of game.neighbors(tile)) if (game.isLand(next) && !scan.seen.has(next)) { scan.seen.add(next); scan.queue.push(next); }
      }
      scan.complete = scan.cursor === scan.queue.length;
      if (scan.complete) scan.queue = [];
    }
    return scan;
  }
  function hostileTransports(game, self) {
    return game.units(U.TransportShip).filter(ship => {
      if (!active(ship) || self.isFriendly(ship.owner()) || ship.owner().smallID() === self.smallID()) return false;
      if (ship.transportShipState?.()?.isRetreating) return false;
      const target = ship.targetTile();
      if (target == null || !game.hasOwner(target)) return false;
      const owner = game.playerBySmallID(game.ownerID(target));
      return owner && (owner.smallID() === self.smallID() || owner.team() === self.team());
    });
  }
  function navalFacts(game, self) {
    if (!applies(game, self)) return null;
    const region = landRegion(game, self);
    const ports = self.units(U.Port).filter(ready);
    const defensePorts = ports.filter(p => region.seen.has(p.tile()));
    const ownComponents = new Set(defensePorts.flatMap(p => waterAt(game, p.tile()).map(t => game.getWaterComponent(t))));
    const enemies = game.players().filter(p => p.isAlive() && p.type() !== deps.botType &&
      p.smallID() !== self.smallID() && !self.isFriendly(p));
    const hostilePorts = enemies.flatMap(p => p.units(U.Port).filter(ready));
    const sharedComponents = new Set();
    let sameLand = false;
    if (region.complete) {
      for (const enemy of enemies) {
        const center = enemy.nameLocation();
        if (center && game.isValidCoord(Math.round(center.x), Math.round(center.y)) &&
          region.seen.has(game.ref(Math.round(center.x), Math.round(center.y)))) sameLand = true;
      }
      for (const port of hostilePorts) {
        if (region.seen.has(port.tile())) { sameLand = true; continue; }
        for (const tile of waterAt(game, port.tile())) {
          const component = game.getWaterComponent(tile);
          if (ownComponents.has(component)) sharedComponents.add(component);
        }
      }
    }
    const threats = hostileTransports(game, self).length;
    const ships = self.units(U.Warship).filter(s => active(s) && sharedComponents.has(game.getWaterComponent(s.tile()))).length;
    const island = region.complete && !sameLand && sharedComponents.size > 0;
    const targetShips = threats ? 3 : 2;
    return { twoTeam: true, island, topologyKnown: region.complete, visitedLand: region.cursor,
      sharedComponents: [...sharedComponents], defensePortTiles:defensePorts.map(p=>p.tile()), ports: defensePorts.length, ships, threats, targetShips,
      fleetNeeded: island && defensePorts.length > 0 && ships < targetShips };
  }
  function transportTargets(game, self, ship) {
    if (!applies(game, self)) return [];
    const component = game.getWaterComponent(ship.tile());
    if (component == null) return [];
    const radius = Math.max(80, Math.min(180, Number(game.config().warshipTargettingRange()) || 130));
    return hostileTransports(game, self).filter(t => game.getWaterComponent(t.tile()) === component &&
      game.manhattanDist(ship.tile(), t.tile()) <= radius).map(t => ({ tile: t.tile(), targetId: t.id(),
      targetTile: t.targetTile(), landingDistance: game.manhattanDist(t.tile(), t.targetTile()),
      interceptDistance: game.manhattanDist(ship.tile(), t.tile()) }))
      .sort((a, b) => a.landingDistance - b.landingDistance || a.interceptDistance - b.interceptDistance).slice(0, 79);
  }
  function coastalPatrols(game, self, naval) {
    if (!naval?.island) return [];
    const shipComponents = new Set(self.units(U.Warship).filter(ready).map(s => game.getWaterComponent(s.tile())));
    const enemies = game.players().filter(p => p.isAlive() && p.type() !== deps.botType && !self.isFriendly(p));
    const enemyPorts = enemies.flatMap(p => p.units(U.Port).filter(ready));
    const result = [];
    for (const player of game.players().filter(p => p.team() === self.team())) {
      for (const port of player.units(U.Port).filter(ready)) {
        const starts = waterAt(game, port.tile()).filter(t => shipComponents.has(game.getWaterComponent(t)) && naval.sharedComponents.includes(game.getWaterComponent(t)));
        if (!starts.length) continue;
        const seen = new Set(starts), queue = starts.map(tile => ({ tile, depth: 0 }));
        const candidates = [];
        for (let i = 0; i < queue.length && i < 160; i++) {
          const entry = queue[i];
          if (entry.depth > 0) candidates.push(entry.tile);
          if (entry.depth >= 20) continue;
          for (const t of game.neighbors(entry.tile)) if (game.isWater(t) && !seen.has(t) &&
            game.getWaterComponent(t) === game.getWaterComponent(entry.tile)) { seen.add(t); queue.push({ tile: t, depth: entry.depth + 1 }); }
        }
        const enemyDistance = tile => Math.min(...enemyPorts.map(p => game.manhattanDist(tile, p.tile())));
        candidates.sort((a, b) => enemyDistance(a) - enemyDistance(b));
        if (candidates.length) result.push({ tile: candidates[0], kind: 'coast-guard', approachDistance: enemyDistance(candidates[0]) });
        if (result.length >= 8) return result;
      }
    }
    return result;
  }
  return { applies, spawnMetrics, placementContext, rearMetrics, rearTiles, navalFacts, transportTargets, coastalPatrols };
}
if (typeof module !== 'undefined' && module.exports) module.exports = createTeamGeography;
