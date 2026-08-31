// The stubs are only worth anything if they match the REAL api. This test derives both
// surfaces from gameApi.js itself and fails when they drift, so lib/stubs.mjs cannot
// quietly become a snapshot of an api that has moved on.
//
// It also pins the UnitType strings against the upstream enum. That check exists because
// `TradeShip: "Trade"` (upstream says "Trade Ship") silently killed three features for
// months: GameView.units() filters with types.includes(u.type()), so a wrong string
// returns an EMPTY ARRAY instead of throwing. A wrong method name at least crashes; a
// wrong enum string is invisible.

import { source, cut, suite } from "./lib/harness.mjs";
import {
  API_SURFACE,
  UNIT_SURFACE,
  ATTACK_SURFACE,
  strictSurface,
  makeGame,
  makeUnit,
  makeBareConfig,
} from "./lib/stubs.mjs";

const t = suite("gameapi-surface");
const GA = source("engine/ingame/auto-bot/gameApi.js");
const CORE = source("engine/ingame/auto-bot/core.js");

t.section("the stub surfaces match gameApi.js");
{
  // `api` object literal keys, at its own indent level.
  const apiBlock = cut(GA, "const api = {", "\n    };", "api");
  const realApi = [...apiBlock.matchAll(/^ {6}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
  const missing = realApi.filter((k) => !API_SURFACE.includes(k));
  const extra = API_SURFACE.filter((k) => !realApi.includes(k));
  t.check("found the api literal", realApi.length > 30, realApi.length + " keys");
  t.check("no api key is missing from API_SURFACE", missing.length === 0, missing.join(","));
  t.check("API_SURFACE invents nothing", extra.length === 0, extra.join(","));

  const unitBlock = cut(GA, "function wrapUnit(u) {", "\n    }", "wrapUnit");
  const realUnit = [...unitBlock.matchAll(/^ {8}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]);
  const uMissing = realUnit.filter((k) => !UNIT_SURFACE.includes(k));
  const uExtra = UNIT_SURFACE.filter((k) => !realUnit.includes(k));
  t.check("found wrapUnit", realUnit.length > 10, realUnit.length + " methods");
  t.check("no unit method is missing from UNIT_SURFACE", uMissing.length === 0, uMissing.join(","));
  t.check("UNIT_SURFACE invents nothing", uExtra.length === 0, uExtra.join(","));

  const atkBlock = cut(GA, "function wrapAttack(a) {", "\n    }", "wrapAttack");
  const realAtk = [...atkBlock.matchAll(/^ {8}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]);
  t.check(
    "no attack method is missing from ATTACK_SURFACE",
    realAtk.filter((k) => !ATTACK_SURFACE.includes(k)).length === 0,
    realAtk.filter((k) => !ATTACK_SURFACE.includes(k)).join(","),
  );
}

t.section("the api really does NOT have the methods that crashed us");
{
  t.check("gameApi exposes neighbors", /neighbors:\s*mapM\("neighbors"\)/.test(GA));
  t.check("gameApi has no forEachNeighbor", !/forEachNeighbor\s*:/.test(GA));
  t.check("wrapUnit has no isFriendly", !UNIT_SURFACE.includes("isFriendly"));
  t.check("...but a PLAYER has one", /isFriendly:/.test(GA));
  t.check(
    "wrapUnit has no maxHealth (hence the guarded reads in warshipBehavior)",
    !UNIT_SURFACE.includes("maxHealth"),
  );
  t.check(
    "wrapUnit has no veterancy (it arrives via warshipState)",
    !UNIT_SURFACE.includes("veterancy") && UNIT_SURFACE.includes("warshipState"),
  );
}

t.section("the strict stubs fail loudly, by name");
{
  const game = makeGame();
  t.check("an on-surface call works", typeof game.neighbors(100) === "object");
  t.throws(
    "game.forEachNeighbor throws",
    () => game.forEachNeighbor(1, () => {}),
    /forEachNeighbor/,
  );
  t.throws("game.borderTiles throws", () => game.borderTiles(), /borderTiles/);
  const unit = makeUnit({ tile: 5, health: 900 });
  t.check("an on-surface unit call works", unit.health() === 900);
  t.throws("unit.isFriendly throws", () => unit.isFriendly({}), /isFriendly/);
  t.throws("unit.veterancy throws", () => unit.veterancy(), /veterancy/);
  t.check("spreading a stub does not explode", { ...{ a: 1 } }.a === 1);
}

t.section("the config Proxy shape that produced the nuke crash");
{
  // gameApi's config proxy get() returns t[prop] unchanged, so a missing method is
  // undefined and calling it is a TypeError. Reproduce that exactly.
  const bare = makeBareConfig({ nukeSpeed: (x) => (x === "MIRV" ? 15 : 10) });
  t.check("a present method works", bare.nukeSpeed("MIRV") === 15);
  t.throws("a MISSING method throws when called", () => bare.defaultNukeSpeed(), /not a function/);
}

t.section("UnitType strings match the upstream enum");
{
  // Verbatim from the game's src/core/game/Game.ts.
  const UPSTREAM_ENUM = {
    City: "City",
    Port: "Port",
    Factory: "Factory",
    SAMLauncher: "SAM Launcher",
    MissileSilo: "Missile Silo",
    DefensePost: "Defense Post",
    TransportShip: "Transport",
    TradeShip: "Trade Ship",
    Warship: "Warship",
    AtomBomb: "Atom Bomb",
    HydrogenBomb: "Hydrogen Bomb",
    MIRV: "MIRV",
    MIRVWarhead: "MIRV Warhead",
  };
  const block = cut(CORE, "const UNIT = {", "};", "unit");
  const got = {};
  for (const m of block.matchAll(/^\s*([A-Za-z]+):\s*"([^"]+)",/gm)) got[m[1]] = m[2];
  const wrong = Object.keys(UPSTREAM_ENUM).filter((k) => got[k] !== UPSTREAM_ENUM[k]);
  t.check(
    "every UNIT string matches upstream",
    wrong.length === 0,
    wrong.map((k) => `${k}=${got[k]}`).join(","),
  );
  t.check("TradeShip specifically is 'Trade Ship'", got.TradeShip === "Trade Ship", got.TradeShip);

  // Demonstrate WHY this is a test and not a code review note: the failure is silent.
  const units = (type) => (type === "Trade Ship" ? [makeUnit({ id: "trade" })] : []);
  t.check("the old string returns [] rather than throwing", units("Trade").length === 0);
  t.check("the correct string finds the ships", units(got.TradeShip).length === 1);
}

t.done();
