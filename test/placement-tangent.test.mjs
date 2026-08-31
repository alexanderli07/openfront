// Shield spacing: 2r=60 is the EXACT no-shared-blast threshold for one atom.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies tangent shield spacing with the REAL sliced sampleTilesNearFront +
// dpTangentSeparation, including the game's own strict-less-than blast test.
import { source, suite } from "./lib/harness.mjs";
const src = source("engine/ingame/auto-bot/structureBehavior.js");

function cut(a0, b0, label) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start " + label);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end " + label);
  return src.slice(a, b + b0.length);
}
const fnSample = cut(
  "sampleTilesNearFront(frontTiles, count, _unitType, depthPlan) {",
  "      return fallback;\n    }",
  "sampler",
);
const fnTangent = cut("dpTangentSeparation() {", "return 2 * Math.max(1, r);\n    }", "tangent");
const fnSpacing = cut(
  "spacingConstants() {",
  "return { borderSpacing, structureSpacing: borderSpacing * 2 };\n    }",
  "spacing",
);
const tiers = cut("const DP_SPACING_TIERS", "];", "tiers");

for (const [n, t, needle] of [
  ["sampler", fnSample, "if (!farEnough(t, sepSq)) continue;"],
  ["sampler", fnSample, "DP_SPACING_TIERS"],
  ["sampler", fnSample, "this.random.randElement(frontTiles)"],
])
  if (!t.includes(needle)) throw new Error("slice " + n + " missing " + needle);

const W = 800;
const T = (x, y) => y * W + x;
const dist = (a, b) => {
  const dx = (a % W) - (b % W),
    dy = Math.floor(a / W) - Math.floor(b / W);
  return Math.sqrt(dx * dx + dy * dy);
};

const ATOM_OUTER = 30,
  POST_AURA = 30;

// Depth exactly as sampleTilesNearFront measures it: euclidean distance to the nearest
// border tile. NOT the vertical offset — they differ for a tile past the border's extent.
const depthOf = (t, border) => {
  let best = Infinity;
  for (const b of border) {
    const d = dist(t, b);
    if (d < best) best = d;
  }
  return best;
};

// The game's own rule, verbatim from NukeExecution: a unit dies only on
// euclideanDistSquared(dst, unit) < outer*outer — STRICTLY less than.
function oneAtomKillsBoth(a, b) {
  // Sweep every integer tile that could reach either post.
  const ax = a % W,
    ay = Math.floor(a / W),
    bx = b % W,
    by = Math.floor(b / W);
  for (let x = Math.min(ax, bx) - ATOM_OUTER; x <= Math.max(ax, bx) + ATOM_OUTER; x++) {
    for (let y = Math.min(ay, by) - ATOM_OUTER; y <= Math.max(ay, by) + ATOM_OUTER; y++) {
      const da = (x - ax) ** 2 + (y - ay) ** 2;
      const db = (x - bx) ** 2 + (y - by) ** 2;
      if (da < ATOM_OUTER ** 2 && db < ATOM_OUTER ** 2) return true;
    }
  }
  return false;
}

function makeBot(opts) {
  const logs = [];
  const Cls = new Function(
    "env",
    `
    const { closestTile, ofhDebug } = env;
    const UNIT = { DefensePost: "Defense Post", AtomBomb: "Atom Bomb" };
    ${tiers}
    class B {
      ${fnSpacing}
      ${fnTangent}
      ${fnSample}
    }
    return B;
  `,
  )({
    closestTile: (game, refs, tile) => {
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
    },
    ofhDebug: (m) => logs.push(m),
  });
  const b = new Cls();
  let seed = opts.seed ?? 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  b.random = {
    randElement: (a) => a[Math.floor(rnd() * a.length) % a.length],
    nextInt: (lo, hi) => lo + Math.floor(rnd() * (hi - lo)),
  };
  b.game = {
    x: (t) => t % W,
    y: (t) => Math.floor(t / W),
    ref: (x, y) => T(x, y),
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < 600,
    ownerID: (t) => (opts.ownedPredicate ? (opts.ownedPredicate(t) ? 1 : 2) : 1),
    euclideanDistSquared: (a, c) => {
      const dx = (a % W) - (c % W),
        dy = Math.floor(a / W) - Math.floor(c / W);
      return dx * dx + dy * dy;
    },
    config: () => ({
      nukeMagnitudes: () => ({ inner: 12, outer: ATOM_OUTER }),
      defensePostRange: () => (opts.aura === undefined ? POST_AURA : opts.aura),
    }),
  };
  b.player = {
    smallID: () => 1,
    borderTiles: () => opts.border,
    units: () => (opts.posts || []).map((t) => ({ tile: () => t })),
  };
  return { b, logs };
}

