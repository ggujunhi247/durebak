import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const checker=resolve('scripts/check-repository.mjs');
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'durebak-hygiene-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync('git',['init','-q',dir]);copyFileSync('.gitignore',join(dir,'.gitignore'));return dir;}
test('private host histories and exports are ignored while public integration files remain visible',t=>{
 const cwd=fixture(t);
 for(const file of ['.codex/history.jsonl','.claude/projects/session.jsonl','nested/.claude/settings.local.json','credentials/private.json','records/task.md','backups/history.bundle','gitleaks-report.json','identity.p12'])assert.equal(spawnSync('git',['check-ignore','--no-index',file],{cwd}).status,0,file);
 for(const file of ['plugins/durebak/.codex-plugin/plugin.json','plugins/durebak/.claude-plugin/plugin.json','tests/fixtures/events.jsonl','.env.example','.npmrc.example','docs/adr/0001.md'])assert.equal(spawnSync('git',['check-ignore','--no-index',file],{cwd}).status,1,file);
});
test('force-added ignored credentials fail repository checks without printing their content',t=>{
 const cwd=fixture(t);const marker='synthetic-private-content';writeFileSync(join(cwd,'.npmrc'),marker);execFileSync('git',['add','-f','.npmrc'],{cwd});
 const result=spawnSync(process.execPath,[checker],{cwd,encoding:'utf8'});assert.equal(result.status,1);assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
});
test('private machine paths fail even in otherwise public source files',t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'docs'));writeFileSync(join(cwd,'docs','note.md'),'/Us'+'ers/private-person/secret-project');
 const result=spawnSync(process.execPath,[checker],{cwd,encoding:'utf8'});assert.equal(result.status,1);assert.ok(!result.stderr.includes('private-person'));
});
