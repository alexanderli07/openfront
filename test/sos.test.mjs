// Auto-SOS: fires only when under attack AND low on troops; manual Shift+S path.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies (A) the automatic SOS trigger and (B) auto-leave-on-loss, using the REAL
// sliced functions from quick-panel.js and auto-leave.js.
import { source, suite } from "./lib/harness.mjs";
const qp = source("engine/ingame/quick-panel.js");
const al = source("engine/ingame/auto-leave.js");
const adv = source("engine/ingame/advisor-intel.js");
const boot = source("engine/ingame/bootstrap.js");
const lobby = source("engine/lobby/core.js");
const settings = source("engine/shared/settings.js");
const popup = source("src/shell/popup/panel.ts");

function cut(src, a0, b0, label) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start " + label + ": " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end " + label + ": " + b0);
  return src.slice(a, b + b0.length);
}

const t = suite("sos");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

// ───────────────────────────────────────────────────────────── A. automatic SOS
// Real slices: the advisor helpers the trigger leans on, plus the trigger itself.
const fnAdvIncoming = cut(
  adv,
  "function advIncomingTroops(me) {",
  "return sum;\n  }",
  "advIncoming",
);
const fnAdvMax = cut(adv, "function advMaxTroops(game, player) {", "return 0;\n  }", "advMax");
const fnAdvTroops = cut(adv, "function advTroops(player) {", "return 0;\n    }\n  }", "advTroops");
const sosConsts = cut(qp, "var SOS_AUTO_POLL_MS", "var _sosAutoStreak = 0;", "sosConsts");
const fnDistress = cut(
  qp,
  "function _sosDistress() {",
  "return { game: game, me: me };\n  }",
  "distress",
);
const fnAutoTick = cut(
  qp,
  "function _sosAutoTick() {",
  "if (_doSosCall(true)) _sosAutoLastSentAt = now;\n  }",
  "autoTick",
);
const fnSetEnabled = cut(
  qp,
  "function setSosDefenseEnabled(enabled) {",
  "_sosAutoStreak = 0;\n    }\n  }",
  "setEnabled",
);

for (const [n, t, needle] of [
  ["distress", fnDistress, "advIncomingTroops(me)"],
  ["distress", fnDistress, "SOS_AUTO_LOW_FRAC"],
  ["autoTick", fnAutoTick, "SOS_AUTO_CONFIRM_POLLS"],
])
  if (!t.includes(needle)) throw new Error("slice " + n + " missing " + needle);

const build = (env) =>
  new Function(
    "env",
    `
  const { getOpenFrontGameContext, _sosRecipients, _doSosCall, clock, timers } = env;
  ${fnAdvIncoming}
  ${fnAdvMax}
  ${fnAdvTroops}
  ${sosConsts}
  var _sosAutoStreak = 0;
  const Date = { now: () => clock.now };
  const window = { setInterval: (fn, ms) => timers.set(fn, ms), };
  const clearInterval = (h) => timers.clear(h);
  ${fnDistress}
  ${fnAutoTick}
  ${fnSetEnabled}
  return {
    tick: _sosAutoTick, distress: _sosDistress, setEnabled: setSosDefenseEnabled,
    streak: () => _sosAutoStreak,
    consts: {
      POLL: SOS_AUTO_POLL_MS, REPEAT: SOS_AUTO_REPEAT_MS,
      WAVE: SOS_AUTO_WAVE_FRAC, LOW: SOS_AUTO_LOW_FRAC, CONFIRM: SOS_AUTO_CONFIRM_POLLS,
    },
  };
`,
  )(env);

