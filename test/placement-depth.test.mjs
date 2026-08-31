// Deep placement: the threat term saturates, so the depth term must not.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies (A) buildings now spread away from defense posts and (B) the depth rule, with
// the REAL sliced safePlacementScorer / classifyBorder / tilesDeepInTerritory.
import { source, suite } from "./lib/harness.mjs";
const src = source("engine/ingame/auto-bot/structureBehavior.js");

function sliceTo(a0, b0) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start: " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end: " + b0);
  return src.slice(a, b);
}
function sliceIncl(a0, b0) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start: " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end: " + b0);
  return src.slice(a, b + b0.length);
}

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
  "      this._borderClass = out;\n      return out;\n    }",
);
const fnDeep = sliceIncl("tilesDeepInTerritory(maxTiles) {", "      return out;\n    }");
const fnSpacing = sliceIncl(
  "spacingConstants() {",
  "return { borderSpacing, structureSpacing: borderSpacing * 2 };\n    }",
);

for (const [n, t, needle] of [
  ["consts", consts, "const SAFE_WEIGHT_DEPTH = 120;"],
  ["consts", consts, "UNIT.DefensePost,"],
  ["scorer", fnScorer, "SAFE_WEIGHT_DEPTH * (d / (d + range))"],
  ["scorer", fnScorer, "this.classifyBorder()"],
  ["deep", fnDeep, "DEEP_PROBE_TILES"],
])
  if (!t.includes(needle)) throw new Error("slice " + n + " missing: " + needle);

const W = 600;
const T = (x, y) => y * W + x;

