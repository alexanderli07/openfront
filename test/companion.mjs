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
 * @param {Object} stubs optional function stubs to inject into the scope
 */
function loadCompanion(files, names, stubs) {
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  // `document` is a fixed parameter (below), not one of the injected stubs, so
  // pull it out of stubs here rather than passing it through stubNames/stubEntries
  // — otherwise it would shadow the "document" parameter under a different name.
  const { document: documentStub, ...restStubs } = stubs || {};
  const stubEntries = Object.entries(restStubs);
  const stubNames = stubEntries.map(([k]) => k);
  const factory = new Function(
    "window",
    "localStorage",
    "document",
    ...stubNames,
    `${src}\nreturn { ${names.join(", ")} };`,
  );
  return factory(
    fakeWindow,
    fakeLocalStorage,
    documentStub || { getElementById: () => null },
    ...stubEntries.map(([, v]) => v),
  );
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
  assert.deepEqual(
    companionTileToXY(4523, 137),
    { x: 4523 % 137, y: Math.floor(4523 / 137) },
    "non-round map width",
  );

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
  assert.equal(
    companionPercentAmount(10n ** 18n, 50),
    Number(10n ** 18n / 2n),
    "huge bigint stays finite",
  );
  // A fractional percent must not make the two branches disagree.
  assert.equal(
    companionPercentAmount(1000, 33.6),
    companionPercentAmount(1000n, 33.6),
    "fractional pct behaves the same for number and bigint",
  );
  assert.equal(companionPercentAmount(1000, 33.6), 340, "fractional pct rounds to 34%");
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

// ---- settings blob ----------------------------------------------------------
{
  store.clear();
  const m = loadCompanion(CORE, [
    "COMPANION_DEFAULTS",
    "companionSettings",
    "companionSaveSettings",
    "companionPatchSettings",
    "COMPANION_STORAGE_KEY",
  ]);

  // Lazy init: nothing was read at load time.
  assert.equal(store.size, 0, "no storage access at load time");

  const s = m.companionSettings();
  assert.equal(s.bossName, "", "default boss name empty");
  assert.equal(s.mode, "passive", "default mode");
  assert.equal(s.maxFactoryLevel, 20, "default maxFactoryLevel");
  assert.strictEqual(m.companionSettings(), s, "settings() is a stable reference");

  m.companionPatchSettings({ bossName: "EcoMaxer", maxFactoryLevel: 5 });
  assert.equal(m.companionSettings().bossName, "EcoMaxer", "patch applied");
  const raw = JSON.parse(store.get(m.COMPANION_STORAGE_KEY));
  assert.equal(raw.bossName, "EcoMaxer", "patch persisted");
  assert.equal(raw.maxFactoryLevel, 5, "numeric patch persisted");
}

{
  // Whitelist: unknown keys in storage are dropped, defaults fill the gaps.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(
    m0.COMPANION_STORAGE_KEY,
    JSON.stringify({ bossName: "Boss", somethingRemoved: 1, mode: "active" }),
  );
  const m = loadCompanion(CORE, ["companionSettings"]);
  const s = m.companionSettings();
  assert.equal(s.bossName, "Boss", "known key restored");
  assert.equal(s.mode, "active", "known key restored");
  assert.equal("somethingRemoved" in s, false, "unknown key dropped");
  assert.equal(s.maxFactoryLevel, 20, "missing key falls back to default");
}

{
  // A corrupt blob must never throw — it would kill every later engine feature.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(m0.COMPANION_STORAGE_KEY, "{not json");
  const m = loadCompanion(CORE, ["companionSettings"]);
  assert.equal(m.companionSettings().mode, "passive", "corrupt blob → defaults");
}

{
  // companionState starts empty and is a single shared object.
  const m = loadCompanion(CORE, ["companionState"]);
  assert.equal(m.companionState.bossStatus, "idle");
  assert.deepEqual(m.companionState.log, []);
  assert.equal(m.companionState.paused, false);
}

// ---- settings validation ----------------------------------------------------
{
  store.clear();
  const m = loadCompanion(CORE, [
    "companionSettings",
    "companionPatchSettings",
    "companionCoerceSetting",
    "COMPANION_STORAGE_KEY",
  ]);

  // An emptied number input yields NaN. It must NOT land in settings — a NaN
  // maxFactoryLevel makes `factories < maxFactoryLevel` false forever, silently
  // switching auto-factory off with nothing on screen to explain it.
  m.companionPatchSettings({ maxFactoryLevel: Number.NaN });
  assert.equal(m.companionSettings().maxFactoryLevel, 20, "NaN keeps the previous value");

  m.companionPatchSettings({ maxFactoryLevel: "not-a-number" });
  assert.equal(m.companionSettings().maxFactoryLevel, 20, "garbage string keeps previous value");

  // Numbers are clamped to their declared range, not rejected.
  m.companionPatchSettings({ troopNeedPct: 500 });
  assert.equal(m.companionSettings().troopNeedPct, 100, "clamped to max");
  m.companionPatchSettings({ troopSendPct: -5 });
  assert.equal(m.companionSettings().troopSendPct, 1, "clamped to min");
  m.companionPatchSettings({ tickMs: 10 });
  assert.equal(m.companionSettings().tickMs, 250, "tick floor");
  m.companionPatchSettings({ maxFactoryLevel: 0 });
  assert.equal(
    m.companionSettings().maxFactoryLevel,
    1,
    "level 0 clamps to 1 — a built factory is always at least level 1",
  );
  m.companionPatchSettings({ spawnMinRadius: 12.7 });
  assert.equal(m.companionSettings().spawnMinRadius, 13, "rounded to an integer");

  // Enums reject anything not in the list.
  m.companionPatchSettings({ mode: 12345 });
  assert.equal(m.companionSettings().mode, "passive", "bad enum keeps previous value");
  m.companionPatchSettings({ mode: "active" });
  assert.equal(m.companionSettings().mode, "active", "valid enum applies");
  m.companionPatchSettings({ activeTab: "nope" });
  assert.equal(m.companionSettings().activeTab, "control", "bad tab keeps previous value");

  // Strings and flags.
  m.companionPatchSettings({ bossName: "  EcoMaxer  " });
  assert.equal(m.companionSettings().bossName, "EcoMaxer", "boss name is trimmed");
  m.companionPatchSettings({ bossName: 42 });
  assert.equal(m.companionSettings().bossName, "EcoMaxer", "non-string keeps previous value");
  m.companionPatchSettings({ autoGold: 1 });
  assert.equal(m.companionSettings().autoGold, true, "flags coerce to boolean");
  assert.strictEqual(m.companionSettings().autoGold, true, "flag is a real boolean, not 1");

  // Objects.
  m.companionPatchSettings({ emojiBindings: { pause: "😀" } });
  assert.deepEqual(m.companionSettings().emojiBindings, { pause: "😀" });
  m.companionPatchSettings({ emojiBindings: "nope" });
  assert.deepEqual(m.companionSettings().emojiBindings, { pause: "😀" }, "bad object rejected");
  m.companionPatchSettings({ emojiBindings: null });
  assert.equal(m.companionSettings().emojiBindings, null, "null resets bindings");

  assert.equal(m.companionCoerceSetting("maxFactoryLevel", "7"), 7, "numeric string is usable");
  assert.equal(m.companionCoerceSetting("maxFactoryLevel", Number.NaN), undefined);
}

{
  // A stored blob written by an older build cannot inject out-of-range values.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(
    m0.COMPANION_STORAGE_KEY,
    JSON.stringify({
      maxFactoryLevel: 99999,
      troopNeedPct: "junk",
      mode: "nonsense",
      tickMs: 1,
    }),
  );
  const m = loadCompanion(CORE, ["companionSettings"]);
  const s = m.companionSettings();
  assert.equal(s.maxFactoryLevel, 100, "stored value clamped on load");
  assert.equal(s.troopNeedPct, 60, "stored garbage falls back to the default");
  assert.equal(s.mode, "passive", "stored bad enum falls back to the default");
  assert.equal(s.tickMs, 250, "stored value clamped on load");
}

