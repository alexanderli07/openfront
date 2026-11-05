'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildSource}=require('../scripts/build');
test('shipped panel IDs and public APIs use the shared interface namespace',()=>{
 const {source}=buildSource();
 for(const name of ['ui-kit-quick-panel','ui-kit-control-panel','ui-kit-floating-autojoin-panel','window.__UIK_performance','InterfaceKitSettings'])assert.ok(source.includes(name),name);
 assert.equal(source.includes('window.__OFH_performance'),false);
 assert.equal(source.includes('"openfront-helper-auto-bot-panel"'),false);
});
test('renaming preserves persistence identities, update links, and visible branding',()=>{
 const {source,metadata}=buildSource();
 for(const key of ['openfront-helper-autobot-v1','openfront-helper-settings','openfront-helper-match-history','openfront-helper-quick-panel-pos','openfront-helper-autobot-config-scroll'])assert.ok(source.includes(key),key);
 assert.ok(source.includes('>Auto-Bot</span>'));
 assert.ok(metadata.includes('https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.user.js'));
 assert.ok(metadata.includes('@namespace    openfront-helper'));
});