const t = suite("placement-tangent");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

t.section("the threshold really is tangency (game's own strict-< rule)");
{
  const a = T(400, 300);
  check("58 apart: one atom kills both", oneAtomKillsBoth(a, T(458, 300)));
  // 59 axial actually survives, and the reason matters: an ODD axial gap has no lattice
  // point at its midpoint, so the closest tile is 30 from one of them and the strict < fails.
  check(
    "59 apart axially: survives on the integer grid (no lattice midpoint)",
    !oneAtomKillsBoth(a, T(459, 300)),
  );
  check("58 apart is the last lethal axial gap", oneAtomKillsBoth(a, T(458, 300)));
  check("60 apart (TANGENT): both survive any single atom", !oneAtomKillsBoth(a, T(460, 300)));
  check("61 apart: both survive", !oneAtomKillsBoth(a, T(461, 300)));
  // diagonals are where a manhattan-ish rule would leak
  check("42,42 diagonal (59.4 true) still dies", oneAtomKillsBoth(a, T(442, 342)));
  check("43,43 diagonal (60.8 true) survives", !oneAtomKillsBoth(a, T(443, 343)));
  check("the old 45-tile rule sat well INSIDE one blast", oneAtomKillsBoth(a, T(445, 300)));
  // The invariant the code actually leans on: dsq >= 3600 is safe for EVERY offset, because
  // the only offsets whose midpoint IS a lattice point are the even ones, and there the
  // midpoint sits at exactly D/2 = 30. Sweep every offset out to 62 to prove it.
  {
    let firstAlwaysSafe = null;
    for (let d = 40; d <= 62 && firstAlwaysSafe === null; d++) {
      let anyLethal = false;
      for (let dx = 0; dx <= d && !anyLethal; dx++) {
        const dy = Math.round(Math.sqrt(Math.max(0, d * d - dx * dx)));
        if (dx * dx + dy * dy < d * d) continue; // keep offsets at >= d
        if (oneAtomKillsBoth(a, T(400 + dx, 300 + dy))) anyLethal = true;
      }
      if (!anyLethal) firstAlwaysSafe = d;
    }
    check(
      "60 is the first separation safe for every offset direction",
      firstAlwaysSafe === 60,
      firstAlwaysSafe,
    );
  }
}

t.section("dpTangentSeparation reads it from the config");
{
  const { b } = makeBot({ border: [T(400, 300)] });
  check("2 x 30 = 60", b.dpTangentSeparation() === 60, b.dpTangentSeparation());
}
{
  const { b } = makeBot({ border: [T(400, 300)], aura: 45 }); // rebalanced aura > atom
  check(
    "takes the max of the two radii (aura 45 -> 90)",
    b.dpTangentSeparation() === 90,
    b.dpTangentSeparation(),
  );
}
{
  const { b } = makeBot({ border: [T(400, 300)], aura: 0 }); // config unreadable-ish
  check(
    "falls back to the atom radius when the aura is missing",
    b.dpTangentSeparation() === 60,
    b.dpTangentSeparation(),
  );
}

t.section("every sited post clears its neighbours by a full tangent");
{
  // A long straight border along y = 200; we own everything below it.
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const posts = [T(300, 225)];
  const { b } = makeBot({ border, posts, ownedPredicate: (t) => Math.floor(t / W) > 200 });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", null);
  check("found candidates", tiles.length > 0, tiles.length);
  const bad = tiles.filter((t) => dist(t, posts[0]) < 60);
  check(
    "NONE is within a tangent of the existing post",
    bad.length === 0,
    bad.length + " violations of " + tiles.length,
  );
  const pairable = tiles.filter((t) => oneAtomKillsBoth(t, posts[0]));
  check("  ... and by the game's own blast rule, none pairs with it", pairable.length === 0);
}
{
  // Two existing posts: candidates must clear BOTH.
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const posts = [T(300, 225), T(400, 230)];
  const { b } = makeBot({
    border,
    posts,
    ownedPredicate: (t) => Math.floor(t / W) > 200,
    seed: 777,
  });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", null);
  check("found candidates with two posts down", tiles.length > 0, tiles.length);
  check(
    "all clear BOTH posts",
    tiles.every((t) => dist(t, posts[0]) >= 60 && dist(t, posts[1]) >= 60),
  );
}
{
  // BEFORE: the old rule only filtered the ANCHOR. Reproduce it and show the hole.
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const posts = [T(300, 225)];
  const oldSample = fnSample
    .replace("if (!farEnough(t, sepSq)) continue;", "")
    .replace("const tangentSep = this.dpTangentSeparation();", "const tangentSep = 45;");
  const Cls = new Function(
    "env",
    `
    const { closestTile, ofhDebug } = env;
    const UNIT = { DefensePost: "Defense Post", AtomBomb: "Atom Bomb" };
    ${tiers}
    class B { ${fnSpacing} ${fnTangent} ${oldSample} }
    return B;
  `,
  )({
    closestTile: (game, refs, tile) => {
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
    },
    ofhDebug: () => {},
  });
  const ob = new Cls();
  const proto = makeBot({ border, posts, ownedPredicate: (t) => Math.floor(t / W) > 200 });
  ob.random = proto.b.random;
  ob.game = proto.b.game;
  ob.player = proto.b.player;
  const oldTiles = ob.sampleTilesNearFront(border, 25, "Defense Post", null);
  const oldBad = oldTiles.filter((t) => oneAtomKillsBoth(t, posts[0]));
  check(
    "anchor-only filtering DID leak sites into the neighbour's blast",
    oldBad.length > 0,
    oldBad.length + " of " + oldTiles.length + " would pair",
  );
}

