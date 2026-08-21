// The settings popup — a vanilla, in-page panel in the floating-panel aesthetic.
// Replaces the extension's React popup. Reads/writes the same `settings` object
// via chrome.storage; the content engine reacts through storage.onChanged.

import { ringChime } from "../audio";
import { availableLanguages, mapThumbnailUrl } from "../assets";
import { requestJoinNotificationPermission } from "../notification";

// ---- auto-bot bridge (exposed by the page-bridge engine in-game) ------------
type AutoBot = {
  FEATURE_KEYS: string[];
  DIFFICULTIES: string[];
  get: () => {
    enabled: boolean;
    difficulty: string;
    winFixes: boolean;
    smartSpawn: boolean;
    tickMs: number;
    hidden: boolean;
    features: Record<string, boolean>;
    buildStructures: Record<string, boolean>;
  };
  set: (patch: Record<string, unknown>) => void;
};

// Structure types the auto-bot can build (type string + emoji fallback). Same
// types/icons as the team-build panel; the game SVG icon resolves via the global
// __OFH_gameIconUrl, falling back to the emoji.
const AB_STRUCTURES: Array<[string, string]> = [
  ["City", "🏙️"],
  ["Port", "⚓"],
  ["Factory", "🏭"],
  ["Defense Post", "🛡️"],
  ["SAM Launcher", "🛰️"],
  ["Missile Silo", "🚀"],
];

function gameStructureIcon(type: string, emoji: string): HTMLElement {
  const url =
    (window as unknown as { __OFH_gameIconUrl?: (t: string) => string })
      .__OFH_gameIconUrl?.(type) || "";
  if (!url) {
    return el("span", {}, emoji);
  }
  const img = el("img", {
    src: url,
    alt: type,
    width: "16",
    height: "16",
    draggable: "false",
    style: "object-fit:contain;",
  }) as HTMLImageElement;
  img.addEventListener("error", () => img.replaceWith(el("span", {}, emoji)), {
    once: true,
  });
  return img;
}
const autobot = () => (window as unknown as { __OFH_autobot?: AutoBot }).__OFH_autobot;

// ---- atom batch-fire bridge (exposed by the in-game engine) -----------------
// The macro persists its pacing to one localStorage blob; the engine re-reads it
// on each fire. The bridge is a thin accessor over that blob (always available,
// even in the lobby). localStorage is the single source of truth, so if the
// in-game layer ever faulted before exposing the bridge we read/write it directly.
type AtomCfg = { batchSize: number; delayMs: number; lastHydrogen: boolean };
type AtomBridge = {
  SAFE_GAP_MS?: number;
  get: () => AtomCfg;
  set: (patch: Partial<AtomCfg>) => void;
  effectiveGapMs?: (batchSize: number, delayMs: number) => number;
};
const ATOM_KEY = "openfront-helper-atom-batch-v1";
const ATOM_SAFE_GAP_MS = 140; // server-safe floor (~7 shots/sec); mirror of the engine
const ATOM_DEFAULTS: AtomCfg = { batchSize: 10, delayMs: 150, lastHydrogen: false };
const atomBridge = () => (window as unknown as { __OFH_atomBatch?: AtomBridge }).__OFH_atomBatch;

