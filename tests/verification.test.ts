import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
function fixture(t:test.TestContext){
 const dir=mkdtempSync(join(tmpdir(),'durebak-verification-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('w','c','opencode').session;
 const q=store.requestCreate(a,{to:b.id,body:'review result',key:'q',task:{title:'Review',criteria:'Tests must pass.'}});
 now+=5000;store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});
 return {store,a,b,c,q,dir,clock,advance:(ms:number)=>now+=ms};
}
test('accepted owner submits an immutable private revision with dual versions and idempotent retry',t=>{
 const {store,a,b,c,q}=fixture(t),u=store.attachmentPut(b,{name:'result.txt',content:'revision one',key:'u'}),input={id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'};
 assert.throws(()=>store.requestRevision(a,input),/request_role_required/);assert.throws(()=>store.requestRevision(c,input),/not_found/);
 const r=store.requestRevision(b,input);assert.equal(r.hash,u.hash);assert.equal(r.task_version,3);assert.equal(r.source,'self_reported');assert.equal(store.requestRevision(b,input).id,r.id);
 assert.throws(()=>store.requestRevision(b,{...input,key:'new',expectedTaskVersion:2}),/task_conflict/);
 assert.equal(store.requestGet(b,q.id).version,2);
 assert.throws(()=>store.readArtifact(a,r.hash),/not_found/);
});
test('incoming revision metadata and source require delivery, including verification and bundle views',t=>{
 const {store,a,b,c,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'result.txt',content:'private result',key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'});
 assert.equal(store.requestRevisions(a,q.id).items.length,0);assert.equal(store.requestVerification(a,q.id).status,'waiting_delivery');
 assert.throws(()=>store.attachmentRead(a,r.handle_id),/message_not_delivered/);assert.throws(()=>store.requestVerification(c,q.id),/not_found/);
 advance(5000);store.receive(a);assert.equal(store.requestRevisions(a,q.id).items[0]?.id,r.id);assert.equal(store.requestVerification(a,q.id).status,'unverified');
 assert.equal(store.attachmentRead(a,r.handle_id).content,'private result');
});
test('protected completion freezes latest private revision and hides result references until result delivery',t=>{
 const {store,a,b,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'result.txt',content:'latest private result',key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'});
 const wrong=store.putArtifact(b,'old public result');assert.throws(()=>store.requestMessage(b,{id:q.id,version:2,expectedTaskVersion:3,hash:wrong.hash,kind:'result',body:'done',key:'bad'}),/revision_conflict/);
 store.requestMessage(b,{id:q.id,version:2,expectedTaskVersion:3,hash:r.hash,kind:'result',body:'done',key:'done'});
 assert.equal(store.requestGet(a,q.id).state,'completed');assert.equal(store.getTask(a,q.task!.id).result_hash,null);assert.equal(store.requestGet(a,q.id).task?.result_hash,null);
 advance(5000);store.receive(a);assert.equal(store.getTask(a,q.task!.id).result_hash,r.hash);assert.equal(store.requestGet(a,q.id).task?.result_visibility,'request-private');
 assert.throws(()=>store.requestRevision(b,{id:q.id,version:3,expectedTaskVersion:4,uploadId:u.id,key:'new'}),/request_terminal/);
});
test('old revision pass requires revalidation after explicit new content revision',t=>{
 const {store,a,b,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'one',content:'one',key:'u1'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r1'});advance(5000);store.receive(a);
 store.requestEvidence(a,{id:q.id,revisionId:r.id,procedure:'npm test',result:'pass',attempt:'a1',key:'e1',startedAt:100000,endedAt:100100});
 assert.equal(store.requestVerification(a,q.id).status,'reported_pass');
 const next=store.attachmentPut(b,{name:'two',content:'two',key:'u2'});store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:3,uploadId:next.id,key:'r2'});advance(5000);store.receive(a);
 assert.equal(store.requestVerification(a,q.id).status,'needs_revalidation');
});
test('peer failure cannot be superseded by another author and conflicts do not become consensus pass',t=>{
 const {store,a,b,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'result',content:'result',key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'});advance(5000);store.receive(a);
 const fail=store.requestEvidence(a,{id:q.id,revisionId:r.id,procedure:'npm test',result:'fail',attempt:'a1',key:'e1',startedAt:100000,endedAt:100100});
 store.requestEvidence(b,{id:q.id,revisionId:r.id,procedure:'self check',result:'pass',attempt:'b1',key:'e2',startedAt:100000,endedAt:100100});
 assert.equal(store.requestVerification(b,q.id).status,'failed');assert.equal(store.requestVerification(b,q.id).conflict,true);
 assert.throws(()=>store.requestEvidence(b,{id:q.id,revisionId:r.id,procedure:'self check again',result:'pass',attempt:'b2',key:'e3',startedAt:100000,endedAt:100100,supersedes:fail.id}),/evidence_author_required/);
 store.requestEvidence(a,{id:q.id,revisionId:r.id,procedure:'npm test again',result:'pass',attempt:'a2',key:'e4',startedAt:100000,endedAt:100100,supersedes:fail.id});
 assert.equal(store.requestVerification(a,q.id).status,'reported_pass');assert.equal(store.requestVerification(a,q.id).source,'self_reported');
});
test('context bundle stays bounded, marks incomplete source, and respects revision delivery',t=>{
 const {store,a,b,c,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'source',content:'x'.repeat(60000),key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'});
 assert.throws(()=>store.requestBundle(c,q.id),/not_found/);const pending=store.requestBundle(a,q.id);assert.equal(pending.verification.status,'waiting_delivery');assert.equal(pending.revision,null);assert.ok(!JSON.stringify(pending).includes(r.hash));
 advance(5000);store.receive(a);const bundle=store.requestBundle(a,q.id);assert.equal(bundle.revision?.id,r.id);assert.equal(bundle.source_complete,false);assert.equal(bundle.criteria_digest,r.criteria_digest);assert.ok(Buffer.byteLength(JSON.stringify(bundle))<16384);assert.equal(bundle.mode,'cooperative');assert.equal(bundle.auto_wake,false);
});
test('evidence retries remain identical, pagination keeps source out of metadata, and terminal cancellation refuses new evidence',t=>{
 const {store,a,b,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'r',content:'r',key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'});advance(5000);store.receive(a);
 const input={id:q.id,revisionId:r.id,procedure:'private procedure '.repeat(150),result:'fail' as const,attempt:'a1',key:'e1',startedAt:100000,endedAt:100100};const e=store.requestEvidence(a,input);assert.deepEqual(store.requestEvidence(a,input),e);
 const page=store.requestEvidenceList(a,q.id);assert.equal(page.items.length,1);assert.ok(!JSON.stringify(page).includes(input.procedure));assert.equal(store.requestEvidenceRead(a,e.id).content,input.procedure);
 assert.throws(()=>store.requestEvidence(a,{...input,key:'changed',endedAt:999999}),/evidence_time_invalid/);
 store.requestTransition(a,q.id,2,'cancelled',{expectedTaskVersion:3});assert.throws(()=>store.requestEvidence(a,{...input,key:'new',attempt:'a2'}),/request_terminal/);assert.deepEqual(store.requestEvidence(a,input),e);
});
test('revision enqueue and evidence persist through restart; injected storage failure rolls back task and queue together',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {store,a,b,q,dir,clock,advance}=fixture(t),u=store.attachmentPut(b,{name:'r',content:'r',key:'u'}),input={id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'};
 const db=new DatabaseSync(join(dir,'runtime.sqlite'));t.after(()=>db.close());db.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON task_revisions BEGIN SELECT RAISE(ABORT,'revision_write_failed'); END;");
 assert.throws(()=>store.requestRevision(b,input),/revision_write_failed/);assert.equal(store.requestGet(b,q.id).task?.version,2);assert.equal(store.requestRevisions(b,q.id).items.length,0);assert.equal(store.requestAttachments(b,q.id).items.length,0);
 db.exec('DROP TRIGGER reject_revision');const r=store.requestRevision(b,input);advance(5000);store.receive(a);const reopened=new Store(dir,clock);try{assert.equal(reopened.requestRevision(b,input).id,r.id);assert.equal(reopened.requestRevisions(a,q.id).items[0]?.id,r.id);assert.equal(reopened.attachmentRead(a,r.handle_id).content,'r');}finally{reopened.close();}
});
test('schema8 independent fixture preserves private attachments, protected tasks and old previews on upgrade',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{readFileSync,chmodSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'durebak-schema8-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'runtime.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);db.exec(readFileSync(new URL('./fixtures/schema8.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES('a','w','a','codex','token-a'),('b','w','b','claude','token-b'); INSERT INTO messages(id,workspace,sender,recipient,body,created_at,key,digest,delivered_at) VALUES('m','w','a','b','q','2026-01-01T00:00:00Z','m','d',100000); INSERT INTO requests(id,workspace,creator,recipient,message_id,state,version,created_ms,deadline_at,key,digest) VALUES('q','w','a','b','m','accepted',2,100000,700000,'q','d'); INSERT INTO request_messages(message_id,request_id,kind) VALUES('m','q','question'); INSERT INTO tasks(id,workspace,creator,title,criteria,state,owner,version,created_at,key,digest) VALUES('t','w','a','review','test','claimed','b',2,'2026-01-01T00:00:00Z','t','d'); INSERT INTO request_tasks VALUES('q','t'); INSERT INTO private_uploads VALUES('u','a','w','old','hash','old source',10,'u','d'); INSERT INTO request_attachment_handles(id,request_id,message_id,upload_id) VALUES('h','q','m','u');");db.close();
 const store=new Store(dir,{now:()=>100000});try{const a={id:'a',workspace:'w',alias:'a',provider:'codex',revoked:0};assert.equal(store.attachmentRead(a,'h').content,'old source');assert.equal(store.requestGet(a,'q').task?.version,2);assert.equal(store.requestVerification(a,'q').status,'unverified');const check=new DatabaseSync(file);try{assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,10);assert.equal(check.prepare('SELECT token_hash FROM sessions WHERE id=?').get('a')!.token_hash,'token-a');}finally{check.close();}}finally{store.close();}
});
test('evidence pagination never advances beyond an undelivered earlier report',t=>{
 const {store,a,b,q,advance}=fixture(t),u=store.attachmentPut(b,{name:'one',content:'one',key:'u1'}),r1=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r1'});advance(5000);store.receive(a);
 const u2=store.attachmentPut(b,{name:'two',content:'two',key:'u2'}),r2=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:3,uploadId:u2.id,key:'r2'});
 const hidden=store.requestEvidence(b,{id:q.id,revisionId:r2.id,procedure:'failed latest',result:'fail',attempt:'b1',key:'hidden',startedAt:100000,endedAt:100100});store.requestEvidence(a,{id:q.id,revisionId:r1.id,procedure:'old pass',result:'pass',attempt:'a1',key:'visible',startedAt:100000,endedAt:100100});
 const page=store.requestEvidenceList(a,q.id);assert.equal(page.items.length,0);assert.equal(page.next,0);assert.equal(page.waiting_delivery,true);advance(5000);store.receive(a);assert.equal(store.requestEvidenceList(a,q.id,page.next).items[0]?.id,hidden.id);
});
test('bundle retains an explicit paginated source for initial and later request attachments',t=>{
 const {store,a,b}=fixture(t),upload=store.attachmentPut(a,{name:'input',content:'must inspect',key:'u'}),q=store.requestCreate(a,{to:b.id,body:'q',key:'with-input',uploads:[upload.id],task:{title:'review',criteria:'inspect input'}});
 const bundle=store.requestBundle(a,q.id);assert.ok(bundle.required_sources.some(s=>s.operation==='request_attachments'&&s.id===q.id));
});
test('revision admission reserves capacity for final result and later notes cannot consume that reserve',t=>{
 const {store,a,b,q}=fixture(t);let latest:ReturnType<Store['requestRevision']>|undefined;
 for(let i=0;i<15;i++){const u=store.attachmentPut(b,{name:`r${i}`,content:`${i}`.padEnd(65536,'x'),key:`u${i}`});latest=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2+i,uploadId:u.id,key:`r${i}`});}
 const extra=store.attachmentPut(b,{name:'extra',content:'z'.repeat(65536),key:'extra'});
 assert.throws(()=>store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:17,uploadId:extra.id,key:'overflow'}),/attachment_capacity_exceeded/);
 assert.throws(()=>store.requestMessage(b,{id:q.id,version:2,kind:'note',body:'more',uploads:[extra.id],key:'overflow-note'}),/attachment_capacity_exceeded/);
 assert.ok(latest);store.requestMessage(b,{id:q.id,version:2,expectedTaskVersion:17,hash:latest.hash,kind:'result',body:'done',key:'result'});assert.equal(store.requestGet(a,q.id).state,'completed');
});
