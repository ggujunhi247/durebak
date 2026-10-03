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
   const out=join(root,`${host}-${alias}.config`);const setup=createSetup(host,file,out);
   assert.equal(setup.scope,'config_fragment');assert.equal(setup.native_session_isolation,'unverified');assert.equal(setup.isolation_evidence,'renderer_tested');
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
test('doctor preserves legacy codes and adds non-sensitive actionable checks',async t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-doctor-checks-'));const data=join(root,'data');const runtime=await startRuntime(data);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});
 const missing=await doctor(join(root,'missing'));assert.equal(missing.code,'credential_unavailable');assert(missing.checks.some(x=>x.name==='credential'&&x.status==='fail'&&x.action.length>0));
 const a:any=await adminCall(data,'/v1/register',{workspace:'w',alias:'a',provider:'codex'});const file=join(root,'session');writeFileSync(file,JSON.stringify({data_dir:data,...a}),{mode:0o600});
 const {request}=await import('../src/client.js');const {randomUUID}=await import('node:crypto');const call=async(operation:string,args:unknown={})=>await request(data,a.token,'/v1/session',{operation,args}) as any;
 const info=await call('runtime_info');await call('bridge_touch',{instance:randomUUID(),epoch:info.daemon_epoch});await call('session_state',{state:'paused'});
 const ready=await doctor(file);assert.equal(ready.code,'ready');assert.equal(ready.ok,true);assert.equal(ready.health?.bridge.state,'fresh');assert.equal(ready.health?.availability,'paused');assert.equal(ready.health?.readiness,'unknown');assert.equal(ready.health?.auto_wake,false);assert(ready.checks.some(x=>x.name==='bridge'&&x.status==='pass'));assert(ready.checks.every(x=>x.action&&x.reason_code));
 assert(!JSON.stringify(ready).includes(root));assert(!JSON.stringify(ready).includes(a.token));
 await adminCall(data,'/v1/revoke',{id:a.session.id});const revoked=await doctor(file);assert.equal(revoked.code,'unauthorized');assert.equal(revoked.ok,false);assert.equal(revoked.health,undefined);
});
