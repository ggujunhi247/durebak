import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
function fixture(t:test.TestContext){
 const dir=mkdtempSync(join(tmpdir(),'durebak-preview-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('w','c','opencode').session;
 return {store,dir,clock,a,b,c,advance:(ms:number)=>now+=ms};
}
test('preview exposes exact sharing scope without enqueue, delivery, acknowledgement or request creation',t=>{
 const {store,a,b}=fixture(t),p=store.requestPreview(a,{to:b.id,body:'hello',key:'q'});
 assert.equal(p.visibility,'request-private');assert.equal(p.recipient,b.id);assert.equal(p.body,'hello');assert.equal(p.body_bytes,5);
 assert.equal(store.requestList(a).items.length,0);assert.equal(store.receive(b).items.length,0);assert.equal(store.requestPreviewRead(a,p.id).content,'hello');
 assert.equal(p.expires_at,160000);assert.equal(p.due_at,105000);assert.equal(p.deadline_at,700000);
});
test('only owner reads preview; payload or recipient change cannot reuse it',t=>{
 const {store,a,b,c}=fixture(t),input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);
 assert.throws(()=>store.requestPreviewRead(c,p.id),/not_found/);
 assert.throws(()=>store.requestCreate(a,{...input,body:'changed',previewId:p.id}),/preview_conflict/);
 assert.throws(()=>store.requestCreate(a,{...input,to:c.id,previewId:p.id}),/preview_conflict/);
 assert.equal(store.requestList(a).items.length,0);
 const q=store.requestCreate(a,{...input,priority:'normal',delayMs:0,ttlMs:86400000,deadlineMs:600000,previewId:p.id});assert.equal(q.state,'pending');
});
test('60-second expiry boundary rejects new transmission but successful retry remains idempotent',t=>{
 const {store,a,b,advance}=fixture(t),input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);
 const q=store.requestCreate(a,{...input,previewId:p.id});advance(60000);
 assert.equal(store.requestCreate(a,{...input,previewId:p.id}).id,q.id);
 assert.throws(()=>store.requestCreate(a,{...input,key:'new',previewId:p.id}),/preview_expired/);
 assert.throws(()=>store.requestPreviewRead(a,p.id),/preview_expired/);
});
test('preview is not a send-time permission grant and reports paused recipient',t=>{
 const {store,a,b}=fixture(t);store.setSessionState(b,'paused');const input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);
 assert(p.warnings.includes('recipient_paused'));assert(p.warnings.includes('host_readiness_unknown'));
 store.revoke(b.id);assert.throws(()=>store.requestCreate(a,{...input,previewId:p.id}),/not_found/);assert.equal(store.requestList(a).items.length,0);
});
test('preview capacity is bounded and expired slots can be reused',t=>{
 const {store,a,b,advance}=fixture(t);for(let i=0;i<20;i++)store.requestPreview(a,{to:b.id,body:'q',key:`q${i}`});
 assert.throws(()=>store.requestPreview(a,{to:b.id,body:'q',key:'overflow'}),/preview_capacity_exceeded/);
 advance(60000);assert.equal(store.requestPreview(a,{to:b.id,body:'q',key:'new'}).visibility,'request-private');
});
test('large escaped input has a bounded preview and range while original payload survives restart',t=>{
 const {store,dir,clock,a,b}=fixture(t),input={to:b.id,body:'\n'.repeat(65000),key:'q'},p=store.requestPreview(a,input);
 assert(Buffer.byteLength(JSON.stringify(p))<16384);assert.equal(p.truncated,true);
 const source=store.requestPreviewRead(a,p.id,0,4096);assert(Buffer.byteLength(JSON.stringify(source))<16384);assert.equal(source.total_bytes,65000);
 const reopened=new Store(dir,clock);try{const q=reopened.requestCreate(a,{...input,previewId:p.id});assert.equal(reopened.readMessage(a,q.message_id).total_bytes,65000);}finally{reopened.close();}
});
test('preview rejects requests whose timing cannot deliver before expiry or response deadline',t=>{
 const {store,a,b}=fixture(t);
 assert.throws(()=>store.requestPreview(a,{to:b.id,body:'q',key:'q',deadlineMs:5000}),/deadline_before_delivery/);
 assert.throws(()=>store.requestPreview(a,{to:b.id,body:'q',key:'q',ttlMs:5000}),/expiry_before_delivery/);
 assert.throws(()=>store.requestPreview(a,{to:b.id,body:'q',key:'q',priority:'urgent'}),/urgent_reason_required/);
});
test('preview timing is tentative and the request deadline is fixed at actual transmission',t=>{
 const {store,a,b,advance}=fixture(t),input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);advance(59000);
 const q=store.requestCreate(a,{...input,previewId:p.id});assert.equal(q.deadline_at,p.deadline_at+59000);
});
test('new transmission still respects current inbox backpressure despite a valid preview',t=>{
 const {store,a,b}=fixture(t),input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);
 for(let i=0;i<100;i++)store.send(a,{to:b.id,body:'load',key:`load${i}`});
 assert.throws(()=>store.requestCreate(a,{...input,previewId:p.id}),/inbox_full/);assert.equal(store.requestList(a).items.length,0);
 assert(store.requestPreview(a,{...input,key:'warn'}).warnings.includes('inbox_full'));
});
test('clock rollback invalidates preview rather than extending its permission window',t=>{
 const {store,a,b,advance}=fixture(t),input={to:b.id,body:'q',key:'q'},p=store.requestPreview(a,input);advance(-1);
 assert.throws(()=>store.requestCreate(a,{...input,previewId:p.id}),/preview_expired/);
});
