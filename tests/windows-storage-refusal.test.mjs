import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('Windows daemon refuses unsupported storage without creating data',{skip:process.platform!=='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-platform-refusal-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'data');
 const result=spawnSync(process.execPath,['--no-warnings',fileURLToPath(new URL('../dist/cli.js',import.meta.url)),'serve','--data-dir',directory],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1,result.stderr);
 assert.deepEqual(JSON.parse(result.stderr),{error:'unsupported_storage_platform'});
 assert.equal(result.stdout,'');
 assert.equal(existsSync(directory),false);
});
