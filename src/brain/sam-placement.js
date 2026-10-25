'use strict';

// Priority anchors are economic buildings, not the aggregate structure count.
function createSamPlacement(deps) {
  const U = deps.units;
  const active = unit => !unit.isActive || unit.isActive();
  function prepare(actor, economyMode) {
    const game = actor.game, player = actor.player;
    const ports = economyMode === 'factory' ? [] : player.units(U.Port).filter(active);
    const anchorKind = ports.length ? 'Port' : 'City';
    const primary = ports.length ? ports : player.units(U.City).filter(active);
    if (!primary.length) return { anchorKind:null, tiles:[], metrics:()=>({}) };
    const sams = player.units(U.SAMLauncher).filter(s => active(s) && !s.isUnderConstruction?.());
    const anchors = primary.map(unit => ({ tile:unit.tile(), protection:sams.reduce((sum,sam) => {
      const range = Number(game.config().samRange(Math.max(1,Number(sam.level()) || 1)));
      return sum + (game.euclideanDistSquared(unit.tile(),sam.tile()) <= range*range ? Math.max(1,Number(sam.level()) || 1) : 0);
    },0) }));
    const minimum = Math.min(...anchors.map(a=>a.protection));
    const targets = anchors.filter(a=>a.protection===minimum);
    const metrics = tile => {
      let chosen = targets[0], distance = Infinity;
      for (const anchor of targets) {
        const squared = game.euclideanDistSquared(tile,anchor.tile);
        if (squared < distance) { distance = squared; chosen = anchor; }
      }
      return {samAnchorKind:anchorKind,samAnchorTile:chosen.tile,samAnchorProtection:chosen.protection,
        samAnchorDistance:Math.sqrt(distance)};
    };
    const seen = new Set(), tiles = [];
    for (const radius of [2,6,12,24,40]) {
      for (const anchor of targets.slice(0,8)) for (let step=0;step<4;step++) {
        const angle = step*Math.PI/2;
        const x = Math.round(game.x(anchor.tile)+Math.cos(angle)*radius);
        const y = Math.round(game.y(anchor.tile)+Math.sin(angle)*radius);
        if (!game.isValidCoord(x,y)) continue;
        const tile = game.ref(x,y);
        if (seen.has(tile) || !game.isLand(tile) || game.ownerID(tile)!==player.smallID() || game.hasFallout(tile)) continue;
        seen.add(tile); tiles.push(tile);
        if (tiles.length>=160) return {anchorKind,tiles,metrics};
      }
    }
    return {anchorKind,tiles,metrics};
  }
  return {prepare};
}
if (typeof module !== 'undefined' && module.exports) module.exports = createSamPlacement;
