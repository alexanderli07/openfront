'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildSource}=require('../scripts/build');
function fields(source){return Object.fromEntries([...source.matchAll(/^\/\/ @([^\s]+)\s+(.+)$/gm)].map(m=>[m[1],m[2].trim()]));}
test('published update metadata points only to this fork on its verified default branch',()=>{
 const built=buildSource(),meta=fields(built.source);
 assert.equal(meta.updateURL,'https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.meta.js');
 assert.equal(meta.downloadURL,'https://raw.githubusercontent.com/alexanderli07/openfront/minimal/openfront-helper.user.js');
 assert.equal(meta.name,'OpenFront Helper (userscript)');assert.equal(meta.namespace,'openfront-helper');
 assert.equal(meta.author,'Saxien (https://github.com/alexanderli07)');
});
test('lightweight update check and downloadable script have identical version and metadata',()=>{
 const built=buildSource(),end=built.source.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length;
 assert.equal(built.metadata,built.source.slice(0,end)+'\n');
 assert.equal(fields(built.metadata).version,'1.84.73');
 const assets=JSON.parse(built.source.match(/window\.__OFH_ASSETS = (\{[^\n]+\});/)[1]);
 assert.equal(assets.version,fields(built.metadata).version);
});

test('release output uses stable LF bytes across Windows and Git checkouts',()=>{
 const built=buildSource();assert.equal(built.source.includes('\r\n'),false);assert.equal(built.metadata.includes('\r\n'),false);
});
