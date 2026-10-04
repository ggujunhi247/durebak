import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,hash} from '../src/store.js';
import {DatabaseSync} from 'node:sqlite';
function fixture(t:test.TestContext){
 const dir=mkdtempSync(join(tmpdir(),'durebak-protected-'));let now=100000;const clock={now:()=>now},store=new Store(dir,clock);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('w','c','opencode').session;
 return {store,dir,clock,a,b,c,advance:(ms:number)=>now+=ms};
}
const task={title:'private title',criteria:'private criteria'};
test('request creates a private task atomically; outsider and undelivered recipient cannot discover it',t=>{
 const {store,a,b,c}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task});
 assert(q.task);const id=q.task.id;
 assert.equal(store.tasks(c).items.length,0);assert.equal(store.tasks(b).items.length,0);
 for(const actor of [b,c]){assert.throws(()=>store.getTask(actor,id));assert.throws(()=>store.record(actor,id));}
 assert.equal(store.getTask(a,id).criteria,task.criteria);assert.equal(store.requestGet(b,q.id).task,undefined);
 assert.equal(store.events(c).items.filter(e=>e.entity===id).length,0);
});
test('protected task legacy mutation is rejected while normal workspace tasks retain their contract',t=>{
 const {store,a,b,c,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task});advance(5000);store.receive(b);
 const id=q.task!.id;
 assert.throws(()=>store.claim(b,id,1),/linked_request_operation_required/);
 assert.throws(()=>store.cancel(a,id,1),/linked_request_operation_required/);
 assert.throws(()=>store.complete(b,id,1,'0'.repeat(64)),/linked_request_operation_required/);
 assert.throws(()=>store.claim(c,id,1),/not_found/);
 const old=store.createTask(a,{...task,key:'public'});assert.equal(store.getTask(c,old.id).criteria,task.criteria);assert.equal(store.claim(c,old.id,1).owner,c.id);
});
test('request acceptance and task claim require both current versions and fix owner to recipient',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task});advance(5000);store.receive(b);
 assert.throws(()=>store.requestTransition(b,q.id,1,'accepted'),/task_version_required/);
 assert.throws(()=>store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:99}),/task_conflict/);
 const accepted=store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});assert.equal(accepted.task?.version,2);assert.equal(accepted.task?.state,'claimed');
 assert.equal(store.getTask(b,q.task!.id).owner,b.id);assert.equal(store.requestTaskRead(b,q.id).content,task.criteria);
});
test('timeout and creator cancellation close task without releasing its owner',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task,deadlineMs:10000});advance(5000);store.receive(b);
 store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});advance(5000);
 assert.equal(store.requestGet(a,q.id).state,'timed_out');assert.equal(store.getTask(a,q.task!.id).state,'cancelled');assert.equal(store.getTask(a,q.task!.id).owner,b.id);
 const next=store.requestCreate(a,{to:b.id,body:'q',key:'next',task});store.requestTransition(a,next.id,1,'cancelled',{expectedTaskVersion:1});assert.equal(store.getTask(a,next.task!.id).state,'cancelled');
});
test('result submission completes request and task with explicit workspace-visible artifact revision',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});
 const input={id:q.id,version:2,kind:'result' as const,body:'result',key:'result',expectedTaskVersion:2};
 assert.throws(()=>store.requestMessage(b,input),/result_hash_required/);
 const artifact=store.putArtifact(b,'result artifact');store.requestMessage(b,{...input,hash:artifact.hash});
 const done=store.requestGet(a,q.id);assert.equal(done.state,'completed');assert.equal(done.task?.state,'completed');assert.equal(done.task?.result_hash,artifact.hash);assert.equal(done.task?.result_visibility,'workspace-visible');
 assert.equal(store.requestMessage(b,{...input,hash:artifact.hash}).late,false);
});
test('task preview digest includes criteria and provides bounded owner-only criteria source',t=>{
 const {store,a,b,c}=fixture(t),input={to:b.id,body:'q',key:'q',task},p=store.requestPreview(a,input);
 assert.equal(p.task?.title,task.title);assert.equal(store.requestPreviewRead(a,p.id,0,4096,'criteria').content,task.criteria);
 assert.throws(()=>store.requestPreviewRead(c,p.id,0,4096,'criteria'),/not_found/);
 assert.throws(()=>store.requestCreate(a,{...input,task:{...task,criteria:'changed'},previewId:p.id}),/preview_conflict/);
 assert(store.requestCreate(a,{...input,previewId:p.id}).task);
});
test('reject and fail close the linked task without changing public task semantics',t=>{
 const {store,a,b,advance}=fixture(t);
 for(const state of ['rejected','failed'] as const){const q=store.requestCreate(a,{to:b.id,body:'q',key:state,task});advance(5000);store.receive(b);
  if(state==='failed')store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});
  const version=state==='failed'?2:1;
  const closed=store.requestTransition(b,q.id,version,state,{expectedTaskVersion:version,reasonCode:'blocked',detail:'Unavailable scope.'});
  assert.equal(closed.task?.state,'cancelled');assert.equal(closed.state,state);
  assert.throws(()=>store.requestTransition(a,q.id,closed.version,'cancelled',{expectedTaskVersion:closed.task!.version}),/request_terminal/);
 }
});
test('storage failure during protected creation or completion rolls back request, task and message together',async t=>{
 const {store,a,b,dir,advance}=fixture(t);const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(dir,'runtime.sqlite'));
 try{
  db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON request_tasks BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END");
  assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q',task}),/injected_storage_failure/);
  for(const table of ['tasks','requests','messages'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0);
  db.exec('DROP TRIGGER fail_link');const q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});
  const artifact=store.putArtifact(b,'result artifact');db.exec("CREATE TRIGGER fail_result BEFORE UPDATE OF state ON requests WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END");
  const input={id:q.id,version:2,kind:'result' as const,body:'result',key:'r',expectedTaskVersion:2,hash:artifact.hash};
  assert.throws(()=>store.requestMessage(b,input),/injected_storage_failure/);
  assert.equal(store.getTask(a,q.task!.id).state,'claimed');assert.equal(store.getTask(a,q.task!.id).version,2);
  assert.equal(store.requestGet(a,q.id).state,'accepted');assert.equal(db.prepare('SELECT count(*) n FROM request_messages').get()!.n,1);
  db.exec('DROP TRIGGER fail_result');store.requestMessage(b,input);assert.equal(store.getTask(a,q.task!.id).state,'completed');
 }finally{db.close();}
});
test('protected task metadata remains bounded and receiver criteria remain private until delivery after restart',t=>{
 const {store,a,b,c,dir,clock,advance}=fixture(t),input={to:b.id,body:'q',key:'q',task:{title:'\n'.repeat(200),criteria:'\n'.repeat(1900)}},p=store.requestPreview(a,input);
 assert(Buffer.byteLength(JSON.stringify(p))<16384);const q=store.requestCreate(a,{...input,previewId:p.id});
 const reopened=new Store(dir,clock);try{assert.throws(()=>reopened.requestTaskRead(b,q.id),/message_not_delivered/);assert.throws(()=>reopened.requestTaskRead(c,q.id),/not_found/);
 advance(5000);reopened.receive(b);assert.equal(reopened.requestTaskRead(b,q.id).content,input.task.criteria);assert(Buffer.byteLength(JSON.stringify(reopened.getTask(b,q.task!.id)))<16384);
 }finally{reopened.close();}
});
test('protected late result cannot complete a task cancelled at the deadline',t=>{
 const {store,a,b,advance}=fixture(t),q=store.requestCreate(a,{to:b.id,body:'q',key:'q',task,deadlineMs:10000});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted',{expectedTaskVersion:1});advance(5000);
 assert.equal(store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'late',key:'late',expectedTaskVersion:2}).late,true);
 assert.equal(store.getTask(a,q.task!.id).state,'cancelled');assert.equal(store.requestGet(a,q.id).state,'timed_out');
});

