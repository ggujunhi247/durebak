import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,statSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRuntime} from '../src/runtime.js';
import {adminCall} from '../src/client.js';
import {createSetup} from '../src/setup.js';
import {doctor} from '../src/doctor.js';

test('setup preserves per-session identity and private paths without embedding tokens',async t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak setup '));const data=join(root,'data');
 const runtime=await startRuntime(data);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});
 const outputs:string[]=[];
 for(const alias of ['a','b']){
  const registered:any=await adminCall(data,'/v1/register',{workspace:'w',alias,provider:'codex'});
  const file=join(root,`session-${alias}.json`);writeFileSync(file,JSON.stringify({data_dir:data,...registered}),{mode:0o600});
  for(const host of ['codex','claude','opencode']as const){
   const out=join(root,`${host}-${alias}.config`);createSetup(host,file,out);
   const text=readFileSync(out,'utf8');assert.ok(text.includes(file));assert.ok(!text.includes(registered.token));assert.equal(statSync(out).mode&0o777,0o600);
   assert.throws(()=>createSetup(host,file,out),/EEXIST/);
   if(host==='claude')assert.deepEqual(JSON.parse(text).mcpServers.durebak.args.slice(-2),['--session',realpathSync(file)]);
   if(host==='opencode')assert.equal(JSON.parse(text).mcp.durebak.type,'local');
   outputs.push(text);
  }
  assert.equal((await doctor(file)).ok,true);
  await fetch(runtime.url+'/v1/revoke',{method:'POST',headers:{authorization:`Bearer ${runtime.adminToken}`,'content-type':'application/json'},body:JSON.stringify({id:registered.session.id})});
  assert.equal((await doctor(file)).code,'unauthorized');
 }
 assert.notEqual(outputs[0],outputs[3]);
});

test('doctor distinguishes missing credentials and stopped daemon',async t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-doctor-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 assert.equal((await doctor(join(root,'missing'))).code,'credential_unavailable');
 const runtime=await startRuntime(join(root,'data'));
 const registered:any=await adminCall(join(root,'data'),'/v1/register',{workspace:'w',alias:'a',provider:'other'});
 const file=join(root,'session.json');writeFileSync(file,JSON.stringify({data_dir:join(root,'data'),...registered}),{mode:0o600});
 await runtime.close();assert.equal((await doctor(file)).code,'daemon_unavailable');
});

test('doctor rejects mismatched protocol, schema, identity and version without leaking tokens',async t=>{
 const {createServer}=await import('node:http');
 const {randomBytes}=await import('node:crypto');
 const {version,protocolVersion}=await import('../src/version.js');
 const {schemaVersion}=await import('../src/migrations.js');
 const root=mkdtempSync(join(tmpdir(),'durebak-compat-'));
 const token=randomBytes(32).toString('hex');
 const expected={version,protocol_version:protocolVersion,schema_version:schemaVersion,session_id:'session-a'};
 let payload:unknown=expected;
 const server=createServer((req,res)=>{assert.equal(req.headers.authorization,`Bearer ${token}`);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 writeFileSync(join(root,'connection.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}`,instance:'test'}),{mode:0o600});
 const file=join(root,'session.json');writeFileSync(file,JSON.stringify({data_dir:root,token,session:{id:'session-a',workspace:'w',alias:'a',provider:'other'}}),{mode:0o600});
 for(const [overrides,code] of [
  [{protocol_version:999},'incompatible_runtime'],[{schema_version:999},'incompatible_runtime'],
  [{session_id:'session-b'},'identity_mismatch'],[{version:'0.0.0'},'version_mismatch'],
 ]as const){payload={...expected,...overrides};const result=await doctor(file);assert.equal(result.code,code);assert.ok(!JSON.stringify(result).includes(token));}
 payload={};assert.equal((await doctor(file)).code,'incompatible_runtime');
});