function atomGetCfg(): AtomCfg {
  const b = atomBridge();
  if (b?.get) {
    try {
      return { ...ATOM_DEFAULTS, ...b.get() };
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = window.localStorage.getItem(ATOM_KEY);
    if (raw) return { ...ATOM_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* defaults */
  }
  return { ...ATOM_DEFAULTS };
}

function atomSetCfg(patch: Partial<AtomCfg>): void {
  const b = atomBridge();
  if (b?.set) {
    try {
      b.set(patch);
      return;
    } catch {
      /* fall through to localStorage */
    }
  }
  // read-merge-write so a partial patch never wipes sibling fields
  const next = { ...atomGetCfg(), ...patch };
  try {
    window.localStorage.setItem(ATOM_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

// Effective ms-between-shots; never below the server-safe floor — matches the
// engine's atomFireGapMs so the readout shows the real delivery cadence.
function atomGapMs(batchSize: number, delayMs: number): number {
  const b = atomBridge();
  if (b?.effectiveGapMs) {
    try {
      return b.effectiveGapMs(batchSize, delayMs);
    } catch {
      /* fall through to local formula */
    }
  }
  const perShot = batchSize >= 1 ? (delayMs || 0) / batchSize : delayMs || 0;
  return Math.max(ATOM_SAFE_GAP_MS, Math.floor(perShot) || 0);
}

const REPO_URL = "https://github.com/alexanderli07/openfront";

const FEATURE_LABELS: Record<string, [string, string]> = {
  spawn: ["Auto-spawn", "Automatically pick a spawn tile."],
  expand: ["Auto-expand / attack", "Expand into land and attack targets."],
  build: ["Auto-build", "Build and upgrade structures."],
  boat: ["Auto-landing (boats)", "Send probe and landing boats overseas."],
  nuke: ["Auto-launch nukes", "Fire nukes at high-value targets."],
  warship: ["Auto-deploy warships", "Build and dispatch warships."],
  alliance: ["Auto-alliances", "Send and accept alliance requests."],
  donate: ["Auto-donate troops", "Donate troops to needy allies."],
  betray: ["Allow betrayal", "Off = stay loyal (defensive retaliation only)."],
};

// ---- engine globals (set by the content IIFE at runtime) --------------------
type Shared = {
  STORAGE_KEY: string;
  MAPS: Array<{ id: string; name: string }>;
  normalizeSettings: (
    raw: unknown,
    options?: { ensureActiveSearchTimestamp?: boolean },
  ) => Record<string, any>;
};
type I18n = {
  getMessage: (bundle: Record<string, string>, key: string) => string;
  loadBundle: (lang: string) => Promise<Record<string, string>>;
};
const shared = () =>
  (window as unknown as { OpenFrontHelperSettings?: Shared }).OpenFrontHelperSettings;
const i18n = () => (window as unknown as { OpenFrontHelperI18n?: I18n }).OpenFrontHelperI18n;
const chromeApi = () => (window as unknown as { chrome: any }).chrome;

// ---- filter / helper config (English labels) --------------------------------
const START_GOLD = [
  ["startingGold0M", "0M starting gold"],
  ["startingGold1M", "1M starting gold"],
  ["startingGold5M", "5M starting gold"],
  ["startingGold25M", "25M starting gold"],
] as const;

const MODIFIERS = [
  ["randomSpawn", "Random spawn"],
  ["alliancesDisabled", "Alliances disabled"],
  ["portsDisabled", "Ports disabled"],
  ["nukesDisabled", "Nukes disabled"],
  ["samsDisabled", "SAMs disabled"],
  ["waterNukes", "Water nukes"],
  ["peaceTime4m", "4min peace time"],
  ["goldMultiplier2x", "2x gold"],
] as const;

const TEAM_PRESETS: Array<[string, number, number | null]> = [
  ["FFA", 1, 1],
  ["Duos", 2, 2],
  ["Trios", 3, 3],
  ["Quads", 4, 4],
  ["5+", 5, null],
];

// A Toggle is one switch row. `parent` makes it an indented sub-toggle (disabled
// while the parent is off). `input` renders a value control instead of a switch.
type Toggle = {
  name: string;
  title: string;
  desc: string;
  parent?: string;
  input?: "gameTimeMinutes";
};
// Helper toggles are grouped into collapsible, labeled sections.
type HelperSection = { key: string; title: string; toggles: Toggle[] };

const HELPER_SECTIONS: HelperSection[] = [
  {
    key: "panels",
    title: "Panels",
    toggles: [
      {
        name: "showTopGoldPerMinute",
        title: "Player stats panel",
        desc: "All-players table (owned, gold, gold/min, max troops; expandable); hides the game's leaderboard.",
      },
      {
        name: "showGoldPerMinute",
        title: "Highlight hovered player",
        desc: "Highlights the hovered player's row in the stats panel.",
        parent: "showTopGoldPerMinute",
      },
      {
        name: "showTeamBuildStats",
        title: "Team build stats",
        desc: "Per-team structures, gold/min, owned tiles & max troops; warns on a first Missile Silo.",
      },
      {
        name: "showTradeBalances",
        title: "Trade balances",
        desc: "Shows observed ship and train trade imports/exports.",
      },
      {
        name: "showAdvisorPanel",
        title: "Advisor panel",
        desc: "Compact HUD: troop-economy state, growth, spendable troops, expansion advice, and top threats.",
      },
      {
        name: "showEstatePanel",
        title: "Estates panel",
        desc: "Lists your separate land parcels (tile counts); click a row to jump there.",
      },
      {
        name: "showAllianceRequestsPanel",
        title: "Alliance requests panel",
        desc: "Moves alliance requests into a side window.",
      },
      {
        name: "showHelperUsers",
        title: "Script users panel",
        desc: "Lists other players running this helper (detected via a 3-emoji signature broadcast once per match).",
      },
      {
        name: "showQuickPanel",
        title: "Quick Panel (floating)",
        desc: "Compact tabbed in-game panel for fast settings toggles, WS actions (kill shot, embargo, donate), theme presets, and lobby feed.",
      },
    ],
  },
  {
    key: "map",
    title: "Map overlays",
    toggles: [
      {
        name: "showPlayerMapOverlays",
        title: "Player overlays",
        desc: "Master switch for the per-player info drawn over each player on the map.",
      },
      {
        name: "showMapTroopCounts",
        title: "Troop bar",
        desc: "Ratio bar over each player: home troops (green) + attacking (orange) vs max, with the /max count.",
        parent: "showPlayerMapOverlays",
      },
      {
        name: "showMapMoney",
        title: "Money",
        desc: "Shows each player's gold above their name.",
        parent: "showPlayerMapOverlays",
      },
      {
        name: "showThreatIndicators",
        title: "Threat indicators",
        desc: "Marks enemies: ☢ nuke-capable, red dot = stronger than you, amber dot = weak.",
        parent: "showPlayerMapOverlays",
      },
      {
        name: "showAttackHighlight",
        title: "Attack highlight",
        desc: "Flags who is attacking you: pulsing rings, lines to your territory, total incoming troops.",
      },
      {
        name: "showNukePrediction",
        title: "Nuke prediction",
        desc: "Shows predicted enemy nuke landing points & radius.",
      },
      {
        name: "showNukeTrajectory",
        title: "Trajectory line",
        desc: "Draws the dashed flight-path line from each nuke to its landing point.",
        parent: "showNukePrediction",
      },
      {
        name: "showBoatPrediction",
        title: "Boat prediction",
        desc: "Shows boat landings (blue = you, teal = team, green = allies, yellow/red = enemies).",
      },
      {
        name: "alwaysShowOwnBoatRoutes",
        title: "Always show your boat routes",
        desc: "Draws your own boat routes without hovering.",
        parent: "showBoatPrediction",
      },
      {
        name: "alwaysShowTeamBoatRoutes",
        title: "Always show team boat routes",
        desc: "Draws teammates' boat routes without hovering.",
        parent: "showBoatPrediction",
      },
      {
        name: "alwaysShowAllyBoatRoutes",
        title: "Always show ally boat routes",
        desc: "Draws allies' (alliance) boat routes without hovering.",
        parent: "showBoatPrediction",
      },
      {
        name: "alwaysShowEnemyBoatRoutes",
        title: "Always show enemy boat routes",
        desc: "Draws enemy boat routes without hovering.",
        parent: "showBoatPrediction",
      },
      {
        name: "showWarshipRoutes",
        title: "Warship routes",
        desc: "Draws warship destinations & routes (blue = you, teal = team, green = allies, red = enemies).",
      },
      {
        name: "showWarshipRoutesOwn",
        title: "Your warships",
        desc: "Show routes for your own warships.",
        parent: "showWarshipRoutes",
      },
      {
        name: "showWarshipRoutesTeam",
        title: "Team warships",
        desc: "Show routes for teammates' warships.",
        parent: "showWarshipRoutes",
      },
      {
        name: "showWarshipRoutesAlly",
        title: "Ally warships",
        desc: "Show routes for allies' (alliance) warships.",
        parent: "showWarshipRoutes",
      },
      {
        name: "showWarshipRoutesEnemy",
        title: "Enemy warships",
        desc: "Show routes for enemy warships.",
        parent: "showWarshipRoutes",
      },
      {
        name: "showSpawnHeatmap",
        title: "Spawn heatmap",
        desc: "Colored grid showing spawn quality: land density, nation proximity, player distance.",
      },
      {
        name: "showSpawnMarkers",
        title: "Spawn top-spot markers",
        desc: "Numbered circles on the best spawn tiles — works with or without the heatmap grid.",
      },
      {
        name: "showBuildTimers",
        title: "Build timers",
        desc: "Shows construction countdown and missile cooldown above Missile Silos and SAM Launchers.",
      },
      {
        name: "showEconomyHeatmap",
        title: "Economy heatmap",
        desc: "Overlays an economic-activity heatmap.",
      },
      {
        name: "showExportPartnerHeatmap",
        title: "Export partner heatmap",
        desc: "Highlights your trade export partners.",
      },
      {
        name: "markBotNationsRed",
        title: "Mark bot nations red",
        desc: "Adds a red marker to nation AI names.",
      },
      {
        name: "markHoveredAlliesGreen",
        title: "Alliances",
        desc: "Highlights allies with remaining alliance time.",
      },
    ],
  },
  {
    key: "combat",
    title: "Combat & automation",
    toggles: [
      {
        name: "autoNuke",
        title: "Auto nuke",
        desc: "Automatically fires nukes at suggested targets.",
      },
      {
        name: "autoNukeIncludeAllies",
        title: "Include allies",
        desc: "Allow auto nuke to target allies.",
        parent: "autoNuke",
      },
      {
        name: "showNukeSuggestions",
        title: "Nuke suggestions",
        desc: "Suggests high-value nuke targets.",
      },
      {
        name: "showRetaliationHud",
        title: "Retaliation HUD",
        desc: "When hit by a nuke, shows a confirmation card to fire back (semi-auto).",
      },
      {
        name: "sosDefense",
        title: "SOS when attacked",
        desc: "When under attack, sends an SOS emoji to allies/teammates and marks the attacker for your team. Works with or without the auto-bot.",
      },
      {
        name: "send1PercentBoat",
        title: "Send 1% boat",
        desc: "Adds a 1%-troop boat send to the context menu.",
      },
      {
        name: "rightClickConquest",
        title: "Right-click conquest",
        desc: "Right-click an enemy: one-click attack, favourite/blacklist alliance policy.",
      },
      {
        name: "attackRatioHotkey",
        title: "Attack-ratio hotkeys",
        desc: "Shift+1..0 sets attack ratio to 10%..100%.",
      },
    ],
  },
  {
    key: "alerts",
    title: "Alerts",
    toggles: [
      {
        name: "showGameTimeAlert",
        title: "Game-time alert",
        desc: "One-time center-screen notice when the match reaches a set time.",
      },
      {
        name: "gameTimeAlertThresholdSec",
        title: "Alert at (minutes)",
        desc: "When to fire the game-time alert.",
        parent: "showGameTimeAlert",
        input: "gameTimeMinutes",
      },
      {
        name: "warnIncomingBoats",
        title: "Incoming boat warning",
        desc: "Center-screen alert when a new boat targets your territory (like the Missile Silo warning).",
      },
      {
        name: "showEnemyIntent",
        title: "Enemy-intent warning",
        desc: "Early warning: detects incoming attacks before they appear in game state.",
      },
    ],
  },
  {
    key: "tools",
    title: "Tools",
    toggles: [
      { name: "hideAds", title: "Hide ads", desc: "Hides ad containers in the game page." },
      {
        name: "antiAfk",
        title: "Anti-AFK",
        desc: "Prevents AFK detection when tab is in background. Uses Web Worker to send periodic WebSocket pings.",
      },
      {
        name: "roundLogger",
        title: "Round logger",
        desc: "Records match timeline (attacks, nukes, troop changes) to localStorage; export as JSON.",
      },
      {
        name: "networkLogger",
        title: "Network logger",
        desc: "Records fetch/XHR metadata (URL, status, timing) for debugging. No response bodies.",
      },
    ],
  },
];

// ---- state ------------------------------------------------------------------
let overlay: HTMLDivElement | null = null;
let opening = false;
let settings: Record<string, any> = {};
let translations: Record<string, string> = {};
let activeTab = "autojoin";
let activeAutoTab = "main"; // sub-tab within Auto-Join (main / filters / maps)
let mapMode: "include" | "exclude" = "include";

const t = (key: string): string => {
  const m = i18n();
  return (m && m.getMessage(translations, key)) || key;
};

// ---- tiny DOM helper --------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v != null) node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

async function persist(): Promise<void> {
  const s = shared();
  if (!s) return;
  // ensureActiveSearchTimestamp mirrors the original popup (App.tsx): enabling
  // auto-join stamps searchStartedAt so the "searching for …" timer/forecast run.
  settings = s.normalizeSettings(settings, { ensureActiveSearchTimestamp: true });
  await chromeApi().storage.local.set({ [s.STORAGE_KEY]: settings });
}

// ---- reusable controls ------------------------------------------------------
function switchRow(
  title: string,
  desc: string,
  value: boolean,
  onToggle: (v: boolean) => void,
): HTMLElement {
  const sw = el("div", { class: `ofh-switch${value ? " on" : ""}` });
  const row = el(
    "div",
    { class: "ofh-row" },
    el(
      "div",
      { class: "ofh-txt" },
      el("div", { class: "ofh-name" }, t(title)),
      desc ? el("div", { class: "ofh-desc" }, t(desc)) : "",
    ),
    sw,
  );
  const flip = () => {
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    onToggle(next);
  };
  sw.addEventListener("click", flip);
  return row;
}

// Renders the minutes control for the game-time alert (a non-boolean child row).
function gameTimeMinutesControl(): HTMLElement {
  const input = el("input", {
    class: "ofh-num",
    type: "number",
    min: "1",
    max: "60",
    step: "1",
    value: String(Math.round((Number(settings.gameTimeAlertThresholdSec) || 300) / 60)),
  }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const mins = Math.max(1, Math.min(60, Number(input.value) || 5));
    input.value = String(mins);
    settings.gameTimeAlertThresholdSec = mins * 60;
    void persist();
  });
  return input;
}

function helperRows(list: Toggle[]): HTMLElement {
  const grid = el("div", { class: "ofh-grid" });
  // Sub-controls (those with a `parent`) follow their parent in `list`. They are
  // indented and disabled while the parent is off; toggling the parent refreshes
  // that disabled state live (no re-render). A control may be a switch OR an
  // input, so each registers its own disable() fn under its parent.
  const subControlsByParent: Record<string, Array<(disabled: boolean) => void>> = {};

  const refreshSubs = (parent: string): void => {
    const off = !settings[parent];
    for (const setDisabled of subControlsByParent[parent] || []) setDisabled(off);
  };

  for (const h of list) {
    let control: HTMLElement;
    let register: (disabled: boolean) => void;

    if (h.input === "gameTimeMinutes") {
      const input = gameTimeMinutesControl() as HTMLInputElement;
      control = input;
      register = (disabled) => {
        input.disabled = disabled;
        input.classList.toggle("disabled", disabled);
      };
    } else {
      const sw = el("div", { class: `ofh-switch${settings[h.name] ? " on" : ""}` });
      control = sw;
      register = (disabled) => sw.classList.toggle("disabled", disabled);
      sw.addEventListener("click", () => {
        if (sw.classList.contains("disabled")) return;
        const next = !sw.classList.contains("on");
        sw.classList.toggle("on", next);
        settings[h.name] = next;
        void persist();
        if (subControlsByParent[h.name]) refreshSubs(h.name);
      });
    }

    const row = el(
      "div",
      { class: `ofh-row${h.parent ? " ofh-sub" : ""}` },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t(h.title)),
        h.desc ? el("div", { class: "ofh-desc" }, t(h.desc)) : "",
      ),
      control,
    );
    if (h.parent) {
      (subControlsByParent[h.parent] ||= []).push(register);
    }
    grid.append(row);
  }

  for (const parent of Object.keys(subControlsByParent)) refreshSubs(parent);

  return grid;
}

// ---- tabs -------------------------------------------------------------------
function renderAutoJoinMain(body: HTMLElement): void {
  body.append(el("div", { class: "ofh-section-title" }, t("Auto-join")));

  body.append(
    switchRow(
      "Auto-join",
      "Automatically join lobbies that match your filters.",
      Boolean(settings.enabled),
      (v) => {
        settings.enabled = v;
        void persist();
      },
    ),
  );
  body.append(
    switchRow(
      "Found-game notification",
      "Show a toast and play a chime when a match is found.",
      Boolean(settings.joinNotification),
      (v) => {
        settings.joinNotification = v;
        // turning it on is a user gesture — the moment to ask for OS-notification permission
        if (v) requestJoinNotificationPermission();
        void persist();
      },
    ),
  );
  body.append(
    switchRow(
      "Keep searching after joining",
      "Don't turn auto-join off when a match is found, so it resumes after the game ends.",
      Boolean(settings.keepAutoJoinAfterMatch),
      (v) => {
        settings.keepAutoJoinAfterMatch = v;
        void persist();
      },
    ),
  );
  body.append(
    switchRow(
      "Auto-leave on team win",
      "Leave the match automatically once you / your team win.",
      Boolean(settings.autoLeaveOnTeamWin),
      (v) => {
        settings.autoLeaveOnTeamWin = v;
        void persist();
      },
    ),
  );

  // team-size presets
  body.append(el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Team size")));
  const chips = el("div", { class: "ofh-chips" });
  const activePreset = () =>
    TEAM_PRESETS.find(
      ([, mn, mx]) => settings.minTeamSize === mn && settings.maxTeamSize === mx,
    )?.[0] ?? null;
  for (const [label, mn, mx] of TEAM_PRESETS) {
    const chip = el("div", { class: `ofh-chip${activePreset() === label ? " on" : ""}` }, label);
    chip.addEventListener("click", () => {
      settings.minTeamSize = mn;
      settings.maxTeamSize = mx;
      chips.querySelectorAll(".ofh-chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      void persist();
    });
    chips.append(chip);
  }
  body.append(chips);

  // min lobby size
  const num = el("input", {
    class: "ofh-num",
    type: "number",
    min: "0",
    max: "100",
    value: settings.minLobbySize ?? "",
  }) as HTMLInputElement;
  num.addEventListener("change", () => {
    settings.minLobbySize = num.value === "" ? null : Number(num.value);
    void persist();
  });
  body.append(
    el(
      "div",
      { class: "ofh-row", style: "margin-top:10px" },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t("Minimum lobby size")),
        el(
          "div",
          { class: "ofh-desc" },
          t("Only join lobbies with at least this many players (blank = any)."),
        ),
      ),
      el("div", { class: "ofh-field" }, num),
    ),
  );

  // teams-in-match count range
  const countNum = (k: string): HTMLInputElement => {
    const input = el("input", {
      class: "ofh-num",
      type: "number",
      min: "1",
      max: "100",
      value: settings[k] ?? "",
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      settings[k] = input.value === "" ? null : Number(input.value);
      void persist();
    });
    return input;
  };
  body.append(
    el(
      "div",
      { class: "ofh-row", style: "margin-top:10px" },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t("Teams in match")),
        el("div", { class: "ofh-desc" }, t("Number of teams in the lobby (blank = any).")),
      ),
      el(
        "div",
        { class: "ofh-field" },
        el("label", {}, t("Min")),
        countNum("minTeamCount"),
        el("label", {}, t("Max")),
        countNum("maxTeamCount"),
      ),
    ),
  );

  // in-game floating panel
  body.append(
    el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("In-game panel")),
  );
  body.append(
    switchRow(
      "Floating auto-join panel",
      "Show the in-game auto-join quick panel.",
      Boolean(settings.showFloatingAutoJoinPanel),
      (v) => {
        settings.showFloatingAutoJoinPanel = v;
        void persist();
      },
    ),
  );

  // test chime
  const testBtn = el("button", { class: "ofh-btn" }, "▶ " + t("Test chime"));
  testBtn.addEventListener("click", () => ringChime());
  body.append(el("div", { style: "margin-top:14px" }, testBtn));
}

