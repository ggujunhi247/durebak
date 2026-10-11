import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=(...args)=>spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8',timeout:15000});
test('updater status needs no session, performs no initialization and reports disabled',t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-updater-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'state');const result=run('update','status','--update-dir',dir);
 assert.equal(result.status,0,result.stderr);const body=JSON.parse(result.stdout);
 assert.equal(body.mode,'disabled');assert.equal(body.automatic_apply,false);assert.equal(existsSync(dir),false);
});
test('update check rejects unknown channels before network and without a session',()=>{
 const result=run('update-check','--channel','garbage');
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{error:'invalid_update_channel'});assert.equal(result.stdout,'');
});
test('apply reports a blocked gate without treating target version as the global version flag',t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-updater-apply-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const dir=join(root,'new');
 const result=run('update','apply','--version','0.1.0-alpha.24','--update-dir',dir);
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{error:'automatic_apply_not_configured'});assert.equal(result.stdout,'');assert.equal(existsSync(dir),false);
 const reordered=run('--update-dir',dir,'update','apply','--version','0.1.0-alpha.24');
 assert.equal(reordered.status,1);assert.deepEqual(JSON.parse(reordered.stderr),{error:'automatic_apply_not_configured'});
 assert.equal(run('--version').status,0);
});
