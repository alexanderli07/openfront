// i18n quality gate: scan engine UI files for t("…") / tr("…") keys and report,
// for every locale under locales/, which engine keys are missing or look
// untranslated. English (locales/en) is the source/fallback. Scales automatically
// to new languages — drop in locales/<code>/common.json and re-run.
//
//   npm run check:i18n
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Every engine .js file — auto-discovered so new files are covered without
// touching this list. (The bot's TileRef variable `t` is a number, never called
// with a string, so matching t("…")/tr("…") yields no false positives.)
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".js")) out.push(path.relative(root, p));
  }
  return out;
}
const FILES = walk(path.join(root, "engine"));

const keys = new Set();
// Every call-site spelling used across the engine: the lobby layer's t()/tr(),
// the Quick Panel's local _tr(), and the Companion panel's local companionTr().
// A leading \b before "t"/"tr" would reject "_tr(" and "companionTr(" outright
// (no word-boundary between "_"/"n" and the following letter), so this instead
// requires the character before the call to be a non-identifier character (or
// string start) via a negative lookbehind.
const reDq = /(?<![\w$])(?:companionTr|_tr|tr|t)\("((?:[^"\\]|\\.)+)"\)/g;
const reTl = /(?<![\w$])(?:companionTr|_tr|tr|t)\(`([^`]*)`\)/g;
for (const f of FILES) {
  let s;
  try {
    s = read(f);
  } catch {
    continue;
  }
  let m;
  while ((m = reDq.exec(s))) keys.add(JSON.parse(`"${m[1]}"`));
  while ((m = reTl.exec(s))) {
    if (!m[1].includes("${")) keys.add(m[1]);
  }
}
const engineKeys = [...keys].sort();

const localesDir = path.join(root, "locales");
const codes = fs
  .readdirSync(localesDir)
  .filter((c) => fs.existsSync(path.join(localesDir, c, "common.json")));
const bundles = Object.fromEntries(
  codes.map((c) => [c, JSON.parse(read(`locales/${c}/common.json`))]),
);

console.log(`engine UI keys: ${engineKeys.length} · locales: ${codes.join(", ")}\n`);
let missingTotal = 0;
for (const code of codes) {
  if (code === "en") continue;
  const b = bundles[code];
  const missing = engineKeys.filter((k) => !(k in b));
  // value identical to the English key AND looks like prose. Only a HINT: some
  // terms are kept in English on purpose (MIRV, FFA, …), so this never fails.
  const sameAsEnglish = engineKeys.filter((k) => k in b && b[k] === k && /\s/.test(k));
  missingTotal += missing.length;
  console.log(`[${code}] missing: ${missing.length}, kept-as-English: ${sameAsEnglish.length}`);
  if (missing.length) console.log("  missing:   " + missing.join(" | "));
  if (sameAsEnglish.length) console.log("  as-English: " + sameAsEnglish.join(" | "));
}
console.log(
  missingTotal === 0
    ? "\nOK — every locale covers all engine keys (missing keys fall back to English)."
    : `\n${missingTotal} missing key(s).`,
);
process.exit(missingTotal === 0 ? 0 : 1); // only MISSING keys fail; kept-as-English is fine