{
  // JSON.parse("null") must not throw during load.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(m0.COMPANION_STORAGE_KEY, "null");
  const m = loadCompanion(CORE, ["companionSettings"]);
  assert.equal(m.companionSettings().mode, "passive", "null blob → defaults, no throw");
}

// ---- coercion covers every non-boolean default ------------------------------
{
  // companionCoerceSetting's last branch assumes "anything left is a boolean
  // flag". That assumption is only safe while every non-boolean key in
  // COMPANION_DEFAULTS has an explicit branch. Without this test, adding a new
  // numeric setting and forgetting its range entry would silently coerce it to
  // true/false at runtime with nothing to show for it.
  const m = loadCompanion(CORE, [
    "COMPANION_DEFAULTS",
    "COMPANION_NUMBER_RANGES",
    "COMPANION_ENUMS",
    "companionCoerceSetting",
  ]);
  const explicit = new Set([
    ...Object.keys(m.COMPANION_NUMBER_RANGES),
    ...Object.keys(m.COMPANION_ENUMS),
    "bossName",
    "collapsedSections",
    "emojiBindings",
    "pos",
  ]);
  const unhandled = Object.keys(m.COMPANION_DEFAULTS).filter(
    (k) => typeof m.COMPANION_DEFAULTS[k] !== "boolean" && !explicit.has(k),
  );
  assert.deepEqual(
    unhandled,
    [],
    `these non-boolean settings have no coercion branch and would be forced to a ` +
      `boolean: ${unhandled.join(", ")}`,
  );

  // And the converse: every key claiming an explicit branch actually exists.
  const missing = [...explicit].filter((k) => !(k in m.COMPANION_DEFAULTS));
  assert.deepEqual(
    missing,
    [],
    `coercion branches for keys that do not exist: ${missing.join(", ")}`,
  );
}

// ---- boss resolution --------------------------------------------------------
{
  const { companionResolveBoss, companionHumanPlayers } = loadCompanion(CORE, [
    "companionResolveBoss",
    "companionHumanPlayers",
  ]);

  const mkPlayer = (name, smallID, type, alive = true) => ({
    name: () => name,
    smallID: () => smallID,
    id: () => `p${smallID}`,
    type: () => type,
    isAlive: () => alive,
    isPlayer: () => true,
  });

  const me = mkPlayer("Slave1", 2, "HUMAN");
  const boss = mkPlayer("EcoMaxer", 1, "HUMAN");
  const nation = mkPlayer("France", 3, "NATION");
  const bot = mkPlayer("Bot4", 4, "BOT");
  const game = { players: () => [boss, me, nation, bot], myPlayer: () => me };

  assert.deepEqual(
    companionResolveBoss(game, ""),
    { status: "idle", boss: null },
    "empty name → idle",
  );
  assert.deepEqual(
    companionResolveBoss(game, "   "),
    { status: "idle", boss: null },
    "whitespace-only name → idle",
  );

  const found = companionResolveBoss(game, "EcoMaxer");
  assert.equal(found.status, "found");
  assert.equal(found.boss.smallID(), 1);

  assert.equal(
    companionResolveBoss(game, "ecomaxer").status,
    "found",
    "name match is case-insensitive",
  );
  assert.equal(
    companionResolveBoss(game, " EcoMaxer ").status,
    "found",
    "name match trims whitespace",
  );

  assert.deepEqual(companionResolveBoss(game, "Nobody"), { status: "missing", boss: null });
  assert.equal(
    companionResolveBoss(game, "France").status,
    "missing",
    "a Nation is never the boss",
  );
  assert.equal(
    companionResolveBoss(game, "Bot4").status,
    "missing",
    "a regular bot is never the boss",
  );

  assert.deepEqual(
    companionResolveBoss(game, "Slave1"),
    { status: "self", boss: null },
    "this tab IS the boss → self",
  );

  // A dead boss is not a usable boss.
  const deadBoss = mkPlayer("Ghost", 5, "HUMAN", false);
  const g2 = { players: () => [me, deadBoss], myPlayer: () => me };
  assert.equal(companionResolveBoss(g2, "Ghost").status, "missing", "dead boss → missing");

  // Never throws on a broken/absent game.
  assert.deepEqual(companionResolveBoss(null, "EcoMaxer"), { status: "missing", boss: null });
  assert.deepEqual(companionResolveBoss({}, "EcoMaxer"), { status: "missing", boss: null });

  const humans = companionHumanPlayers(game);
  assert.deepEqual(
    humans.map((p) => p.name()),
    ["EcoMaxer", "Slave1"],
    "dropdown lists live humans only",
  );
  assert.deepEqual(companionHumanPlayers(null), [], "no game → empty list");
}

// ---- emoji command table ----------------------------------------------------
const CMDS = ["engine/ingame/companion/core.js", "engine/ingame/companion/commands.js"];
{
  const m = loadCompanion(CMDS, [
    "COMPANION_ACTION_IDS",
    "COMPANION_DEFAULT_BINDINGS",
    "companionEmojiKey",
    "companionCollectCommands",
    "COMPANION_SEEN_LIMIT",
  ]);

  assert.deepEqual(
    m.COMPANION_ACTION_IDS,
    [
      "donateAllGold",
      "donateAllTroops",
      "breakAlliance",
      "requestAlliance",
      "attackBossTarget",
      "buildFactory",
      "pause",
      "resume",
    ],
    "eight actions in a stable order",
  );
  assert.equal(m.COMPANION_DEFAULT_BINDINGS.donateAllGold, "🆘");
  assert.equal(m.COMPANION_DEFAULT_BINDINGS.breakAlliance, "💔");
  assert.equal(m.COMPANION_DEFAULT_BINDINGS.pause, "🥱");
  assert.equal(
    Object.keys(m.COMPANION_DEFAULT_BINDINGS).length,
    m.COMPANION_ACTION_IDS.length,
    "every action has a default emoji",
  );
  assert.equal(
    new Set(Object.values(m.COMPANION_DEFAULT_BINDINGS)).size,
    m.COMPANION_ACTION_IDS.length,
    "default emoji are distinct — one emoji cannot mean two things",
  );

  const key = m.companionEmojiKey({
    message: "🆘",
    senderID: 1,
    recipientID: 2,
    createdAt: 500,
  });
  assert.equal(key, "1:2:🆘:500", "dedupe key covers sender, recipient, emoji and tick");

  const B = m.COMPANION_DEFAULT_BINDINGS;
  const mkBoss = (emojis) => ({ state: { outgoingEmojis: emojis } });

  // Addressed to me → runs.
  let seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 10 }]),
      2,
      B,
      seen,
    ),
    ["donateAllGold"],
  );

  // Same emoji still sitting in the array on the next tick → must NOT repeat.
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 10 }]),
      2,
      B,
      seen,
    ),
    [],
    "dedupe by createdAt stops the multitab re-fire bug",
  );

  // Same emoji sent AGAIN later is a new command.
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 99 }]),
      2,
      B,
      seen,
    ),
    ["donateAllGold"],
    "a later createdAt is a fresh command",
  );

  // Addressed to a different bot → ignored.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 7, createdAt: 1 }]),
      2,
      B,
      seen,
    ),
    [],
    "emoji for another slave is not mine",
  );

  // Broadcast → every bot obeys. (The multitab original skipped AllPlayers.)
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "💔", senderID: 1, recipientID: "AllPlayers", createdAt: 1 }]),
      2,
      B,
      seen,
    ),
    ["breakAlliance"],
    "AllPlayers is the all-bots channel",
  );

  // Unbound emoji → nothing.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "😀", senderID: 1, recipientID: 2, createdAt: 1 }]),
      2,
      B,
      seen,
    ),
    [],
  );

  // Remapped binding wins over the default.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "😀", senderID: 1, recipientID: 2, createdAt: 1 }]),
      2,
      Object.assign({}, B, { donateAllGold: "😀" }),
      seen,
    ),
    ["donateAllGold"],
  );

  // Multiple commands in one tick keep array order.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([
        { message: "🥱", senderID: 1, recipientID: 2, createdAt: 1 },
        { message: "🆘", senderID: 1, recipientID: "AllPlayers", createdAt: 2 },
      ]),
      2,
      B,
      seen,
    ),
    ["pause", "donateAllGold"],
  );

  // Missing / malformed input never throws — the field is optional on the wire.
  seen = [];
  assert.deepEqual(m.companionCollectCommands({ state: {} }, 2, B, seen), []);
  assert.deepEqual(m.companionCollectCommands({}, 2, B, seen), []);
  assert.deepEqual(m.companionCollectCommands(null, 2, B, seen), []);
  assert.deepEqual(m.companionCollectCommands(mkBoss([null, 5, "x"]), 2, B, seen), []);

  // The seen list is bounded so a long game cannot grow it without limit.
  seen = [];
  assert.equal(m.COMPANION_SEEN_LIMIT, 256, "the dedupe window is 256 entries");
  for (let i = 0; i < m.COMPANION_SEEN_LIMIT + 50; i++) {
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: i }]),
      2,
      B,
      seen,
    );
  }
  assert.ok(seen.length <= 256, "seen list is capped");
}