test('released schema6 fixture preserves an existing request and normalized preview through schema7',t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-schema6-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'runtime.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);db.exec(readFileSync(new URL('./fixtures/schema6.sql',import.meta.url),'utf8'));
 for(const id of ['a','b'])db.prepare('INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES(?,?,?,?,?)').run(id,'w',id,'codex',`fixture-${id}`);
 db.exec("INSERT INTO messages(id,workspace,sender,recipient,body,created_at,key,digest) VALUES('m','w','a','b','old question','2026-01-01T00:00:00Z','old','fixture'); INSERT INTO requests(id,workspace,creator,recipient,message_id,created_ms,deadline_at,key,digest) VALUES('q','w','a','b','m',100000,700000,'old','fixture'); INSERT INTO request_messages(message_id,request_id,kind) VALUES('m','q','question');");
 const payload='{"to":"b","body":"preview body","key":"new","priority":"normal","delayMs":0,"ttlMs":86400000,"deadlineMs":600000}';
 db.prepare('INSERT INTO request_previews VALUES(?,?,?,?,?,?)').run('preview','a',payload,hash(payload),100000,160000);db.close();
 const store=new Store(dir,{now:()=>100000});try{
  const actor={id:'a',workspace:'w',alias:'a',provider:'codex',revoked:0};assert.equal(store.requestGet(actor,'q').message_id,'m');assert.equal(store.requestGet(actor,'q').task,undefined);
  assert.equal(store.requestPreviewRead(actor,'preview').content,'preview body');
  assert.equal(store.requestCreate(actor,{to:'b',body:'preview body',key:'new',previewId:'preview'}).state,'pending');
  const check=new DatabaseSync(file);try{assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,8);assert.equal(check.prepare('SELECT token_hash FROM sessions WHERE id=?').get('a')!.token_hash,'fixture-a');}finally{check.close();}
 }finally{store.close();}
});