function renderFilters(body: HTMLElement): void {
  const groups: Array<[string, ReadonlyArray<readonly [string, string]>]> = [
    ["Start gold", START_GOLD],
    ["Modifiers", MODIFIERS],
  ];
  body.append(
    el(
      "div",
      { class: "ofh-note", style: "margin:0 2px 12px" },
      t("Tap a filter to cycle: off → include (green, must match) → exclude (red, skip these)."),
    ),
  );
  for (const [title, list] of groups) {
    body.append(el("div", { class: "ofh-section-title" }, t(title)));
    const chips = el("div", { class: "ofh-chips", style: "margin-bottom:16px" });
    for (const [key, label] of list) {
      const chip = el("div", { class: "ofh-chip" }, t(label));
      const apply = () => {
        const inc = Boolean(settings.includeFilters?.[key]);
        const exc = Boolean(settings.excludeFilters?.[key]);
        chip.classList.toggle("on", inc || exc);
        chip.classList.toggle("exclude", exc);
      };
      apply();
      chip.addEventListener("click", () => {
        settings.includeFilters = settings.includeFilters || {};
        settings.excludeFilters = settings.excludeFilters || {};
        const inc = Boolean(settings.includeFilters[key]);
        const exc = Boolean(settings.excludeFilters[key]);
        if (!inc && !exc) {
          settings.includeFilters[key] = true;
        } else if (inc) {
          settings.includeFilters[key] = false;
          settings.excludeFilters[key] = true;
        } else {
          settings.excludeFilters[key] = false;
        }
        apply();
        void persist();
      });
      chips.append(chip);
    }
    body.append(chips);
  }
}

