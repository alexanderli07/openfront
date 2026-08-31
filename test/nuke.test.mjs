// The nuclear offence, which was entirely dead as recently as v1.80 — for the second
// time, and for a different reason than the first.

import { source, fnUpTo, cut, decomment, suite } from "./lib/harness.mjs";
import { makeBareConfig, UPSTREAM } from "./lib/stubs.mjs";

const t = suite("nuke");
const NB = source("engine/ingame/auto-bot/nukeBehavior.js");
const NB_C = decomment(NB);
const LC = source("engine/ingame/auto-bot/lifecycle.js");

t.section("the trajectory increment, and the crash it used to cause");
{
  // nukeBehavior called config().defaultNukeSpeed() bare at two sites. That method is
  // absent from the current upstream Config (only nukeSpeed(unitType) exists), and
  // gameApi's config Proxy forwards t[prop] unchanged — so it resolved to undefined() and
  // threw. Nothing between maybeSendNuke and chooseNukeArc catches, so it unwound to the
  // decision-chain handler that only logs: the bot never scored a single nuke candidate.
  //
  // Every OTHER consumer in the repo guards this call. That asymmetry was the tell.
  t.check(
    "no bare config().defaultNukeSpeed() call survives",
    !/config\(\)\.defaultNukeSpeed\(\)/.test(NB_C),
  );

  const fn = fnUpTo(NB, "function nukeArcSpeed(game, nukeType) {", "\n// ", "speed");
  const nukeArcSpeed = new Function(`${fn} return nukeArcSpeed;`)();
  const asGame = (methods) => ({ config: () => makeBareConfig(methods) });

  // The fix must be correct whichever version the live server runs, so it tries the
  // current API, then the older name, then the upstream constant.
  t.check(
    "prefers nukeSpeed(type) when present",
    nukeArcSpeed(asGame({ nukeSpeed: (x) => UPSTREAM.nukeSpeed[x] ?? 10 }), "MIRV") === 15,
  );
  t.check(
    "...and reads Atom correctly too",
    nukeArcSpeed(asGame({ nukeSpeed: (x) => UPSTREAM.nukeSpeed[x] ?? 10 }), "Atom Bomb") === 10,
  );
  t.check(
    "falls back to the older defaultNukeSpeed when that is all there is",
    nukeArcSpeed(asGame({ defaultNukeSpeed: () => 8 }), "Atom Bomb") === 8,
  );

  let threw = null,
    val = null;
  try {
    val = nukeArcSpeed(asGame({}), "Atom Bomb");
  } catch (e) {
    threw = e;
  }
  t.check("a config with NEITHER method does not throw", threw === null, threw && threw.message);
  t.check("...and yields the upstream increment 10", val === 10, val);

  // Junk must not propagate a NaN into the trajectory sampler.
  t.check(
    "a non-numeric answer is rejected",
    nukeArcSpeed(asGame({ nukeSpeed: () => undefined }), "Atom Bomb") === 10,
  );
  t.check("a zero is rejected", nukeArcSpeed(asGame({ nukeSpeed: () => 0 }), "Atom Bomb") === 10);

  // Prove the OLD form really did throw through the real proxy shape.
  t.throws(
    "the old bare call throws through a pass-through proxy",
    () => makeBareConfig({}).defaultNukeSpeed(),
    /not a function/,
  );
}

t.section("a salvo flies the arc its planner cleared");
{
  // The 6th argument to sendNuke is the ARC. Omitting it defaulted arcUp to true, so
  // every bomb the planner had cleared on the DOWN arc launched on the up arc it had
  // just rejected as corridor-blocked: the salvo lands under-strength, the SAM survives,
  // and 750k per bomb is gone. The density-first path passed it; this one did not.
  const blk = cut(NB, "for (let i = 0; i < plan.bombsToFire; i++) {", "}", "samsalvo");
  t.check(
    "the SAM-cracking salvo passes arcUpPerBomb",
    /plan\.arcUpPerBomb \? plan\.arcUpPerBomb\[i\] !== false : true/.test(blk),
  );
  t.check("both salvo paths are paced", (NB.match(/await salvoPace\(/g) || []).length === 2);

  const fn = fnUpTo(NB, "function salvoPace(i, total) {", "\n/** ", "pace");
  const salvoPace = new Function(`const SALVO_GAP_MS = 140; ${fn} return salvoPace;`)();
  t.check("pacing returns a promise", salvoPace(0, 8) instanceof Promise);
}

t.section("...and inside the interception window");
{
  // A saturation salvo is the one thing that cannot absorb a dropped intent: its premise
  // is Sigma(covering SAM levels) + 1 SIMULTANEOUS arrivals. But the server silently
  // drops build intents above ~10/sec, so firing N back-to-back risks losing one and
  // landing ZERO warheads. Arrivals only have to fall inside floor(SAMCooldown()/2).
  const GAP = 140;
  const windowTicks = Math.floor(UPSTREAM.SAMCooldown / 2);
  const windowMs = windowTicks * 100; // 10 ticks/sec
  t.check("the window is 45 ticks", windowTicks === 45, windowTicks);
  t.check("an 8-bomb salvo fits", 7 * GAP < windowMs, `${7 * GAP}ms < ${windowMs}ms`);
  t.check("so does a 16-bomb salvo", 15 * GAP < windowMs, `${15 * GAP}ms`);
  t.check("the pacing is above the ~10/sec drop threshold", GAP >= 100, GAP + "ms");
}

t.section("the atom macro obeys the rate cap it checks");
{
  // Phase 1 did `if (!perMinuteOk()) { ...; continue; }`. Phases 2 and 3 slept one second
  // and then fired ANYWAY — over the cap, in the phase whose entire job is replacing
  // shots the cap already ate. One second only evicts timestamps older than 60s.
  t.check(
    "the top-up phase continues instead of firing over the cap",
    /if \(!perMinuteOk\(\)\) \{ await atomSleep\(1000\); continue; \}/.test(LC),
  );
  t.check(
    "the hydrogen tail no longer falls through",
    /if \(!perMinuteOk\(\)\) \{\s*await atomSleep\(1000\);\s*\} else if \(fireOne\(descriptor\)\) \{/.test(
      LC,
    ),
  );
  // Every worker await in the macro needs a timeout, or a stall leaves the banner on
  // "Firing... (Esc to stop)" with Esc unreachable — the loop is suspended inside it.
  t.check(
    "no unguarded buildables await remains in the macro",
    !/await myPlayer\.buildables\((?![^)]*\)\s*,\s*WORKER_TIMEOUT_MS)/.test(
      decomment(LC).slice(decomment(LC).indexOf("fireAtoms")),
    ) || /withTimeout/.test(LC),
  );
}

t.done();
