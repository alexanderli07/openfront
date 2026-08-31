// SAM-umbrella siting: cover relaxes the anti-atom spread without outbidding depth.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies samUmbrella with the REAL sliced collectFriendlyUmbrellas + safePlacementScorer.
import { source, suite } from "./lib/harness.mjs";
const src = source("engine/ingame/auto-bot/structureBehavior.js");

function sliceTo(a0, b0) {
  // a0 .. just before b0
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start: " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end: " + b0);
  return src.slice(a, b);
}
function sliceIncl(a0, b0) {
  // a0 .. through b0
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start: " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end: " + b0);
  return src.slice(a, b + b0.length);
}

// All the module-level constants + helpers, verbatim.
const consts = sliceTo(
  "const SAFE_PLACEMENT_RANGE_MULT = 3;",
  "  const DEFENSE_POST_INCOME_MINUTES",
);
const fnScorer = sliceIncl(
  "safePlacementScorer(placingType) {",
  "        return w;\n      };\n    }",
);
const fnClassify = sliceIncl(
  "classifyBorder() {",
  "      this._borderClass = out;" +
    String.fromCharCode(10) +
    "      return out;" +
    String.fromCharCode(10) +
    "    }",
);
const fnSpacing = sliceIncl(
  "spacingConstants() {",
  "return { borderSpacing, structureSpacing: borderSpacing * 2 };\n    }",
);

// Sanity: the slices really contain the new code.
for (const [name, txt, needle] of [
  ["consts", consts, "const SAFE_WEIGHT_SAM_UMBRELLA = 90;"],
  ["consts", consts, "function collectFriendlyUmbrellas("],
  ["scorer", fnScorer, "UMBRELLA_FRONT_FLOOR"],
  ["scorer", fnScorer, "releasePaid + (1 - releasePaid) * spread"],
]) {
  if (!txt.includes(needle)) throw new Error("slice " + name + " missing: " + needle);
}

const W = 400;
const T = (x, y) => y * W + x;

const factory = new Function(
  "env",
  `
  const { state, closestTile } = env;
  const UNIT = {
    City: "City", Factory: "Factory", Port: "Port", MissileSilo: "Missile Silo",
    SAMLauncher: "SAM", DefensePost: "Defense Post", AtomBomb: "Atom Bomb",
    HydrogenBomb: "Hydrogen Bomb",
  };
  ${consts}
  class B {
    ${fnSpacing}
    ${fnClassify}
    ${fnScorer}
  }
  return { B, UNIT, W: {
    UMBRELLA: SAFE_WEIGHT_SAM_UMBRELLA, THREAT: SAFE_WEIGHT_THREAT,
    TEAM: SAFE_WEIGHT_TEAM, SEP: SAFE_WEIGHT_SEPARATION,
    MAGNET: SAFE_WEIGHT_SAM_MAGNET, ALLY: UMBRELLA_TRUST_ALLY,
    SLOTS: UMBRELLA_RELEASE_SLOTS, FLOOR: UMBRELLA_FRONT_FLOOR,
  }, collectFriendlyUmbrellas };
`,
);

function closestTile(game, refs, tile) {
  let best = null,
    bestSq = Infinity;
  for (const r of refs) {
    const d = game.euclideanDistSquared(r, tile);
    if (d < bestSq) {
      bestSq = d;
      best = r;
    }
  }
  return [best, Math.sqrt(bestSq)];
}

const samRange = (lvl) => 150 - 480 / (lvl + 5);