function renderMaps(body: HTMLElement): void {
  const s = shared();
  const maps = s?.MAPS ?? [];

  const modeChips = el("div", { class: "ofh-chips", style: "margin-bottom:12px" });
  (["include", "exclude"] as const).forEach((mode) => {
    const chip = el(
      "div",
      { class: `ofh-chip${mapMode === mode ? " on" : ""}${mode === "exclude" ? " exclude" : ""}` },
      mode === "include" ? t("Include maps") : t("Exclude maps"),
    );
    chip.addEventListener("click", () => {
      mapMode = mode;
      renderActiveTab();
    });
    modeChips.append(chip);
  });
  body.append(modeChips);

  const key = mapMode === "include" ? "mapFilters" : "mapExcludeFilters";
  const tools = el("div", { class: "ofh-chips", style: "margin-bottom:12px" });
  const allBtn = el("button", { class: "ofh-btn" }, t("Select all"));
  const noneBtn = el("button", { class: "ofh-btn" }, t("Clear"));
  allBtn.addEventListener("click", () => {
    settings[key] = Object.fromEntries(maps.map((m) => [m.id, true]));
    renderActiveTab();
    void persist();
  });
  noneBtn.addEventListener("click", () => {
    settings[key] = {};
    renderActiveTab();
    void persist();
  });
  tools.append(allBtn, noneBtn);
  body.append(tools);

  const grid = el("div", { class: "ofh-maps" });
  for (const map of maps) {
    const on = Boolean(settings[key]?.[map.id]);
    const card = el("div", { class: `ofh-map${on ? " on" : ""}` });
    const url = mapThumbnailUrl(map.id);
    if (url) {
      const img = el("img", {
        class: "ofh-thumb",
        src: url,
        alt: map.name,
        draggable: "false",
        loading: "lazy",
      }) as HTMLImageElement;
      img.addEventListener("error", () => {
        img.replaceWith(el("div", { class: "ofh-noimg" }, "🗺"));
      });
      card.append(img);
    } else {
      card.append(el("div", { class: "ofh-noimg" }, "🗺"));
    }
    card.append(
      el("div", { class: "ofh-mapname" }, map.name),
      el("div", { class: "ofh-check" }, "✓"),
    );
    card.addEventListener("click", () => {
      settings[key] = settings[key] || {};
      const next = !settings[key][map.id];
      settings[key][map.id] = next;
      card.classList.toggle("on", next);
      void persist();
    });
    grid.append(card);
  }
  body.append(grid);
}

