// The naval layer. Worth the most scrutiny of anything in the bot, because two
// mutually-masking crashes meant NONE of it executed until v1.78 — one aborted the pass,
// the other emptied its inputs — so every line here shipped unexercised for months.

import { source, fnUpTo, cut, decomment, suite } from "./lib/harness.mjs";
import { makeGame, makeWarship, makePlayer, makeConfig, grid, UPSTREAM } from "./lib/stubs.mjs";

const t = suite("warship");
const WB = source("engine/ingame/auto-bot/warshipBehavior.js");
const WB_C = decomment(WB);
const g = grid();
const { T, xOf } = g;

t.section("only PATROLLING ships count as idle");
{
  // A docked ship healing at 20% HP also has a patrolTile it is sitting on, so it passed
  // every old test and got tasked back out to sea. Upstream cancels the repair retreat
  // the moment patrolTile changes, so tasking it also CANCELLED the repair.
  const fn = fnUpTo(
    WB,
    "moveBestWarshipTo(tile, kind, s, tick) {",
    "moveWarship(warship, tile) {",
    "idle",
  );
  const body = cut(fn, "const targetComponent", "});", "filter");
  const runFilter = new Function(
    "env",
    `
    const { game, s, tick, tile, ships } = env;
    const cooldownTicks = 60;
    ${body
      .replace(/this\.game/g, "game")
      .replace("const idle = this.player.units(UNIT.Warship).filter", "const idle = ships.filter")}
    return idle;
  `,
  );
  // Two seas: x < 200 is component 1, x >= 200 is component 2.
  const game = makeGame({
    overrides: { getWaterComponent: (tl) => (xOf(tl) < 200 ? 1 : 2) },
  });
  const ships = [
    makeWarship({ id: "docked", tile: T(100, 100), state: "docked", hp: 200 }),
    makeWarship({ id: "retreating", tile: T(102, 100), state: "retreating", hp: 400 }),
    makeWarship({ id: "patrol", tile: T(105, 100), state: "patrolling" }),
    makeWarship({ id: "otherSea", tile: T(300, 100), state: "patrolling" }),
  ];
  const ids = runFilter({
    game,
    s: { cooldown: new Map() },
    tick: 500,
    tile: T(110, 100),
    ships,
  }).map((w) => w.id());

  t.check("the docked ship is NOT idle", !ids.includes("docked"), ids.join(","));
  t.check("the retreating ship is NOT idle", !ids.includes("retreating"));
  t.check("the patrolling ship IS idle", ids.includes("patrol"));
  t.check("a ship in another sea is excluded", !ids.includes("otherSea"));

  // A move that the server would silently drop must not book a cooldown, or the
  // reachable threats behind it get starved for 60 ticks.
  t.check(
    "a failed emit books no cooldown",
    /if \(!emitIntent\(ctors\.moveWarship, \[w\.id\(\)\], tile\)\) return false;/.test(fn),
  );
}

t.section("engagement geometry matches the engine");
{
  const fn = fnUpTo(WB, "smartWarshipCombat() {", "moveWarship(warship, tile) {", "combat");
  const c = decomment(fn);
  // The engine engages at warshipTargettingRange() = 130, compared as squared euclidean
  // by UnitGrid. The old 30-tile MANHATTAN window left a blind band from 30 to 130 in
  // which we were being shelled while the bot believed it was at peace.
  t.check(
    "enemies collected by squared euclidean",
    /euclideanDistSquared\(warship\.tile\(\), ew\.tile\(\)\) <= engageR2/.test(c),
  );
  t.check(
    "friendlies collected on the SAME radius",
    /euclideanDistSquared\(warship\.tile\(\), fw\.tile\(\)\) <= engageR2/.test(c),
  );
  t.check("docked enemies skipped, as findBestTarget does", /es\.state === "docked"/.test(c));
  t.check("the engine's own retreat is left alone", /if \(isGameRetreating\) continue;/.test(c));
  t.check("moves are hysteresis-gated", /MOVE_HYSTERESIS/.test(c));
  t.check("and reachability-gated", /getWaterComponent\(targetTile\)/.test(c));

  // The blind band, as arithmetic rather than as a regex.
  const me = T(100, 100),
    foe = T(160, 100);
  const seenNow = g.euclideanDistSquared(me, foe) <= UPSTREAM.warshipTargettingRange ** 2;
  const seenBefore = g.manhattanDist(me, foe) <= 30;
  t.check(
    "an enemy 60 tiles away is now seen, and was not before",
    seenNow && !seenBefore,
    `euclid=60 manhattan=${g.manhattanDist(me, foe)}`,
  );

  // Symmetry: enemies had no HP filter while friendlies were dropped below the retreat
  // threshold, so a healthy group repeatedly read as outnumbered.
  t.check("no one-sided friendly HP filter remains", !/fHp < wsMaxHp \* retreatPct/.test(c));
}

