import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateRelease} from '../scripts/check-release.mjs';
const manifest={name:'durebak',version:'0.1.0-alpha.1',repository:{type:'git',url:'https://github.com/example/durebak.git'},publishConfig:{access:'public'}};
test('release guard rejects mismatched version, private package, wrong channel and missing owner metadata',()=>{
 assert.doesNotThrow(()=>validateRelease(manifest,{tag:'v0.1.0-alpha.1',channel:'alpha',repository:'example/durebak'}));
 for(const [m,opts] of [
  [{...manifest,private:true},{}],
  [manifest,{tag:'v0.1.0'}],
  [manifest,{channel:'latest'}],
  [{...manifest,repository:undefined},{}],
  [manifest,{repository:'other/durebak'}],
 ])assert.throws(()=>validateRelease(m,{tag:'v0.1.0-alpha.1',channel:'alpha',repository:'example/durebak',...opts}));
});
test('installed CLI reports the package version',()=>{
 const expected=JSON.parse(readFileSync('package.json','utf8')).version;
 assert.equal(execFileSync(process.execPath,['dist/cli.js','--version'],{encoding:'utf8'}).trim(),expected);
});

test('release CLI rejects a tag outside main and a tag pointing away from HEAD',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'durebak-release-git-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(root,'package.json'),JSON.stringify(manifest));git('add','.');git('commit','-m','base');git('update-ref','refs/remotes/origin/main','HEAD');
 const script=resolve('scripts/check-release.mjs');
 const check=()=>execFileSync(process.execPath,[script,'--publish','--tag','v0.1.0-alpha.1','--channel','alpha','--repository','example/durebak'],{cwd:root,stdio:['ignore','pipe','pipe']});
 git('checkout','-b','candidate');writeFileSync(join(root,'change'),'x');git('add','.');git('commit','-m','candidate');git('tag','v0.1.0-alpha.1');
 assert.throws(check);git('update-ref','refs/remotes/origin/main','HEAD');assert.doesNotThrow(check);
 git('checkout','main');assert.throws(check,error=>error.stderr.toString().includes('tag_head_mismatch'));
});