// world: { troops, max, attacks:[{troops,retreating}], alive, spawnPhase, recipients }
function world(o) {
  const w = Object.assign(
    {
      troops: 500_000,
      max: 1_000_000,
      attacks: [],
      alive: true,
      spawnPhase: false,
      recipients: 2,
      noCtx: false,
      noGame: false,
    },
    o,
  );
  const sent = [];
  const timers = {
    handles: [],
    set(fn, ms) {
      this.handles.push({ fn, ms });
      return this.handles.length;
    },
    clear(h) {
      this.handles.splice(h - 1, 1);
    },
  };
  const clock = { now: 1_000_000 };
  const me = {
    troops: () => w.troops,
    isAlive: () => w.alive,
    incomingAttacks: () => w.attacks,
  };
  const game = {
    myPlayer: () => me,
    inSpawnPhase: () => w.spawnPhase,
    config: () => ({ maxTroops: () => w.max }),
  };
  const api = build({
    clock,
    timers,
    getOpenFrontGameContext: () => {
      if (w.noCtx) throw new Error("no ctx");
      return w.noGame ? {} : { game };
    },
    _sosRecipients: () => new Array(w.recipients).fill({}),
    _doSosCall: (silent) => {
      sent.push({ silent, at: clock.now });
      return w.recipients > 0;
    },
  });
  return { w, api, sent, clock, timers };
}

t.section("the trigger is under attack AND low on troops (both)");
{
  const { api } = world({});
  const c = api.consts;
  check(
    "wave floor 5% of cap, low mark 35% of cap",
    c.WAVE === 0.05 && c.LOW === 0.35,
    c.WAVE + " / " + c.LOW,
  );
  check(
    "confirms over 2 polls, repeats at most once a minute",
    c.CONFIRM === 2 && c.REPEAT === 60000 && c.POLL === 2000,
  );
}
{
  // low troops but nothing incoming
  const { api } = world({ troops: 200_000, attacks: [] });
  check("low troops, no attack: no distress", api.distress() === null);
}
{
  // big attack but troops healthy
  const { api } = world({ troops: 700_000, attacks: [{ troops: 300_000 }] });
  check("big attack, troops healthy: no distress", api.distress() === null);
}
{
  const { api } = world({ troops: 200_000, attacks: [{ troops: 300_000 }] });
  check("big attack AND low troops: distress", api.distress() !== null);
}
{
  // a trickle while low — must not fire (5% of 1M = 50k)
  const { api } = world({ troops: 200_000, attacks: [{ troops: 49_999 }] });
  check("trickle (under 5% of cap) while low: no distress", api.distress() === null);
  const { api: api2 } = world({ troops: 200_000, attacks: [{ troops: 50_001 }] });
  check("just over the wave floor: distress", api2.distress() !== null);
}
{
  // exactly on the low mark counts; just above does not
  const { api } = world({ troops: 350_000, attacks: [{ troops: 100_000 }] });
  check("troops exactly at 35% of cap: distress", api.distress() !== null);
  const { api: api2 } = world({ troops: 350_001, attacks: [{ troops: 100_000 }] });
  check("troops a hair above 35%: no distress", api2.distress() === null);
}
{
  // RETREATING attacks are not a threat — advIncomingTroops already excludes them
  const { api } = world({ troops: 200_000, attacks: [{ troops: 300_000, retreating: true }] });
  check("a retreating attack does not count as being under attack", api.distress() === null);
}
{
  const { api } = world({ troops: 200_000, attacks: [{ troops: 300_000 }], spawnPhase: true });
  check("spawn phase: never", api.distress() === null);
}
{
  const { api } = world({ troops: 200_000, attacks: [{ troops: 300_000 }], alive: false });
  check("already dead: never", api.distress() === null);
}
{
  const { api } = world({ troops: 200_000, attacks: [{ troops: 300_000 }], max: 0 });
  check("no troop cap available: bails instead of guessing", api.distress() === null);
}
{
  const { api } = world({ noCtx: true });
  check("no game context: bails quietly", api.distress() === null);
  const { api: api2 } = world({ noGame: true });
  check("context without a game: bails quietly", api2.distress() === null);
}

