import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.js';
import {WorkInput} from '../src/work-input.js';
function fixture(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'durebak-input-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock),db=new DatabaseSync(join(dir,'runtime.sqlite'));t.after(()=>{db.close();store.close();rmSync(dir,{recursive:true,force:true});});const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('other','c','codex').session;return {store,db,a,b,c,input:new WorkInput(db,clock),advance:(ms:number)=>now+=ms};}
function question(store:Store,a:{id:string;workspace:string;alias:string;provider:string;revoked:number},to:string,extra:object={}){return store.requestCreate(a,{to,body:'explicit question',key:'q',priority:'urgent',urgentReason:'test',...extra});}
test('complete input preserves exact body, criteria and private attachment without delivery side effects',t=>{
 const {store,db,a,b,input}=fixture(t),content='원문\n'.repeat(400),upload=store.attachmentPut(a,{name:'source.txt',content,key:'source'}),q=question(store,a,b.id,{body:'원문 질문\n'.repeat(150),task:{title:'review',criteria:'check the exact source'},uploads:[upload.id]});
 const envelope=input.assemble(b.id,q.message_id);assert.equal(envelope.input.source_complete,true);assert.equal(envelope.input.messages[0]!.body,'원문 질문\n'.repeat(150));assert.equal(envelope.input.task?.criteria,'check the exact source');assert.equal(envelope.input.attachments[0]!.content,content);assert.ok(envelope.bytes<=16384);assert.equal(envelope.digest.length,64);assert.equal(input.assemble(b.id,q.message_id).digest,envelope.digest);
 const m=db.prepare('SELECT status,delivered_at,attempts FROM messages WHERE id=?').get(q.message_id)!;assert.equal(m.status,'queued');assert.equal(m.delivered_at,null);assert.equal(m.attempts,0);assert.throws(()=>store.requestTaskRead(b,q.id),/message_not_delivered/);assert.throws(()=>store.attachmentRead(b,envelope.input.attachments[0]!.id),/message_not_delivered/);
});
test('wrong recipient, revoked identity and non-request messages cannot assemble work',t=>{
 const {store,a,b,c,input}=fixture(t),q=question(store,a,b.id);assert.throws(()=>input.assemble(c.id,q.message_id),/not_found/);assert.throws(()=>input.assemble(a.id,q.message_id),/not_found/);const m=store.send(a,{to:b.id,body:'ordinary',key:'plain',priority:'urgent',urgentReason:'test'});assert.throws(()=>input.assemble(b.id,m.id),/not_a_work_trigger/);store.revoke(b.id);assert.throws(()=>input.assemble(b.id,q.message_id),/binding_revoked/);
});
test('queue delay, availability, TTL and request cancellation prevent input preparation',t=>{
 const {store,a,b,input,advance}=fixture(t),q=question(store,a,b.id,{priority:'normal',urgentReason:undefined,ttlMs:6000});assert.throws(()=>input.assemble(b.id,q.message_id),/waiting_delay/);advance(5000);store.setSessionState(b,'paused');assert.throws(()=>input.assemble(b.id,q.message_id),/recipient_unavailable/);store.setSessionState(b,'available');assert.equal(input.assemble(b.id,q.message_id).input.trigger.kind,'question');advance(1000);assert.throws(()=>input.assemble(b.id,q.message_id),/trigger_expired/);
 const q2=question(store,a,b.id,{key:'cancel'});store.requestTransition(a,q2.id,q2.version,'cancelled');assert.throws(()=>input.assemble(b.id,q2.message_id),/trigger_unavailable/);
});
test('a cooperative consumer wins delivery and prevents a second native work preparation',t=>{
 const {store,a,b,input}=fixture(t),q=question(store,a,b.id);store.receive(b);assert.throws(()=>input.assemble(b.id,q.message_id),/trigger_unavailable/);
});
test('encoded input exceeding the bound is refused rather than truncated',t=>{
 const {store,a,b,input}=fixture(t),q=question(store,a,b.id,{body:'x'.repeat(16384)});assert.throws(()=>input.assemble(b.id,q.message_id),/context_unavailable/);
});
test('corrupt or missing scoped attachment content refuses the entire input',t=>{
 const {store,db,a,b,input}=fixture(t),upload=store.attachmentPut(a,{name:'source',content:'exact',key:'u'}),q=question(store,a,b.id,{uploads:[upload.id]});db.prepare('UPDATE private_uploads SET content=? WHERE id=?').run('changed',upload.id);assert.throws(()=>input.assemble(b.id,q.message_id),/context_unavailable/);
});
test('continuation contains the initial input and correlated answer; notes are not triggers',t=>{
 const {store,a,b,input,advance}=fixture(t),q=question(store,a,b.id);store.receive(b);store.requestTransition(b,q.id,1,'accepted');const answer=store.requestMessage(b,{id:q.id,version:2,kind:'answer',body:'answer',key:'answer'});advance(5000);const e=input.assemble(a.id,answer.id);assert.deepEqual(e.input.messages.map(m=>m.kind),['question','answer']);assert.equal(e.input.through_seq,e.input.messages.at(-1)!.seq);
 const note=store.requestMessage(b,{id:q.id,version:2,kind:'note',body:'progress',key:'note'});advance(5000);assert.throws(()=>input.assemble(a.id,note.id),/not_a_work_trigger/);assert.equal(input.assemble(a.id,answer.id).input.messages.length,2);
});
test('a deadline closes preparation without claiming a native host was stopped',t=>{
 const {store,a,b,input,advance}=fixture(t),q=question(store,a,b.id,{deadlineMs:1000});advance(1000);assert.throws(()=>input.assemble(b.id,q.message_id),/request_closed/);
});
test('workspace-visible result includes exact artifact and rejects missing, corrupt or oversized source',t=>{
 const {store,db,a,b,input,advance}=fixture(t),q=question(store,a,b.id,{task:{title:'review',criteria:'exact output'}});store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});const artifact=store.putArtifact(b,'REQUIRED_RESULT_SOURCE');const result=store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'done',hash:artifact.hash,expectedTaskVersion:2,key:'result'});advance(5000);
 const e=input.assemble(a.id,result.id);assert.ok(e.encoded.includes(artifact.hash));assert.ok(e.encoded.includes('REQUIRED_RESULT_SOURCE'));
 db.prepare('UPDATE artifacts SET content=? WHERE workspace=? AND hash=?').run('corrupt',a.workspace,artifact.hash);assert.throws(()=>input.assemble(a.id,result.id),/context_unavailable/);
 db.prepare('DELETE FROM artifacts WHERE workspace=? AND hash=?').run(a.workspace,artifact.hash);assert.throws(()=>input.assemble(a.id,result.id),/context_unavailable/);
 const q2=question(store,a,b.id,{key:'large',task:{title:'review',criteria:'exact output'}});store.receive(b);store.requestTransition(b,q2.id,1,'accepted',{expectedTaskVersion:1});const large=store.putArtifact(b,'x'.repeat(16384)),largeResult=store.requestMessage(b,{id:q2.id,version:2,kind:'result',body:'done',hash:large.hash,expectedTaskVersion:2,key:'large-result'});advance(5000);assert.throws(()=>input.assemble(a.id,largeResult.id),/context_unavailable/);
});
test('old revision evidence remains associated and labeled after the latest source changes',t=>{
 const {store,a,b,input,advance}=fixture(t),q=question(store,a,b.id,{task:{title:'review',criteria:'test exact output'}});store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});
 const u1=store.attachmentPut(b,{name:'one',content:'one',key:'u1'}),r1=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u1.id,key:'r1'});advance(5000);store.receive(a);
 store.requestEvidence(a,{id:q.id,revisionId:r1.id,procedure:'PRIOR_FAILURE_PROCEDURE',result:'fail',attempt:'a1',key:'e1',startedAt:100000,endedAt:100001});
 const u2=store.attachmentPut(b,{name:'two',content:'two',key:'u2'}),r2=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:3,uploadId:u2.id,key:'r2'});advance(5000);store.receive(a);const answer=store.requestMessage(b,{id:q.id,version:2,kind:'answer',body:'updated source',key:'answer'});advance(5000);
 const e=input.assemble(a.id,answer.id);assert.ok(e.encoded.includes(r1.id));assert.ok(e.encoded.includes('PRIOR_FAILURE_PROCEDURE'));assert.equal(e.input.evidence[0]!.revision_id,r1.id);assert.equal(e.input.evidence[0]!.verification_kind,'self_reported');assert.equal(e.input.latest_revision?.id,r2.id);assert.equal(store.requestVerification(a,q.id).status,'needs_revalidation');
});
test('queued revision notes accompany a result without requiring a note-triggered native turn',t=>{
 const {store,db,a,b,input,advance}=fixture(t),q=question(store,a,b.id,{task:{title:'review',criteria:'test'}});store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});const u=store.attachmentPut(b,{name:'private',content:'private result',key:'u'}),r=store.requestRevision(b,{id:q.id,version:2,expectedTaskVersion:2,uploadId:u.id,key:'r'}),result=store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'done',hash:r.hash,expectedTaskVersion:3,key:'result'});advance(5000);
 const e=input.assemble(a.id,result.id);assert.equal(e.input.latest_revision?.id,r.id);assert.ok(e.encoded.includes('private result'));assert.equal(e.input.messages.length,3);assert.deepEqual(e.pending_delivery_ids,[r.message_id,result.id]);assert.equal(db.prepare('SELECT delivered_at FROM messages WHERE id=?').get(r.message_id)!.delivered_at,null);assert.throws(()=>store.attachmentRead(a,r.handle_id),/message_not_delivered/);
});
