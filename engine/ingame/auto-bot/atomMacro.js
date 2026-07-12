// ☢️ Atom-bomb batch macro — STUB.
//
// The implementation now lives at the END of lifecycle.js so that a plain page
// F5 loads it: lifecycle.js was already listed in manifest.json, whereas this
// file (atomMacro.js) was added later and a newly-added manifest entry only loads
// after a FULL extension reload (chrome://extensions → Reload), not on F5.
//
// This stub is kept only because manifest.json still references the path; it is a
// harmless no-op. The real code carries a `window.__ofhAtomMacroInstalled` guard,
// so even if both this file (after an extension reload) and the lifecycle.js copy
// run in the same page, the macro installs exactly once.
"use strict";
