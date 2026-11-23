import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {adminCall} from '../src/client.js';
import {acquireMaintenanceGate,openDatabase} from '../src/database.js';
import {startRuntime} from '../src/runtime.js';

function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'durebak-maintenance-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}

test('maintenance excludes daemon startup and an active daemon excludes maintenance',async t=>{
 const dir=join(fixture(t),'data');
 acquireMaintenanceGate(dir,'runtime')();
 const release=acquireMaintenanceGate(dir,'maintenance');
 try{
  await assert.rejects(startRuntime(dir),/maintenance_in_progress/);
  assert.equal(existsSync(join(dir,'runtime.lock')),false);
  assert.equal(existsSync(join(dir,'runtime.sqlite')),false);
 }finally{release();}

 const runtime=await startRuntime(dir);
 try{assert.throws(()=>acquireMaintenanceGate(dir,'maintenance'),/runtime_active/);}
 finally{await runtime.close();}
 acquireMaintenanceGate(dir,'maintenance')();
});

test('maintenance preserves legacy runtime locks and refuses directories without the new fence',t=>{
 const dir=join(fixture(t),'data');
 assert.throws(()=>acquireMaintenanceGate(dir,'maintenance'),/maintenance_gate_unavailable/);
 assert.equal(existsSync(dir),false);
 acquireMaintenanceGate(dir,'runtime')();
 const lock=join(dir,'runtime.lock');
 writeFileSync(lock,'{}',{mode:0o600});
 assert.throws(()=>acquireMaintenanceGate(dir,'maintenance'),/runtime_active/);
 assert.equal(existsSync(lock),true);
});

test('maintenance refuses unresolved managed work after the daemon exits',t=>{
 const dir=join(fixture(t),'data');
 acquireMaintenanceGate(dir,'runtime')();
 const db=openDatabase(dir);
 try{
  db.exec('PRAGMA foreign_keys=OFF'); // Only the ledger entry is relevant to the check.
  db.exec(`INSERT INTO work_attempts
    (id,binding_id,workspace,request_id,message_id,epoch,instance,key,intent_digest,policy_digest,root_policy_digest,source_digest,source,created_ms,state,input_accepted)
    VALUES ('attempt','binding','workspace','request','message',1,'instance','key','intent','policy','root','digest','source',0,'unknown',1)`);
 }finally{db.close();}
 assert.throws(()=>acquireMaintenanceGate(dir,'maintenance'),/update_execution_unresolved/);
 const resolved=openDatabase(dir);
 try{resolved.exec("UPDATE work_attempts SET state='completed',active_released=1");}
 finally{resolved.close();}
 acquireMaintenanceGate(dir,'maintenance')();
});

test('an open MCP bridge keeps the maintenance gate closed after its daemon exits',async t=>{
 const root=fixture(t),dir=join(root,'data');
 const runtime=await startRuntime(dir);
 const client=new Client({name:'maintenance-test',version:'1.0.0'});
 try{
  const identity=await adminCall(dir,'/v1/register',{workspace:'workspace',alias:'reviewer',provider:'other'}) as object;
  const file=join(root,'session.json');
  writeFileSync(file,JSON.stringify({data_dir:dir,...identity}),{mode:0o600});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'mcp','--session',file],stderr:'pipe'}));
  await runtime.close();
  assert.throws(()=>acquireMaintenanceGate(dir,'maintenance'),/runtime_active/);
 }finally{
  await client.close();
  await runtime.close();
 }
 acquireMaintenanceGate(dir,'maintenance')();
});
