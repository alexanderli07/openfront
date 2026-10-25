'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildSource}=require('../scripts/build');
const source=buildSource().source;
function element(classes,dataset={}){
 const selected=new Set(classes.split(' ')),listeners=new Map();
 return {dataset,classList:{contains:c=>selected.has(c),toggle(c,on){on?selected.add(c):selected.delete(c);}},
 addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
 click(){for(const handler of listeners.get('click')||[])handler();}};
}
test('Export trace downloads once without selecting a chip or changing the log filter',()=>{
 const markup=source.match(/<button[^>]*data-role="brain-export"[^>]*>/)[0];
 const button=element(markup.match(/class="([^"]+)"/)[1],{role:'brain-export'});
 const all=element('ab-chip on',{filter:'all'}),combat=element('ab-chip',{filter:'combat'}),dummy=element('');
 const nodes=[button,all,combat];let downloads=0,renders=0;
 const panel={querySelector:selector=>selector.includes('brain-export')?button:dummy,
 querySelectorAll:selector=>selector==='.ab-chip'?nodes.filter(n=>n.classList.contains('ab-chip')):
 selector==='.ab-chip[data-filter]'?nodes.filter(n=>n.classList.contains('ab-chip')&&n.dataset.filter!==undefined):[]};
 const state={settings:{},logFilter:'all'};
 const start=source.indexOf('function wirePanel(n){'),end=source.indexOf('function renderLog(){',start);
 assert.ok(end>start);
 vm.runInNewContext(source.slice(start,end)+';wirePanel(panel)',{panel,state,document:{querySelectorAll:()=>[]},
 ofhExportMatchSummary:()=>{},ofhExportBrainTrace:()=>downloads++,makeDraggable(){},renderLog:()=>renders++,saveSettings(){},tr:x=>x,setEnabled(){}});
 button.click();assert.equal(downloads,1);assert.equal(state.logFilter,'all');assert.equal(renders,0);
 assert.equal(button.classList.contains('on'),false);assert.equal(all.classList.contains('on'),true);
 combat.click();assert.equal(state.logFilter,'combat');assert.equal(renders,1);assert.equal(combat.classList.contains('on'),true);
 assert.equal(all.classList.contains('on'),false);assert.equal(button.classList.contains('on'),false);
 button.click();assert.equal(downloads,2);assert.equal(state.logFilter,'combat');assert.equal(renders,1);
});
test('Export trace has transient hover and keyboard focus feedback',()=>{
 assert.ok(source.includes('.ab-trace-export:hover'));
 assert.ok(source.includes('.ab-trace-export:focus-visible'));
 const button=source.match(/<button[^>]*data-role="brain-export"[^>]*>/)[0];
 assert.ok(button.includes('type="button"'));assert.ok(!button.includes('class="ab-chip"'));
});

test('Match summary and Detailed trace each run their own export without changing filters',()=>{
 const summary=element('ab-trace-export'),detail=element('ab-trace-export'),chip=element('ab-chip on',{filter:'combat'}),dummy=element('');
 let summaries=0,details=0;
 const panel={querySelector:s=>s.includes('brain-summary')?summary:s.includes('brain-export')?detail:dummy,
   querySelectorAll:s=>s==='.ab-chip[data-filter]'?[chip]:[]};
 const state={settings:{},logFilter:'combat'};
 const start=source.indexOf('function wirePanel(n){'),end=source.indexOf('function renderLog(){',start);
 vm.runInNewContext(source.slice(start,end)+';wirePanel(panel)',{panel,state,document:{querySelectorAll:()=>[]},
   ofhExportMatchSummary:()=>summaries++,ofhExportBrainTrace:()=>details++,makeDraggable(){},renderLog(){},saveSettings(){},tr:x=>x,setEnabled(){}});
 summary.click();summary.click();detail.click();
 assert.equal(summaries,2);assert.equal(details,1);assert.equal(state.logFilter,'combat');
 assert.equal(summary.classList.contains('on'),false);assert.equal(detail.classList.contains('on'),false);
 assert.ok(source.includes('>Match summary</button>'));assert.ok(source.includes('>Detailed trace</button>'));
});
