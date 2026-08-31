// Runs the shell smoke test plus every *.test.mjs, and fails the whole run if any of
// them fails. This is what `npm test` executes.
//
// Each test file is spawned as its own process, so one crashing file cannot take the rest
// with it and every file stays independently runnable while you debug:
//
//     node test/warship.test.mjs                  # one file
//     OFH_TEST_VERBOSE=1 node test/run.mjs        # every assertion, not just the tally
//
// WHAT A GREEN RUN MEANS. This is a regression ratchet: it proves that bugs already found
// and fixed have not come back. It slices real functions out of the engine and drives
// them against stubs built to gameApi's true surface (see lib/stubs.mjs), so it tests the
// code that actually ships — but it covers a small number of functions out of ~18k lines
// and it never runs the game.
//
// It does NOT tell you the bot works. For that: load the userscript, run
// window.__autoBotDiag() in the page console, and play a game. Three of the bugs found in
// the last review round were in code that had never executed even once.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const files = [
  "smoke.mjs",
  // Surface first: if the stubs have drifted from the real gameApi, every other file's
  // result is suspect, so it is the most useful failure to see at the top.
  "gameapi-surface.test.mjs",
  ...fs
    .readdirSync(HERE)
    .filter((f) => f.endsWith(".test.mjs") && f !== "gameapi-surface.test.mjs")
    .sort(),
];

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      cwd: path.resolve(HERE, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ file, code, out: out.trimEnd() }));
  });
}

const results = [];
for (const f of files) results.push(await run(f));

let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  // The suite reporter already prints its own one-line tally; show it inline.
  const first = r.out.split("\n").find((l) => l.trim()) || "";
  console.log(`${ok ? "  ok  " : "FAIL  "}${r.file.padEnd(32)} ${ok ? first : ""}`);
  if (!ok) console.log(r.out.replace(/^/gm, "        "));
}

const total = results.length;
console.log(
  failed === 0 ? `\nALL PASS — ${total} test files` : `\n${failed} of ${total} test files FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
