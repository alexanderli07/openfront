// i18n override — ships the bundled locales inline (no 179-locale fetch).
//
// loadBundle(lang) returns DEFAULT_TRANSLATIONS + the English bundle (as the
// always-present fallback) + the requested language's bundle when it's one we
// ship. Anything else falls back to English.

import { injected } from "./assets";

type Translations = Record<string, string>;

function loadBundle(language: string): Promise<Translations> {
  const i18n = (
    window as unknown as {
      OpenFrontHelperI18n?: { DEFAULT_TRANSLATIONS?: Translations };
    }
  ).OpenFrontHelperI18n;
  const def = i18n?.DEFAULT_TRANSLATIONS || {};
  const en = injected.locales.en || {};
  const lang = injected.locales[language] || {};
  return Promise.resolve({ ...def, ...en, ...lang });
}

export function installI18nOverride(): void {
  const w = window as unknown as {
    OpenFrontHelperI18n?: { loadBundle: (lang: string) => Promise<Translations> };
  };
  if (w.OpenFrontHelperI18n) {
    w.OpenFrontHelperI18n.loadBundle = loadBundle;
  }
}
