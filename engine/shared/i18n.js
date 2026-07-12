(function initOpenFrontHelperI18n(globalScope) {
  const LANGUAGE_CODES = [
    "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
    "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce",
    "ch", "co", "cr", "cs", "cu", "cv", "cy", "da", "de", "dv", "dz", "ee",
    "el", "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr",
    "fy", "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr",
    "ht", "hu", "hy", "hz", "ia", "id", "ie", "ig", "ii", "ik", "io", "is",
    "it", "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn",
    "ko", "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln",
    "lo", "lt", "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms",
    "mt", "my", "na", "nd", "ne", "ng", "nl", "no", "nr", "nv",
    "ny", "oc", "oj", "om", "or", "os", "pa", "pi", "pl", "ps", "pt", "qu",
    "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "si", "sk",
    "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta",
    "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw",
    "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "wo", "xh", "yi",
    "yo", "za", "zh", "zu",
  ];

  const DEFAULT_TRANSLATIONS = {
    languageCode: "en",
    languageName: "English",
    settings: "Settings",
    openSettings: "Open settings",
    github: "GitHub",
    openGitHubRepository: "Open GitHub repository",
    openFrontReloadTitle: "Reload OpenFront?",
    openFrontReloadText: "OpenFront was already open, so the extension is not active on this tab yet. Reload the page to enable OpenFront Helper.",
    openFrontReloadButton: "Reload page",
    global: "Global",
    lobby: "Lobby",
    send: "Send",
    writeAMessage: "Write a message...",
    noMessagesYet: "No messages yet.",
    anonymous: "Anonymous",
    customNotificationSound: "Custom notification sound",
    test: "Test",
    upload: "Upload",
    remove: "Remove",
    cancel: "Cancel",
    defaultSound: "Default",
    customSound: "Custom",
    language: "Language",
    openLanguageMenu: "Change language",
    "Game-time alert": "Game-time alert",
    "Game-time alert at (min)": "Game-time alert at (min)",
    "When to fire the game-time alert, in minutes.": "When to fire the game-time alert, in minutes.",
    "Match time reached {time}": "Match time reached {time}",
    "Advisor": "Advisor",
    "critical": "critical",
    "recover": "recover",
    "growing": "growing",
    "spend now": "spend now",
    "Troops": "Troops",
    "Growth": "Growth",
    "Spend": "Spend",
    "Push in": "Push in",
    "Expansion": "Expansion",
    "normal": "normal",
    "aggressive": "aggressive",
    "Threats": "Threats",
    "Weak": "Weak",
    "Neutral": "Neutral",
    "Dangerous": "Dangerous",
    "Critical": "Critical",
    "No notable threats": "No notable threats",
    "Waiting for game…": "Waiting for game…",
    "Nuke incoming": "Nuke incoming",
    "Retaliate against {name}?": "Retaliate against {name}?",
    "Fire": "Fire",
    "Dismiss": "Dismiss",
    "easy": "easy",
    "moderate": "moderate",
    "risky": "risky",
    "Attack": "Attack",
    "Favourite": "Favourite",
    "Blacklist": "Blacklist",
    "Building": "Building",
    "Ready": "Ready",
    searchLanguages: "Search languages",
    noLanguagesFound: "No languages found",
    openMacros: "Open macros",
    autoJoinOn: "Auto-Join ON",
    autoJoinOff: "Auto-Join OFF",
    showFloatingHelpersPanel: "Show floating helpers panel on OpenFront",
    hideFloatingHelpersPanel: "Hide floating helpers panel on OpenFront",
    "Auto-Join & Helpers for OpenFront": "Auto-Join & Helpers for OpenFront",
    "Settings": "Settings",
    "Open settings": "Open settings",
    "GitHub": "GitHub",
    "Open GitHub repository": "Open GitHub repository",
    "Global": "Global",
    "Lobby": "Lobby",
    "Send": "Send",
    "Write a message...": "Write a message...",
    "No messages yet.": "No messages yet.",
    "Anonymous": "Anonymous",
    "Change language": "Change language",
    "Open macros": "Open macros",
    "Custom notification sound": "Custom notification sound",
    "Show floating helpers panel on OpenFront": "Show floating helpers panel on OpenFront",
    "Test": "Test",
    "Upload": "Upload",
    "Remove": "Remove",
    "Cancel": "Cancel",
    "Default": "Default",
    "Search languages": "Search languages",
    "Languages": "Languages",
    "Join our Discord": "Join our Discord",
    "Macros": "Macros",
    "⚓ Send 1% Boat": "⚓ Send 1% Boat",
    "Send a transport with 1% troops, then restore the attack ratio.": "Send a transport with 1% troops, then restore the attack ratio.",
    "Hotkey": "Hotkey",
    "Shift + B": "Shift + B",
    "N": "N",
    "Show button in selection wheel": "Show button in selection wheel",
    "One-time setup": "One-time setup",
    "If openfront.io was already open when you installed this extension, reload that tab once. Otherwise the extension will not work on that tab.": "If openfront.io was already open when you installed this extension, reload that tab once. Otherwise the extension will not work on that tab.",
    "Got it": "Got it",
    "Helpers": "Helpers",
    "Float": "Float",
    "Game helpers": "Game helpers",
    "Mark bot nations red": "Mark bot nations red",
    "Adds a red marker to nation AI names on the map.": "Adds a red marker to nation AI names on the map.",
    "Adds a red marker to nation AI names.": "Adds a red marker to nation AI names.",
    "Alliances": "Alliances",
    "Show alliances": "Show alliances",
    "Highlights allies with remaining alliance time.": "Highlights allies with remaining alliance time.",
    "Alliance requests panel": "Alliance requests panel",
    "Moves alliance requests and renewal prompts into a separate right-side window.": "Moves alliance requests and renewal prompts into a separate right-side window.",
    "Cheats": "Cheats",
    "Only available in solo or custom games.": "Only available in solo or custom games.",
    "⚠ Only available in solo or custom games.": "⚠ Only available in solo or custom games.",
    "Nuke prediction": "Nuke prediction",
    "Shows predicted enemy nuke landing points and explosion radius.": "Shows predicted enemy nuke landing points and explosion radius.",
    "Shows predicted enemy nuke landing points and blast radius.": "Shows predicted enemy nuke landing points and blast radius.",
    "Boat prediction": "Boat prediction",
    "Shows enemy boat landing points. Red = targeting you, yellow = targeting others.": "Shows enemy boat landing points. Red = targeting you, yellow = targeting others.",
    "Nuke suggestion": "Nuke suggestion",
    "Beta": "Beta",
    "May lag": "May lag",
    "Hover an enemy to show high-damage atom and hydrogen targets.": "Hover an enemy to show high-damage atom and hydrogen targets.",
    "Auto nuke": "Auto nuke",
    "Adds auto economy and population nuke actions to the player wheel.": "Adds auto economy and population nuke actions to the player wheel.",
    "Include allies": "Include allies",
    "↳ Include allies": "↳ Include allies",
    "Also show auto nuke options when right-clicking allied players.": "Also show auto nuke options when right-clicking allied players.",
    "Block non-team trades": "Block non-team trades",
    "Team games only: blocks trades with players who are not on your team.": "Team games only: blocks trades with players who are not on your team.",
    "Blocks trades with players who are not on your team.": "Blocks trades with players who are not on your team.",
    "Available only during an active team game.": "Available only during an active team game.",
    "Economic helpers": "Economic helpers",
    "Gold per minute": "Gold per minute",
    "Show gold per minute": "Show gold per minute",
    "Show gold per minute preview": "Show gold per minute preview",
    "Adds GPM to the player hover panel.": "Adds GPM to the player hover panel.",
    "Team gold per minute": "Team gold per minute",
    "Show team gold per minute": "Show team gold per minute",
    "Show team gold per minute preview": "Show team gold per minute preview",
    "Lists each team's total GPM in team games.": "Lists each team's total GPM in team games.",
    "Lists each team's total GPM.": "Lists each team's total GPM.",
    "Top 10 gold per minute": "Top 10 gold per minute",
    "Lists the highest tracked player GPM.": "Lists the highest tracked player GPM.",
    "Trade balances": "Trade balances",
    "Show trade balances": "Show trade balances",
    "Show trade balances preview": "Show trade balances preview",
    "Shows observed ship and train trade imports and exports.": "Shows observed ship and train trade imports and exports.",
    "Shows observed trade imports and exports.": "Shows observed trade imports and exports.",
    "Heatmaps": "Heatmaps",
    "Economic heatmap": "Economic heatmap",
    "Highlights structures with observed trade revenue.": "Highlights structures with observed trade revenue.",
    "Intensity": "Intensity",
    "Economic heatmap intensity": "Economic heatmap intensity",
    "Low": "Low",
    "High": "High",
    "Export partner heatmap": "Export partner heatmap",
    "Hover a player to highlight the partner industry that fuels their exports.": "Hover a player to highlight the partner industry that fuels their exports.",
    "Hover a player to highlight export partners.": "Hover a player to highlight export partners.",
    "Auto-Join": "Auto-Join",
    "Auto-Join ON": "Auto-Join ON",
    "Auto-Join OFF": "Auto-Join OFF",
    "Lobby Forecast": "Lobby Forecast",
    "Lobby forecast": "Lobby forecast",
    "ETA (estimate)": "ETA (estimate)",
    "Hit chance next 10 lobbies": "Hit chance next 10 lobbies",
    "Median to match": "Median to match",
    "lobbies": "lobbies",
    "Send 1% Boat": "Send 1% Boat",
    "Right-click any tile to send a boat with 1% troops, then restores your ratio.": "Right-click any tile to send a boat with 1% troops, then restores your ratio.",
    "Not enough data yet": "Not enough data yet",
    "Game found notification popup": "Game found notification popup",
    "Show a notification when a game is found": "Show a notification when a game is found",
    "Min lobby size": "Min lobby size",
    "Only join lobbies whose max player count is greater than this number.": "Only join lobbies whose max player count is greater than this number.",
    "Searching for": "Searching for",
    "Lobby Type": "Lobby Type",
    "Team size": "Team size",
    "Min": "Min",
    "Max": "Max",
    "Any": "Any",
    "FFA": "FFA",
    "Duos": "Duos",
    "Trios": "Trios",
    "Quads": "Quads",
    "Teams larger than Quads": "Teams larger than Quads",
    "Matches team lobbies with more than 4 players per team.": "Matches team lobbies with more than 4 players per team.",
    "Modifier": "Modifier",
    "Random spawn": "Random spawn",
    "Alliances disabled": "Alliances disabled",
    "Ports disabled": "Ports disabled",
    "Nukes disabled": "Nukes disabled",
    "SAMs disabled": "SAMs disabled",
    "Water nukes": "Water nukes",
    "4min peace time": "4min peace time",
    "2x gold": "2x gold",
    "Start Gold": "Start Gold",
    "You can turn on all three at the same time. Only one of them has to match.": "You can turn on all three at the same time. Only one of them has to match.",
    "You can turn on all four at the same time. Only one of them has to match.": "You can turn on all four at the same time. Only one of them has to match.",
    "0M starting gold": "0M starting gold",
    "Default case with no explicit starting gold.": "Default case with no explicit starting gold.",
    "1M starting gold": "1M starting gold",
    "5M starting gold": "5M starting gold",
    "25M starting gold": "25M starting gold",
    "Exclude": "Exclude",
    "Maps": "Maps",
    "Clear": "Clear",
    "Search maps": "Search maps",
    "Map filters": "Map filters",
    "Include requires a match. Exclude blocks an option. For starting gold, any included value is enough, while excluded values are always rejected.": "Include requires a match. Exclude blocks an option. For starting gold, any included value is enough, while excluded values are always rejected.",
    "Helper preview": "Helper preview",
    "Close": "Close",
    "Close helper preview": "Close helper preview",
    "Previous image": "Previous image",
    "Next image": "Next image",
    "Close helpers panel": "Close helpers panel",
    "Resize helpers panel": "Resize helpers panel",
    "On": "On",
    "Off": "Off",
    "Show Mark bot nations red preview": "Show Mark bot nations red preview",
    "Show alliances preview": "Show alliances preview",
    "Show Nuke prediction preview": "Show Nuke prediction preview",
    "Show Auto nuke preview": "Show Auto nuke preview",
    "Show Economic heatmap preview": "Show Economic heatmap preview",
    "Game Found!": "Game Found!",
    "Joining now...": "Joining now...",
    "Cologne": "Cologne",
    "Cologne, Germany and European Union": "Cologne, Germany and European Union",
    "Cologne Cathedral": "Cologne Cathedral",
    "Germany": "Germany",
    "European Union": "European Union",
    // ---- Auto-Bot (page-bridge/auto-bot) ----
    "Starting…": "Starting…",
    "Disabled": "Disabled",
    "Waiting to enter game…": "Waiting to enter game…",
    "⛔ Blocked in a public lobby": "⛔ Blocked in a public lobby",
    "Waiting for player…": "Waiting for player…",
    "Spawn phase…": "Spawn phase…",
    "💀 Eliminated": "💀 Eliminated",
    "Expanding…": "Expanding…",
    "Massing troops / building…": "Massing troops / building…",
    "Error (see console)": "Error (see console)",
    "Waiting for build-menu (eventBus)…": "Waiting for build-menu (eventBus)…",
    "Spawn intent not found": "Spawn intent not found",
    "No suitable spawn tile found": "No suitable spawn tile found",
    "Spawn tile selected": "Spawn tile selected",
    "Attack intent not found": "Attack intent not found",
    "🛡️ Defending…": "🛡️ Defending…",
    "build-menu not found": "build-menu not found",
    "Waiting for border data (borderTiles)…": "Waiting for border data (borderTiles)…",
    "⛔ Public lobby — auto-disabled": "⛔ Public lobby — auto-disabled",
    "Checking lobby…": "Checking lobby…",
    "⛔ Public lobby — bot locked": "⛔ Public lobby — bot locked",
    "Private lobby": "Private lobby",
    "Singleplayer": "Singleplayer",
    "🚢 Deploy warship": "🚢 Deploy warship",
    "🚢 Dispatch {moved}/{total} ships (keep {home} on guard)": "🚢 Dispatch {moved}/{total} ships (keep {home} on guard)",
    "🚢 Patrol weak point ({moved})": "🚢 Patrol weak point ({moved})",
    "🤝➡️ Send alliance {name}": "🤝➡️ Send alliance {name}",
    "🔁 Renew alliance {name}": "🔁 Renew alliance {name}",
    "🤝 Alliance {name}": "🤝 Alliance {name}",
    "🏗️ Build {type} (score {score})": "🏗️ Build {type} (score {score})",
    "⬆️ Upgrade {type} (level {level})": "⬆️ Upgrade {type} (level {level})",
    "🚫 Embargo {name}": "🚫 Embargo {name}",
    "🎁 Donate troops {name}": "🎁 Donate troops {name}",
    "🤖 Crush {count} bots": "🤖 Crush {count} bots",
    "🛡️ Retaliate {name}": "🛡️ Retaliate {name}",
    "🟩 Grab empty land": "🟩 Grab empty land",
    "☢️🟩 Reclaim irradiated land": "☢️🟩 Reclaim irradiated land",
    "🌊⚔️ Surge from beachhead {name}": "🌊⚔️ Surge from beachhead {name}",
    "🎯 Attack weakened {name}": "🎯 Attack weakened {name}",
    "🤝⚔️ Assist ally vs {name}": "🤝⚔️ Assist ally vs {name}",
    "🗡️ Attack traitor {name}": "🗡️ Attack traitor {name}",
    "🗡️ Betray {name}": "🗡️ Betray {name}",
    "😴 Attack AFK {name}": "😴 Attack AFK {name}",
    "⚔️ Pile on {name}": "⚔️ Pile on {name}",
    "😠 Attack nemesis {name}": "😠 Attack nemesis {name}",
    "🏭⚔️ Seize economy {name}": "🏭⚔️ Seize economy {name}",
    "⚔️ Attack weakest {name}": "⚔️ Attack weakest {name}",
    "⛵ Probe landing {name}": "⛵ Probe landing {name}",
    "☢️ MIRV the dominant enemy": "☢️ MIRV the dominant enemy",
    "☢️ Saturate air defense ({bombs} bombs, {sams} SAMs on path)": "☢️ Saturate air defense ({bombs} bombs, {sams} SAMs on path)",
    "☢️ Nuclear RETALIATION": "☢️ Nuclear RETALIATION",
    "☢️ Launch": "☢️ Launch",
    "Toggle on/off": "Toggle on/off",
    "Collapse": "Collapse",
    "🎮 Controls": "🎮 Controls",
    "📜 Log": "📜 Log",
    "Auto-spawn": "Auto-spawn",
    "Auto-expand / attack": "Auto-expand / attack",
    "Auto-landing (1% boat)": "Auto-landing (1% boat)",
    "Auto-deploy warships": "Auto-deploy warships",
    "Auto-build": "Auto-build",
    "Auto-launch nukes": "Auto-launch nukes",
    "Auto-accept alliances": "Auto-accept alliances",
    "Auto-donate troops (allies)": "Auto-donate troops (allies)",
    "⚙ Advanced settings ▾": "⚙ Advanced settings ▾",
    "⚙ Advanced settings ▴": "⚙ Advanced settings ▴",
    "Troop reserve (vs players)": "Troop reserve (vs players)",
    "Trigger threshold": "Trigger threshold",
    "Reserve when grabbing land": "Reserve when grabbing land",
    "Troops per landing boat": "Troops per landing boat",
    "Tick interval": "Tick interval",
    "Troops": "Troops",
    "Gold": "Gold",
    "Tiles": "Tiles",
    "Attacks": "Attacks",
    "Builds": "Builds",
    "Nukes": "Nukes",
    "All": "All",
    "No actions yet": "No actions yet",
    "Spawn": "Spawn",
    "Combat": "Combat",
    "Naval": "Naval",
    "Building": "Building",
    "Strikes": "Strikes",
    "Diplomacy": "Diplomacy",

    // ---- Auto-Bot (page-bridge/auto-bot) ----
    "🏁 Spawn": "🏁 Spawn",

    // ---- Helper-users panel (TN1) ----
    "Script users": "Script users",
    "Script users panel": "Script users panel",
    "Lists other players running this helper (detected via a 3-emoji signature broadcast once per match).":
      "Lists other players running this helper (detected via a 3-emoji signature broadcast once per match).",
    "No script users detected yet.": "No script users detected yet.",
    you: "you",
    ally: "ally",
    enemy: "enemy",
    neutral: "neutral",

    // ---- SOS defense (TN2) ----
    "SOS when attacked": "SOS when attacked",
    "When under attack, sends an SOS emoji to allies/teammates and marks the attacker for your team. Works with or without the auto-bot.":
      "When under attack, sends an SOS emoji to allies/teammates and marks the attacker for your team. Works with or without the auto-bot.",

  };

  const LANGUAGE_NAME_OVERRIDES = {
    tl: "Tagalog",
  };

  let defaultBundlePromise = null;

  function getMessage(bundle, key) {
    return bundle?.[key] || DEFAULT_TRANSLATIONS[key] || key;
  }

  function localizeTextValue(bundle, value) {
    const trimmed = String(value ?? "").trim();
    return trimmed ? getMessage(bundle, trimmed) : value;
  }

  function localizeElement(root, bundle) {
    const ignoredTags = new Set(["SCRIPT", "STYLE", "SVG", "PATH"]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ignoredTags.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      node.__openFrontI18nText ||= node.nodeValue.trim();
      const translated = getMessage(bundle, node.__openFrontI18nText);
      node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated);
    }

    for (const element of root.querySelectorAll("*")) {
      for (const attr of ["aria-label", "title", "placeholder", "data-info-title"]) {
        if (!element.hasAttribute(attr)) {
          continue;
        }
        const storeAttr = `data-openfront-i18n-${attr}`;
        if (!element.hasAttribute(storeAttr)) {
          element.setAttribute(storeAttr, element.getAttribute(attr));
        }
        element.setAttribute(attr, localizeTextValue(bundle, element.getAttribute(storeAttr)));
      }
    }
  }

  function getLanguageDisplayName(code, locale = "en") {
    if (LANGUAGE_NAME_OVERRIDES[code]) {
      return LANGUAGE_NAME_OVERRIDES[code];
    }

    try {
      const displayNames = new Intl.DisplayNames([locale], { type: "language" });
      return displayNames.of(code) || code;
    } catch (_) {
      return code;
    }
  }

  function createLanguageOptions(locale = "en") {
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    return LANGUAGE_CODES.map((code) => {
      const name = getLanguageDisplayName(code, locale);
      const nativeName = getLanguageDisplayName(code, code);
      return {
        code,
        name,
        nativeName,
        searchText: `${code} ${name} ${nativeName}`.toLowerCase(),
      };
    }).sort((a, b) => collator.compare(a.name, b.name));
  }

  async function fetchBundle(language) {
    const path = `locales/${language}/common.json`;
    const url =
      globalScope.chrome?.runtime?.getURL instanceof Function
        ? globalScope.chrome.runtime.getURL(path)
        : path;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load locale ${language}`);
    }
    return response.json();
  }

  async function loadBundle(language) {
    if (!defaultBundlePromise) {
      defaultBundlePromise = fetchBundle("en").catch(() => DEFAULT_TRANSLATIONS);
    }

    const defaultBundle = await defaultBundlePromise;
    if (language === "en") {
      return { ...DEFAULT_TRANSLATIONS, ...defaultBundle };
    }

    try {
      const bundle = await fetchBundle(language);
      return { ...DEFAULT_TRANSLATIONS, ...defaultBundle, ...bundle };
    } catch (_) {
      return { ...DEFAULT_TRANSLATIONS, ...defaultBundle };
    }
  }

  globalScope.OpenFrontHelperI18n = {
    LANGUAGE_CODES,
    DEFAULT_TRANSLATIONS,
    createLanguageOptions,
    getLanguageDisplayName,
    getMessage,
    localizeElement,
    loadBundle,
  };
})(globalThis);
