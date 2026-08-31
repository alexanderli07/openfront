// Bot emojis silenced at the one choke point, with the shared RNG draw preserved.
//
// Ported from a session harness. See ./lib/harness.mjs for why these tests slice real
// source text rather than importing it, and for what they do and do not prove.

// Verifies (a) the bot's emoji send is unconditionally removed, with the REAL sliced
// EmojiBehavior.sendEmoji, and (b) this turn's panel cleanups.
import { source, suite } from "./lib/harness.mjs";
const EB = source("engine/ingame/auto-bot/emojiBehavior.js");
const CORE = source("engine/ingame/auto-bot/core.js");
const PANEL = source("engine/ingame/auto-bot/panel.js");
const QP = source("engine/ingame/quick-panel.js");
const AJ = source("engine/lobby/floating-autojoin.js");
const BUNDLE = source("openfront-helper.user.js");

function cut(src, a0, b0) {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error("start: " + a0);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error("end: " + b0);
  return src.slice(a, b + b0.length);
}
const fnSend = cut(
  EB,
  "sendEmoji(otherPlayer, emojisList) {",
  'setLastAction(tr("💬 Emoji"), "diplo");\n    }',
);

const t = suite("emoji");
// Bare alias so every ported assertion below reads exactly as written.
const check = (name, ok, detail) => t.check(name, ok, detail);

function build() {
  const emitted = [],
    rng = [],
    actions = [];
  const AllPlayers = Symbol("AllPlayers");
  const B = new Function(
    "env",
    `
    const { discoverCtors, getEventBus, emitIntent, setLastAction, tr, AllPlayers } = env;
    class B {
      constructor(r) { this.random = r; this._can = true; this._should = true; }
      shouldSendEmoji() { return this._should; }
      canSendEmoji() { return this._can; }
      ${fnSend}
    }
    return B;
  `,
  )({
    discoverCtors: () => ({ emoji: "EMOJI_CTOR" }),
    getEventBus: () => ({}),
    emitIntent: (c, r, n) => {
      emitted.push({ c, r, n });
      return true;
    },
    setLastAction: (l, cat) => actions.push([l, cat]),
    tr: (s) => s,
    AllPlayers,
  });
  const b = new B({
    randElement: (list) => {
      rng.push(list.length);
      return list[0];
    },
  });
  return { b, emitted, rng, actions, AllPlayers };
}

t.section("the bot's emoji send is gone, unconditionally");
{
  const { b, emitted, actions } = build();
  b.sendEmoji({ __src: "P2" }, [7, 8]);
  check("a targeted emoji emits NOTHING", emitted.length === 0);
  check("and logs nothing", actions.length === 0);
}
{
  const { b, emitted, AllPlayers } = build();
  b.sendEmoji(AllPlayers, [12]);
  check("a broadcast emits nothing either (nuke / warship)", emitted.length === 0);
}
{
  // No state/settings object is referenced at all any more.
  const { b } = build();
  let threw = null;
  try {
    b.sendEmoji({ __src: "P2" }, [1]);
  } catch (e) {
    threw = e;
  }
  check(
    "it does not touch state.settings (would throw in this stub)",
    threw === null,
    threw ? String(threw.message) : "",
  );
  check("no setting name survives in the method", !fnSend.includes("botEmojis"));
}

t.section("but the shared RNG stream is untouched");
{
  const { b, rng } = build();
  b.sendEmoji({ __src: "P2" }, [1, 2, 3]);
  check(
    "the emoji is still DRAWN and discarded",
    rng.length === 1 && rng[0] === 3,
    JSON.stringify(rng),
  );
  check(
    "the draw is still ahead of the removal",
    EB.indexOf("randElement(emojisList)") < EB.indexOf("return;\n\n      // The original emit"),
  );
}
{
  const { b, rng, emitted } = build();
  b._should = false;
  b.sendEmoji({ __src: "P2" }, [1, 2]);
  check(
    "shouldSendEmoji=false still short-circuits before the draw",
    rng.length === 0 && emitted.length === 0,
  );
  const t = build();
  t.b._can = false;
  t.b.sendEmoji({ __src: "P2" }, [1, 2]);
  check(
    "canSendEmoji=false still short-circuits before the draw",
    t.rng.length === 0 && t.emitted.length === 0,
  );
}

