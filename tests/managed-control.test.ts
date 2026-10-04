import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
function fixture(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'durebak-managed-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});const a=store.register('w','a','codex').session,b=store.register('w','b','codex').session;return {store,a,b,dir,clock,advance:(ms:number)=>now+=ms};}
function bind(sessionId:string,key='bind'){return {sessionId,harness:'codex' as const,profile:'default',nativeId:'native-thread',instance:'driver-instance',key};}
test('managed configuration defaults off and native owner uniqueness survives different driver instances',t=>{
 const {store,a,b}=fixture(t),created=store.managedBind(bind(a.id));assert.equal(created.binding.epoch,1);assert.equal(created.ownerToken?.length,64);assert.equal(store.managedStatus(a).enabled,false);assert.equal(store.managedStatus(a).auto_wake,false);assert.equal(store.managedStatus(a).host_readiness,'unverified');
 assert.throws(()=>store.managedBind({...bind(b.id,'another'),instance:'another-instance'}),/native_owner_exists/);assert.equal(store.managedBind(bind(a.id)).binding.id,created.binding.id);assert.equal(store.managedBind(bind(a.id)).ownerToken,null);
 assert.throws(()=>store.managedBind({...bind(a.id),nativeId:'changed'}),/idempotency_conflict/);
});
test('grant is durable user configuration; toggling or reopening never resets the existing scope',t=>{
 const {store,a,dir,clock}=fixture(t),created=store.managedBind(bind(a.id)),input={bindingId:created.binding.id,version:1,enabled:true,key:'policy'};
 const policy=store.managedPolicy(input);assert.equal(policy.max_turns,30);assert.equal(policy.max_concurrent,3);assert.equal(policy.expires_at,3700000);assert.equal(store.managedStatus(a).auto_wake,false);assert.equal(store.managedStatus(a).blocked_reason,'driver_unverified');
 assert.equal(store.managedPolicy(input).version,policy.version);assert.throws(()=>store.managedPolicy({...input,key:'stale'}),/policy_conflict/);
 const off=store.managedPolicy({bindingId:created.binding.id,version:2,enabled:false,key:'off'});assert.equal(off.scope_id,policy.scope_id);assert.equal(off.expires_at,policy.expires_at);const reopened=new Store(dir,clock);try{assert.equal(reopened.managedStatus(a).enabled,false);assert.equal(reopened.managedStatus(a).scope_id,policy.scope_id);}finally{reopened.close();}
});
test('expired owner lease blocks renewal and does not permit takeover or claim host stopped',t=>{
 const {store,a,b,advance}=fixture(t),created=store.managedBind(bind(a.id));assert.ok(created.ownerToken);assert.throws(()=>store.managedRenew(created.binding.id,1,'0'.repeat(64)),/unauthorized/);assert.equal(store.managedRenew(created.binding.id,1,created.ownerToken).renewed,true);
 advance(60000);assert.equal(store.managedRenew(created.binding.id,1,created.ownerToken).renewed,false);assert.equal(store.managedStatus(a).execution_state,'unknown');assert.equal(store.managedStatus(a).host_stopped,'unknown');assert.throws(()=>store.managedBind({...bind(b.id,'takeover'),instance:'new-instance'}),/native_owner_exists/);
});
test('revocation blocks user enabling policy and never exposes owner secret in session status',t=>{
 const {store,a}=fixture(t),created=store.managedBind(bind(a.id));assert.ok(!JSON.stringify(store.managedStatus(a)).includes(created.ownerToken!));store.revoke(a.id);assert.throws(()=>store.managedPolicy({bindingId:created.binding.id,version:1,enabled:true,key:'on'}),/binding_revoked/);
});
test('owner clock rollback becomes unknown instead of extending a previous owner lease',t=>{
 const {store,a,advance}=fixture(t),created=store.managedBind(bind(a.id));assert.ok(created.ownerToken);advance(10000);assert.equal(store.managedRenew(created.binding.id,1,created.ownerToken).renewed,true);advance(-5000);assert.equal(store.managedRenew(created.binding.id,1,created.ownerToken).renewed,false);assert.equal(store.managedStatus(a).execution_state,'unknown');
});
test('off and idempotent retries preserve spent budget and never reactivate an old enabled snapshot',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{store,a,dir}=fixture(t),created=store.managedBind(bind(a.id)),input={bindingId:created.binding.id,version:1,enabled:true,key:'on'};const on=store.managedPolicy(input),db=new DatabaseSync(join(dir,'runtime.sqlite'));try{db.prepare('UPDATE managed_policies SET spent_turns=5,active_turns=1 WHERE binding_id=?').run(created.binding.id);}finally{db.close();}
 const off=store.managedPolicy({bindingId:created.binding.id,version:2,enabled:false,key:'off'});assert.equal(off.spent_turns,5);assert.equal(off.active_turns,1);assert.equal(off.scope_id,on.scope_id);assert.equal(store.managedPolicy(input).enabled,true);assert.equal(store.managedStatus(a).enabled,false);
});
test('schema9 release upgrades without granting execution or changing existing session and private request data',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{readFileSync,chmodSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'durebak-schema9-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'runtime.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);db.exec(readFileSync(new URL('./fixtures/schema9.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES('a','w','a','codex','fixture-token'),('b','w','b','claude','fixture-peer'); INSERT INTO messages(id,workspace,sender,recipient,body,created_at,key,digest) VALUES('m','w','a','b','private question','2026-01-01T00:00:00Z','m','d'); INSERT INTO requests(id,workspace,creator,recipient,message_id,created_ms,deadline_at,key,digest) VALUES('q','w','a','b','m',100000,700000,'q','d'); INSERT INTO request_messages(message_id,request_id,kind) VALUES('m','q','question');");db.close();const store=new Store(dir,{now:()=>100000});try{const a={id:'a',workspace:'w',alias:'a',provider:'codex',revoked:0};assert.equal(store.managedStatus(a).configured,false);assert.equal(store.managedStatus(a).auto_wake,false);assert.equal(store.requestGet(a,'q').state,'pending');const check=new DatabaseSync(file);try{assert.equal(check.prepare('SELECT token_hash FROM sessions WHERE id=?').get('a')!.token_hash,'fixture-token');assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,12);}finally{check.close();}}finally{store.close();}
});
test('observed grant expiry and clock high-water survive rollback and restart',t=>{
 const {store,a,dir,clock,advance}=fixture(t),created=store.managedBind(bind(a.id));assert.ok(created.ownerToken);
 store.managedPolicy({bindingId:created.binding.id,version:1,enabled:true,ttlMs:1000,key:'on'});
 advance(1001);assert.equal(store.managedStatus(a).blocked_reason,'grant_expired');advance(-501);
 const reopened=new Store(dir,clock);try{assert.equal(reopened.managedStatus(a).execution_state,'unknown');assert.equal(reopened.managedRenew(created.binding.id,1,created.ownerToken).renewed,false);assert.throws(()=>reopened.managedPolicy({bindingId:created.binding.id,version:2,enabled:true,key:'again'}),/grant_expired/);}finally{reopened.close();}
});
test('off-state configured TTL is durable and used by later enable without a TTL',t=>{
 const {store,a,dir,clock}=fixture(t),created=store.managedBind(bind(a.id));
 store.managedPolicy({bindingId:created.binding.id,version:1,enabled:false,ttlMs:1000,key:'configure'});
 const reopened=new Store(dir,clock);try{const on=reopened.managedPolicy({bindingId:created.binding.id,version:2,enabled:true,key:'on'});assert.equal(on.expires_at,101000);}finally{reopened.close();}
});
test('rejected enabling records observed expiry before rollback',t=>{
 const {store,a,advance}=fixture(t),created=store.managedBind(bind(a.id));
 store.managedPolicy({bindingId:created.binding.id,version:1,enabled:true,ttlMs:1000,key:'on'});advance(1001);
 assert.throws(()=>store.managedPolicy({bindingId:created.binding.id,version:2,enabled:true,key:'expired'}),/grant_expired/);advance(-501);
 assert.throws(()=>store.managedPolicy({bindingId:created.binding.id,version:2,enabled:true,key:'rolled-back'}),/grant_expired/);
});
