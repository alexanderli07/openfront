'use strict';
const path = require('node:path');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) freeze(item);
  return value;
}

function choose(strategy, scenario) {
  const snapshot = freeze(clone(scenario.snapshot));
  const candidates = freeze(clone(scenario.candidates));
  return strategy.decide(snapshot, candidates);
}

function compareScenarios(left, right, scenarios) {
  const rows = scenarios.map(scenario => {
    const leftChoice = choose(left, scenario);
    const rightChoice = choose(right, scenario);
    const expectedChoice = scenario.expectedAdaptiveChoice ?? leftChoice.selectedId ?? null;
    return {
      name: scenario.name,
      phase: scenario.phase,
      leftChoice: leftChoice.selectedId ?? null,
      rightChoice: rightChoice.selectedId ?? null,
      sameChoice: leftChoice.selectedId === rightChoice.selectedId,
      expectedChoice,
      expectedMatch: (rightChoice.selectedId ?? null) === expectedChoice,
      leftReason: leftChoice.reason,
      rightReason: rightChoice.reason
    };
  });
  return { left: left.id, right: right.id, scenarios: rows.length,
    mismatches: rows.filter(row => !row.sameChoice).length,
    unexpected: rows.filter(row => !row.expectedMatch).length, rows };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const createLegacyStrategy = require(path.join(root, 'src/brain/legacy-strategy.js'));
  const createAdaptiveStrategy = require(path.join(root, 'src/brain/adaptive-strategy.js'));
  const scenarios = require(path.join(root, 'tests/fixtures/strategy-scenarios.json'));
  const legacy = createLegacyStrategy();
  const report = compareScenarios(legacy, createAdaptiveStrategy(legacy), scenarios);
  console.table(report.rows.map(row => ({ phase: row.phase, scenario: row.name,
    legacy: row.leftChoice, adaptive: row.rightChoice, expected: row.expectedChoice,
    expectedMatch: row.expectedMatch })));
  console.log(`${report.scenarios} scenarios compared; ${report.mismatches} intentional differences; ${report.unexpected} unexpected outcomes.`);
  if (report.unexpected) process.exitCode = 1;
}

module.exports = { compareScenarios };