// ---- unresolved smallID must not match anything -----------------------------
{
  const m = loadCompanion(CMDS, ["COMPANION_DEFAULT_BINDINGS", "companionCollectCommands"]);
  const B = m.COMPANION_DEFAULT_BINDINGS;
  const boss = {
    state: { outgoingEmojis: [{ message: "🆘", senderID: 1, recipientID: 0, createdAt: 1 }] },
  };

  // Number(null) === 0, and 0 is TerraNullius's sentinel smallID. An unresolved
  // caller must collect nothing rather than obey messages addressed to nobody.
  let seen = [];
  assert.deepEqual(
    m.companionCollectCommands(boss, null, B, seen),
    [],
    "null smallID matches nothing",
  );
  assert.deepEqual(seen, [], "null smallID does not even record a dedupe key");

  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(boss, undefined, B, seen),
    [],
    "undefined smallID matches nothing",
  );

  // A broadcast is still ignored while our identity is unknown — acting on an
  // all-bots order before we know who we are is what the guard prevents.
  seen = [];
  const broadcast = {
    state: {
      outgoingEmojis: [{ message: "🆘", senderID: 1, recipientID: "AllPlayers", createdAt: 1 }],
    },
  };
  assert.deepEqual(
    m.companionCollectCommands(broadcast, null, B, seen),
    [],
    "broadcast ignored until our smallID is known",
  );

  // A real smallID of 0 is impossible for a player (players start at 1), but the
  // guard must not break the normal path.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(boss, 0, B, seen),
    ["donateAllGold"],
    "an explicit 0 still works — only null/undefined are treated as unresolved",
  );
}

// ---- actions: donate + alliance ---------------------------------------------
const ACTS = [
  "engine/ingame/companion/core.js",
  "engine/ingame/companion/commands.js",
  "engine/ingame/companion/actions.js",
];
{
  const sent = [];
  let sendResult = true;
  const m = loadCompanion(
    ACTS,
    [
      "companionSend",
      "companionDonateGold",
      "companionDonateTroops",
      "companionRequestAlliance",
      "companionBreakAlliance",
      "companionBossNeedsTroops",
      "companionIsAlliedWithBoss",
      "companionState",
    ],
    {
      sendGamePacket: (o) => {
        sent.push(o);
        return sendResult;
      },
    },
  );

  const boss = { id: () => "p1", smallID: () => 1, name: () => "EcoMaxer" };

  // -- gold: bigint in, plain Number on the wire (schema is z.number()) --------
  sent.length = 0;
  const me = { gold: () => 1000n, troops: () => 5000, id: () => "p2", smallID: () => 2 };
  assert.equal(m.companionDonateGold(me, boss, 40), true);
  assert.deepEqual(sent[0], { type: "donate_gold", recipient: "p1", gold: 400 });
  assert.equal(typeof sent[0].gold, "number", "gold must not be a bigint on the wire");

  // recipient is the string PlayerID, never smallID
  assert.equal(sent[0].recipient, "p1");

  // -- troops -----------------------------------------------------------------
  sent.length = 0;
  assert.equal(m.companionDonateTroops(me, boss, 40), true);
  assert.deepEqual(sent[0], { type: "donate_troops", recipient: "p1", troops: 2000 });

  // -- nothing to give → no packet -------------------------------------------
  sent.length = 0;
  assert.equal(m.companionDonateGold({ gold: () => 0n }, boss, 40), false);
  assert.equal(m.companionDonateTroops({ troops: () => 0 }, boss, 40), false);
  assert.equal(sent.length, 0, "never send an empty donation");

  // -- alliance ---------------------------------------------------------------
  sent.length = 0;
  assert.equal(m.companionRequestAlliance(boss), true);
  assert.deepEqual(sent[0], { type: "allianceRequest", recipient: "p1" });
  sent.length = 0;
  assert.equal(m.companionBreakAlliance(boss), true);
  assert.deepEqual(sent[0], { type: "breakAlliance", recipient: "p1" });

  // -- no boss → never send ---------------------------------------------------
  sent.length = 0;
  assert.equal(m.companionRequestAlliance(null), false);
  assert.equal(m.companionDonateGold(me, null, 40), false);
  assert.equal(sent.length, 0);

  // -- a failed send is recorded so the panel can show it ---------------------
  sendResult = false;
  m.companionState.lastSendFailedAt = 0;
  assert.equal(m.companionSend({ type: "donate_gold", recipient: "p1", gold: 1 }), false);
  assert.ok(m.companionState.lastSendFailedAt > 0, "failure timestamped");
  sendResult = true;
}

// ---- boss need + alliance predicates ----------------------------------------
{
  const m = loadCompanion(ACTS, ["companionBossNeedsTroops", "companionIsAlliedWithBoss"], {
    sendGamePacket: () => true,
  });

  const game = { config: () => ({ maxTroops: () => 10000 }) };
  assert.equal(
    m.companionBossNeedsTroops(game, { troops: () => 5000 }, 60),
    true,
    "50% of max is below the 60% threshold",
  );
  assert.equal(
    m.companionBossNeedsTroops(game, { troops: () => 9000 }, 60),
    false,
    "90% of max is above the threshold",
  );
  assert.equal(
    m.companionBossNeedsTroops(game, { troops: () => 6000 }, 60),
    true,
    "exactly at the threshold still counts as needing",
  );
  assert.equal(
    m.companionBossNeedsTroops(null, { troops: () => 1 }, 60),
    false,
    "no game → false, never throw",
  );
  assert.equal(
    m.companionBossNeedsTroops({ config: () => ({ maxTroops: () => 0 }) }, { troops: () => 1 }, 60),
    false,
    "zero max troops → false, no divide-by-zero",
  );

  const boss = { smallID: () => 1 };
  assert.equal(
    m.companionIsAlliedWithBoss({ isOnSameTeam: () => true, isAlliedWith: () => false }, boss),
    true,
    "same team counts",
  );
  assert.equal(
    m.companionIsAlliedWithBoss({ isOnSameTeam: () => false, isAlliedWith: () => true }, boss),
    true,
    "allied counts",
  );
  assert.equal(
    m.companionIsAlliedWithBoss({ isOnSameTeam: () => false, isAlliedWith: () => false }, boss),
    false,
  );
  assert.equal(m.companionIsAlliedWithBoss({}, boss), false, "missing methods → false");
  assert.equal(m.companionIsAlliedWithBoss(null, null), false);
}

