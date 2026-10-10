import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=new URL('../scripts/windows-storage-probe.mjs',import.meta.url);
test('Windows storage probe refuses non-Windows execution without fabricating evidence',{skip:process.platform==='win32'},()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8'});
 assert.equal(result.status,2);
 assert.deepEqual(JSON.parse(result.stdout),{status:'unsupported',reason:'windows_required'});
});
test('Windows storage probe records actual ACL and SQLite cases',{skip:process.platform!=='win32',timeout:60000},()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8',timeout:55000});
 assert.equal(result.status,0,result.stdout);
 const report=JSON.parse(result.stdout);
 assert.equal(report.platform,'win32');
 assert.equal(report.arch,process.arch);
 assert.equal(report.product_support,false);
 for(const id of ['atomic_private_directory','private_file','broad_allow_rejected','null_dacl_rejected','foreign_owner_rejected','junction_rejected','hardlink_rejected','sqlite_sidecars_observed']){
  assert.equal(report.cases.find(item=>item.id===id)?.passed,true,id);
 }
 assert.equal(report.cross_user_access,'not_tested');
 assert.equal(report.desktop_validation,'not_tested');
 assert.ok(!JSON.stringify(report).includes('S-1-5-21-'));
});
