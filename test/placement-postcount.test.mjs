// Defense-post depth-credit counting near the attack front.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies the per-post depth credit in countDefensePostsNearFront (the depthPlan
// staleness fix) with the REAL sliced method.
import { source, suite } from "./lib/harness.mjs";
const src = source("engine/ingame/auto-bot/structureBehavior.js");

function cut(a0, b0, label) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start " + label);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end " + label);
  return src.slice(a, b + b0.length);
}
const fnCount = cut(
  "countDefensePostsNearFront(frontTiles, cap, maxDepth) {",
  "      return count;\n    }",
  "count",
);
const fnSpacing = cut(
  "spacingConstants() {",
  "return { borderSpacing, structureSpacing: borderSpacing * 2 };\n    }",
  "spacing",
);

const W = 800;
const T = (x, y) => y * W + x;

function make(opts) {
  const B = new Function(
    "env",
    `
    const UNIT = { DefensePost: "Defense Post", AtomBomb: "Atom Bomb" };
    const DP_MAX_DEPTH_SPACINGS = 4;
    class B { ${fnSpacing} ${fnCount} }
    return B;
  `,
  )({});
  const b = new B();
  b.game = {
    euclideanDistSquared: (a, c) => {
      const dx = (a % W) - (c % W),
        dy = Math.floor(a / W) - Math.floor(c / W);
      return dx * dx + dy * dy;
    },
    config: () => ({ nukeMagnitudes: () => ({ inner: 12, outer: 30 }) }),
  };
  b.player = {
    units: () => (opts.posts || []).map((t) => ({ tile: () => t })),
    borderTiles: () => opts.border || [],
  };
  return b;
}

const t = suite("placement-postcount");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

// Geometry: a straight front along y=200 (also the full border unless stated).
const front = [];
for (let x = 100; x <= 700; x += 2) front.push(T(x, 200));

t.section("baseline behaviour unchanged");
{
  const b = make({ posts: [T(400, 230)], border: front });
  check(
    "post 30 deep counts with no plan (inside base 45)",
    b.countDefensePostsNearFront(front, undefined, undefined) === 1,
  );
}
{
  const b = make({ posts: [T(400, 300)], border: front }); // 100 deep
  check(
    "plan pass still counts a deep post via maxDepth",
    b.countDefensePostsNearFront(front, undefined, 106) === 1,
  );
}

t.section("the staleness bug: deep post, plan GONE");
{
  // Post sited 106 deep during a fast attack; this pass carries NO plan. The front is
  // its nearest border, so it must still count — before the fix it went invisible and
  // the bot re-bought its quota.
  const b = make({ posts: [T(400, 306)], border: front });
  check(
    "106-deep post STILL counts on a plan-less pass",
    b.countDefensePostsNearFront(front, undefined, undefined) === 1,
  );
}
{
  // Same depth but the territory is a narrow strip: a rear border runs at y=320, only
  // 14 tiles behind the post. Its nearest border is the REAR, not this front, so this
  // front gets no credit for it (it could never have been sited 106 deep here).
  const rear = [];
  for (let x = 100; x <= 700; x += 2) rear.push(T(x, 320));
  const b = make({ posts: [T(400, 306)], border: front.concat(rear) });
  check(
    "post whose nearest border is elsewhere does NOT count",
    b.countDefensePostsNearFront(front, undefined, undefined) === 0,
  );
}
{
  // A post on a completely different border 200+ tiles away: the degenerate
  // max-over-posts form would have counted this. Ours must not.
  const other = [];
  for (let y = 100; y <= 500; y += 2) other.push(T(60, y));
  const b = make({ posts: [T(90, 300)], border: front.concat(other) });
  check(
    "unrelated border's post never satisfies this front's quota",
    b.countDefensePostsNearFront(front, undefined, undefined) === 0,
  );
}
{
  // Beyond the plan ceiling (4 spacings + slack = 143): not credited even if this front
  // is technically its nearest border.
  const b = make({ posts: [T(400, 360)], border: front }); // 160 deep
  check(
    "past maxCredit: not counted",
    b.countDefensePostsNearFront(front, undefined, undefined) === 0,
  );
}

t.section("the slack band");
{
  // Post 60 deep behind this front, front is nearest border: depth credit needs
  // distToFront <= depth + 23, which holds with equality-ish (dist == depth). Counts.
  const b = make({ posts: [T(400, 260)], border: front });
  check(
    "60-deep post counts (dist == its own depth)",
    b.countDefensePostsNearFront(front, undefined, undefined) === 1,
  );
}
{
  // Rear border 30 closer than the front (depth 76 vs dist 106): outside the 23 slack,
  // so no credit.
  const rear = [];
  for (let x = 100; x <= 700; x += 2) rear.push(T(x, 382));
  const b = make({ posts: [T(400, 306)], border: front.concat(rear) });
  check(
    "nearest-border 30 tiles closer than the front: no credit (slack is 23)",
    b.countDefensePostsNearFront(front, undefined, undefined) === 0,
  );
}

t.section("cap + mixed sets");
{
  const posts = [T(200, 225), T(400, 306), T(600, 230), T(60, 300)];
  const other = [];
  for (let y = 100; y <= 500; y += 2) other.push(T(30, y));
  const b = make({ posts, border: front.concat(other) });
  check(
    "mixed: two shallow + one deep count, the foreign one does not",
    b.countDefensePostsNearFront(front, undefined, undefined) === 3,
  );
  check("cap still short-circuits", b.countDefensePostsNearFront(front, 2, undefined) === 2);
}
{
  const b = make({ posts: [], border: front });
  check("no posts: zero", b.countDefensePostsNearFront(front, undefined, undefined) === 0);
  check("no front: zero", b.countDefensePostsNearFront([], undefined, undefined) === 0);
}

t.done();