// ---- spawn near boss --------------------------------------------------------
{
  const sent = [];
  const m = loadCompanion(ACTS, ["companionPickSpawnTile", "companionSpawnAt"], {
    sendGamePacket: (o) => {
      sent.push(o);
      return true;
    },
  });

  // 100×100 map. Land everywhere except a water column at x=50.
  // Tiles owned by someone: the 3×3 block around the boss.
  const W = 100;
  const H = 100;
  const owned = new Set();
  const mkGame = (opts) => ({
    width: () => W,
    height: () => H,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < H,
    ref: (x, y) => y * W + x,
    x: (t) => t % W,
    y: (t) => Math.floor(t / W),
    isLand: (t) => (opts && opts.allWater ? false : t % W !== 50),
    hasOwner: (t) => owned.has(t),
    isBorder: () => false,
  });

  const bossTile = 40 * W + 20; // (20, 40)
  const boss = { state: { spawnTile: bossTile } };
  const me = {};

  const tile = m.companionPickSpawnTile(mkGame(), me, boss, 12, 24);
  assert.ok(tile != null, "found a spawn tile");
  const p = { x: tile % W, y: Math.floor(tile / W) };
  const dist = Math.hypot(p.x - 20, p.y - 40);
  assert.ok(
    dist >= 12 - 1e-9 && dist <= 24 + 1e-9,
    `spawn ${dist.toFixed(2)} tiles from the boss, inside the ring`,
  );
  assert.notEqual(p.x, 50, "never picks a water tile");

  // Nearest-first: with open terrain the pick should sit at the inner edge.
  assert.ok(dist < 14, "prefers the closest valid tile in the ring");

  // Owned tiles are skipped.
  owned.clear();
  for (let dy = -14; dy <= 14; dy++) {
    for (let dx = -14; dx <= 14; dx++) owned.add((40 + dy) * W + (20 + dx));
  }
  const tile2 = m.companionPickSpawnTile(mkGame(), me, boss, 12, 24);
  assert.ok(tile2 != null, "still finds a tile further out");
  const p2 = { x: tile2 % W, y: Math.floor(tile2 / W) };
  assert.ok(Math.hypot(p2.x - 20, p2.y - 40) > 14, "skipped the owned block");
  owned.clear();

  // No valid tile anywhere → null, never a bogus tile.
  assert.equal(
    m.companionPickSpawnTile(mkGame({ allWater: true }), me, boss, 12, 24),
    null,
    "all water → null",
  );

  // Boss has not spawned yet → null (nothing to anchor to).
  assert.equal(m.companionPickSpawnTile(mkGame(), me, { state: {} }, 12, 24), null);
  assert.equal(m.companionPickSpawnTile(mkGame(), me, null, 12, 24), null);
  assert.equal(m.companionPickSpawnTile(null, me, boss, 12, 24), null);

  // Ring that falls entirely off the map → null, no crash.
  const edgeBoss = { state: { spawnTile: 0 } };
  const t3 = m.companionPickSpawnTile(mkGame(), me, edgeBoss, 12, 24);
  assert.ok(t3 === null || (t3 >= 0 && t3 < W * H), "on-map or null, never out of range");

  // The emitted intent matches SpawnIntentSchema.
  sent.length = 0;
  assert.equal(m.companionSpawnAt(1234), true);
  assert.deepEqual(sent[0], { type: "spawn", tile: 1234 });
  assert.equal(m.companionSpawnAt(null), false, "no tile → no packet");
  assert.equal(sent.length, 1);
}

// ---- ring offsets are memoised ----------------------------------------------
{
  const m = loadCompanion(CORE, ["companionRingOffsets"]);
  const a = m.companionRingOffsets(12, 24);
  const b = m.companionRingOffsets(12, 24);
  assert.strictEqual(a, b, "same radii reuse the cached array");
  const c = m.companionRingOffsets(5, 9);
  assert.notStrictEqual(a, c, "different radii recompute");
  assert.strictEqual(m.companionRingOffsets(5, 9), c, "and then cache the new radii");
  // Recomputing must still be correct after a cache miss, not just fast.
  for (const o of c) {
    const d = Math.hypot(o.dx, o.dy);
    assert.ok(d >= 5 - 1e-9 && d <= 9 + 1e-9, "recomputed ring still respects its bounds");
  }
  assert.deepEqual(m.companionRingOffsets(24, 12), [], "inverted bounds still empty, uncached");
}

// ---- spawn placement refuses a GameView without bounds checking --------------
{
  const sent = [];
  const m = loadCompanion(ACTS, ["companionPickSpawnTile", "companionSpawnAt"], {
    sendGamePacket: (o) => {
      sent.push(o);
      return true;
    },
  });

  const W = 100;
  // A GameView whose ref() wraps instead of throwing, and which is missing
  // isValidCoord. Trusting it would place the bot on the far side of the map.
  const wrapping = {
    width: () => W,
    ref: (x, y) => (((y * W + x) % (W * W)) + W * W) % (W * W),
    isLand: () => true,
    hasOwner: () => false,
    isBorder: () => false,
  };
  assert.equal(
    m.companionPickSpawnTile(wrapping, {}, { state: { spawnTile: 0 } }, 12, 24),
    null,
    "no isValidCoord → refuse to guess rather than wrap across the map",
  );

  // A negative or fractional tile is not a TileRef and must not go on the wire.
  sent.length = 0;
  assert.equal(m.companionSpawnAt(-5), false, "negative tile rejected");
  assert.equal(m.companionSpawnAt(1.5), false, "fractional tile rejected");
  assert.equal(m.companionSpawnAt(Number.POSITIVE_INFINITY), false, "Infinity rejected");
  assert.equal(sent.length, 0, "nothing was sent");
  assert.equal(m.companionSpawnAt(0), true, "tile 0 is valid");
  assert.deepEqual(sent[0], { type: "spawn", tile: 0 });
}

// ---- factories --------------------------------------------------------------
{
  const sent = [];
  const m = loadCompanion(
    ACTS,
    [
      "companionFactoryLevel",
      "companionFirstFactoryId",
      "companionBuildOrUpgradeFactory",
      "companionState",
    ],
    {
      sendGamePacket: (o) => {
        sent.push(o);
        return true;
      },
    },
  );

  const me = { smallID: () => 2, id: () => "p2", state: { spawnTile: 777 } };
  const mkUnit = (id, ownerSmallID, level) => ({
    id: () => id,
    level: () => (level === undefined ? 1 : level),
    owner: () => ({ smallID: () => ownerSmallID }),
  });
  const mkGame = (units) => ({ units: () => units });

  assert.equal(m.companionFactoryLevel(mkGame([]), me), 0, "no factory → level 0");
  assert.equal(
    m.companionFactoryLevel(mkGame([mkUnit(1, 2, 4)]), me),
    4,
    "reads the real level off the unit — the multitab original tracked a local " +
      "counter that silently drifted from reality",
  );
  assert.equal(
    m.companionFactoryLevel(mkGame([mkUnit(1, 9, 9), mkUnit(2, 2, 3)]), me),
    3,
    "ignores factories owned by someone else",
  );
  assert.equal(
    m.companionFactoryLevel(mkGame([mkUnit(1, 2, 2), mkUnit(2, 2, 7)]), me),
    7,
    "with several of our own, the highest level wins",
  );
  assert.equal(
    m.companionFactoryLevel(mkGame([{ id: () => 1, owner: () => ({ smallID: () => 2 }) }]), me),
    1,
    "a factory with no level() still counts as level 1",
  );
  assert.equal(m.companionFactoryLevel(null, me), 0, "no game → 0");
  assert.equal(m.companionFactoryLevel(mkGame([]), null), 0, "no me → 0");
  assert.equal(
    m.companionFactoryLevel({ units: () => ({}) }, me),
    0,
    "a non-array from units() must not throw",
  );

  assert.equal(m.companionFirstFactoryId(mkGame([mkUnit(7, 2), mkUnit(8, 2)]), me), 7);
  assert.equal(m.companionFirstFactoryId(mkGame([mkUnit(7, 9)]), me), null, "not mine");

  // Zero factories → build one at my spawn tile.
  sent.length = 0;
  assert.equal(m.companionBuildOrUpgradeFactory(mkGame([]), me), true);
  assert.deepEqual(sent[0], { type: "build_unit", unit: "Factory", tile: 777 });

  // Already own one → upgrade it instead.
  sent.length = 0;
  assert.equal(m.companionBuildOrUpgradeFactory(mkGame([mkUnit(7, 2)]), me), true);
  assert.deepEqual(sent[0], { type: "upgrade_structure", unit: "Factory", unitId: 7 });

  // No spawn tile and nothing to upgrade → do nothing rather than guess.
  sent.length = 0;
  assert.equal(
    m.companionBuildOrUpgradeFactory(mkGame([]), { smallID: () => 2, state: {} }),
    false,
  );
  assert.equal(sent.length, 0);
}

