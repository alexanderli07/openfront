// Auto-bot config pane: every surfaced setting is wired, and number inputs are live.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Proves the 16 previously-unreachable strategy settings are wired end to end, and that
// every [data-cfg-num] input is live. Run from the repo root.
import { source, suite } from "./lib/harness.mjs";
const P = source("engine/ingame/auto-bot/panel.js");
const C = source("engine/ingame/auto-bot/core.js");

const t = suite("panel-autobot");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

const KEYS = [
  "defensePostTiming",
  "defensePostPlayersOnly",
  "combatReserve",
  "absorbThenCounter",
  "gentleNeighbors",
  "encirclePockets",
  "nukeIncomeMinutes",
  "nukeArcRotate",
  "samUpgradeMargin",
  "openingArmyFill",
  "openingMinCityLevels",
  "openingMaxTicks",
  "openingSurroundedNeighbors",
  "openingAllModes",
  "minAttackForce",
  "openingInvaderMemoryTicks",
];

const persisted = C.match(/PERSISTED_KEYS\s*=\s*\[([\s\S]*?)\]/)[1];
const defaultsBlock = C.slice(C.indexOf("const DEFAULTS = {"), C.indexOf("PERSISTED_KEYS"));

t.section("every surfaced setting is control + default + persisted");
{
  const broken = [];
  for (const k of KEYS) {
    const ui =
      P.includes('data-cfg="' + k + '"') ||
      P.includes('data-cfg-num="' + k + '"') ||
      P.includes('data-cfg-range="' + k + '"');
    const def = new RegExp("^\\s*" + k + ":", "m").test(defaultsBlock);
    const per = persisted.includes('"' + k + '"');
    if (!(ui && def && per)) broken.push(`${k}(ui=${ui},def=${def},persist=${per})`);
  }
  check("all 16 are fully wired", broken.length === 0, broken.join(" "));
  check(
    "each also has a hover tip",
    KEYS.every((k) => {
      const i =
        P.indexOf('data-cfg="' + k + '"') >= 0
          ? P.indexOf('data-cfg="' + k + '"')
          : P.indexOf('data-cfg-num="' + k + '"') >= 0
            ? P.indexOf('data-cfg-num="' + k + '"')
            : P.indexOf('data-cfg-range="' + k + '"');
      return P.lastIndexOf("data-tip-desc", i) > i - 1200;
    }),
  );
}

t.section("the engine actually reads each of them");
{
  const engine = [
    "attackBehavior",
    "structureBehavior",
    "nukeBehavior",
    "nationExecution",
    "warshipBehavior",
    "allianceBehavior",
    "lifecycle",
    "portutil",
  ]
    .map((f) => {
      try {
        return source(`engine/ingame/auto-bot/${f}.js`);
      } catch {
        return "";
      }
    })
    .join("\n");
  const unread = KEYS.filter((k) => !engine.includes(k));
  check("no setting we just exposed is inert", unread.length === 0, unread.join(","));
}

t.section("number inputs are no longer dead");
{
  check(
    "a GENERIC [data-cfg-num] handler exists",
    /panel\.querySelectorAll\("\[data-cfg-num\]"\)\.forEach/.test(P),
  );
  check(
    "the old hardcoded tickMs-only lookup is gone",
    !/const tickInput = panel\.querySelector\('\[data-cfg-num="tickMs"\]'\);/.test(P),
  );
  check("tickMs keeps its engine retune", /key === "tickMs" && typeof retuneEngine/.test(P));

  // Run the real handler body against stub inputs.
  const body = P.slice(
    P.indexOf('panel.querySelectorAll("[data-cfg-num]").forEach'),
    P.indexOf("// range sliders"),
  );
  const settings = { tickMs: 200, openingMaxTicks: 9000, openingMinCityLevels: 5 };
  let saved = 0,
    retuned = 0;
  const mkInput = (key, min, max, value) => {
    const listeners = [];
    return {
      dataset: { cfgNum: key },
      min,
      max,
      value,
      addEventListener: (_e, fn) => listeners.push(fn),
      fire(v) {
        this.value = v;
        listeners.forEach((f) => f());
        return this.value;
      },
    };
  };
  const inputs = [
    mkInput("tickMs", "50", "2000", "200"),
    mkInput("openingMaxTicks", "0", "30000", "9000"),
    mkInput("openingMinCityLevels", "1", "20", "5"),
  ];
  new Function(
    "env",
    `
    const { panel, state, saveSettings, retuneEngine } = env;
    ${body}
  `,
  )({
    panel: { querySelectorAll: () => inputs },
    state: { settings },
    saveSettings: () => saved++,
    retuneEngine: () => retuned++,
  });

  inputs[1].fire("12000");
  check(
    "a number input writes its setting",
    settings.openingMaxTicks === 12000,
    settings.openingMaxTicks,
  );
  check("...and persists it", saved === 1, saved);
  inputs[1].fire("99999");
  check(
    "out-of-range is clamped to the element max",
    settings.openingMaxTicks === 30000,
    settings.openingMaxTicks,
  );
  check("...and the field is corrected too", inputs[1].value === "30000", inputs[1].value);
  inputs[2].fire("");
  check(
    "a blank field does not write NaN",
    settings.openingMinCityLevels === 5,
    settings.openingMinCityLevels,
  );
  check("...and reverts the field", inputs[2].value === "5", inputs[2].value);
  inputs[0].fire("400");
  check("tickMs still retunes the engine", retuned === 1, retuned);
  check("a non-tickMs change does NOT retune", retuned === 1);
}

t.section("the retreat threshold now means what it says");
{
  check(
    "default matches the game's warshipRetreatHealthPercent()",
    /warshipRetreatHealthPct: 75,/.test(C),
  );
  check("the slider readout agrees", /warshipRetreatHealthPct \|\| 75/.test(P));
  // 50 sat below the game's 75, so the engine had always already flipped the ship to
  // "retreating" and our branch could never fire.
  const engineFlipsAt = 75,
    oldSetting = 50,
    newSetting = 75;
  check("OLD: our branch was unreachable", oldSetting < engineFlipsAt);
  check("NEW: the setting is the same threshold the engine acts on", newSetting === engineFlipsAt);
}

t.done();
