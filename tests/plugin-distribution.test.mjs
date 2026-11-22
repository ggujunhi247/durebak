import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {cooperationSkill,operationReference} from '../src/skill-content.ts';

const readText=path=>readFileSync(path,'utf8').replaceAll('\r\n','\n');
const readJson=path=>JSON.parse(readText(path));

test('the marketplace plugin ships the CLI skill and operation reference',()=>{
 const marketplace=readJson('.claude-plugin/marketplace.json');
 const entry=marketplace.plugins.find(plugin=>plugin.name==='durebak');
 assert.equal(entry?.source,'./plugins/durebak');
 const skill=`${entry.source}/skills/durebak`;
 assert.equal(readText(`${skill}/SKILL.md`),cooperationSkill);
 assert.equal(readText(`${skill}/references/operations.md`),operationReference);
});

test('both plugin manifests track the package release version',()=>{
 const {name,version}=readJson('package.json');
 for(const host of ['claude','codex']){
  const plugin=readJson(`plugins/durebak/.${host}-plugin/plugin.json`);
  assert.equal(plugin.name,name);
  assert.equal(plugin.version,version);
 }
});