// ---- attack the boss's target ----------------------------------------------
{
  const sent = [];
  const m = loadCompanion(ACTS, ["companionBossTargetId", "companionAttackBossTarget"], {
    sendGamePacket: (o) => {
      sent.push(o);
      return true;
    },
  });

  const enemy = { id: () => "p9", smallID: () => 9 };
  const game = { playerBySmallID: (sid) => (sid === 9 ? enemy : null) };

  // outgoingAttacks entries are PLAIN objects with fields, not methods.
  const boss = {
    state: { outgoingAttacks: [{ troops: 10, attackerID: 1, targetID: 9, retreating: false }] },
  };
  assert.equal(m.companionBossTargetId(game, boss), "p9");

  // The most recent non-retreating attack wins.
  const boss2 = {
    state: {
      outgoingAttacks: [
        { troops: 10, attackerID: 1, targetID: 5, retreating: false },
        { troops: 10, attackerID: 1, targetID: 9, retreating: false },
      ],
    },
  };
  assert.equal(m.companionBossTargetId(game, boss2), "p9", "latest attack wins");

  // Retreating attacks are ignored.
  const boss3 = {
    state: { outgoingAttacks: [{ troops: 10, attackerID: 1, targetID: 9, retreating: true }] },
  };
  assert.equal(m.companionBossTargetId(game, boss3), null);

  assert.equal(m.companionBossTargetId(game, { state: {} }), null);
  assert.equal(m.companionBossTargetId(game, null), null);
  assert.equal(m.companionBossTargetId(null, boss), null);

  // Full action: matches AttackIntentSchema (targetID, not target).
  sent.length = 0;
  const me = { troops: () => 5000 };
  assert.equal(m.companionAttackBossTarget(game, me, boss, 50), true);
  assert.deepEqual(sent[0], { type: "attack", targetID: "p9", troops: 2500 });

  // Boss is not attacking anyone → no packet.
  sent.length = 0;
  assert.equal(m.companionAttackBossTarget(game, me, { state: {} }, 50), false);
  assert.equal(sent.length, 0);
}

// ---- queue, cooldowns, log --------------------------------------------------
const ENG = [
  "engine/ingame/companion/core.js",
  "engine/ingame/companion/commands.js",
  "engine/ingame/companion/actions.js",
  "engine/ingame/companion/engine.js",
];
{
  const m = loadCompanion(
    ENG,
    [
      "companionEnqueue",
      "companionDrainQueue",
      "companionCooldownReady",
      "companionMarkCooldown",
      "companionLog",
      "companionState",
      "COMPANION_MIN_SEND_GAP_MS",
      "COMPANION_LOG_LIMIT",
    ],
    { sendGamePacket: () => true, registerHelperTickListener: () => {} },
  );

  assert.equal(m.COMPANION_MIN_SEND_GAP_MS, 300);

  // One action per drain, spaced by the minimum gap.
  const ran = [];
  m.companionState.queue.length = 0;
  m.companionState.lastSendAt = 0;
  m.companionEnqueue("a", () => {
    ran.push("a");
    return true;
  });
  m.companionEnqueue("b", () => {
    ran.push("b");
    return true;
  });
  assert.equal(m.companionState.queue.length, 2, "both queued");

  assert.equal(m.companionDrainQueue(10000), 1, "one action per drain");
  assert.deepEqual(ran, ["a"]);
  assert.equal(m.companionDrainQueue(10100), 0, "too soon — 100ms < 300ms gap");
  assert.deepEqual(ran, ["a"]);
  assert.equal(m.companionDrainQueue(10400), 1, "gap elapsed");
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(m.companionDrainQueue(20000), 0, "queue empty");

  // A throwing action must not wedge the queue.
  m.companionState.queue.length = 0;
  m.companionState.lastSendAt = 0;
  m.companionEnqueue("boom", () => {
    throw new Error("nope");
  });
  m.companionEnqueue("after", () => {
    ran.push("after");
    return true;
  });
  assert.equal(m.companionDrainQueue(30000), 1);
  assert.equal(m.companionDrainQueue(30400), 1);
  assert.deepEqual(ran, ["a", "b", "after"], "queue survived the throw");

  // Cooldowns.
  m.companionState.cooldowns = {};
  assert.equal(m.companionCooldownReady("donateGold", 30000, 1000), true, "never run → ready");
  m.companionMarkCooldown("donateGold", 1000);
  assert.equal(m.companionCooldownReady("donateGold", 30000, 5000), false, "still cooling");
  assert.equal(m.companionCooldownReady("donateGold", 30000, 31001), true, "cooled down");
  assert.equal(m.companionCooldownReady("other", 30000, 5000), true, "independent keys");

  // Log is bounded and newest-first.
  m.companionState.log.length = 0;
  assert.equal(m.COMPANION_LOG_LIMIT, 100, "the log keeps 100 lines");
  for (let i = 0; i < m.COMPANION_LOG_LIMIT + 20; i++) m.companionLog("line " + i);
  assert.equal(m.companionState.log.length, 100, "log capped");
  assert.ok(
    String(m.companionState.log[0].text).indexOf("line " + (m.COMPANION_LOG_LIMIT + 19)) !== -1,
    "newest entry first",
  );
}