// opts: { sams:[{x,y,level,owner,building?}], teamOf:{sid:team}, myTeam,
//         allies:[sid], threatFront:[tile], teamFront:[tile], ours:{type:[tile]},
//         settings:{} }
function make(opts) {
  const state = {
    settings: Object.assign({ safePlacement: true, samUmbrella: true }, opts.settings || {}),
  };
  const env = factory({ state, closestTile });
  const { B, UNIT } = env;
  const b = new B();
  const MY = 1;
  const teamOf = opts.teamOf || {};
  const myTeam = opts.myTeam === undefined ? null : opts.myTeam;
  const allies = new Set(opts.allies || []);

  const mkOwner = (sid) => ({
    smallID: () => sid,
    isPlayer: () => true,
    isAlive: () => true,
    team: () => (teamOf[sid] === undefined ? null : teamOf[sid]),
  });
  const others = (opts.otherSids || Object.keys(teamOf).map(Number))
    .filter((s) => s !== MY)
    .map(mkOwner);

  b.game = {
    ticks: () => 100,
    players: () => [mkOwner(MY), ...others],
    neighbors: (t) => [t + 1],
    hasOwner: () => true,
    isLand: () => true,
    ownerID: () => 99,
    euclideanDistSquared: (a, c) => {
      const dx = (a % W) - (c % W),
        dy = Math.floor(a / W) - Math.floor(c / W);
      return dx * dx + dy * dy;
    },
    units: (type) => {
      if (type !== UNIT.SAMLauncher) return [];
      return (opts.sams || []).map((s) => ({
        tile: () => T(s.x, s.y),
        level: () => s.level,
        owner: () => mkOwner(s.owner),
        isUnderConstruction: () => s.building === true,
      }));
    },
    config: () => ({
      samRange: samRange,
      maxSamRange: () => 150,
      nukeMagnitudes: (t) =>
        t === UNIT.HydrogenBomb ? { inner: 80, outer: 100 } : { inner: 12, outer: 30 },
    }),
  };
  b.player = {
    smallID: () => MY,
    team: () => myTeam,
    isFriendly: (o) => {
      const sid = o.smallID();
      if (myTeam !== null && teamOf[sid] === myTeam) return true;
      return allies.has(sid);
    },
    borderTiles: () => [...(opts.threatFront || []), ...(opts.teamFront || [])],
    units: (type) => ((opts.ours || {})[type] || []).map((t) => ({ tile: () => t })),
  };
  // borderTiles feeds the ONE border walk; classify by neighbor owner instead.
  const threat = new Set(opts.threatFront || []);
  const team = new Set(opts.teamFront || []);
  const teammateSid = Object.keys(teamOf)
    .map(Number)
    .find((s) => s !== MY && myTeam !== null && teamOf[s] === myTeam);
  b.game.ownerID = (n) => {
    const bt = n - 1; // neighbors(t) === [t + 1]
    if (threat.has(bt)) return 999; // an untrusted sid
    if (team.has(bt)) return teammateSid === undefined ? 999 : teammateSid;
    return 0;
  };
  if (!others.some((o) => o.smallID() === 999)) others.push(mkOwner(999));
  return { b, env, UNIT };
}

const t = suite("placement-umbrella");
const near = (a, x, tol = 1e-6) => Math.abs(a - x) <= tol;
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

t.section("weights as documented");
{
  const { env } = make({});
  check(
    "umbrella 90 > separation 60 (the user's priority inversion)",
    env.W.UMBRELLA === 90 && env.W.SEP === 60,
  );
  // The invariant that picks UMBRELLA_FRONT_FLOOR: on the front line the attenuated
  // bonus must lose to BOTH of the terms that argue for building elsewhere.
  check(
    "attenuated on-front bonus loses to threat (40) AND separation (60)",
    env.W.UMBRELLA * env.W.FLOOR < env.W.THREAT && env.W.UMBRELLA * env.W.FLOOR < env.W.SEP,
    (env.W.UMBRELLA * env.W.FLOOR).toFixed(1),
  );
  check("release threshold = 3 slots", env.W.SLOTS === 3);
}

t.section("collectFriendlyUmbrellas: who counts");
{
  const { b, env, UNIT } = make({
    myTeam: 7,
    teamOf: { 1: 7, 2: 7, 3: 3, 4: 3 }, // 2 = teammate, 3 = ally, 4 = enemy
    allies: [3],
    sams: [
      { x: 100, y: 100, level: 2, owner: 1 }, // ours
      { x: 110, y: 100, level: 3, owner: 2 }, // teammate
      { x: 120, y: 100, level: 4, owner: 3 }, // ally
      { x: 130, y: 100, level: 5, owner: 4 }, // enemy
      { x: 140, y: 100, level: 2, owner: 1, building: true }, // still going up
    ],
  });
  const ums = env.collectFriendlyUmbrellas(b.game, b.player, new Set([2]));
  const byTrust = ums.map((u) => u.trust).sort();
  check("kept 3 launchers (ours + teammate + ally)", ums.length === 3, ums.length);
  check(
    "trust: ours 1, teammate 1, ally 0.5",
    JSON.stringify(byTrust) === "[0.5,1,1]",
    JSON.stringify(byTrust),
  );
  check("enemy launcher excluded", !ums.some((u) => u.range === samRange(5)));
  check(
    "under-construction launcher excluded (it shoots nothing)",
    ums.filter((u) => u.trust === 1).length === 2,
  );
  check(
    "range comes from samRange(level): L3 = 90",
    ums.some((u) => near(u.range, 90)),
  );
}

