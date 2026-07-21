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
  const stubEntries = Object.entries(stubs || {});
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
    { getElementById: () => null },
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
  assert.equal(s.maxFactories, 20, "default maxFactories");
  assert.strictEqual(m.companionSettings(), s, "settings() is a stable reference");

  m.companionPatchSettings({ bossName: "EcoMaxer", maxFactories: 5 });
  assert.equal(m.companionSettings().bossName, "EcoMaxer", "patch applied");
  const raw = JSON.parse(store.get(m.COMPANION_STORAGE_KEY));
  assert.equal(raw.bossName, "EcoMaxer", "patch persisted");
  assert.equal(raw.maxFactories, 5, "numeric patch persisted");
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
  assert.equal(s.maxFactories, 20, "missing key falls back to default");
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
    "companionSettings", "companionPatchSettings", "companionCoerceSetting",
    "COMPANION_STORAGE_KEY",
  ]);

  // An emptied number input yields NaN. It must NOT land in settings — a NaN
  // maxFactories makes `factories < maxFactories` false forever, silently
  // switching auto-factory off with nothing on screen to explain it.
  m.companionPatchSettings({ maxFactories: Number.NaN });
  assert.equal(m.companionSettings().maxFactories, 20, "NaN keeps the previous value");

  m.companionPatchSettings({ maxFactories: "not-a-number" });
  assert.equal(m.companionSettings().maxFactories, 20, "garbage string keeps previous value");

  // Numbers are clamped to their declared range, not rejected.
  m.companionPatchSettings({ troopNeedPct: 500 });
  assert.equal(m.companionSettings().troopNeedPct, 100, "clamped to max");
  m.companionPatchSettings({ troopSendPct: -5 });
  assert.equal(m.companionSettings().troopSendPct, 1, "clamped to min");
  m.companionPatchSettings({ tickMs: 10 });
  assert.equal(m.companionSettings().tickMs, 250, "tick floor");
  m.companionPatchSettings({ maxFactories: 0 });
  assert.equal(m.companionSettings().maxFactories, 0, "zero factories is a legal setting");
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

  assert.equal(m.companionCoerceSetting("maxFactories", "7"), 7, "numeric string is usable");
  assert.equal(m.companionCoerceSetting("maxFactories", Number.NaN), undefined);
}