// ---- the decision tick actually decides --------------------------------------
{
  // The brief's other blocks cover the queue, the cooldowns and the hooks — but
  // companionTick itself could be deleted outright and they would all still pass.
  // This block pins the loop that decides when a packet goes on the wire.
  const sent = [];
  let fakeGame = null;
  const m = loadCompanion(
    ENG,
    ["companionTick", "companionState", "companionPatchSettings", "companionResetRunState"],
    {
      sendGamePacket: (o) => {
        sent.push(o);
        return true;
      },
      registerHelperTickListener: () => {},
      getOpenFrontGameContext: () => (fakeGame ? { game: fakeGame } : null),
    },
  );

  const boss = {
    name: () => "Boss",
    smallID: () => 1,
    id: () => "p1",
    type: () => "HUMAN",
    isAlive: () => true,
    troops: () => 1000, // 10% of max → below the 60% threshold
    state: { outgoingEmojis: [], outgoingAllianceRequests: [], spawnTile: 500 },
  };
  const me = {
    name: () => "Slave",
    smallID: () => 2,
    id: () => "p2",
    type: () => "HUMAN",
    isAlive: () => true,
    troops: () => 5000,
    gold: () => 1000n,
    isOnSameTeam: () => true,
    isAlliedWith: () => true,
    state: { spawnTile: 777 },
  };
  const mkGame = () => ({
    players: () => [boss, me],
    myPlayer: () => me,
    config: () => ({ maxTroops: () => 10000 }),
    units: () => [],
    inSpawnPhase: () => false,
    ticks: () => 1,
  });
  // Hold the drain off so these assertions count what the tick QUEUES, not what
  // the queue happens to have already flushed.
  const tick = () => {
    m.companionState.lastSendAt = Date.now();
    m.companionTick();
  };

  fakeGame = mkGame();
  m.companionPatchSettings({
    bossName: "Boss",
    mode: "passive",
    autoTroops: true,
    autoFactory: true,
    autoGold: false,
    emojiControl: true,
    autoSpawn: false,
    autoAlliance: false,
  });
  m.companionResetRunState();

  // Disabled → the tick must not even look at the game.
  m.companionState.enabled = false;
  tick();
  assert.equal(m.companionState.queue.length, 0, "disabled → tick does nothing");

  m.companionState.enabled = true;
  tick();
  assert.deepEqual(
    m.companionState.queue.map((q) => q.label).sort(),
    ["donateTroops", "factory"],
    "a needy boss and no factory queue exactly those two actions",
  );

  // Ticking again while they are still queued must not pile up duplicates —
  // the cooldown is marked at enqueue time, not at send time.
  tick();
  assert.equal(m.companionState.queue.length, 2, "no duplicate work while queued");

  // Paused → nothing new is queued.
  m.companionResetRunState();
  m.companionState.paused = true;
  tick();
  assert.equal(m.companionState.queue.length, 0, "paused → no new work");

  // A different game object means a new match: per-match state must be dropped.
  // Without this the stale gold baseline swallows the new game's whole income.
  m.companionResetRunState();
  m.companionState.lastGameRef = fakeGame;
  m.companionState.lastGoldSnapshot = 999999;
  m.companionState.cooldowns = { donateTroops: Date.now() };
  fakeGame = mkGame();
  tick();
  assert.equal(m.companionState.lastGoldSnapshot, 0, "a new match clears the gold baseline");
  assert.equal(m.companionState.lastGameRef, fakeGame, "and remembers the new game");

  // No boss → never any work, and the status says why.
  m.companionResetRunState();
  m.companionState.lastGameRef = fakeGame;
  m.companionPatchSettings({ bossName: "Nobody" });
  tick();
  assert.equal(m.companionState.queue.length, 0, "no boss → no work");
  assert.equal(m.companionState.bossStatus, "missing", "and the panel is told why");
}

// ---- auto-bot hooks ---------------------------------------------------------
{
  const m = loadCompanion(
    ENG,
    [
      "companionSpawnCenter",
      "companionAllianceVeto",
      "companionState",
      "companionSettings",
      "companionPatchSettings",
    ],
    { sendGamePacket: () => true, registerHelperTickListener: () => {} },
  );

  const W = 100;
  const game = {
    width: () => W,
    height: () => W,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < W,
    ref: (x, y) => y * W + x,
    isLand: () => true,
    hasOwner: () => false,
    isBorder: () => false,
    myPlayer: () => ({ name: () => "Slave1", smallID: () => 2 }),
    players: () => [
      {
        name: () => "EcoMaxer",
        smallID: () => 1,
        id: () => "p1",
        type: () => "HUMAN",
        isAlive: () => true,
        state: { spawnTile: 40 * W + 20 },
      },
      {
        name: () => "Slave1",
        smallID: () => 2,
        id: () => "p2",
        type: () => "HUMAN",
        isAlive: () => true,
      },
    ],
  };

  // Disabled → hooks are inert and auto-bot behaves exactly as before.
  m.companionPatchSettings({
    bossName: "EcoMaxer",
    mode: "active",
    autoSpawn: true,
    autoAlliance: true,
  });
  m.companionState.enabled = false;
  assert.equal(m.companionSpawnCenter(game, null), null, "disabled → no spawn override");
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), false, "disabled → no veto");

  // Enabled + active mode → spawn override returns a tile in the ring.
  m.companionState.enabled = true;
  const tile = m.companionSpawnCenter(game, null);
  assert.ok(tile != null, "active mode overrides the spawn");
  const d = Math.hypot((tile % W) - 20, Math.floor(tile / W) - 40);
  assert.ok(d >= 12 - 1e-9 && d <= 24 + 1e-9, "override tile sits in the ring");

  // Passive mode must NOT drive the auto-bot hook (auto-bot is meant to be off).
  m.companionPatchSettings({ mode: "passive" });
  assert.equal(m.companionSpawnCenter(game, null), null, "passive → hook stays out");

  // autoSpawn off → no override even in active mode.
  m.companionPatchSettings({ mode: "active", autoSpawn: false });
  assert.equal(m.companionSpawnCenter(game, null), null);

  // Alliance veto: allow the boss, block everyone else.
  m.companionPatchSettings({ mode: "active", autoSpawn: true, autoAlliance: true });
  m.companionState.bossSmallID = 1;
  assert.equal(m.companionAllianceVeto({ smallID: () => 1 }), false, "boss is allowed");
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), true, "everyone else vetoed");
  assert.equal(m.companionAllianceVeto(null), true, "unknown player vetoed");

  // autoAlliance off → companion does not interfere with auto-bot diplomacy.
  m.companionPatchSettings({ autoAlliance: false });
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), false);

  // Boss not yet found → veto nobody, so the auto-bot is never frozen out
  // just because the boss name is mistyped.
  m.companionPatchSettings({ autoAlliance: true });
  m.companionState.bossSmallID = null;
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), false, "no boss resolved → no veto");
}

