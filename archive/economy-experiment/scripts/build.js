'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const baseline = fs.readFileSync(path.join(root, 'vendor/openfront-helper-1.84.0.user.js'));
if (crypto.createHash('sha256').update(baseline).digest('hex') !== '863068bc00d0e6a9610e3c1199ea2c6fe8f5ae3c6ea6cca8d051abe74ffcfad8') {
  throw new Error('Vendor baseline changed; review integration anchors before rebuilding.');
}
let output = baseline.toString('utf8');
function replaceExactly(before, after) {
  const parts = output.split(before);
  if (parts.length !== 2) throw new Error(`Expected exactly one integration anchor: ${before.slice(0, 100)}`);
  output = parts.join(after);
}
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8')
  .replace(/^if \(typeof module !== 'undefined'.*$/m, '');
replaceExactly('// @version      1.84.0', '// @version      1.85.0');
// Local development should not silently be replaced by the upstream release.
output = output.replace(/^\/\/ @(?:updateURL|downloadURL).*\r?\n/gm, '');
replaceExactly('const DEFAULTS={enabled:true,features:', 'const DEFAULTS={enabled:true,economyPlanner:true,features:');
replaceExactly('const n=["enabled","winFixes","economyFirst"', 'const n=["enabled","economyPlanner","winFixes","economyFirst"');
replaceExactly('async handleStructures(){const e=this.placementsCount',
  'async handleStructures(){if(state.settings.economyPlanner!==false)return await ofhEconomyAdapter.run(this);const e=this.placementsCount');
replaceExactly('async tick(e){this.player=this.mg.myPlayer();const t=this.player;',
  'async tick(e){this.player=this.mg.myPlayer();ofhEconomyAdapter.begin(this);const t=this.player;');
// Existing action routines must return before recording a blocked purchase as sent.
const calls = [
  ['s.sendBuildOrUpgrade(i,t);', 'if(!ofhPlannerSend(s,i,t))return false;'],
  ['r.sendBuildOrUpgrade(s,i);', 'if(!ofhPlannerSend(r,s,i))return false;'],
  ['s.sendBuildOrUpgrade(i,e);', 'if(!ofhPlannerSend(s,i,e))return false;'],
  ['i.sendBuildOrUpgrade(a,t);', 'if(!ofhPlannerSend(i,a,t))return false;'],
  ['I.sendBuildOrUpgrade(x,x.canBuild);', 'if(!ofhPlannerSend(I,x,x.canBuild))return false;'],
  ['o.sendBuildOrUpgrade(r,r.canBuild);', 'if(!ofhPlannerSend(o,r,r.canBuild))return false;'],
  ['a.sendBuildOrUpgrade(t.bu);', 'if(!ofhPlannerSend(a,t.bu))return false;'],
  ['try{c.sendBuildOrUpgrade(u,e)}finally', 'try{if(!ofhPlannerSend(c,u,e))return false}finally'],
  ['c.sendBuildOrUpgrade(u);', 'if(!ofhPlannerSend(c,u))return false;']
];
for (const [before, after] of calls) replaceExactly(before, after.replace('!ofhPlannerSend(', '!await ofhPlannerSend(this,'));
const toggle = `
            <div class="ab-cfg-row">
              <span class="ab-cfg-label" data-tip="Economic planner" data-tip-desc="Compare investments using live prices, trade income and threats. Turn off to use the original strategy. Read decisions in the Log tab.">Economic planner</span>
              <div class="ab-cfg-sw \${state.settings.economyPlanner!==false?"on":""}" data-cfg="economyPlanner"></div>
            </div>
`;
replaceExactly('data-cfg="economyFirst"></div>\n            </div>', 'data-cfg="economyFirst"></div>\n            </div>' + toggle);
replaceExactly('class NationBot{', `${source('economy-planner.js')}\n${source('economy-adapter.js')}\n${source('economy-bootstrap.js')}\nclass NationBot{`);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(path.join(root, 'openfront-helper.user.js'), 'utf8') !== output) {
    throw new Error('Distributed userscript is out of date. Run node scripts/build.js');
  }
  console.log('Distributed userscript matches its sources.');
} else {
  fs.writeFileSync(path.join(root, 'openfront-helper.user.js'), output);
  console.log(`Built openfront-helper.user.js (${Buffer.byteLength(output)} bytes)`);
}
