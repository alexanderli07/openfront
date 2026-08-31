# test/

```bash
npm test                              # everything (this is test/run.mjs)
node test/warship.test.mjs            # one file
OFH_TEST_VERBOSE=1 npm test           # every assertion, not just the per-file tally
```

## What this is — and what it is not

**It is a regression ratchet.** It proves that bugs already found and fixed have not come
back. Roughly 350 assertions over ~20 functions, out of ~18,000 lines of auto-bot.

**A green run does not mean the bot works.** Nothing here runs the game. There is no
integration test — the bot only genuinely executes in a browser against a live `GameView`.
Three of the bugs found in the last review round were in code that had _never executed
once_, and no test of this shape would have found them; they were found by reading the
fork against the real game's source.

To answer "does it work": load the userscript, run `window.__autoBotDiag()` in the page
console, and play a game.

## Why the tests look so strange

The engine has **no modules**. `engine/**/*.js` are classic scripts with no
`import`/`export`; `build.mjs` concatenates them into one shared scope inside an IIFE. So
there is nothing to import and unit-test.

Instead each test **slices the real function text out of the source file** and evaluates it
with `new Function` against stubs. That is uglier than importing, but it has one large
advantage: the tests exercise the code that actually ships, and a test cannot silently
drift from a copy of the implementation.

The cost is that the slice anchors are fragile. Two rules, both learned the hard way:

- Use `fnUpTo(src, start, nextDecl)` for functions, not `cut(src, start, "  }")`. An
  anchor like `"  }"` lands on the first **nested** closing brace and yields unbalanced
  code, surfacing as a `SyntaxError` several frames from the real mistake.
- Run source text through `decomment()` before any "is the old code gone?" assertion.
  Fixes in this repo carry comments quoting the broken code verbatim, so a raw regex
  matches the _explanation_ and reports a fixed bug as still present. That has produced
  false failures twice.

## `lib/stubs.mjs` is the important file

Three of the four crashes found in the last two review rounds were the same mistake:
**bot code calling a method `gameApi` does not expose.**

| Call                          | Reality                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `game.forEachNeighbor(...)`   | never existed — the api has `neighbors` (an array). TypeError aborted the whole warship combat pass; it had never run.            |
| `unit.isFriendly(me)`         | `isFriendly` is a **player** method. Both enemy filters threw into their per-unit `catch` and came out **empty**.                 |
| `config().defaultNukeSpeed()` | absent from Config. The config Proxy forwards `t[prop]`, so this resolved to `undefined()` and killed the entire nuclear offence. |

So the stubs **throw by name** on any property the real surface lacks:

```
unit has no "isFriendly" — the real gameApi does not expose it.
If production code reads this, it throws there too.
```

That turns a whole _class_ of bug into a test failure instead of a silent no-op in
production, which is worth more than any single assertion here.

`gameapi-surface.test.mjs` derives both surfaces from `gameApi.js` itself and fails if the
stubs drift, so they cannot rot into a snapshot of an api that has moved on.

> **Do not add a missing method to `lib/stubs.mjs` to make a test pass.** If bot code needs
> it, either the real `gameApi` exposes it — add it to the SURFACE list _and_ to gameApi —
> or the bot code is wrong. Loosening the stub hides exactly the bug it exists to catch.

## Files

| File                           | Covers                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `lib/harness.mjs`              | slicing (`cut`, `fnUpTo`, `decomment`), the `suite()` reporter, cwd-proof `source()` |
| `lib/stubs.mjs`                | the strict gameApi/wrapUnit surfaces, tile grid, verified upstream constants         |
| `gameapi-surface.test.mjs`     | stubs match real gameApi; UnitType strings match the upstream enum                   |
| `warship.test.mjs`             | idle/docked filtering, engagement geometry, veterancy battle sim, waypoint BFS       |
| `nuke.test.mjs`                | trajectory-increment fallback chain, salvo arc + pacing, atom-macro rate cap         |
| `placement-umbrella.test.mjs`  | SAM-umbrella siting and the attenuated spread release                                |
| `placement-depth.test.mjs`     | threat term saturates, depth term does not                                           |
| `placement-tangent.test.mjs`   | 2r=60 is the exact no-shared-blast threshold                                         |
| `placement-postcount.test.mjs` | defense-post depth-credit counting                                                   |
| `panel-quick.test.mjs`         | accordion restore, dotted setting keys, debounced sliders, theme sweep               |
| `panel-autobot.test.mjs`       | every surfaced setting wired; `[data-cfg-num]` inputs live                           |
| `settings.test.mjs`            | map-filter normalisation, min-lobby-size contract                                    |
| `sos.test.mjs`                 | auto-SOS trigger maths, manual Shift+S path                                          |
| `emoji.test.mjs`               | bot emojis silenced at the choke point, shared RNG draw preserved                    |
| `smoke.mjs`                    | the shell IIFE wires up in a mocked DOM                                              |

## Adding a test

Only add one for a bug you have actually seen, or an invariant with a source you can cite
(a formula from the game, a constant from `Config.ts`). Prefer running real sliced code
over asserting on source text — of the assertions here, the regex-only ones are the ones
that false-fail on innocent refactors.

Constants belong in `lib/stubs.mjs`'s `UPSTREAM` block with a comment naming where they
came from. A wrong constant there turns a passing test into a lie.
