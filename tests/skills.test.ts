import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSkills} from '../src/skills.js';
function fixture(t:test.TestContext){const root=mkdtempSync(join(tmpdir(),'durebak-skills '));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('one project gets discoverable shared skills and provider command entry points without credentials',t=>{
 const root=fixture(t),result=installSkills('all',root);assert.equal(result.scope,'project');assert.equal(result.native_host_verified,false);assert.equal(result.auto_wake,false);
 const shared=readFileSync(join(root,'.agents/skills/durebak/SKILL.md'),'utf8'),claude=readFileSync(join(root,'.claude/skills/durebak/SKILL.md'),'utf8');assert.equal(shared,claude);assert.ok(readFileSync(join(root,'.opencode/commands/durebak.md'),'utf8').includes('$ARGUMENTS'));assert.ok(!shared.includes(root));assert.ok(!shared.includes('owner_token'));assert.equal(result.files.length,5);
 assert.deepEqual(installSkills('all',root).created,[]);
});
test('codex and opencode share the same installed skill without overwriting unrelated configuration',t=>{
 const root=fixture(t);mkdirSync(join(root,'.agents'));writeFileSync(join(root,'.agents/unrelated'),'keep');const a=installSkills('codex',root),b=installSkills('opencode',root);assert.equal(a.created.length,2);assert.equal(b.created.length,1);assert.equal(readFileSync(join(root,'.agents/unrelated'),'utf8'),'keep');
});
test('any modified existing target aborts the complete install before new files are written',t=>{
 const root=fixture(t);mkdirSync(join(root,'.opencode/commands'),{recursive:true});writeFileSync(join(root,'.opencode/commands/durebak.md'),'user custom command');assert.throws(()=>installSkills('all',root),/skill_conflict/);assert.ok(!existsSync(join(root,'.agents/skills/durebak/SKILL.md')));assert.equal(readFileSync(join(root,'.opencode/commands/durebak.md'),'utf8'),'user custom command');
});
test('symlinked discovery paths are refused and their targets stay untouched',t=>{
 const root=fixture(t),outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,join(root,'.agents'),'dir');assert.throws(()=>installSkills('codex',root),/unsafe_skill_path/);assert.ok(!existsSync(join(outside,'skills')));
});
test('unknown harness and nonexistent workspace fail before creating skill directories',t=>{
 const root=fixture(t);assert.throws(()=>installSkills('grok',root),/unsupported_harness/);assert.throws(()=>installSkills('codex',join(root,'missing')),/ENOENT/);assert.ok(!existsSync(join(root,'.agents')));
});
test('partial file writes roll back owned files and leave a clean retry',async t=>{
 const root=fixture(t),fs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),original=fs.writeFileSync;
 t.mock.method(fs,'writeFileSync',(target:Parameters<typeof fs.writeFileSync>[0],data:Parameters<typeof fs.writeFileSync>[1],options:Parameters<typeof fs.writeFileSync>[2])=>{original(target,String(data).slice(0,20),options);throw Object.assign(new Error('disk full'),{code:'ENOSPC'});});syncBuiltinESMExports();
 try{assert.throws(()=>installSkills('codex',root),/disk full/);assert.ok(!existsSync(join(root,'.agents/skills/durebak/SKILL.md')));}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 assert.equal(installSkills('codex',root).created.length,2);
});
test('a competing exclusive creator is preserved instead of being claimed by rollback',async t=>{
 const root=fixture(t),fs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),original=fs.openSync,write=fs.writeFileSync;
 t.mock.method(fs,'openSync',(path:Parameters<typeof fs.openSync>[0],flags:Parameters<typeof fs.openSync>[1],mode:Parameters<typeof fs.openSync>[2])=>{if(flags==='wx'&&String(path).endsWith('/SKILL.md')){const fd=original(path,'wx');try{write(fd,'other writer');}finally{fs.closeSync(fd);}}return original(path,flags,mode);});syncBuiltinESMExports();
 try{assert.throws(()=>installSkills('codex',root),/EEXIST/);assert.equal(readFileSync(join(root,'.agents/skills/durebak/SKILL.md'),'utf8'),'other writer');}finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
