import {mkdtempSync,copyFileSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'durebak-scan-test-'));
const scanner=resolve('scripts/check-secrets.mjs');
const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
const scan=()=>spawnSync(process.execPath,[scanner],{cwd:dir,encoding:'utf8'});
try {
  git('init','-q');git('config','user.name','Synthetic test');git('config','user.email','test@example.invalid');
  copyFileSync('.gitleaks.toml',join(dir,'.gitleaks.toml'));
  writeFileSync(join(dir,'README.md'),'Synthetic scanner fixture\n');git('add','.');git('commit','-qm','clean fixture');
  assert.equal(scan().status,0,'Clean fixture must pass; missing scanner is a failure.');
  const token=randomBytes(32).toString('hex');
  writeFileSync(join(dir,'candidate.json'),JSON.stringify({token}));
  const candidate=scan();assert.equal(candidate.status,1,'Uncommitted credential must fail.');assert.ok(!`${candidate.stdout}${candidate.stderr}`.includes(token),'Secret must be redacted.');
  git('add','candidate.json');writeFileSync(join(dir,'candidate.json'),'{}');
  assert.equal(scan().status,1,'Staged credential hidden by an unstaged clean edit must fail.');
  git('commit','-qm','synthetic secret fixture');
  unlinkSync(join(dir,'candidate.json'));git('add','-u');git('commit','-qm','remove synthetic fixture');
  assert.equal(scan().status,1,'Removed historical credential must still fail.');
  console.log('Secret scan self-test passed: clean source, uncommitted and staged secrets, redaction and deleted historical secret.');
} finally {rmSync(dir,{recursive:true,force:true});}
