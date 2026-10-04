import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRuntime} from '../src/runtime.js';
import {adminCall,request} from '../src/client.js';
test('managed bindings and policies require administrator authority; sessions can only read their own metadata',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-managed-http-')),runtime=await startRuntime(dir);t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
 const a=await adminCall(dir,'/v1/register',{workspace:'w',alias:'a',provider:'codex'}) as {session:{id:string};token:string},b=await adminCall(dir,'/v1/register',{workspace:'w',alias:'b',provider:'codex'}) as {session:{id:string};token:string};const input={sessionId:a.session.id,harness:'codex',profile:'default',nativeId:'native-test',instance:'test-driver',key:'bind'};
 await assert.rejects(request(dir,a.token,'/v1/managed',{operation:'bind',args:input}),/unauthorized/);
 const binding=await adminCall(dir,'/v1/managed',{operation:'bind',args:input}) as {binding:{id:string};ownerToken:string};
 await assert.rejects(request(dir,a.token,'/v1/session',{operation:'managed_policy',args:{bindingId:binding.binding.id,version:1,enabled:true,key:'peer'}}),/invalid_input/);
 await adminCall(dir,'/v1/managed',{operation:'policy',args:{bindingId:binding.binding.id,version:1,enabled:true,key:'user'}});
 const status=await request(dir,a.token,'/v1/session',{operation:'managed_status',args:{}}) as {configured:boolean;auto_wake:boolean;blocked_reason:string};assert.equal(status.configured,true);assert.equal(status.auto_wake,false);assert.equal(status.blocked_reason,'driver_unverified');assert.ok(!JSON.stringify(status).includes(binding.ownerToken));assert.ok(!JSON.stringify(status).includes(input.nativeId));
 const outsider=await request(dir,b.token,'/v1/session',{operation:'managed_status',args:{}}) as {configured:boolean};assert.equal(outsider.configured,false);
 const {promisify}=await import('node:util'),{execFile}=await import('node:child_process'),{resolve}=await import('node:path'),{statSync,readFileSync}=await import('node:fs');const ownerFile=join(dir,'owner.json');
 const cli=await promisify(execFile)(process.execPath,[resolve('dist/cli.js'),'managed-bind',b.session.id,'--harness','codex','--native-id','native-second','--profile','default','--instance','second-driver','--key','cli-bind','--out',ownerFile,'--data-dir',dir],{timeout:10000});
 const output=JSON.parse(cli.stdout),owner=JSON.parse(readFileSync(ownerFile,'utf8'));assert.equal(statSync(ownerFile).mode&0o077,0);assert.equal(owner.owner_token.length,64);assert.ok(!cli.stdout.includes(owner.owner_token));assert.equal(output.auto_wake,false);
 const policyCli=await promisify(execFile)(process.execPath,[resolve('dist/cli.js'),'managed-policy','--data-dir',dir,'--json',JSON.stringify({bindingId:output.binding_id,version:1,enabled:false,key:'cli-off'})],{timeout:10000});assert.equal(JSON.parse(policyCli.stdout).policy.enabled,false);

});