t.section("simulateBattle models the real shell");
{
  const fn = fnUpTo(
    WB,
    "simulateBattle(friendlies, enemies, maxHp, focalTile) {",
    "findSafeWaypoint(start, baseTarget, enemies) {",
    "sim",
  );
  // Expected shell damage is exactly baseDamage: nextInt is MAX-EXCLUSIVE so the roll is
  // 1..5, the multiplier averages 250, and the return is round((base/250)*multiplier).
  // The old code used base * 2.625 — the mean you get by reading nextInt as inclusive
  // AND skipping the /250 normalisation — which resolved battles in ~38% of their true
  // length and so under-counted the staggered reinforcements the sim exists to model.
  t.check("the 2.625 fudge is gone from the code", !/2\.625/.test(decomment(fn)));
  t.check(
    "damage is summed per ship, not shipCount * one flat rate",
    /fDmg \+= activeF\[i\]\.dps/.test(fn),
  );

  const B = new Function("env", `const { state } = env; class B { ${fn} } return B;`)({
    state: { settings: {} },
  });
  const b = new B();
  b.game = makeGame({ config: makeConfig(), strict: false });

  const ship = (hp, vet) => makeWarship({ id: `s${hp}_${vet}`, tile: T(100, 100), hp, vet });

  const even = b.simulateBattle([ship(1000, 0)], [ship(1000, 0)], 1000, T(100, 100));
  t.check("an even duel is not scored a win", even.win === false, JSON.stringify(even));

  // Veterancy is +20% health and +20% shell damage per level, to level 3. A vet-3 ship
  // is 1600 HP hitting for ~400: it should win a duel with health to spare, where the
  // old flat model rated the same fight as even and could evade a certain win.
  const vet = b.simulateBattle([ship(1600, 3)], [ship(1000, 0)], 1000, T(100, 100));
  t.check("a vet-3 ship beats a fresh one", vet.win === true, JSON.stringify(vet));
  t.check("...with real health left", vet.survivalPct > 30, vet.survivalPct.toFixed(1) + "%");

  t.check(
    "1 vs 2 is still a loss",
    b.simulateBattle([ship(1000, 0)], [ship(1000, 0), ship(1000, 0)], 1000, T(100, 100)).win ===
      false,
  );
  t.check(
    "2 vs 1 is a win",
    b.simulateBattle([ship(1000, 0), ship(1000, 0)], [ship(1000, 0)], 1000, T(100, 100)).win ===
      true,
  );
  t.check(
    "no enemies is a trivial win",
    b.simulateBattle([ship(1000, 0)], [], 1000, T(100, 100)).win === true,
  );
  t.check(
    "no friendlies is a trivial loss",
    b.simulateBattle([], [ship(1000, 0)], 1000, T(100, 100)).win === false,
  );
}

t.section("the safe-waypoint BFS");
{
  const fn = fnUpTo(
    WB,
    "findSafeWaypoint(start, baseTarget, enemies) {",
    "smartWarshipCombat() {",
    "bfs",
  );
  // Open water at depth 30 over 4-connected neighbours is ~1861 tiles, and Array.shift()
  // on a queue that long is O(n) per pop — ~1.7M element moves per call, on the UI
  // thread, once per evading warship per pass.
  t.check("head index, not shift()", /let head = 0;/.test(fn) && !/queue\.shift\(\)/.test(fn));
  t.check(
    "one neighbors() call per tile",
    (fn.match(/game\.neighbors\(tile\)/g) || []).length === 1,
  );

  const B = new Function(`class B { ${fn} } return B;`)();
  const b = new B();
  b.game = makeGame({ strict: false });
  const start = T(200, 200);
  const t0 = Date.now();
  const out = b.findSafeWaypoint(start, T(200, 220), [makeWarship({ id: "e", tile: T(230, 200) })]);
  const ms = Date.now() - t0;
  t.check("returns a tile", typeof out === "number", out);
  t.check("moves away from the enemy", xOf(out) <= xOf(start), `x=${xOf(out)} enemy x=230`);
  t.check("a full-depth BFS stays fast", ms < 500, ms + "ms");
}

t.section("the crashes of v1.78 stay dead");
{
  // These three were the same mistake three times: calling something gameApi does not
  // expose. lib/stubs.mjs now throws by name on any such call, so a reintroduction fails
  // in the sections above rather than needing its own regex — but keep the direct
  // assertions too, since they also cover code paths no test drives yet.
  t.check("no game.forEachNeighbor call survives", !/game\.forEachNeighbor\(/.test(WB_C));
  t.check("no wrapped-unit isFriendly call survives", !/\bu\.isFriendly\(/.test(WB_C));
  t.check(
    "both enemy filters test the OWNER",
    (WB_C.match(/!owner\.isFriendly\(me\)/g) || []).length >= 2,
    (WB_C.match(/!owner\.isFriendly\(me\)/g) || []).length,
  );
  // Healing is strictly owner-scoped upstream (healWarship and findNearestPort both
  // iterate warship.owner().units(Port)), so an ALLY's harbour never heals us — and
  // allies can betray. Own ports plus real teammates only.
  t.check("retreat targets exclude ally ports", /isOnSameTeam/.test(WB));
}

t.done();