{
  // A stored blob written by an older build cannot inject out-of-range values.
  store.clear();
  const m0 = loadCompanion(CORE, ["COMPANION_STORAGE_KEY"]);
  store.set(m0.COMPANION_STORAGE_KEY, JSON.stringify({
    maxFactories: 99999, troopNeedPct: "junk", mode: "nonsense", tickMs: 1,
  }));
  const m = loadCompanion(CORE, ["companionSettings"]);
  const s = m.companionSettings();
  assert.equal(s.maxFactories, 100, "stored value clamped on load");
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
    "COMPANION_DEFAULTS", "COMPANION_NUMBER_RANGES", "COMPANION_ENUMS",
    "companionCoerceSetting",
  ]);
  const explicit = new Set([
    ...Object.keys(m.COMPANION_NUMBER_RANGES),
    ...Object.keys(m.COMPANION_ENUMS),
    "bossName", "emojiBindings", "pos",
  ]);
  const unhandled = Object.keys(m.COMPANION_DEFAULTS).filter(
    (k) => typeof m.COMPANION_DEFAULTS[k] !== "boolean" && !explicit.has(k),
  );
  assert.deepEqual(unhandled, [],
    `these non-boolean settings have no coercion branch and would be forced to a `
    + `boolean: ${unhandled.join(", ")}`);

  // And the converse: every key claiming an explicit branch actually exists.
  const missing = [...explicit].filter((k) => !(k in m.COMPANION_DEFAULTS));
  assert.deepEqual(missing, [], `coercion branches for keys that do not exist: ${missing.join(", ")}`);
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

  assert.deepEqual(companionResolveBoss(game, ""), { status: "idle", boss: null },
    "empty name → idle");
  assert.deepEqual(companionResolveBoss(game, "   "), { status: "idle", boss: null },
    "whitespace-only name → idle");

  const found = companionResolveBoss(game, "EcoMaxer");
  assert.equal(found.status, "found");
  assert.equal(found.boss.smallID(), 1);

  assert.equal(companionResolveBoss(game, "ecomaxer").status, "found",
    "name match is case-insensitive");
  assert.equal(companionResolveBoss(game, " EcoMaxer ").status, "found",
    "name match trims whitespace");

  assert.deepEqual(companionResolveBoss(game, "Nobody"), { status: "missing", boss: null });
  assert.equal(companionResolveBoss(game, "France").status, "missing",
    "a Nation is never the boss");
  assert.equal(companionResolveBoss(game, "Bot4").status, "missing",
    "a regular bot is never the boss");

  assert.deepEqual(companionResolveBoss(game, "Slave1"), { status: "self", boss: null },
    "this tab IS the boss → self");

  // A dead boss is not a usable boss.
  const deadBoss = mkPlayer("Ghost", 5, "HUMAN", false);
  const g2 = { players: () => [me, deadBoss], myPlayer: () => me };
  assert.equal(companionResolveBoss(g2, "Ghost").status, "missing", "dead boss → missing");

  // Never throws on a broken/absent game.
  assert.deepEqual(companionResolveBoss(null, "EcoMaxer"), { status: "missing", boss: null });
  assert.deepEqual(companionResolveBoss({}, "EcoMaxer"), { status: "missing", boss: null });

  const humans = companionHumanPlayers(game);
  assert.deepEqual(humans.map((p) => p.name()), ["EcoMaxer", "Slave1"],
    "dropdown lists live humans only");
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
    ["donateAllGold", "donateAllTroops", "breakAlliance", "requestAlliance",
     "attackBossTarget", "buildFactory", "pause", "resume"],
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
    message: "🆘", senderID: 1, recipientID: 2, createdAt: 500,
  });
  assert.equal(key, "1:2:🆘:500", "dedupe key covers sender, recipient, emoji and tick");

  const B = m.COMPANION_DEFAULT_BINDINGS;
  const mkBoss = (emojis) => ({ state: { outgoingEmojis: emojis } });

  // Addressed to me → runs.
  let seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 10 }]), 2, B, seen),
    ["donateAllGold"],
  );

  // Same emoji still sitting in the array on the next tick → must NOT repeat.
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 10 }]), 2, B, seen),
    [],
    "dedupe by createdAt stops the multitab re-fire bug",
  );

  // Same emoji sent AGAIN later is a new command.
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: 99 }]), 2, B, seen),
    ["donateAllGold"],
    "a later createdAt is a fresh command",
  );

  // Addressed to a different bot → ignored.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 7, createdAt: 1 }]), 2, B, seen),
    [],
    "emoji for another slave is not mine",
  );

  // Broadcast → every bot obeys. (The multitab original skipped AllPlayers.)
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "💔", senderID: 1, recipientID: "AllPlayers", createdAt: 1 }]), 2, B, seen),
    ["breakAlliance"],
    "AllPlayers is the all-bots channel",
  );

  // Unbound emoji → nothing.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "😀", senderID: 1, recipientID: 2, createdAt: 1 }]), 2, B, seen),
    [],
  );

  // Remapped binding wins over the default.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(
      mkBoss([{ message: "😀", senderID: 1, recipientID: 2, createdAt: 1 }]), 2,
      Object.assign({}, B, { donateAllGold: "😀" }), seen),
    ["donateAllGold"],
  );

  // Multiple commands in one tick keep array order.
  seen = [];
  assert.deepEqual(
    m.companionCollectCommands(mkBoss([
      { message: "🥱", senderID: 1, recipientID: 2, createdAt: 1 },
      { message: "🆘", senderID: 1, recipientID: "AllPlayers", createdAt: 2 },
    ]), 2, B, seen),
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
  for (let i = 0; i < m.COMPANION_SEEN_LIMIT + 50; i++) {
    m.companionCollectCommands(
      mkBoss([{ message: "🆘", senderID: 1, recipientID: 2, createdAt: i }]), 2, B, seen);
  }
  assert.ok(seen.length <= m.COMPANION_SEEN_LIMIT, "seen list is capped");
}