t.section("the SOS is the only emoji emitter left");
{
  const live = (src) =>
    src
      .split(String.fromCharCode(10))
      .filter((l) => /emitIntent\(\s*_?ctors\.emoji/.test(l) && !/^\s*(\/\/|\*)/.test(l)).length;
  check("emojiBehavior has NO live emitter now", live(EB) === 0, live(EB));
  check("quick-panel's SOS still has exactly one", live(QP) === 1, live(QP));
  check(
    "the SOS still reads the emoji table from emojiBehavior",
    QP.includes("flattenedEmojiTable") && EB.includes("flattenedEmojiTable"),
  );
  check(
    "bundle keeps exactly one live emoji emit",
    (BUNDLE.match(/emitIntent\([a-zA-Z_$]+\.emoji,/g) || []).length === 1,
    (BUNDLE.match(/emitIntent\([a-zA-Z_$]+\.emoji,/g) || []).length,
  );
}

t.section("the option is gone everywhere (USER: 'i dont even want the option')");
check(
  "no botEmojis in the auto-bot sources",
  !CORE.includes("botEmojis") && !PANEL.includes("botEmojis") && !EB.includes("botEmojis"),
);
check("no botEmojis pill", !PANEL.includes('data-cfg="botEmojis"'));
check("no botEmojis anywhere in the built bundle", !BUNDLE.includes("botEmojis"));

t.section("the duplicate Auto-bot enabled pill is gone");
check("no data-cfg='enabled' pill", !PANEL.includes('data-cfg="enabled"'));
check("the header master switch is untouched", PANEL.includes('data-role="switch"'));
check(
  "the now-dead enabled branch was removed from the handler",
  !/const key = el\.dataset\.cfg;[\s\S]{0,200}if \(key === "enabled"\)/.test(PANEL),
);
// The enabled pill was the ONLY row under "General", so the heading went with it rather
// than being left as an empty section header above the next one.
check("the now-empty General heading was removed too", !PANEL.includes('${tr("General")}</div>'));
check("the next section is intact", PANEL.includes('${tr("Auto-build structures")}</div>'));

t.section("auto-join header: flashing circle, not a lightning bolt");
check("the ⚡ is gone from the title", !/ofh-aj-title"><span aria-hidden="true">⚡/.test(AJ));
check("a title dot replaces it", AJ.includes('class="ofh-aj-title-dot"'));
check(
  "it is the same 8px disc as every other status dot",
  /\.ofh-aj-title-dot \{[\s\S]*?width: var\(--ofh-dot-size\)/.test(AJ) &&
    /\.ofh-aj-title-dot \{[\s\S]*?border-radius: 50%/.test(AJ),
);
check(
  "it flashes only while auto-join is ARMED",
  /\[data-armed="true"\] \.ofh-aj-title-dot \{[\s\S]*?animation: ofhStatusPulse/.test(AJ),
);
check(
  "idle is dim and steady, not animated",
  !/\.ofh-aj-title-dot \{[\s\S]*?animation:/.test(
    AJ.slice(
      AJ.indexOf(".ofh-aj-title-dot {"),
      AJ.indexOf('[data-armed="true"] .ofh-aj-title-dot'),
    ),
  ),
);
check(
  "the armed flag is actually written by the state updater",
  AJ.includes("panel.dataset.armed = String(enabled);"),
);

t.section("the red flash the user asked about");
check(
  "nothing in the quick panel animates any more (that was it)",
  !/ohqp-conn\[data-status='disconnected'\][^;]*ofhStatusPulse/.test(QP),
);
{
  // Every remaining pulse, so a red one can never sneak back unnoticed.
  const pulses = [];
  for (const [n, s] of [
    ["auto-bot", PANEL],
    ["auto-join", AJ],
    ["quick-panel", QP],
  ]) {
    for (const line of s.split(String.fromCharCode(10))) {
      if (/animation:\s*ofh(StatusPulse|AjPulse)/.test(line)) pulses.push(n);
    }
  }
  check(
    "exactly 4 pulsing elements, none of them red",
    pulses.length === 4 && !PANEL.includes("#f87171"),
    pulses.join(","),
  );
}

check(
  "bundle parses",
  (() => {
    try {
      new Function(BUNDLE);
      return true;
    } catch {
      return false;
    }
  })(),
);

t.done();