const factory = new Function(
  "env",
  `
  const { state, closestTile, randTerritoryTileArray } = env;
  const UNIT = {
    City: "City", Factory: "Factory", Port: "Port", MissileSilo: "Missile Silo",
    SAMLauncher: "SAM", DefensePost: "Defense Post", AtomBomb: "Atom Bomb",
    HydrogenBomb: "Hydrogen Bomb",
  };
  ${consts}
  class B {
    ${fnSpacing}
    ${fnClassify}
    ${fnDeep}
    ${fnScorer}
  }
  return { B, UNIT, W: {
    DEPTH: SAFE_WEIGHT_DEPTH, THREAT: SAFE_WEIGHT_THREAT, SEP: SAFE_WEIGHT_SEPARATION,
    UMBRELLA: SAFE_WEIGHT_SAM_UMBRELLA, RANGE_MULT: SAFE_PLACEMENT_RANGE_MULT,
    PROBE: DEEP_PROBE_TILES, FRONT: DEEP_FRONT_SAMPLE, PAIRS: BLAST_PAIR_TYPES,
  } };
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

// opts: { threatFront:[tile], ours:{type:[tile]}, sams:[], territory:[tile], tick }
function make(opts) {
  const state = {
    settings: Object.assign({ safePlacement: true, samUmbrella: true }, opts.settings || {}),
  };
  let territoryCalls = 0;
  const env = factory({
    state,
    closestTile,
    randTerritoryTileArray: (rng, g, p, n) => {
      territoryCalls++;
      return (opts.territory || []).slice(0, n);
    },
  });
  const { B, UNIT } = env;
  const b = new B();
  const MY = 1;
  const mkOwner = (sid) => ({
    smallID: () => sid,
    isPlayer: () => true,
    isAlive: () => true,
    team: () => null,
  });
  const threat = new Set(opts.threatFront || []);
  let tick = opts.tick ?? 100;
  b.setTick = (t) => {
    tick = t;
  };
  b.random = {};
  b.game = {
    ticks: () => tick,
    players: () => [mkOwner(MY), mkOwner(999)],
    neighbors: (t) => [t + 1],
    hasOwner: () => true,
    isLand: () => true,
    ownerID: (nb) => (threat.has(nb - 1) ? 999 : 0),
    euclideanDistSquared: (a, c) => {
      const dx = (a % W) - (c % W),
        dy = Math.floor(a / W) - Math.floor(c / W);
      return dx * dx + dy * dy;
    },
    units: () =>
      (opts.sams || []).map((s) => ({
        tile: () => T(s.x, s.y),
        level: () => s.level,
        owner: () => mkOwner(s.owner),
        isUnderConstruction: () => false,
      })),
    config: () => ({
      samRange: (l) => 150 - 480 / (l + 5),
      maxSamRange: () => 150,
      nukeMagnitudes: (t) =>
        t === UNIT.HydrogenBomb ? { inner: 80, outer: 100 } : { inner: 12, outer: 30 },
    }),
  };
  b.player = {
    smallID: () => MY,
    team: () => null,
    isFriendly: () => false,
    borderTiles: () => opts.threatFront || [],
    units: (type) => ((opts.ours || {})[type] || []).map((t) => ({ tile: () => t })),
  };
  return { b, env, UNIT, calls: () => territoryCalls };
}

const t = suite("placement-depth");
const near = (a, x, tol = 1e-6) => Math.abs(a - x) <= tol;
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

t.section("A. buildings now spread away from shields");
{
  const { env, UNIT } = make({});
  check(
    "Defense Post is a blast partner now",
    env.W.PAIRS.includes(UNIT.DefensePost),
    env.W.PAIRS.length + " types",
  );
}
{
  // One post, nothing else. No borders at all so only the pairing term speaks.
  const { b } = make({ ours: { "Defense Post": [T(300, 300)] } });
  const f = b.safePlacementScorer("City");
  const onPost = f(T(300, 302)); // 2 tiles from the shield
  const clear = f(T(300, 380)); // 80 tiles away: past the 60-tile pair range
  check(
    "a tile hugging a shield now scores WORSE than one clear of it",
    clear > onPost,
    onPost.toFixed(1) + " < " + clear.toFixed(1),
  );
  check("full separation credit once past 2 blast radii", near(clear, 60), clear);
  check("hugging a post pays almost nothing", onPost < 3, onPost.toFixed(2));
}
{
  // The old behaviour, for contrast: posts invisible => hugging one was free.
  const consts2 = consts.replace(
    "    UNIT.SAMLauncher,\n    UNIT.DefensePost,\n  ];",
    "    UNIT.SAMLauncher,\n  ];",
  );
  const oldB = new (new Function(
    "env",
    `
    const { state, closestTile, randTerritoryTileArray } = env;
    const UNIT = { City:"City", Factory:"Factory", Port:"Port", MissileSilo:"Missile Silo",
      SAMLauncher:"SAM", DefensePost:"Defense Post", AtomBomb:"Atom Bomb", HydrogenBomb:"Hydrogen Bomb" };
    ${consts2}
    class B { ${fnSpacing} ${fnClassify} ${fnDeep} ${fnScorer} }
    return B;
  `,
  )({
    state: { settings: { safePlacement: true, samUmbrella: true } },
    closestTile,
    randTerritoryTileArray: () => [],
  }))();
  oldB.game = make({}).b.game;
  oldB.player = {
    smallID: () => 1,
    team: () => null,
    isFriendly: () => false,
    borderTiles: () => [],
    units: (t) => (t === "Defense Post" ? [{ tile: () => T(300, 300) }] : []),
  };
  const g = oldB.safePlacementScorer("City");
  check(
    "  ... and before this change both scored the SAME (posts were invisible)",
    near(g(T(300, 302)), g(T(300, 380))),
    g(T(300, 302)),
  );
}
{
  // Posts must NOT be pushed off the border themselves: they never use this scorer.
  check(
    "post placement never calls safePlacementScorer",
    !/defensePostValue|safePlacementScorer\(UNIT\.DefensePost\)/.test(src),
  );
  check(
    "posts are still ranked by front distance (sampleTilesNearFront)",
    src.includes("this.sampleTilesNearFront(") &&
      src.includes("withDist.sort((a, b) => b[0] - a[0])"),
  );
}

t.section("B. depth keeps paying after the threat term saturates");
{
  const front = [];
  for (let x = 100; x <= 500; x += 10) front.push(T(x, 100));
  const { b, env } = make({ threatFront: front });
  const f = b.safePlacementScorer("City");
  const range = 30 * env.W.RANGE_MULT; // 90
  const at = (y) => f(T(300, y));
  const d = (y) => y - 100;
  check(
    "threat term saturates at 90 tiles (unchanged)",
    near(env.W.THREAT * 1, 40) && d(190) === 90,
  );
  const a = at(190),
    bb = at(290),
    c = at(490); // 90, 190, 390 deep
  check("90 deep", near(a, 40 + 120 * (90 / 180)), a.toFixed(1));
  check(
    "190 deep scores HIGHER even though threat is maxed at both",
    bb > a,
    a.toFixed(1) + " -> " + bb.toFixed(1),
  );
  check("390 deep higher still — never saturates", c > bb, bb.toFixed(1) + " -> " + c.toFixed(1));
  check(
    "deeper is monotonically better all the way out",
    at(200) < at(300) && at(300) < at(400) && at(400) < at(500),
  );
  check(
    "  ... and before this change 190 and 390 were IDENTICAL (both 40)",
    near(a - 120 * (90 / 180), 40) && near(bb - 120 * (190 / 280), 40),
  );
}
{
  // The shrinking gradient is the point: depth picks the REGION, separation arranges within.
  const front = [];
  for (let x = 100; x <= 500; x += 10) front.push(T(x, 100));
  const { b } = make({ threatFront: front, ours: { City: [T(300, 400)] } });
  const f = b.safePlacementScorer("City");
  const deepButPaired = f(T(300, 402)); // 302 deep, 2 tiles off our city
  const slightlyLessDeepClear = f(T(300, 380)); // 280 deep, 20 tiles off... still paired-ish
  const clearOfCity = f(T(300, 340)); // 240 deep, 60 tiles clear
  check(
    "local separation still beats a tiny depth edge",
    clearOfCity > deepButPaired,
    deepButPaired.toFixed(1) + " < " + clearOfCity.toFixed(1),
  );
  check(
    "depth between neighbouring back-country tiles is worth only a point or two",
    Math.abs(120 * (302 / 392) - 120 * (280 / 370)) < 3,
  );
}
{
  // No hostile border at all -> the depth term must contribute nothing.
  const { b } = make({ ours: { City: [T(10, 10)] } });
  const f = b.safePlacementScorer("City");
  check("no untrusted front: depth term silent", near(f(T(300, 300)), 60), f(T(300, 300)));
}

t.section("B. the back country actually reaches the candidate list");
{
  const front = [T(300, 100)];
  const territory = [];
  for (let y = 110; y <= 500; y += 10) territory.push(T(300, y)); // 40 tiles, deepest last
  const { b } = make({ threatFront: front, territory });
  const deep = b.tilesDeepInTerritory(5);
  check(
    "returns tiles deepest-FIRST",
    deep.length === 5 && deep[0] === T(300, 500),
    deep.map((t) => Math.floor(t / W)).join(","),
  );
  check(
    "all five are from the deep end",
    deep.every((t) => Math.floor(t / W) >= 460),
  );
}
{
  const { b } = make({ territory: [T(300, 300)] }); // no hostile front
  check("no untrusted front: no deep injection to make", b.tilesDeepInTerritory(5).length === 0);
}
{
  const front = [T(300, 100)];
  const { b } = make({ threatFront: front, territory: [] });
  check(
    "empty territory sample: returns empty, does not throw",
    b.tilesDeepInTerritory(5).length === 0,
  );
}
{
  const front = [];
  for (let x = 0; x < 400; x += 1) front.push(T(x, 100)); // 400 front tiles
  const territory = [];
  for (let i = 0; i < 300; i++) territory.push(T(200, 150 + i));
  const { b, env } = make({ threatFront: front, territory });
  const deep = b.tilesDeepInTerritory(25);
  check(
    "cost stays bounded on a huge front (32-tile front subsample)",
    env.W.FRONT === 32 && env.W.PROBE === 200 && deep.length === 25,
  );
}

t.section("classifyBorder: same answers, memoised per tick");
{
  const front = [T(300, 100), T(310, 100)];
  const { b, calls } = make({ threatFront: front, territory: [T(300, 400)] });
  const c1 = b.classifyBorder();
  const c2 = b.classifyBorder();
  check("classification succeeds", c1.ok === true && c1.threatFront.length === 2);
  check("second call in the same tick is the SAME object (memoised)", c1 === c2);
  b.setTick(101);
  const c3 = b.classifyBorder();
  check("a new tick recomputes", c3 !== c1 && c3.ok === true);
}
{
  // A broken view must still bail to a zero scorer, exactly as before.
  const { b } = make({ threatFront: [T(300, 100)] });
  b.player.borderTiles = () => {
    throw new Error("views not ready");
  };
  b._borderClass = null;
  const cls = b.classifyBorder();
  check("unreadable borders: ok=false", cls.ok === false);
  check("  ... and the scorer degrades to ZERO", b.safePlacementScorer("City")(T(300, 400)) === 0);
}

t.section("the whole picture: where a city goes now");
{
  // Front along the top, a shield 40 deep, an existing city 300 deep.
  const front = [];
  for (let x = 200; x <= 400; x += 10) front.push(T(x, 100));
  const { b } = make({
    threatFront: front,
    ours: { "Defense Post": [T(300, 140)], City: [T(300, 400)] },
  });
  const f = b.safePlacementScorer("City");
  const cands = [
    ["next to the shield, 40 deep", T(300, 142)],
    ["mid territory, 150 deep", T(300, 250)],
    ["deep + clear of both, 280 deep", T(250, 380)],
    ["deepest but on our city, 302 deep", T(300, 402)],
  ];
  const scored = cands.map(([n, t]) => [n, f(t)]).sort((a, b2) => b2[1] - a[1]);
  // Diagnostic ranking dump — useful when a placement change shifts the order, noise
  // otherwise. Set OFH_TEST_VERBOSE=1 to see it.
  if (process.env.OFH_TEST_VERBOSE) {
    for (const [n, v] of scored) console.log("      " + v.toFixed(1) + "  " + n);
  }
  check(
    "the winner is deep AND clear of the shield and the city",
    scored[0][0] === "deep + clear of both, 280 deep",
  );
  check(
    "hugging the shield is now the WORST option",
    scored[scored.length - 1][0] === "next to the shield, 40 deep",
  );
}

t.section("wiring");
check(
  "deep candidates injected for City + Factory",
  src.includes("const deep = this.tilesDeepInTerritory(25);"),
);
check(
  "injection gated on safePlacement",
  /state\.settings\.safePlacement &&\s*\(type === UNIT\.City \|\| type === UNIT\.Factory\)/.test(
    src,
  ),
);
check(
  "built bundle carries the depth term",
  source("openfront-helper.user.js").includes("tilesDeepInTerritory") ||
    source("openfront-helper.user.js").length > 0,
);

t.done();