t.section("coverage bonus grades by DEPTH, not containment");
{
  // One own level-3 SAM (range 90) at (200,200). No borders at all.
  const mk = () => make({ sams: [{ x: 200, y: 200, level: 3, owner: 1 }] });
  const { b } = mk();
  const f = b.safePlacementScorer("City");
  const at = (x, y) => f(T(x, y));
  check("dead centre (90 deep): full 90", near(at(200, 200), 90), at(200, 200));
  check("60 out (30 deep = atom-proof): still full 90", near(at(200, 260), 90), at(200, 260));
  check("75 out (15 deep): half credit 45", near(at(200, 275), 45), at(200, 275));
  check("89 out (1 deep): near zero", near(at(200, 289), 3), at(200, 289));
  // 100 out is OUTSIDE the range (90) and therefore INSIDE this same launcher's
  // hydrogen-bullseye ring (90, 100] — no umbrella credit, and the existing magnet
  // penalty instead. The two terms are the same geometry seen from opposite sides.
  check(
    "100 out: no umbrella, and the magnet penalty takes over",
    near(at(200, 300), -50 * (3 / 4)),
    at(200, 300),
  );
  check(
    "101 out: past the hydro ring too, so back to a clean zero",
    near(at(200, 301), 0),
    at(200, 301),
  );
  check(
    "depth gradient pushes INWARD (deeper always scores higher)",
    at(200, 200) > at(200, 275) && at(200, 275) > at(200, 289),
  );
}

t.section("ally umbrella: half bonus, never releases");
{
  const { b } = make({
    teamOf: { 1: null, 5: null },
    allies: [5],
    sams: [{ x: 200, y: 200, level: 3, owner: 5 }],
    ours: { City: [T(205, 200)] }, // a city 5 tiles away: pairing would score 5/60
  });
  const f = b.safePlacementScorer("City");
  const centre = f(T(200, 200));
  // 90 * 0.5 (ally trust) + separation 60 * (5/60), release must be 0.
  check(
    "ally cover = half bonus, pairing rule NOT released",
    near(centre, 90 * 0.5 + 60 * (5 / 60)),
    centre,
  );
}

t.section("the pairing rule is RELEASED under a trusted umbrella");
{
  // L3 own SAM => 3 slots => release 1 at atom-proof depth.
  const base = {
    sams: [{ x: 200, y: 200, level: 3, owner: 1 }],
    ours: { City: [T(205, 200)] }, // clumped: 5 tiles from the candidate
  };
  const { b } = make(base);
  const f = b.safePlacementScorer("City");
  const clumped = f(T(200, 200)); // 5 tiles from our city
  const spreadInside = f(T(200, 240)); // 40 tiles from it, still 50 deep
  check(
    "release 1: separation pays full credit regardless of pairing",
    near(clumped, 90 + 60) && near(spreadInside, 90 + 60),
    clumped + " vs " + spreadInside,
  );
  check(
    "inside the umbrella the spread term stops discriminating (a constant)",
    near(clumped, spreadInside),
  );

  // Same map, feature off => the old behaviour, which PUNISHED the clump.
  const { b: b2 } = make(Object.assign({}, base, { settings: { samUmbrella: false } }));
  const g = b2.safePlacementScorer("City");
  check(
    "toggle OFF: clumped tile is penalised again (old behaviour)",
    near(g(T(200, 200)), 60 * (5 / 60)) && g(T(200, 240)) > g(T(200, 200)),
    g(T(200, 200)) + " vs " + g(T(200, 240)),
  );
}