// @ts-ignore TS6133 — Helpers tab moved to Quick Panel (in-game floating panel)
function renderHelpers(body: HTMLElement): void {
  // Render each section as a collapsible, labeled cluster. Clicking the header
  // toggles it; the collapsed state persists per-section.
  HELPER_SECTIONS.forEach((section, index) => {
    const collapsed = Boolean(settings.collapsedHelperCategories?.[section.key]);
    const grid = helperRows(section.toggles);
    if (collapsed) grid.style.display = "none";

    const chevron = el("span", { class: "ofh-sec-chevron" }, collapsed ? "▸" : "▾");
    const header = el(
      "div",
      {
        class: "ofh-section-title ofh-section-head",
        style: index > 0 ? "margin-top:14px" : "",
      },
      chevron,
      el("span", {}, t(section.title)),
    );
    header.addEventListener("click", () => {
      const nowCollapsed = grid.style.display !== "none";
      grid.style.display = nowCollapsed ? "none" : "";
      chevron.textContent = nowCollapsed ? "▸" : "▾";
      settings.collapsedHelperCategories = {
        ...(settings.collapsedHelperCategories || {}),
        [section.key]: nowCollapsed,
      };
      void persist();
    });

    body.append(header);
    body.append(grid);
  });
}

// @ts-ignore TS6133 — Auto Bot tab now uses in-game panel exclusively
function renderAutoBot(body: HTMLElement): void {
  const ab = autobot();
  if (!ab) {
    body.append(
      el(
        "div",
        { class: "ofh-note" },
        t("The auto-bot loads inside a game. Open this tab while in a match to configure it."),
      ),
    );
    return;
  }
  const cfg = ab.get();

  body.append(
    switchRow(
      "Auto-bot enabled",
      "Run the auto-bot (private-lobby training tool).",
      cfg.enabled,
      (v) => ab.set({ enabled: v }),
    ),
  );
  body.append(
    switchRow(
      "Show auto-bot panel",
      "Show the in-game auto-bot panel (X on the panel hides it).",
      !cfg.hidden,
      (v) => ab.set({ hidden: !v }),
    ),
  );

  body.append(el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Difficulty")));
  const diffChips = el("div", { class: "ofh-chips" });
  for (const d of ab.DIFFICULTIES) {
    const chip = el("div", { class: `ofh-chip${cfg.difficulty === d ? " on" : ""}` }, t(d));
    chip.addEventListener("click", () => {
      ab.set({ difficulty: d });
      diffChips.querySelectorAll(".ofh-chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
    });
    diffChips.append(chip);
  }
  body.append(diffChips);

  body.append(el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Behaviors")));
  const grid = el("div", { class: "ofh-grid" });
  for (const k of ab.FEATURE_KEYS) {
    const [title, desc] = FEATURE_LABELS[k] || [k, ""];
    grid.append(
      switchRow(title, desc, Boolean(cfg.features[k]), (v) => ab.set({ features: { [k]: v } })),
    );
  }
  body.append(grid);

  // Which structure types the bot is allowed to auto-build (icons match the
  // team-build panel). Disabled = the bot never builds/upgrades that type.
  body.append(
    el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Auto-build structures")),
  );
  const structGrid = el("div", { class: "ofh-grid" });
  const allowedStructs = cfg.buildStructures || {};
  for (const [type, emoji] of AB_STRUCTURES) {
    const sw = el("div", {
      class: `ofh-switch${allowedStructs[type] !== false ? " on" : ""}`,
    });
    const row = el(
      "div",
      { class: "ofh-row" },
      el(
        "div",
        { class: "ofh-txt", style: "display:flex;align-items:center;gap:8px;min-width:0;" },
        gameStructureIcon(type, emoji),
        el("div", { class: "ofh-name" }, t(type)),
      ),
      sw,
    );
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      ab.set({ buildStructures: { [type]: next } });
    });
    structGrid.append(row);
  }
  body.append(structGrid);

  body.append(el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Advanced")));
  body.append(
    switchRow(
      "Win-condition fixes",
      "Adjust the bot's internal win thresholds.",
      cfg.winFixes,
      (v) => ab.set({ winFixes: v }),
    ),
    switchRow(
      "Smart spawn",
      "Score spawn tiles by land density, enemy distance, and edge avoidance (instead of random).",
      cfg.smartSpawn,
      (v) => ab.set({ smartSpawn: v }),
    ),
  );
  const tickNum = el("input", {
    class: "ofh-num",
    type: "number",
    min: "50",
    max: "2000",
    step: "50",
    value: cfg.tickMs,
  }) as HTMLInputElement;
  tickNum.addEventListener("change", () => {
    const v = Number(tickNum.value);
    if (v > 0) ab.set({ tickMs: v });
  });
  body.append(
    el(
      "div",
      { class: "ofh-row", style: "margin-top:6px" },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t("Tick interval (ms)")),
        el("div", { class: "ofh-desc" }, t("Engine poll interval; lower = snappier but heavier.")),
      ),
      el("div", { class: "ofh-field" }, tickNum),
    ),
  );
}