// ---- pause is a real stop, and survives a new match --------------------------
{
  const autobotCalls = [];
  let autobotEnabled = false;
  fakeWindow.__OFH_autobot = {
    get: () => ({ enabled: autobotEnabled }),
    set: (p) => {
      autobotCalls.push(p);
      if ("enabled" in p) autobotEnabled = p.enabled;
    },
  };

  const m = loadCompanion(
    ENG,
    [
      "companionState",
      "companionPatchSettings",
      "companionResetRunState",
      "companionRunAction",
      "companionSpawnCenter",
      "companionAllianceVeto",
      "companionEnqueue",
      "COMPANION_QUEUE_LIMIT",
      "setCompanionEnabled",
    ],
    { sendGamePacket: () => true, registerHelperTickListener: () => {} },
  );

  const W = 100;
  const boss = {
    name: () => "Boss",
    smallID: () => 1,
    id: () => "p1",
    type: () => "HUMAN",
    isAlive: () => true,
    state: { spawnTile: 40 * W + 20 },
  };
  const game = {
    width: () => W,
    height: () => W,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < W,
    ref: (x, y) => y * W + x,
    isLand: () => true,
    hasOwner: () => false,
    isBorder: () => false,
    players: () => [
      boss,
      {
        name: () => "Me",
        smallID: () => 2,
        id: () => "p2",
        type: () => "HUMAN",
        isAlive: () => true,
      },
    ],
    myPlayer: () => ({ name: () => "Me", smallID: () => 2, id: () => "p2" }),
  };

  m.companionPatchSettings({
    bossName: "Boss",
    mode: "active",
    autoSpawn: true,
    autoAlliance: true,
  });
  m.companionState.enabled = true;
  m.companionState.bossSmallID = 1;

  // Baseline: while running, the hooks DO interfere.
  m.companionState.paused = false;
  assert.ok(m.companionSpawnCenter(game, null) != null, "running → spawn is overridden");
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), true, "running → stranger vetoed");

  // Paused means stop interfering — otherwise a "paused" companion still steals
  // the auto-bot's spawn and blocks every alliance it tries.
  m.companionState.paused = true;
  assert.equal(m.companionSpawnCenter(game, null), null, "paused → no spawn override");
  assert.equal(m.companionAllianceVeto({ smallID: () => 5 }), false, "paused → no veto");

  // Pausing is user intent, not match state. Auto-join can start the next match
  // on its own; clearing the pause there would let one feature of this script
  // silently undo the stop button of another.
  m.companionResetRunState();
  assert.equal(m.companionState.paused, true, "a new match must NOT clear the pause");

  // Turning the feature on again IS a fresh start, so there the pause does clear.
  m.companionState.paused = true;
  m.companionState.enabled = false;
  m.setCompanionEnabled(true);
  assert.equal(m.companionState.paused, false, "re-enabling clears the pause");

  // -- pause/resume must not switch on an auto-bot the user turned off ---------
  m.companionState.enabled = true;
  m.companionState.paused = false;
  autobotCalls.length = 0;
  autobotEnabled = false; // the user had it OFF
  m.companionRunAction("pause", {});
  m.companionRunAction("resume", {});
  assert.equal(
    autobotEnabled,
    false,
    "resume must not enable an auto-bot the user had switched off — " +
      "__OFH_autobot.set() persists to storage, so this would stick",
  );

  autobotEnabled = true; // the user had it ON
  m.companionState.paused = false;
  m.companionRunAction("pause", {});
  assert.equal(autobotEnabled, false, "pause stops the auto-bot too");
  m.companionRunAction("resume", {});
  assert.equal(autobotEnabled, true, "resume restores what the user had");

  // -- the queue is bounded, dropping the OLDEST -------------------------------
  m.companionState.queue.length = 0;
  for (let i = 0; i < m.COMPANION_QUEUE_LIMIT + 40; i++) {
    m.companionEnqueue("action" + i, () => {});
  }
  // Pin the constant itself, not just "the queue caps to whatever the constant
  // says" — the latter stays green no matter what the constant is changed to.
  assert.equal(m.COMPANION_QUEUE_LIMIT, 32, "the cap is 32");
  assert.equal(m.companionState.queue.length, 32, "queue is capped at 32");
  assert.equal(
    m.companionState.queue[m.companionState.queue.length - 1].label,
    "action" + (m.COMPANION_QUEUE_LIMIT + 39),
    "the newest action is kept",
  );
  assert.equal(
    m.companionState.queue[0].label,
    "action40",
    "and the oldest ones are the ones dropped",
  );

  delete fakeWindow.__OFH_autobot;
}

// ---- the warning banner keeps up with the tick -------------------------------
{
  // The banner exists so a player with several tabs open can tell at a glance
  // which one is a bot. A banner that goes stale defeats the whole point, so the
  // signature gate that drives it gets its own regression cover.
  let bannerCalls = 0;
  let panelCalls = 0;
  let tickBannerCalls = 0;
  let activeEl = null;
  const panelNode = { contains: (el) => el === panelNode.child, child: {} };

  const m = loadCompanion(ENG, ["companionSyncUi", "companionState", "companionPatchSettings"], {
    sendGamePacket: () => true,
    registerHelperTickListener: () => {},
    companionSyncBanner: () => {
      bannerCalls++;
    },
    companionBuildPanel: () => {
      panelCalls++;
    },
    document: {
      getElementById: () => panelNode,
      get activeElement() {
        return activeEl;
      },
    },
  });

  m.companionPatchSettings({ bossName: "Boss" });
  m.companionState.enabled = true;
  m.companionState.bossStatus = "missing";
  m.companionState.uiSignature = null;

  m.companionSyncUi();
  assert.equal(bannerCalls, 1, "first call renders the banner");
  assert.equal(panelCalls, 1, "and the panel");

  // A quiet tick must cost nothing — this runs every 250ms for the whole match.
  m.companionSyncUi();
  m.companionSyncUi();
  assert.equal(bannerCalls, 1, "an unchanged tick does not touch the DOM");
  assert.equal(panelCalls, 1, "for the panel either");

  // The boss turning up mid-match must move the banner off its red state.
  m.companionState.bossStatus = "found";
  m.companionSyncUi();
  assert.equal(bannerCalls, 2, "a status change re-renders the banner");

  // Pausing and the factory level are part of what the UI shows.
  m.companionState.paused = true;
  m.companionSyncUi();
  assert.equal(bannerCalls, 3, "pausing re-renders");
  m.companionState.factoryLevel = 4;
  m.companionSyncUi();
  assert.equal(bannerCalls, 4, "a factory level change re-renders");

  // While the user is typing into the panel, the banner still updates but the
  // panel must NOT be rebuilt — a rebuild would drop focus mid-edit.
  const panelBefore = panelCalls;
  activeEl = panelNode.child;
  m.companionState.bossStatus = "missing";
  m.companionSyncUi();
  assert.equal(bannerCalls, 5, "banner still updates while the user types");
  assert.equal(panelCalls, panelBefore, "but the panel is left alone");
  activeEl = null;

  // Disabling collapses the signature to a single value so the banner is torn
  // down exactly once, not on every following tick.
  m.companionState.enabled = false;
  m.companionSyncUi();
  const afterDisable = bannerCalls;
  m.companionSyncUi();
  assert.equal(bannerCalls, afterDisable, "disabled is a stable signature");

  // Reaching companionSyncUi only by calling it directly would not catch someone
  // dropping the call from companionTickThrottled — which is the one path that
  // actually runs in a match. Go through the real entry point for both of its
  // branches.
  const viaTick = loadCompanion(
    ENG,
    ["companionTickThrottled", "companionState", "companionPatchSettings"],
    {
      sendGamePacket: () => true,
      registerHelperTickListener: () => {},
      getOpenFrontGameContext: () => null, // no game → tick bails early
      companionSyncBanner: () => {
        tickBannerCalls++;
      },
      companionBuildPanel: () => {},
      document: { getElementById: () => null, activeElement: null },
    },
  );
  viaTick.companionPatchSettings({ bossName: "Boss", tickMs: 2000 });
  viaTick.companionState.enabled = true;
  viaTick.companionState.uiSignature = null;

  // Due branch.
  viaTick.companionState.lastTickAt = 0;
  viaTick.companionTickThrottled();
  assert.ok(tickBannerCalls >= 1, "the due branch of the tick syncs the banner");

  // Not-yet-due branch: the banner must still follow state that changed elsewhere
  // (an emoji command can pause the bot between two decision ticks).
  const afterDue = tickBannerCalls;
  viaTick.companionState.lastTickAt = Date.now();
  viaTick.companionState.paused = true;
  viaTick.companionTickThrottled();
  assert.equal(tickBannerCalls, afterDue + 1, "the not-yet-due branch syncs the banner too");
}

