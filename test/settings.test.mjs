// Shared settings: map-filter normalisation and the min-lobby-size contract.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies the settings/popup fixes with the REAL sliced normalizeMapFilters.
import { source, suite } from "./lib/harness.mjs";
const S = source("engine/shared/settings.js");
const P = source("src/shell/popup/panel.ts");
const AJ = source("engine/lobby/auto-join.js");
const PU = source("engine/ingame/auto-bot/portutil.js");

function cut(src, a0, b0, label) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start " + label);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end " + label);
  return src.slice(a, b + b0.length);
}

const t = suite("settings");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

// Real normalizeMapFilters against a small map universe.
const fnNorm = cut(S, "function normalizeMapFilters(", "return normalizedMapFilters;\n  }", "norm");
const MAPS = ["baikal", "baikalnukewars", "luna", "pluto", "africa", "europe"];
const normalize = new Function(`
  const MAP_IDS = ${JSON.stringify(MAPS)};
  const createDefaultMapFilters = () => Object.fromEntries(MAP_IDS.map(i => [i, false]));
  ${fnNorm}
  return normalizeMapFilters;
`)();
// The real DEFAULT_SETTINGS.mapFilters shape: four preset maps on.
const DEFAULTS = {
  baikal: true,
  baikalnukewars: true,
  luna: true,
  pluto: true,
  africa: false,
  europe: false,
};

t.section("the Clear bug (map filters)");
{
  // What the OLD popup wrote.
  const old = normalize({}, DEFAULTS);
  const resurrected = MAPS.filter((m) => old[m]);
  check(
    "writing {} really does resurrect the preset maps (the bug)",
    resurrected.length === 4,
    resurrected.join(","),
  );
}
{
  // What the popup writes NOW: explicit false for every map.
  const cleared = Object.fromEntries(MAPS.map((m) => [m, false]));
  const out = normalize(cleared, DEFAULTS);
  check(
    "explicit falses survive normalisation — nothing comes back",
    MAPS.every((m) => out[m] === false),
    JSON.stringify(out),
  );
}
{
  // Select all must still work, and a fresh install must still get its presets.
  const all = Object.fromEntries(MAPS.map((m) => [m, true]));
  check(
    "Select all still selects everything",
    MAPS.every((m) => normalize(all, DEFAULTS)[m]),
  );
  const fresh = normalize({}, DEFAULTS);
  check(
    "a FRESH install still gets the preset maps (fallback intact)",
    fresh.baikal === true && fresh.luna === true && fresh.africa === false,
  );
}
{
  // A partial selection must not gain the presets back either.
  const partial = Object.fromEntries(MAPS.map((m) => [m, m === "europe"]));
  const out = normalize(partial, DEFAULTS);
  check(
    "selecting only Europe leaves ONLY Europe",
    out.europe === true && MAPS.filter((m) => out[m]).length === 1,
    MAPS.filter((m) => out[m]).join(","),
  );
}
check(
  "the popup's Clear now writes explicit values",
  /noneBtn[\s\S]{0,900}Object\.fromEntries\(maps\.map\(\(m\) => \[m\.id, false\]\)\)/.test(P),
);
check(
  "and Select all is unchanged",
  /allBtn[\s\S]{0,400}Object\.fromEntries\(maps\.map\(\(m\) => \[m\.id, true\]\)\)/.test(P),
);

t.section("min lobby size: one contract, stated the same everywhere");
{
  // The real filter comparison.
  const cmp = cut(AJ, "function lobbyMatchesFilters(lobby, groupKey) {", "  }\n", "cmp");
  check("the rule is strictly greater-than", /maxPlayers <= settings\.minLobbySize/.test(cmp));
  check("popup no longer promises 'at least'", !P.includes("at least this many players"));
  check("popup now says MORE than", P.includes("MORE than this many players"));
  // Behaviour is deliberately unchanged: a 50-cap lobby at setting 50 still rejects.
  const rejects = (maxPlayers, min) => !(maxPlayers > min);
  check("50-cap at setting 50 still rejected (rule untouched)", rejects(50, 50));
  check("51-cap at setting 50 accepted", !rejects(51, 50));
}

t.section("the difficulty dial was dead in two ways");
check(
  "currentDifficulty is pinned to Impossible",
  /function currentDifficulty\(\)\s*\{\s*return Difficulty\.Impossible;/.test(PU),
);
check(
  "difficulty is in neither DEFAULTS nor PERSISTED_KEYS",
  !/^\s*difficulty:/m.test(source("engine/ingame/auto-bot/core.js")) &&
    !/"difficulty"/.test(source("engine/ingame/auto-bot/core.js")),
);
check("the popup no longer renders the dial", !P.includes("ab.DIFFICULTIES"));
check(
  "but the bridge field is left intact for compatibility",
  source("engine/ingame/auto-bot/lifecycle.js").includes("DIFFICULTIES:"),
);

t.done();