// @ts-ignore TS6133 — Atom tab moved to Quick Panel
function renderAtom(body: HTMLElement): void {
  body.append(el("div", { class: "ofh-section-title" }, t("Atom batch-fire")));

  // how-it-works hero (red is a danger accent only — the tab stays on the teal system)
  body.append(
    el(
      "div",
      { class: "ofh-atom-hero" },
      el("div", { class: "ofh-atom-hero-ico" }, "☢️"),
      el(
        "div",
        { class: "ofh-atom-hero-body" },
        el(
          "div",
          { class: "ofh-atom-hero-desc" },
          t(
            "Aim at a target and press the hotkey to open the batch-fire dialog. It paces shots just under the server's rate limit so none are dropped, works out how many atoms pierce the SAMs along the flight path (+1 to land), and can finish with a Hydrogen once the atoms bait the interceptors. Press Esc to abort a salvo.",
          ),
        ),
        el(
          "div",
          { class: "ofh-atom-keyrow" },
          el("span", { class: "ofh-atom-keylbl" }, t("Hotkey")),
          el("span", { class: "ofh-kbd" }, "\\"),
        ),
      ),
    ),
  );

  // ---- throttle controls --------------------------------------------------
  body.append(
    el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("Firing throttle")),
  );

  const cadValue = el("span", { class: "ofh-cad" });
  const refreshCad = (): void => {
    const c = atomGetCfg();
    const gap = atomGapMs(c.batchSize, c.delayMs);
    const rate = (1000 / gap).toFixed(1);
    cadValue.textContent = `≈ ${rate} ${t("shots/sec")}`;
    cadValue.classList.toggle("max", gap <= ATOM_SAFE_GAP_MS);
  };

  const numRow = (
    name: string,
    desc: string,
    key: "batchSize" | "delayMs",
    min: number,
    step: number,
  ): HTMLElement => {
    const input = el("input", {
      class: "ofh-num",
      type: "number",
      min: String(min),
      step: String(step),
      value: String(atomGetCfg()[key]),
    }) as HTMLInputElement;
    const commit = (): void => {
      let v = Math.floor(Number(input.value));
      if (!Number.isFinite(v) || v < min) v = min;
      input.value = String(v);
      atomSetCfg({ [key]: v });
      refreshCad();
    };
    input.addEventListener("change", commit);
    return el(
      "div",
      { class: "ofh-row" },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t(name)),
        el("div", { class: "ofh-desc" }, t(desc)),
      ),
      el("div", { class: "ofh-field" }, input),
    );
  };

  const grid = el("div", { class: "ofh-grid" });
  grid.append(
    numRow(
      "Atoms per burst",
      "Pacing hint. The macro never fires faster than the server-safe rate, so this only matters when you slow it down.",
      "batchSize",
      1,
      1,
    ),
    numRow(
      "Delay (ms)",
      "Spacing between bursts. Raising it throttles the fire rate below the safe maximum — it can never speed past it.",
      "delayMs",
      0,
      10,
    ),
  );
  body.append(grid);

  // live cadence readout
  body.append(
    el(
      "div",
      { class: "ofh-row", style: "margin-top:8px" },
      el(
        "div",
        { class: "ofh-txt" },
        el("div", { class: "ofh-name" }, t("Effective fire rate")),
        el(
          "div",
          { class: "ofh-desc" },
          t("Live delivery cadence at the current throttle (green = server-safe max)."),
        ),
      ),
      el("div", { class: "ofh-field" }, cadValue),
    ),
  );
  refreshCad();

  // reset to safe defaults
  const reset = el(
    "button",
    { class: "ofh-btn", style: "margin-top:12px" },
    t("Reset to safe defaults"),
  );
  reset.addEventListener("click", () => {
    atomSetCfg({ batchSize: ATOM_DEFAULTS.batchSize, delayMs: ATOM_DEFAULTS.delayMs });
    renderActiveTab();
  });
  body.append(reset);

  body.append(
    el(
      "div",
      { class: "ofh-note" },
      t(
        "These knobs only throttle the macro below its server-safe maximum (~7 shots/sec) — they never make it fire faster. Quantity and the “last bomb = Hydrogen” choice are picked per target in the in-game dialog.",
      ),
    ),
  );
}