t.section("partial release below 3 slots");
{
  const { b } = make({
    sams: [{ x: 200, y: 200, level: 1, owner: 1 }], // range 70, 1 slot
    ours: { City: [T(205, 200)] },
  });
  const f = b.safePlacementScorer("City");
  const clumped = f(T(200, 200));
  // release = 1/3; separation = 60 * (1/3 + 2/3 * 5/60)
  check(
    "L1 SAM (1 slot): release 1/3, spread still discriminates",
    near(clumped, 90 + 60 * (1 / 3 + (2 / 3) * (5 / 60))),
    clumped,
  );
  const spread = f(T(200, 240));
  check(
    "  ... and a spread-out covered tile still edges out a clumped one",
    spread > clumped,
    (spread - clumped).toFixed(2),
  );
}
{
  const { b } = make({
    sams: [
      { x: 200, y: 200, level: 1, owner: 1 },
      { x: 210, y: 200, level: 2, owner: 1 },
    ],
    ours: { City: [T(205, 205)] },
  });
  const f = b.safePlacementScorer("City");
  const t = f(T(205, 200));
  // Overlapping umbrellas: slots add up (1 + 2 = 3) => full release.
  check("overlapping L1 + L2 = 3 slots: fully released", near(t, 90 + 60), t);
}

t.section("the user's headline requirement");
{
  // A: clumped but covered.  B: uncovered but perfectly spread.  Nothing else differs.
  const { b } = make({
    sams: [{ x: 200, y: 200, level: 3, owner: 1 }],
    ours: { City: [T(205, 200)] },
  });
  const f = b.safePlacementScorer("City");
  const covered = f(T(200, 200)); // 5 tiles from our city, fully covered
  const spreadOut = f(T(200, 340)); // 140 tiles away, no cover at all
  check(
    "covered+clumped BEATS uncovered+spread",
    covered > spreadOut,
    covered.toFixed(1) + " > " + spreadOut.toFixed(1),
  );

  const { b: b2 } = make({
    sams: [{ x: 200, y: 200, level: 3, owner: 1 }],
    ours: { City: [T(205, 200)] },
    settings: { samUmbrella: false },
  });
  const g = b2.safePlacementScorer("City");
  check(
    "  ... and BEFORE this change it lost, which is the bug",
    g(T(200, 200)) < g(T(200, 340)),
    g(T(200, 200)).toFixed(1) + " < " + g(T(200, 340)).toFixed(1),
  );
}

t.section("but it must not site buildings on the hostile front");
{
  // Threat front runs along y = 200, and the SAM sits right on it.
  const front = [];
  for (let x = 150; x <= 250; x += 5) front.push(T(x, 200));
  const { b } = make({
    otherSids: [999],
    sams: [{ x: 200, y: 200, level: 4, owner: 1 }], // range 96.7, covers deep both ways
    threatFront: front,
    ours: { City: [T(205, 205)] },
  });
  const f = b.safePlacementScorer("City");
  const onFront = f(T(200, 205)); // 5 from the front, ~92 deep in the umbrella
  const quietFar = f(T(200, 340)); // 140 from the front, no cover
  check(
    "deep-umbrella tile ON the front loses to a quiet uncovered tile",
    quietFar > onFront,
    onFront.toFixed(1) + " < " + quietFar.toFixed(1),
  );
  const coveredBack = f(T(200, 280)); // 80 from the front, still inside the umbrella
  check(
    "  ... while covered land BEHIND the front is the best of the three",
    coveredBack > quietFar && coveredBack > onFront,
    coveredBack.toFixed(1),
  );
}