t.section("it relaxes instead of refusing to defend");
{
  // A tiny pocket of land with a post already in it: tangency is impossible.
  const border = [];
  for (let x = 300; x <= 340; x++) border.push(T(x, 200));
  const posts = [T(320, 225)];
  const { b, logs } = makeBot({
    border,
    posts,
    ownedPredicate: (t) => {
      const x = t % W,
        y = Math.floor(t / W);
      return x >= 300 && x <= 340 && y > 200 && y < 250;
    },
  });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", null);
  check("still returns somewhere to build", tiles.length > 0, tiles.length);
  check(
    "and says out loud that it relaxed",
    logs.some((l) => l.includes("tangent spacing") && l.includes("relaxed to")),
    logs[0] ? logs[0].slice(0, 78) : "(no log)",
  );
}
{
  // No existing posts at all => no constraint to apply, no relaxation logged.
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const { b, logs } = makeBot({
    border,
    posts: [],
    ownedPredicate: (t) => Math.floor(t / W) > 200,
  });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", null);
  check(
    "first post: unconstrained, nothing logged",
    tiles.length > 0 && logs.length === 0,
    tiles.length,
  );
}

t.section("the depth band and ownership rules are untouched");
{
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const { b } = makeBot({ border, posts: [], ownedPredicate: (t) => Math.floor(t / W) > 200 });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", null);
  const depths = tiles.map((t) => depthOf(t, border));
  check(
    "every site inside src's default [22, 45] depth band",
    depths.every((d) => d >= 22 && d <= 45),
    depths
      .slice(0, 6)
      .map((d) => d.toFixed(0))
      .join(","),
  );
  check(
    "every site on OUR land",
    tiles.every((t) => Math.floor(t / W) > 200),
  );
}
{
  const border = [];
  for (let x = 100; x <= 700; x++) border.push(T(x, 200));
  const { b } = makeBot({ border, posts: [], ownedPredicate: (t) => Math.floor(t / W) > 200 });
  const tiles = b.sampleTilesNearFront(border, 25, "Defense Post", { min: 90, max: 112 });
  const depths = tiles.map((t) => depthOf(t, border));
  check(
    "a v1.64 deep plan is still honoured",
    depths.every((d) => d >= 90 && d <= 112),
    depths
      .slice(0, 6)
      .map((d) => d.toFixed(0))
      .join(","),
  );
}

t.section("coverage check: tangent posts tile a long border");
{
  // With centres 2r apart the auras meet at exactly one tile — no overlap, no gap
  // on the line through both centres.
  const a = T(400, 300),
    c = T(460, 300);
  const midOnlyBoth = [];
  for (let x = 400; x <= 460; x++) {
    const inA = dist(T(x, 300), a) <= POST_AURA;
    const inC = dist(T(x, 300), c) <= POST_AURA;
    if (inA && inC) midOnlyBoth.push(x);
  }
  check(
    "auras meet at exactly ONE tile between the centres",
    midOnlyBoth.length === 1 && midOnlyBoth[0] === 430,
    midOnlyBoth.join(","),
  );
  const gap = [];
  for (let x = 400; x <= 460; x++) {
    if (dist(T(x, 300), a) > POST_AURA && dist(T(x, 300), c) > POST_AURA) gap.push(x);
  }
  check("  ... and no tile between them is left uncovered", gap.length === 0, gap.length);
}

t.done();