function selectLanguage(code: string): void {
  settings.language = code;
  void (async () => {
    await persist();
    const m = i18n();
    if (m) {
      try {
        translations = await m.loadBundle(code);
      } catch {
        /* keep current translations */
      }
    }
    renderActiveTab();
  })();
}

// Searchable language dropdown, auto-populated from the build-discovered locales.
function languageDropdown(): HTMLElement {
  const langs = availableLanguages(settings.language || "en");
  const current = langs.find((l) => l.code === settings.language) || langs[0];

  const menu = el("div", { class: "ofh-dd-menu", hidden: "" });
  const search = el("input", {
    class: "ofh-dd-search",
    type: "text",
    placeholder: t("Search languages"),
  }) as HTMLInputElement;
  const list = el("div", { class: "ofh-dd-list" });

  const renderList = (q: string) => {
    const needle = q.trim().toLowerCase();
    const filtered = langs.filter(
      (l) =>
        !needle ||
        l.nativeName.toLowerCase().includes(needle) ||
        l.name.toLowerCase().includes(needle) ||
        l.code.toLowerCase().includes(needle),
    );
    list.replaceChildren();
    if (!filtered.length) {
      list.append(el("div", { class: "ofh-dd-empty" }, t("No languages found")));
      return;
    }
    for (const l of filtered) {
      const item = el(
        "div",
        { class: `ofh-dd-item${l.code === settings.language ? " on" : ""}` },
        el("span", {}, l.nativeName),
        el("span", { class: "ofh-dd-code" }, l.code.toUpperCase()),
      );
      item.addEventListener("click", () => selectLanguage(l.code));
      list.append(item);
    }
  };

  const btn = el(
    "button",
    { class: "ofh-dd-btn", type: "button" },
    el("span", {}, current ? current.nativeName : settings.language || "en"),
    el("span", { class: "ofh-dd-caret" }, "▾"),
  );
  const dd = el("div", { class: "ofh-dd" }, btn, menu);
  menu.append(search, list);

  const close = () => {
    menu.setAttribute("hidden", "");
    document.removeEventListener("pointerdown", onOutside, true);
  };
  const onOutside = (e: Event) => {
    if (!dd.contains(e.target as Node)) close();
  };
  btn.addEventListener("click", () => {
    if (menu.hasAttribute("hidden")) {
      menu.removeAttribute("hidden");
      search.value = "";
      renderList("");
      search.focus();
      document.addEventListener("pointerdown", onOutside, true);
    } else {
      close();
    }
  });
  search.addEventListener("input", () => renderList(search.value));

  return dd;
}

