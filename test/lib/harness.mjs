// Shared plumbing for the regression tests.
//
// WHY THESE TESTS LOOK LIKE THIS. The engine is classic scripts with no
// import/export — build.mjs concatenates every file into one shared scope inside an
// IIFE — so there is nothing to `import` and test. Instead each test SLICES the real
// function text out of the source file and evaluates it with `new Function` against the
// stubs in ./stubs.mjs. That means these tests exercise the code that actually ships,
// not a copy of it that can drift.
//
// WHAT THEY ARE FOR. This is a regression RATCHET, not a detector: it proves that bugs
// already found and fixed stay fixed. It covers a small number of functions out of
// ~18k lines and it never runs the game. Passing does NOT mean the bot works — for that
// you still load the userscript and play, and check window.__autoBotDiag() in the page
// console.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read an engine/src file by repo-relative path. Tests must not depend on cwd — the
 *  shell's working directory resets between calls often enough that a relative
 *  readFileSync is a reliable source of phantom failures. */
export function source(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Slice from the first occurrence of `a0` through the end of the first following `b0`.
 *  Use for blocks with an unambiguous terminator (an object literal's `};`). */
export function cut(src, a0, b0, label = "?") {
  const a = src.indexOf(a0);
  if (a < 0) throw new Error(`slice "${label}": start anchor not found: ${a0}`);
  const b = src.indexOf(b0, a);
  if (b < 0) throw new Error(`slice "${label}": end anchor not found: ${b0}`);
  return src.slice(a, b + b0.length);
}

/** Slice a whole function: cut to the START of the next declaration, then trim back to
 *  the last closing brace.
 *
 *  Prefer this over cut() for functions. Ending a slice on an anchor like "  }" lands on
 *  the first NESTED closing brace and yields unbalanced code — which surfaces as a
 *  SyntaxError from new Function, several frames away from the real mistake. */
export function fnUpTo(src, start, nextDecl, label = "?") {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`slice "${label}": start anchor not found: ${start}`);
  const b = src.indexOf(nextDecl, a + start.length);
  if (b < 0) throw new Error(`slice "${label}": next-decl anchor not found: ${nextDecl}`);
  const body = src.slice(a, b);
  const last = body.lastIndexOf("}");
  if (last < 0) throw new Error(`slice "${label}": no closing brace before ${nextDecl}`);
  return body.slice(0, last + 1);
}

/** Strip comments.
 *
 *  MANDATORY before any "is the old code gone?" assertion. Fixes in this repo carry
 *  comments that quote the broken code verbatim so the next reader knows what was wrong —
 *  so a regex over raw source matches the EXPLANATION and reports a fixed bug as still
 *  present. That has produced false failures twice. */
export function decomment(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A test file's reporter. Standalone-runnable (exits non-zero on failure) so a single
 *  file can be run directly while debugging; test/run.mjs aggregates exit codes. */
export function suite(title) {
  let fail = 0;
  let count = 0;
  const out = [];
  let section = "";
  return {
    section(name) {
      section = name;
      out.push({ kind: "section", text: `  ── ${name} ──` });
    },
    /** @param {string} name @param {boolean} ok @param {*} [detail] shown on the line */
    check(name, ok, detail) {
      count++;
      if (!ok) fail++;
      out.push({
        kind: ok ? "pass" : "fail",
        section,
        text:
          `    ${ok ? "pass" : "FAIL"}  ${name}` + (detail !== undefined ? `  [${detail}]` : ""),
      });
    },
    /** Assert a call throws, and optionally that the message matches. Used to prove the
     *  strict stubs still reject a surface the real gameApi does not have. */
    throws(name, fn, re) {
      let err = null;
      try {
        fn();
      } catch (e) {
        err = e;
      }
      this.check(name, err !== null && (!re || re.test(String(err.message))), err && err.message);
    },
    done() {
      console.log(`${title}  (${count} checks)`);
      if (process.env.OFH_TEST_VERBOSE) {
        // Everything, for reading a placement ranking or confirming what is covered.
        console.log(out.map((o) => o.text).join("\n"));
      } else if (fail > 0) {
        // Only what broke, under its own section heading. Printing 40 passing lines
        // around one failure is how a red run gets skimmed and ignored.
        const shown = new Set();
        for (const o of out) {
          if (o.kind !== "fail") continue;
          if (o.section && !shown.has(o.section)) {
            shown.add(o.section);
            console.log(`  ── ${o.section} ──`);
          }
          console.log(o.text);
        }
      }
      if (fail > 0) {
        console.log(
          `  ${fail} of ${count} FAILED in ${title}` + `  (OFH_TEST_VERBOSE=1 for the full list)`,
        );
      }
      process.exit(fail === 0 ? 0 : 1);
    },
  };
}