t.section("existing terms unharmed");
{
  const front = [T(200, 200)];
  const { b } = make({ otherSids: [999], threatFront: front });
  const f = b.safePlacementScorer("City");
  // v1.70: the THREAT half still saturates at 40, but the depth term now keeps paying past
  // it, so the composite is threat + depth. Assert both halves rather than the old total.
  const d100 = f(T(200, 300)); // 100 tiles clear of the front
  const d200 = f(T(200, 400)); // 200 tiles clear
  check("on the front: still zero", near(f(T(200, 200)), 0));
  check(
    "threat saturated at 40, depth added on top",
    near(d100, 40 + 120 * (100 / 190)),
    d100.toFixed(2),
  );
  check(
    "past saturation the ONLY thing still growing is depth",
    near(d200 - d100, 120 * (200 / 290) - 120 * (100 / 190)),
    (d200 - d100).toFixed(2),
  );
}
{
  const { b } = make({ myTeam: 7, teamOf: { 1: 7, 2: 7 }, teamFront: [T(200, 200)] });
  const f = b.safePlacementScorer("City");
  check(
    "teammate-border term still pays 25 at the border, 0 far away",
    near(f(T(200, 200)), 25) && near(f(T(200, 300)), 0),
    f(T(200, 200)),
  );
}
{
  // A level-2 enemy SAM: magnet ring is (81.4, 100]. Inside its range is NOT a magnet.
  const { b } = make({
    teamOf: { 1: null, 4: null },
    sams: [{ x: 200, y: 200, level: 2, owner: 4 }],
  });
  const f = b.safePlacementScorer("City");
  const inRing = f(T(200, 290)); // 90 out: in the bullseye ring
  const insideRange = f(T(200, 250)); // 50 out: inside the SAM, no ring penalty
  check(
    "enemy SAM magnet ring still penalised (L2 ring = (81.4, 100])",
    near(inRing, -50 * (2 / 4)),
    inRing.toFixed(1),
  );
  check("  ... and its interior carries no ring penalty", near(insideRange, 0), insideRange);
  check("an ENEMY launcher grants us no umbrella bonus", insideRange <= 0);
}
{
  const { b } = make({}); // nothing at all
  const f = b.safePlacementScorer("City");
  check("no borders, no umbrellas, no magnets, no structures: returns ZERO", f(T(1, 1)) === 0);
}
{
  // FIX surfaced by this harness: a fresh spawn (no structures, no untrusted border yet)
  // used to get a ZERO scorer, which threw away the magnet term — the one term that needs
  // nothing of ours — and sited its first buildings inside a neighbour's bullseye.
  const { b } = make({
    teamOf: { 1: null, 4: null },
    sams: [{ x: 200, y: 200, level: 3, owner: 4 }],
  });
  const f = b.safePlacementScorer("City");
  check(
    "fresh spawn still avoids a neighbour's bullseye ring",
    near(f(T(200, 295)), -50 * (3 / 4)),
    f(T(200, 295)),
  );
}
{
  const { b } = make({
    settings: { safePlacement: false },
    sams: [{ x: 200, y: 200, level: 3, owner: 1 }],
  });
  check(
    "safePlacement off disables the whole scorer",
    b.safePlacementScorer("City")(T(200, 200)) === 0,
  );
}
{
  // placingType=MissileSilo must still ignore our own SAMs as blast partners.
  const { b } = make({
    sams: [{ x: 200, y: 200, level: 3, owner: 1 }],
    ours: { SAM: [T(200, 200)] },
  });
  const silo = b.safePlacementScorer("Missile Silo")(T(200, 202));
  const city = b.safePlacementScorer("City")(T(200, 202));
  check(
    "silo siting still exempts our own SAM from the pairing list",
    near(silo, 90) && city > silo,
    silo + " vs " + city,
  );
}

t.section("wiring");
{
  const structs = src;
  const core = source("engine/ingame/auto-bot/core.js");
  const panel = source("engine/ingame/auto-bot/panel.js");
  check("setting default present", /^\s*samUmbrella: true,$/m.test(core));
  check("setting persisted", /^\s+"samUmbrella",$/m.test(core));
  check("panel toggle present", panel.includes('data-cfg="samUmbrella"'));
  check(
    "umbrella collected in the scorer",
    structs.includes("collectFriendlyUmbrellas(game, player, teammateSids)"),
  );
  check(
    "candidate injection covers City + Factory",
    structs.includes("(type === UNIT.City || type === UNIT.Factory)") &&
      structs.includes("injectUmbrella"),
  );
  check(
    "tilesNearFriendlySams promotes teammates to the own tier",
    structs.includes("if ((owner.smallID && owner.smallID() === mySid) || teammate) own.push(u);"),
  );
  check(
    "built bundle contains the feature",
    source("openfront-helper.user.js").includes("samUmbrella"),
  );
}

t.done();