t.section("firing: debounce, silence, repeat clock");
{
  const { api, sent } = world({ troops: 200_000, attacks: [{ troops: 300_000 }] });
  api.tick();
  check("one poll of distress does NOT fire yet (debounce)", sent.length === 0, api.streak());
  api.tick();
  check("second consecutive poll fires", sent.length === 1);
  check("fired with refusals silenced", sent[0].silent === true);
}
{
  const { api, sent, w } = world({ troops: 200_000, attacks: [{ troops: 300_000 }] });
  api.tick();
  api.tick();
  check("fires once", sent.length === 1);
  // A momentary recovery must reset the streak, so it re-confirms before firing again.
  w.troops = 900_000;
  api.tick();
  check("recovery resets the streak", api.streak() === 0);
}
{
  const { api, sent, clock } = world({ troops: 200_000, attacks: [{ troops: 300_000 }] });
  api.tick();
  api.tick();
  for (let i = 0; i < 20; i++) {
    clock.now += 2000;
    api.tick();
  } // 40s of siege
  check("no second SOS inside the one-minute window", sent.length === 1, sent.length);
  clock.now += 25_000; // now past 60s
  api.tick();
  check("re-sends once the minute is up", sent.length === 2);
}
{
  const { api, sent } = world({ troops: 200_000, attacks: [{ troops: 300_000 }], recipients: 0 });
  api.tick();
  api.tick();
  api.tick();
  check("solo player under siege: never reaches the send path (no toast spam)", sent.length === 0);
}

t.section("the toggle drives one timer");
{
  const { api, timers } = world({});
  api.setEnabled(true);
  check("on: installs a poll timer", timers.handles.length === 1, timers.handles[0]?.ms);
  api.setEnabled(true);
  check("on twice: still one timer", timers.handles.length === 1);
  api.setEnabled(false);
  check("off: clears it", timers.handles.length === 0);
  api.setEnabled(false);
  check("off twice: harmless", timers.handles.length === 0);
}

t.section("_doSosCall returns a verdict and can stay quiet");
{
  const body = cut(qp, "function _doSosCall(silent) {", "return true;\n  }", "doSos");
  const refusals = (body.match(/return false;/g) || []).length;
  check("every refusal path returns false (5)", refusals === 5, refusals);
  const guarded = (body.match(/if \(!silent\) _toast/g) || []).length;
  check("every refusal toast is silenced-able (5)", guarded === 5, guarded);
  check(
    "the SUCCESS toast is never silenced — an auto-SOS still tells you",
    body.includes('_toast("🆘 " + _tr("SOS sent to {n}")') &&
      !body.includes('if (!silent) _toast("🆘'),
  );
  check("manual hotkey path still calls it", qp.includes("_doSosCall();"));
}

t.section("B. auto-leave on loss");
const alState = cut(
  al,
  "let autoLeaveOnTeamWin = false;",
  "let autoLeaveFired = false; // navigated already this page-load",
  "alState",
);
const fnCheck = cut(
  al,
  "function checkAutoLeave() {",
  "// navigation is best-effort\n    }\n  }",
  "checkAutoLeave",
);
const fnSync = cut(
  al,
  "function syncAutoLeaveTimer() {",
  "autoLeaveTimer = null;\n    }\n  }",
  "syncTimer",
);
const fnSetWin = cut(
  al,
  "function setAutoLeaveOnTeamWinEnabled(enabled) {",
  "syncAutoLeaveTimer();\n  }",
  "setWin",
);
const fnSetLoss = cut(
  al,
  "function setAutoLeaveOnLossEnabled(enabled) {",
  "syncAutoLeaveTimer();\n  }",
  "setLoss",
);

// `location` is a real accessor here so an href assignment is actually recorded.
function leaveWorld(modal) {
  const nav = [];
  const timers = {
    handles: [],
    set(fn, ms) {
      this.handles.push({ fn, ms });
      return this.handles.length;
    },
    clear(h) {
      this.handles.splice(h - 1, 1);
    },
  };
  const loc = {};
  Object.defineProperty(loc, "href", { set: (v) => nav.push(v), get: () => "/game" });
  const api = new Function(
    "env",
    `
    const { modal, timers, loc } = env;
    const document = { querySelector: (s) => (s === "win-modal" ? modal : null) };
    const window = { setInterval: (fn, ms) => timers.set(fn, ms), location: loc };
    const clearInterval = (h) => timers.clear(h);
    ${alState}
    ${fnCheck}
    ${fnSync}
    ${fnSetWin}
    ${fnSetLoss}
    return {
      check: checkAutoLeave, onWin: setAutoLeaveOnTeamWinEnabled,
      onLoss: setAutoLeaveOnLossEnabled,
    };
  `,
  )({ modal, timers, loc });
  return { api, nav, timers };
}

