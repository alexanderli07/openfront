'use strict';

// Internal strategy rules use the existing recommended defaults. Only action
// permissions, building choices and numeric tuning remain user settings.
const AUTOMATIC_RULES = [
  'winFixes','smartSpawn','economyFirst','samCrack','samDefense','defensePosts',
  'nukeDensityFirst','reserveByNeighbors','combatReserve','gentleNeighbors',
  'minAttackForce','absorbThenCounter','encirclePockets','defensePostTiming',
  'defensePostPlayersOnly','nukeArcRotate','samUpgradeMargin','openingAllModes',
  'counterAttackFirst','safePlacement','samUmbrella','phasedOpening',
  'warshipAutoSpawn','warshipHuntTrade','warshipEvade','warshipNukeDodge'
];

function numericRow(pane, key) {
  const input = pane.indexOf('data-cfg-range="' + key + '"');
  const start = pane.lastIndexOf('<div class="ab-cfg-row"', input);
  if (input < 0 || start < 0) throw new Error('Numeric control changed: ' + key);
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0, match;
  while ((match = tags.exec(pane))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return pane.slice(start, tags.lastIndex);
  }
  throw new Error('Unclosed numeric row: ' + key);
}

function simplifyConfigPanel(source) {
  const start = source.indexOf('<div class="ab-pane" data-pane="config">');
  const end = source.indexOf('<div class="ab-pane" data-pane="log">', start);
  if (start < 0 || end <= start) throw new Error('Config pane anchors changed');
  const pane = source.slice(start, end);
  const toggles = [...pane.matchAll(/data-cfg="([^"]+)"/g)].map(m => m[1]);
  if (toggles.length !== AUTOMATIC_RULES.length || toggles.some(k => !AUTOMATIC_RULES.includes(k))) {
    throw new Error('Review changed Config switches before removing them');
  }
  const heading = '<div class="ab-cfg-sec">${tr("Advanced")}</div>';
  const basicEnd = pane.indexOf(heading);
  if (basicEnd < 0) throw new Error('Config section boundary changed');
  let replacement = pane.slice(0, basicEnd).replace('tr("Auto-build structures")', 'tr("Allowed buildings")');
  replacement += `
            <p class="ab-cfg-label" style="margin:8px 0 12px;opacity:.8;">\${tr("Action switches are in Controls. The bot manages its strategy rules automatically.")}</p>
            <details class="ab-cfg-advanced" data-role="cfg-advanced" style="border-top:1px solid var(--oh-panel-border,rgba(148,163,184,.2));">
              <summary class="ab-cfg-sec" style="cursor:pointer;user-select:none;padding:10px 0;">\${tr("Advanced tuning")}</summary>`;
  for (const [label, keys] of [
    ['Opening reserve',['openingArmyFill']],
    ['Donations',['donateKeepFrac','donateNeedThreshold','donateMinDonatePct','donateThrottleMs']],
    ['Warship response',['warshipRetreatHealthPct','warshipCombatThrottleMs','warshipPatrolThrottleMs']]
  ]) {
    replacement += '\n<div class="ab-cfg-sec">${tr("' + label + '")}</div>\n' + keys.map(k => numericRow(pane,k)).join('\n');
  }
  replacement += '\n</details>\n</div>\n</div>\n        ';
  source = source.slice(0,start) + replacement + source.slice(end);

  // Drop removed overrides at the loader boundary. This preserves genuine
  // permissions while ensuring a stale hidden false cannot disable a rule.
  const loader = source.indexOf('function loadSettings(){const n=[');
  const listStart = source.indexOf('[',loader);
  const listEnd = source.indexOf('];const e=JSON.parse(JSON.stringify(DEFAULTS));',listStart);
  if (loader < 0 || listEnd < listStart) throw new Error('Bot settings loader changed');
  const savedKeys = JSON.parse(source.slice(listStart,listEnd+1));
  source = source.slice(0,listStart) + JSON.stringify(savedKeys.filter(k => !AUTOMATIC_RULES.includes(k))) + source.slice(listEnd+1);
  return source.replace('tr("Difficulty-free strategy switches, build allow-list, and donate/warship tuning.")',
    'tr("Choose allowed buildings. Donation limits and timing are under Advanced tuning.")')
    .replace('state.settings.featsOpen?tr("Auto toggles ▴"):tr("Auto toggles ▾")',
      'state.settings.featsOpen?tr("Allowed actions ▴"):tr("Allowed actions ▾")')
    .replace('featRow("warship","Auto-deploy warships","🚢")', 'featRow("warship","Warship automation","🚢")')
    .replace('warship:["Auto-deploy warships","Build and dispatch warships."]',
      'warship:["Warship automation","Build, patrol and command warships."]');
}

module.exports = { simplifyConfigPanel, AUTOMATIC_RULES };
