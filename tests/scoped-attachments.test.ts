import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
function fixture(t:test.TestContext){
 const dir=mkdtempSync(join(tmpdir(),'durebak-attachments-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('w','c','opencode').session;
 return {store,dir,clock,a,b,c,advance:(ms:number)=>now+=ms};
}
test('private upload is owner-only, immutable and unavailable by legacy content hash',t=>{
 const {store,a,b,c}=fixture(t),input={name:'review.txt',content:'private source',key:'upload'},u=store.attachmentPut(a,input);
 assert.equal(store.attachmentPut(a,input).id,u.id);assert.throws(()=>store.attachmentPut(a,{...input,content:'changed'}),/idempotency_conflict/);
 assert.equal(store.attachmentUploadRead(a,u.id).content,input.content);
 for(const actor of [b,c])assert.throws(()=>store.attachmentUploadRead(actor,u.id),/not_found/);
 assert.throws(()=>store.readArtifact(c,u.hash),/not_found/);
});
test('request handle gates reference and body until delivery, without granting outsiders or other requests',t=>{
 const {store,a,b,c,advance}=fixture(t),u=store.attachmentPut(a,{name:'review.txt',content:'secret',key:'u'}),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[u.id]});
 const handle=store.requestAttachments(a,q.id).items[0]!;
 assert.equal(store.requestAttachments(b,q.id).items.length,0);assert.throws(()=>store.attachmentRead(b,handle.id!),/message_not_delivered/);
 assert.throws(()=>store.requestAttachments(c,q.id),/not_found/);assert.throws(()=>store.attachmentRead(c,handle.id!),/not_found/);
 assert.equal(store.attachmentRead(a,handle.id!).content,'secret');store.setSessionState(b,'paused');advance(5000);store.receive(b);assert.equal(store.requestAttachments(b,q.id).items.length,0);
 store.setSessionState(b,'available');store.receive(b);const visible=store.requestAttachments(b,q.id).items[0]!;assert.equal(visible.id,handle.id!);assert.equal('upload_id' in visible,false);assert.equal(store.attachmentRead(b,handle.id!).content,'secret');
 assert.throws(()=>store.attachmentUploadRead(b,u.id),/not_found/);
});
test('preview identifies existing workspace-public copy and rejects later scope changes',t=>{
 const {store,a,b,c}=fixture(t),u=store.attachmentPut(a,{name:'review.txt',content:'source',key:'u'}),input={to:b.id,body:'q',key:'q',uploads:[u.id]},p=store.requestPreview(a,input);
 assert.equal(p.attachments[0]?.public_copy_exists,false);
 const published=store.putArtifact(c,'source');assert.equal(published.hash,u.hash);
 assert.throws(()=>store.requestCreate(a,{...input,previewId:p.id}),/preview_conflict/);
 const fresh=store.requestPreview(a,input);assert.equal(fresh.attachments[0]?.public_copy_exists,true);assert.equal(fresh.attachments[0]?.visibility,'request-private');
 assert.equal(store.requestCreate(a,{...input,previewId:fresh.id}).state,'pending');
});
test('answer attachment uses its own delivery gate and conversation cursor does not skip it',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);
 const u=store.attachmentPut(b,{name:'answer.txt',content:'answer source',key:'u'});store.requestMessage(b,{id:q.id,version:1,kind:'answer',body:'answer',key:'answer',uploads:[u.id]});
 assert.equal(store.requestAttachments(a,q.id).items.length,0);advance(5000);store.receive(a);
 const handle=store.requestAttachments(a,q.id).items[0]!;assert.equal(store.attachmentRead(a,handle.id!).content,'answer source');
});
test('wrong-owner uploads and duplicate upload references are rejected before any request is created',t=>{
 const {store,a,b}=fixture(t),u=store.attachmentPut(b,{name:'private.txt',content:'source',key:'u'});
 assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[u.id]}),/not_found/);
 const own=store.attachmentPut(a,{name:'own.txt',content:'own',key:'own'});
 assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[own.id,own.id]}),/duplicate_attachment/);assert.equal(store.requestList(a).items.length,0);
});
test('private original and handle survive restart while previews and metadata remain bounded',t=>{
 const {store,a,b,dir,clock,advance}=fixture(t),uploads=[] as string[];
 for(let i=0;i<10;i++)uploads.push(store.attachmentPut(a,{name:'\n'.repeat(200),content:'한글\n'.repeat(1000),key:`u${i}`}).id);
 const input={to:b.id,body:'q',key:'q',uploads},p=store.requestPreview(a,input);assert(Buffer.byteLength(JSON.stringify(p))<16384);const q=store.requestCreate(a,{...input,previewId:p.id});
 const reopened=new Store(dir,clock);try{advance(5000);reopened.receive(b);const handles=reopened.requestAttachments(b,q.id,0,20);assert.equal(handles.items.length,10);assert(Buffer.byteLength(JSON.stringify(handles))<16384);assert.equal(reopened.attachmentRead(b,handles.items[0]!.id!).total_bytes,7000);}finally{reopened.close();}
});
test('unshared upload quota is bounded while shared originals do not prevent new drafts',t=>{
 const {store,a,b}=fixture(t),uploads=[] as string[];for(let i=0;i<20;i++)uploads.push(store.attachmentPut(a,{name:'draft',content:'content',key:`u${i}`}).id);
 assert.throws(()=>store.attachmentPut(a,{name:'overflow',content:'x',key:'overflow'}),/upload_capacity_exceeded/);
 store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:uploads.slice(0,10)});
 assert.equal(store.attachmentPut(a,{name:'new',content:'new',key:'new'}).name,'new');
});
test('attachment quota rolls back the triggering message; exact retry does not add duplicate handles',t=>{
 const {store,a,b}=fixture(t),u=store.attachmentPut(a,{name:'source',content:'x'.repeat(65536),key:'u'}),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[u.id]});
 for(let i=0;i<15;i++){const input={id:q.id,version:1,kind:'note' as const,body:'note',key:`n${i}`,uploads:[u.id]};store.requestMessage(a,input);store.requestMessage(a,input);}
 assert.throws(()=>store.requestMessage(a,{id:q.id,version:1,kind:'note',body:'overflow',key:'overflow',uploads:[u.id]}),/attachment_capacity_exceeded/);
 assert.equal(store.requestAttachments(a,q.id,0,20).items.length,16);assert.equal(store.requestMessages(a,q.id,0,20).items.length,16);
});
test('closed undelivered references are redacted and never bypass an earlier incoming delivery barrier',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);
 const incoming=store.attachmentPut(b,{name:'incoming',content:'incoming secret',key:'in'}),outgoing=store.attachmentPut(a,{name:'outgoing',content:'outgoing secret',key:'out'});
 store.requestMessage(b,{id:q.id,version:1,kind:'answer',body:'answer',key:'answer',uploads:[incoming.id]});
 store.requestMessage(a,{id:q.id,version:1,kind:'note',body:'note',key:'note',uploads:[outgoing.id]});
 const blocked=store.requestAttachments(a,q.id);assert.equal(blocked.items.length,0);assert.equal(blocked.next,0);assert.equal(blocked.waiting_delivery,true);
 store.requestTransition(a,q.id,1,'cancelled');const closed=store.requestAttachments(a,q.id);assert.equal(closed.items.length,2);assert.equal(closed.items[0]?.redacted,true);assert.equal(closed.items[0]?.id,undefined);assert.equal('hash' in closed.items[0]!,false);
});
test('handle storage failure rolls back request and message while preserving the immutable private upload',async t=>{
 const {store,a,b,dir}=fixture(t),u=store.attachmentPut(a,{name:'source',content:'private',key:'u'});const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(dir,'runtime.sqlite'));
 try{db.exec("CREATE TRIGGER fail_handle BEFORE INSERT ON request_attachment_handles BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END");
 assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[u.id]}),/injected_storage_failure/);
 assert.equal(store.requestList(a).items.length,0);assert.equal(db.prepare('SELECT count(*) n FROM messages').get()!.n,0);assert.equal(store.attachmentUploadRead(a,u.id).content,'private');
 db.exec('DROP TRIGGER fail_handle');assert.equal(store.requestCreate(a,{to:b.id,body:'q',key:'q',uploads:[u.id]}).state,'pending');
 }finally{db.close();}
});
test('cancelled or timed-out requests reject late-result attachments rather than silently dropping them',t=>{
 const {store,a,b,advance}=fixture(t),u=store.attachmentPut(b,{name:'late',content:'late source',key:'late-upload'});
 for(const terminal of ['cancelled','timed_out'] as const){
  const q=store.requestCreate(a,{to:b.id,body:'q',key:terminal,deadlineMs:10000});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted');
  if(terminal==='cancelled')store.requestTransition(a,q.id,2,'cancelled');else advance(5000);
  for(const id of [u.id,'does-not-exist'])assert.throws(()=>store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'late',key:`late-${id}`,uploads:[id]}),/terminal_attachment_forbidden/);
  assert.equal(store.requestAttachments(b,q.id).items.length,0);
  assert.equal(store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'late without attachment',key:'plain-late'}).late,true);
 }
});
test('schema7 preview with no attachment digest remains valid after adding schema8 attachment tables',async t=>{
 const {store,a,b,dir}=fixture(t);const input={to:b.id,body:'old preview',key:'old-preview'},p=store.requestPreview(a,input);
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(dir,'runtime.sqlite'));
 try{db.prepare('UPDATE request_previews SET attachment_digest=NULL WHERE id=?').run(p.id);}finally{db.close();}
 assert.equal(store.requestCreate(a,{...input,previewId:p.id}).state,'pending');
});