{
  // loss-only enabled
  const m = { isVisible: true, isWin: false };
  const { api, nav } = leaveWorld(m);
  api.onLoss(true);
  api.check();
  check("loss enabled + losing modal: leaves", nav.length === 1 && nav[0] === "/", nav[0]);
  api.check();
  check("only navigates once per page-load", nav.length === 1);
}
{
  const m = { isVisible: true, isWin: true };
  const { api, nav } = leaveWorld(m);
  api.onLoss(true);
  api.check();
  check("loss enabled + WIN modal: stays (that is the other switch)", nav.length === 0);
}
{
  const m = { isVisible: true, isWin: true };
  const { api, nav } = leaveWorld(m);
  api.onWin(true);
  api.check();
  check("win enabled + win modal: leaves (unchanged behaviour)", nav.length === 1);
}
{
  const m = { isVisible: true, isWin: false };
  const { api, nav } = leaveWorld(m);
  api.onWin(true);
  api.check();
  check("win enabled + losing modal: stays (unchanged behaviour)", nav.length === 0);
}
{
  // being ELIMINATED mid-game: the death modal leaves isWin at its false default
  const m = { isVisible: true, isWin: false };
  const { api, nav } = leaveWorld(m);
  api.onLoss(true);
  api.check();
  check("eliminated mid-game (death modal): leaves", nav.length === 1);
}
{
  const m = { isVisible: false, isWin: false };
  const { api, nav } = leaveWorld(m);
  api.onLoss(true);
  api.onWin(true);
  api.check();
  check("modal not visible: stays", nav.length === 0);
}
{
  // element not upgraded yet — both flags undefined
  const m = {};
  const { api, nav } = leaveWorld(m);
  api.onLoss(true);
  api.check();
  check("un-upgraded modal element: stays", nav.length === 0);
}
{
  const { api, nav } = leaveWorld(null);
  api.onLoss(true);
  api.check();
  check("no modal in the DOM at all: stays", nav.length === 0);
}
{
  const m = { isVisible: true, isWin: false };
  const { api, nav } = leaveWorld(m);
  api.check();
  check("neither switch on: stays", nav.length === 0);
}
{
  const m = { isVisible: true, isWin: false };
  const { api, timers } = leaveWorld(m);
  api.onWin(true);
  check("one timer for both switches", timers.handles.length === 1);
  api.onLoss(true);
  check("enabling the second does not add a second timer", timers.handles.length === 1);
  api.onWin(false);
  check("timer survives while one switch is still on", timers.handles.length === 1);
  api.onLoss(false);
  check("timer cleared once both are off", timers.handles.length === 0);
}

t.section("wiring");
check("setting default present", /^\s*autoLeaveOnLoss: false,$/m.test(settings));
check("lobby posts SET_AUTO_LEAVE_ON_LOSS", lobby.includes('type: "SET_AUTO_LEAVE_ON_LOSS"'));
check("lobby calls the sync on init", lobby.includes("syncAutoLeaveOnLossHelper();\n"));
check(
  "bootstrap routes SET_AUTO_LEAVE_ON_LOSS",
  boot.includes('data.type === "SET_AUTO_LEAVE_ON_LOSS"') &&
    boot.includes("setAutoLeaveOnLossEnabled(data.payload?.enabled)"),
);
check(
  "bootstrap routes SET_SOS_DEFENSE (the message that went nowhere)",
  boot.includes('data.type === "SET_SOS_DEFENSE"') &&
    boot.includes("setSosDefenseEnabled(data.payload?.enabled)"),
);
check("popup has an auto-leave-on-loss row", popup.includes('"Auto-leave on loss"'));
check("popup sosDefense row rewritten", popup.includes("Auto SOS when losing"));
check(
  "quick-panel dispatch can now resolve setSosDefenseEnabled",
  qp.includes('case "sosDefense":') && qp.includes("function setSosDefenseEnabled(enabled) {"),
);
check(
  "quick-panel tooltip no longer promises the cut HUD-marking feature",
  !qp.includes("marks attackers in allied HUDs"),
);
{
  const bundle = source("openfront-helper.user.js");
  check(
    "built bundle carries both features",
    bundle.includes("SET_AUTO_LEAVE_ON_LOSS") && bundle.includes("SOS_AUTO_LOW_FRAC".slice(0, 8)),
  );
}

t.done();
