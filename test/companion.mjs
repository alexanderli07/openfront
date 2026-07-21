// Node unit tests for the Companion Bot's pure helpers.
//
// engine/ files are classic scripts sharing one lexical scope with NO load-time
// side effects (see the Global Constraints in the plan). That lets us concatenate
// the files we want, evaluate them inside a Function body, and return the
// top-level declarations under test. Anything that touches the live game is not
// tested here — it is covered by the in-browser checklist.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const store = new Map();
const fakeLocalStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const fakeWindow = { localStorage: fakeLocalStorage, dispatchEvent() {}, addEventListener() {} };

/**
 * Concatenate engine files and return the named top-level declarations.
 * @param {string[]} files repo-relative paths
 * @param {string[]} names top-level names to return
 */
function loadCompanion(files, names) {
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const factory = new Function(
    "window",
    "localStorage",
    "document",
    `${src}\nreturn { ${names.join(", ")} };`,
  );
  return factory(fakeWindow, fakeLocalStorage, { getElementById: () => null });
}

const CORE = ["engine/ingame/companion/core.js"];

// ---- companionTileToXY / companionTileFromXY --------------------------------
{
  const { companionTileToXY, companionTileFromXY } = loadCompanion(CORE, [
    "companionTileToXY",
    "companionTileFromXY",
  ]);

  assert.deepEqual(companionTileToXY(0, 200), { x: 0, y: 0 }, "tile 0 → origin");
  assert.deepEqual(companionTileToXY(199, 200), { x: 199, y: 0 }, "last tile of row 0");
  assert.deepEqual(companionTileToXY(200, 200), { x: 0, y: 1 }, "first tile of row 1");
  assert.deepEqual(companionTileToXY(4523, 200), { x: 123, y: 22 }, "arbitrary tile");

  // The multitab original split the DIGITS of the tile id in half, which is only
  // ever right by accident. Guard the correct arithmetic against regressions.
  assert.deepEqual(companionTileToXY(4523, 137), { x: 4523 % 137, y: Math.floor(4523 / 137) },
    "non-round map width");

  assert.equal(companionTileFromXY(123, 22, 200), 4523, "round-trip back to ref");
  for (const ref of [0, 1, 199, 200, 4523, 39999]) {
    const p = companionTileToXY(ref, 200);
    assert.equal(companionTileFromXY(p.x, p.y, 200), ref, `round-trip ref ${ref}`);
  }
}

// ---- companionPercentAmount -------------------------------------------------
{
  const { companionPercentAmount } = loadCompanion(CORE, ["companionPercentAmount"]);

  assert.equal(companionPercentAmount(1000, 40), 400, "plain number");
  assert.equal(companionPercentAmount(1000n, 40), 400, "bigint input returns a Number");
  assert.equal(typeof companionPercentAmount(1000n, 40), "number", "never returns bigint");
  assert.equal(companionPercentAmount(1000, 100), 1000, "100%");
  assert.equal(companionPercentAmount(0, 50), 0, "zero value → 0");
  assert.equal(companionPercentAmount(-5, 50), 0, "negative value → 0");
  assert.equal(companionPercentAmount(10, 0), 1, "pct clamps up to 1, floor min 1");
  assert.equal(companionPercentAmount(10, 500), 10, "pct clamps down to 100");
  assert.equal(companionPercentAmount(3, 10), 1, "floor never drops below 1 for positive value");
  assert.equal(companionPercentAmount(Number.NaN, 50), 0, "NaN → 0");
  // 2^53 territory: gold can exceed Number.MAX_SAFE_INTEGER in long games.
  assert.equal(companionPercentAmount(10n ** 18n, 50), Number(10n ** 18n / 2n),
    "huge bigint stays finite");
}

// ---- companionRingOffsets ---------------------------------------------------
{
  const { companionRingOffsets } = loadCompanion(CORE, ["companionRingOffsets"]);

  const ring = companionRingOffsets(12, 24);
  assert.ok(ring.length > 0, "ring is non-empty");
  for (const o of ring) {
    const d = Math.hypot(o.dx, o.dy);
    assert.ok(d >= 12 - 1e-9 && d <= 24 + 1e-9, `offset (${o.dx},${o.dy}) inside the annulus`);
  }
  // Sorted nearest-first so callers can take the first valid tile and stay close.
  for (let i = 1; i < ring.length; i++) {
    const a = Math.hypot(ring[i - 1].dx, ring[i - 1].dy);
    const b = Math.hypot(ring[i].dx, ring[i].dy);
    assert.ok(a <= b + 1e-9, "offsets sorted by distance ascending");
  }
  assert.deepEqual(companionRingOffsets(24, 12), [], "inverted bounds → empty");
}

console.log("COMPANION OK — pure helpers behave");