// ---- per-command emoji switches: emojiBindings[id] === null disables it -----
{
  // A disabled action must not be reachable by ANY emoji, while every other
  // action keeps working — companionBindings() drives both the panel's switch
  // state and the byEmoji lookup companionCollectCommands builds, so this pins
  // the contract between the two rather than re-deriving one from the other.
  store.clear();
  const m = loadCompanion(CMDS, [
    "companionBindings",
    "companionPatchSettings",
    "companionCollectCommands",
  ]);

  m.companionPatchSettings({ emojiBindings: { pause: null } });
  const bindings = m.companionBindings();
  assert.equal(
    "pause" in bindings,
    false,
    "a disabled action id is absent from companionBindings()'s output",
  );
  // Ground truth from commands.js's COMPANION_DEFAULT_BINDINGS, spelled out here
  // (not read back from the module) so this cannot pass merely because both
  // sides pulled the same possibly-wrong constant.
  assert.equal(bindings.donateAllGold, "🆘", "an untouched action keeps its default emoji");
  assert.equal(bindings.breakAlliance, "💔", "and so does another untouched one");

  const boss = {
    state: {
      outgoingEmojis: [
        { message: "🥱", senderID: 1, recipientID: 2, createdAt: 1 }, // disabled action's emoji
        { message: "🆘", senderID: 1, recipientID: 2, createdAt: 2 }, // still-enabled action
      ],
    },
  };
  const seen = [];
  assert.deepEqual(
    m.companionCollectCommands(boss, 2, bindings, seen),
    ["donateAllGold"],
    "the disabled action's emoji (🥱) yields no command; the enabled one (🆘) still fires",
  );

  // Re-enabling restores the default emoji as a live trigger again, and doing so
  // must not resurrect an unrelated action that is still disabled.
  m.companionPatchSettings({ emojiBindings: { pause: "🥱", donateAllGold: null } });
  const reEnabled = m.companionBindings();
  assert.equal(reEnabled.pause, "🥱", "re-enabling restores the emoji as a live trigger");
  assert.equal("donateAllGold" in reEnabled, false, "a still-disabled sibling stays disabled");
}

// ---- Active-mode spawn hook does not oscillate ------------------------------
{
  // companionSpawnCenter is the Active-mode counterpart of the passive spawn
  // branch tested above (via companionTick). It has its own call site
  // (nationExecution.js's pickSpawnCenter → doSpawn) and its own guard, so it
  // needs its own regression cover: doSpawn() only re-emits a spawn intent when
  // the tile this hook returns CHANGES, so a hook that re-picks on every call
  // (the bug being fixed here) emits a fresh packet every single tick.
  const m = loadCompanion(
    ENG,
    ["companionSpawnCenter", "companionState", "companionPatchSettings"],
    { sendGamePacket: () => true, registerHelperTickListener: () => {} },
  );

  const W = 100;
  const bossSpawnTileA = 40 * W + 20; // (20, 40)
  const owned = new Set();
  let hasSpawnedFlag = false;

  const boss = {
    name: () => "EcoMaxer",
    smallID: () => 1,
    id: () => "p1",
    type: () => "HUMAN",
    isAlive: () => true,
    state: { spawnTile: bossSpawnTileA },
  };
  const me = {
    name: () => "Slave1",
    smallID: () => 2,
    hasSpawned: () => hasSpawnedFlag,
  };
  const game = {
    width: () => W,
    height: () => W,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < W && y < W,
    ref: (x, y) => y * W + x,
    isLand: () => true,
    hasOwner: (t) => owned.has(t),
    isBorder: () => false,
    myPlayer: () => me,
    players: () => [
      boss,
      {
        name: () => "Slave1",
        smallID: () => 2,
        id: () => "p2",
        type: () => "HUMAN",
        isAlive: () => true,
      },
    ],
  };

  m.companionPatchSettings({ bossName: "EcoMaxer", mode: "active", autoSpawn: true });
  m.companionState.enabled = true;
  m.companionState.paused = false;

  const results = [];
  for (let i = 0; i < 20; i++) {
    const tile = m.companionSpawnCenter(game, null);
    results.push(tile);
    // Simulate what a real match does the instant a directed spawn lands: our
    // own territory now owns the tile we were just given (the trigger for the
    // relinquish/re-conquer bug — SpawnExecution frees whatever we owned before
    // and claims only the new one), and the player has landed. This has to run
    // after EVERY call, not just the first: a guard that stops recomputing
    // altogether never notices, but a guard that only checks "same as the
    // previous call" would still walk a fresh tile every time this keeps
    // moving — which is exactly the two-step cycle the fix has to survive.
    owned.clear();
    if (tile != null) owned.add(tile);
    hasSpawnedFlag = true;
  }

  assert.ok(results[0] != null, "first call picks a tile");
  const dist0 = Math.hypot((results[0] % W) - 20, Math.floor(results[0] / W) - 40);
  assert.ok(dist0 >= 12 - 1e-9 && dist0 <= 24 + 1e-9, "first pick sits inside the configured ring");

  for (let i = 1; i < results.length; i++) {
    assert.equal(
      results[i],
      results[1],
      `call ${i + 1} must return the exact same tile as call 2 — no oscillation`,
    );
  }

  // The boss relocating (a fresh boss spawn) must still be tracked — the guard
  // must not freeze the companion onto a stale tile forever.
  const bossSpawnTileB = 10 * W + 70; // far enough the two rings never overlap
  boss.state.spawnTile = bossSpawnTileB;
  const moved = m.companionSpawnCenter(game, null);
  assert.ok(moved != null, "boss relocation still yields a tile");
  assert.notEqual(moved, results[1], "boss relocation is not answered with the frozen tile");
  const distMoved = Math.hypot((moved % W) - 70, Math.floor(moved / W) - 10);
  assert.ok(
    distMoved >= 12 - 1e-9 && distMoved <= 24 + 1e-9,
    "the new pick sits inside the ring around the boss's NEW spawn tile",
  );
}

// ---- v2 settings: spawnStrategy + collapsedSections -------------------------
{
  store.clear();
  const m = loadCompanion(CORE, [
    "COMPANION_DEFAULTS", "companionSettings", "companionPatchSettings",
    "companionCoerceSetting", "companionState",
  ]);

  // Defaults.
  assert.equal(m.companionSettings().spawnStrategy, "boss", "default spawn strategy is boss");
  assert.deepEqual(
    m.companionSettings().collapsedSections,
    { support: false, economy: true, advanced: true },
    "default: support open, economy/advanced collapsed",
  );
  assert.equal(m.companionState.autobotSuppressed, false, "autobotSuppressed starts false");

  // spawnStrategy is an enum: garbage keeps the previous value.
  m.companionPatchSettings({ spawnStrategy: "auto" });
  assert.equal(m.companionSettings().spawnStrategy, "auto", "valid enum applies");
  m.companionPatchSettings({ spawnStrategy: "nonsense" });
  assert.equal(m.companionSettings().spawnStrategy, "auto", "bad enum keeps previous value");
  m.companionPatchSettings({ spawnStrategy: 5 });
  assert.equal(m.companionSettings().spawnStrategy, "auto", "non-string keeps previous value");

  // collapsedSections coercion: an object of booleans; unknown keys dropped,
  // values forced to boolean, non-object rejected.
  assert.deepEqual(
    m.companionCoerceSetting("collapsedSections", { support: true, junk: 1 }),
    { support: true },
    "keeps known section keys as booleans, drops unknown keys",
  );
  assert.deepEqual(
    m.companionCoerceSetting("collapsedSections", { economy: 0, advanced: "x" }),
    { economy: false, advanced: true },
    "values coerce to real booleans",
  );
  assert.equal(m.companionCoerceSetting("collapsedSections", "nope"), undefined,
    "a non-object is rejected");
  assert.equal(m.companionCoerceSetting("collapsedSections", [1, 2]), undefined,
    "an array is rejected");
  assert.equal(m.companionCoerceSetting("collapsedSections", null), undefined,
    "null is rejected (there is always a default object)");

  // Patch merges section flags rather than replacing the whole object, so
  // toggling one accordion does not wipe the others.
  m.companionPatchSettings({ collapsedSections: { economy: false } });
  assert.deepEqual(
    m.companionSettings().collapsedSections,
    { support: false, economy: false, advanced: true },
    "patching one section flag preserves the rest",
  );
}

{
  // A stored blob with an out-of-range spawnStrategy falls back to the default.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(m0.COMPANION_STORAGE_KEY, JSON.stringify({ spawnStrategy: "sideways" }));
  const m = loadCompanion(CORE, ["companionSettings"]);
  assert.equal(m.companionSettings().spawnStrategy, "boss", "bad stored enum → default");
}

console.log("COMPANION OK — pure helpers behave");
