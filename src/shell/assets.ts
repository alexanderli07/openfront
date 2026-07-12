// Live asset resolution via the game's own manifest.
//
// openfront.io exposes a logical-path -> content-hashed-path manifest and a CDN
// base. Reading them at runtime gives us always-current URLs for map thumbnails,
// unit icons, etc. — no base64 baking, no stale hashes, and they load under the
// same CSP the game itself uses.
//
// The game moved these out of the top-level globals (window.ASSET_MANIFEST /
// window.CDN_BASE) into window.BOOTSTRAP_CONFIG.{assetManifest,cdnBase}. We read
// the legacy globals first (so an un-updated client still works) and fall back
// to BOOTSTRAP_CONFIG. `||` chaining — not `??` — so a defined-but-empty legacy
// global (e.g. CDN_BASE === "") still falls through to BOOTSTRAP_CONFIG.

type Manifest = Record<string, string>;
type BootstrapConfig = { assetManifest?: Manifest; cdnBase?: string };

function bootstrap(): BootstrapConfig | null {
  const b = (window as unknown as { BOOTSTRAP_CONFIG?: BootstrapConfig }).BOOTSTRAP_CONFIG;
  return b && typeof b === "object" ? b : null;
}

function manifest(): Manifest | null {
  const m = (window as unknown as { ASSET_MANIFEST?: Manifest }).ASSET_MANIFEST || bootstrap()?.assetManifest;
  return m && typeof m === "object" ? m : null;
}

function cdnBase(): string {
  return (window as unknown as { CDN_BASE?: string }).CDN_BASE || bootstrap()?.cdnBase || "";
}

/** Resolve a logical asset path (e.g. "maps/world/thumbnail.webp") to a full URL. */
export function resolveAsset(logicalPath: string): string | null {
  const m = manifest();
  const hashed = m?.[logicalPath];
  if (!hashed) return null;
  return cdnBase() + hashed;
}

export function mapThumbnailUrl(mapId: string): string | null {
  return resolveAsset(`maps/${mapId}/thumbnail.webp`);
}

// Engine structure type -> the game's own white unit icon.
const UNIT_ICON: Record<string, string> = {
  City: "images/CityIconWhite.svg",
  Port: "images/PortIcon.svg",
  Factory: "images/FactoryIconWhite.svg",
  "Defense Post": "images/ShieldIconWhite.svg",
  "SAM Launcher": "images/SamLauncherIconWhite.svg",
  "Missile Silo": "images/MissileSiloIconWhite.svg",
};

export function unitIconUrl(structureType: string): string | null {
  const logical = UNIT_ICON[structureType];
  return logical ? resolveAsset(logical) : null;
}

// Build-injected extras (version + the inlined locale bundles). Set by build.mjs
// before the shell runs.
type Injected = {
  version: string;
  locales: Record<string, Record<string, string>>;
};
export const injected: Injected = ((globalThis as Record<string, unknown>)
  .__OFH_ASSETS as Injected) ?? {
  version: "0.0.0",
  locales: {},
};

export type LanguageOption = { code: string; name: string; nativeName: string };

function displayName(code: string, inLocale: string): string {
  try {
    const n = new Intl.DisplayNames([inLocale], { type: "language" }).of(code);
    if (n && n.toLowerCase() !== code.toLowerCase()) {
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
  } catch {
    /* Intl.DisplayNames unsupported or unknown code */
  }
  return code;
}

/**
 * Languages shipped in this build — derived from the inlined locale bundles
 * (auto-discovered at build time). Display names come from Intl.DisplayNames, so
 * adding a locale folder is enough; no hardcoded list. English sorts first.
 */
export function availableLanguages(uiLocale = "en"): LanguageOption[] {
  const list = Object.keys(injected.locales).map((code) => ({
    code,
    name: displayName(code, uiLocale),
    nativeName: displayName(code, code),
  }));
  list.sort((a, b) =>
    a.code === "en" ? -1 : b.code === "en" ? 1 : a.nativeName.localeCompare(b.nativeName),
  );
  return list;
}