// @ts-ignore TS6133 — Settings moved to Quick Panel Config tab, kept for reference
function renderSettings(body: HTMLElement): void {
  body.append(el("div", { class: "ofh-section-title" }, t("Language")));
  body.append(languageDropdown());
  body.append(
    el(
      "div",
      { class: "ofh-note" },
      t("Language of the helper UI. Missing text falls back to English. Applies in-game too."),
    ),
  );

  const version =
    (window as unknown as { __OFH_ASSETS?: { version?: string } }).__OFH_ASSETS?.version || "";
  body.append(el("div", { class: "ofh-section-title", style: "margin-top:16px" }, t("About")));
  body.append(
    el(
      "div",
      { class: "ofh-note" },
      `OpenFront Helper v${version} — ${t("standalone userscript")}.`,
    ),
  );
  body.append(
    el(
      "a",
      { class: "ofh-link", href: REPO_URL, target: "_blank", rel: "noopener noreferrer" },
      el("span", { class: "ofh-link-ico" }, "★"),
      el(
        "div",
        { class: "ofh-link-body" },
        el("div", { class: "ofh-link-title" }, "GitHub — alexanderli07/openfront"),
        el("div", { class: "ofh-link-sub" }, t("Source, issues & updates")),
      ),
      el("span", { class: "ofh-link-arrow" }, "↗"),
    ),
  );
}

// Filters and Maps are sub-tabs of Auto-Join.
const AUTO_SUBTABS: Array<[string, string, (body: HTMLElement) => void]> = [
  ["main", "Auto-join", renderAutoJoinMain],
  ["filters", "Filters", renderFilters],
  ["maps", "Maps", renderMaps],
];

function renderAutoJoin(body: HTMLElement): void {
  const bar = el("div", { class: "ofh-subtabs" });
  for (const [id, label] of AUTO_SUBTABS) {
    const chip = el("div", { class: `ofh-subtab${activeAutoTab === id ? " on" : ""}` }, t(label));
    chip.addEventListener("click", () => {
      activeAutoTab = id;
      renderActiveTab();
    });
    bar.append(chip);
  }
  body.append(bar);
  const sub = el("div", { class: "ofh-subbody" });
  body.append(sub);
  AUTO_SUBTABS.find(([id]) => id === activeAutoTab)?.[2](sub);
}

const TABS: Array<[string, string, (body: HTMLElement) => void]> = [
  ["autojoin", "Auto-Join", renderAutoJoin],
];

function renderActiveTab(): void {
  if (!overlay) return;
  const body = overlay.querySelector(".ofh-body") as HTMLElement;
  if (!body) return;
  body.replaceChildren();
  TABS.find(([id]) => id === activeTab)?.[2](body);
  overlay.querySelectorAll(".ofh-tab").forEach((tab) => {
    const tabEl = tab as HTMLElement;
    const id = tabEl.dataset.tab;
    // re-translate the tab label too — built once in build(), so a language change
    // would otherwise leave the tab strip in the old language.
    const entry = TABS.find(([tid]) => tid === id);
    if (entry) tabEl.textContent = t(entry[1]);
    tabEl.classList.toggle("active", id === activeTab);
  });
}

function build(version: string): HTMLDivElement {
  const panel = el("div", { id: "openfront-helper-popup" });

  const head = el(
    "div",
    { class: "ofh-head" },
    el("h1", {}, "⊕ OpenFront Helper", el("span", { class: "ofh-ver" }, "v" + version)),
    el("div", { class: "ofh-spacer" }),
  );
  const close = el("div", { class: "ofh-x", title: t("Close") }, "✕");
  close.addEventListener("click", closePanel);
  head.append(close);
  panel.append(head);

  const tabs = el("div", { class: "ofh-tabs" });
  if (TABS.length > 1) {
    for (const [id, label] of TABS) {
      const tab = el("div", { class: "ofh-tab", "data-tab": id }, t(label));
      tab.addEventListener("click", () => {
        activeTab = id;
        renderActiveTab();
      });
      tabs.append(tab);
    }
    panel.append(tabs);
  }
  panel.append(el("div", { class: "ofh-body" }));

  const ov = el("div", { id: "openfront-helper-popup-overlay" }, panel);
  ov.addEventListener("pointerdown", (e) => {
    if (e.target === ov) closePanel();
  });
  return ov;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closePanel();
}

export async function openPanel(): Promise<void> {
  if (overlay || opening) return; // guard the await window against double-mount
  opening = true;
  try {
    await openPanelInner();
  } catch (error) {
    console.error("[ofh] popup failed to open:", error);
    closePanel();
  } finally {
    opening = false;
  }
}

async function openPanelInner(): Promise<void> {
  const s = shared();
  const m = i18n();
  if (!s || !m) {
    // Content engine not initialized yet — show a minimal placeholder.
    overlay = el(
      "div",
      { id: "openfront-helper-popup-overlay" },
      el(
        "div",
        { id: "openfront-helper-popup" },
        el(
          "div",
          { class: "ofh-body" },
          el("div", { class: "ofh-note" }, "Initializing… reopen in a moment."),
        ),
      ),
    );
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) closePanel();
    });
    document.body.append(overlay);
    return;
  }

  const stored = await chromeApi().storage.local.get(s.STORAGE_KEY);
  settings = s.normalizeSettings(stored[s.STORAGE_KEY]);
  // Opening the popup is a user gesture — if notifications are already enabled, this is a
  // good moment to (re)request OS-notification permission for users who turned it on before.
  if (settings.joinNotification) requestJoinNotificationPermission();
  try {
    // Open in the SAVED language, not a hardcoded "en" — otherwise the popup always
    // boots in English even when the user already picked Vietnamese.
    translations = await m.loadBundle(settings.language || "en");
  } catch {
    translations = {};
  }

  const version =
    (window as unknown as { __OFH_ASSETS?: { version?: string } }).__OFH_ASSETS?.version || "";
  overlay = build(version);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  renderActiveTab();
}

export function closePanel(): void {
  overlay?.remove();
  overlay = null;
  document.removeEventListener("keydown", onKey);
}

/** Open the popup focused on a specific tab / Auto-Join sub-tab. */
export function openPanelTo(tab?: string, autoSub?: string): void {
  if (tab) activeTab = tab;
  if (autoSub) activeAutoTab = autoSub;
  if (overlay) renderActiveTab();
  else void openPanel();
}