// ---- unresolved smallID must not match anything -----------------------------
{
  const m = loadCompanion(CMDS, [
    "COMPANION_DEFAULT_BINDINGS", "companionCollectCommands",
  ]);
  const B = m.COMPANION_DEFAULT_BINDINGS;
  const boss = { state: { outgoingEmojis: [
    { message: "🆘", senderID: 1, recipientID: 0, createdAt: 1 },
  ] } };

  // Number(null) === 0, and 0 is TerraNullius's sentinel smallID. An unresolved
  // caller must collect nothing rather than obey messages addressed to nobody.
  let seen = [];
  assert.deepEqual(m.companionCollectCommands(boss, null, B, seen), [],
    "null smallID matches nothing");
  assert.deepEqual(seen, [], "null smallID does not even record a dedupe key");

  seen = [];
  assert.deepEqual(m.companionCollectCommands(boss, undefined, B, seen), [],
    "undefined smallID matches nothing");

  // A broadcast is still ignored while our identity is unknown — acting on an
  // all-bots order before we know who we are is what the guard prevents.
  seen = [];
  const broadcast = { state: { outgoingEmojis: [
    { message: "🆘", senderID: 1, recipientID: "AllPlayers", createdAt: 1 },
  ] } };
  assert.deepEqual(m.companionCollectCommands(broadcast, null, B, seen), [],
    "broadcast ignored until our smallID is known");

  // A real smallID of 0 is impossible for a player (players start at 1), but the
  // guard must not break the normal path.
  seen = [];
  assert.deepEqual(m.companionCollectCommands(boss, 0, B, seen), ["donateAllGold"],
    "an explicit 0 still works — only null/undefined are treated as unresolved");
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
    ["companionSend", "companionDonateGold", "companionDonateTroops",
     "companionRequestAlliance", "companionBreakAlliance",
     "companionBossNeedsTroops", "companionIsAlliedWithBoss", "companionState"],
    { sendGamePacket: (o) => { sent.push(o); return sendResult; } },
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
  const m = loadCompanion(ACTS,
    ["companionBossNeedsTroops", "companionIsAlliedWithBoss"],
    { sendGamePacket: () => true });

  const game = { config: () => ({ maxTroops: () => 10000 }) };
  assert.equal(m.companionBossNeedsTroops(game, { troops: () => 5000 }, 60), true,
    "50% of max is below the 60% threshold");
  assert.equal(m.companionBossNeedsTroops(game, { troops: () => 9000 }, 60), false,
    "90% of max is above the threshold");
  assert.equal(m.companionBossNeedsTroops(game, { troops: () => 6000 }, 60), true,
    "exactly at the threshold still counts as needing");
  assert.equal(m.companionBossNeedsTroops(null, { troops: () => 1 }, 60), false,
    "no game → false, never throw");
  assert.equal(m.companionBossNeedsTroops({ config: () => ({ maxTroops: () => 0 }) },
    { troops: () => 1 }, 60), false, "zero max troops → false, no divide-by-zero");

  const boss = { smallID: () => 1 };
  assert.equal(m.companionIsAlliedWithBoss(
    { isOnSameTeam: () => true, isAlliedWith: () => false }, boss), true, "same team counts");
  assert.equal(m.companionIsAlliedWithBoss(
    { isOnSameTeam: () => false, isAlliedWith: () => true }, boss), true, "allied counts");
  assert.equal(m.companionIsAlliedWithBoss(
    { isOnSameTeam: () => false, isAlliedWith: () => false }, boss), false);
  assert.equal(m.companionIsAlliedWithBoss({}, boss), false, "missing methods → false");
  assert.equal(m.companionIsAlliedWithBoss(null, null), false);
}

console.log("COMPANION OK — pure helpers behave");
