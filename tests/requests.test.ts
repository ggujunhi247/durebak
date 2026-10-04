import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {DatabaseSync} from 'node:sqlite';
function fixture(t:test.TestContext,workspace='w'){
 const dir=mkdtempSync(join(tmpdir(),'durebak-requests-'));let now=100000;
 const clock={now:()=>now};const store=new Store(dir,clock);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.register(workspace,'a','codex').session,b=store.register(workspace,'b','claude').session,c=store.register(workspace,'c','opencode').session;
 return {dir,clock,store,a,b,c,advance:(ms:number)=>now+=ms};
}
test('request creation is atomic and idempotent; same-workspace outsiders cannot discover it',t=>{
 const {store,a,b,c}=fixture(t);const input={to:b.id,body:'private question',key:'q'};
 const q=store.requestCreate(a,input);assert.equal(store.requestCreate(a,input).id,q.id);
 assert.equal(store.requestList(c).items.length,0);assert.throws(()=>store.requestGet(c,q.id),/not_found/);
 assert.throws(()=>store.requestCreate(a,{...input,body:'different'}),/idempotency_conflict/);
 assert.equal(store.requestList(a).items.length,1);
 assert.equal(store.events(c).items.filter(e=>e.entity===q.message_id).length,0);
});
test('request conversation cannot bypass delivery delay or pause',t=>{
 const {store,a,b,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'private',key:'q'});
 assert.equal(store.requestMessages(b,q.id).items.length,0);
 assert.equal(store.requestMessages(a,q.id).items[0]?.body,'private');
 store.setSessionState(b,'paused');advance(5000);assert.equal(store.receive(b).items.length,0);
 assert.equal(store.requestMessages(b,q.id).items.length,0);
 store.setSessionState(b,'available');store.receive(b);assert.equal(store.requestMessages(b,q.id).items[0]?.body,'private');
});
test('only delivered recipient accepts; result requires current accepted request',t=>{
 const {store,a,b,c,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});
 assert.throws(()=>store.requestTransition(b,q.id,1,'accepted'),/message_not_delivered/);
 advance(5000);store.receive(b);
 assert.throws(()=>store.requestTransition(c,q.id,1,'accepted'),/not_found/);
 const accepted=store.requestTransition(b,q.id,1,'accepted');assert.equal(accepted.version,2);
 assert.throws(()=>store.requestMessage(b,{id:q.id,version:1,kind:'result',body:'answer',key:'r'}),/request_conflict/);
 store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'answer',key:'r'});
 assert.equal(store.requestGet(a,q.id).state,'completed');
 assert.equal(store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'answer',key:'r'}).late,false);
 assert.throws(()=>store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'changed',key:'r'}),/idempotency_conflict/);
 assert.throws(()=>store.requestTransition(a,q.id,3,'cancelled'),/request_terminal/);
});
test('deadline boundary persists timeout and prevents later completion',t=>{
 const {dir,clock,store,a,b,advance}=fixture(t);
 assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'bad',deadlineMs:5000}),/deadline_before_delivery/);
 const q=store.requestCreate(a,{to:b.id,body:'q',key:'q',deadlineMs:10000});advance(5000);store.receive(b);
 store.requestTransition(b,q.id,1,'accepted');advance(5000);
 const reopened=new Store(dir,clock);try{
 assert.equal(reopened.requestGet(a,q.id).state,'timed_out');
 const late=reopened.requestMessage(b,{id:q.id,version:2,kind:'result',body:'late',key:'late'});
 assert.equal(late.late,true);assert.equal(reopened.requestGet(a,q.id).state,'timed_out');
 }finally{reopened.close();}
});
test('cancel notices bypass pause and full inbox; acknowledgement does not claim host termination',t=>{
 const {store,a,b,c}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});
 for(let i=0;i<99;i++)store.send(a,{to:b.id,body:'load',key:`load${i}`});
 store.setSessionState(b,'paused');store.requestTransition(a,q.id,1,'cancelled');
 const controls=store.requestControls(b);assert.equal(controls.items.length,1);
 const notice=controls.items[0]!;assert.equal(notice.request_id,q.id);assert.equal(notice.reason,'cancelled');
 assert.equal(store.requestControls(c).items.length,0);
 const ack=store.controlAck(b,notice.cursor);assert.equal(ack.host_stopped,'unknown');
 assert.throws(()=>store.controlAck(c,notice.cursor),/not_found/);
 assert.equal(store.requestGet(a,q.id).state,'cancelled');
});
test('reconnect checkpoint is session scoped, compare-and-swap and cannot skip unobserved cursors',t=>{
 const {dir,clock,store,a,b,c,advance}=fixture(t);store.send(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);
 const cursor=store.inbox(b).next;
 assert.throws(()=>store.checkpointSet(b,{consumer:'runner',version:0,messageCursor:cursor+1,controlCursor:0}),/unobserved_cursor/);
 const saved=store.checkpointSet(b,{consumer:'runner',version:0,messageCursor:cursor,controlCursor:0});assert.equal(saved.version,1);
 assert.throws(()=>store.checkpointSet(b,{consumer:'runner',version:0,messageCursor:cursor,controlCursor:0}),/checkpoint_conflict/);
 assert.throws(()=>store.checkpointSet(b,{consumer:'runner',version:1,messageCursor:0,controlCursor:0}),/checkpoint_regression/);
 assert.equal(store.checkpointGet(c,'runner').message_cursor,0);
 const reopened=new Store(dir,clock);try{assert.deepEqual(reopened.checkpointGet(b,'runner'),saved);}finally{reopened.close();}
});
test('cancelled in-flight delivery never becomes a new queue item after receipt lease expiry',t=>{
 const {store,a,b,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});
 advance(5000);assert.equal(store.receive(b).items.length,1);store.requestTransition(a,q.id,1,'cancelled');
 advance(40000);assert.equal(store.receive(b).items.length,0);
 advance(40000);assert.equal(store.receive(b).items.length,0);
});
test('rejection needs an explicit bounded reason and preserves the terminal explanation',t=>{
 const {store,a,b,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);
 assert.throws(()=>store.requestTransition(b,q.id,1,'rejected'),/reason_required/);
 const closed=store.requestTransition(b,q.id,1,'rejected',{reasonCode:'scope_unavailable',detail:'Cannot access the requested files.'});
 assert.equal(closed.reason_code,'scope_unavailable');assert.equal(store.requestGet(a,q.id).detail,'Cannot access the requested files.');
});
test('request list keeps encoded reasons bounded without losing pagination',t=>{
 const {store,a,b,advance}=fixture(t);
 for(let i=0;i<8;i++){const q=store.requestCreate(a,{to:b.id,body:'q',key:`q${i}`});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'rejected',{reasonCode:'blocked',detail:'\n'.repeat(1900)});}
 const page=store.requestList(a,'',20);assert(Buffer.byteLength(JSON.stringify(page))<16384);assert.equal(page.has_more,true);
 const ids=new Set(page.items.map(q=>q.id));let current=page;
 while(current.has_more){current=store.requestList(a,current.next,20);assert(current.items.length>0);for(const q of current.items)ids.add(q.id);}
 assert.equal(ids.size,8);
});
test('conversation pagination never skips a delayed incoming message behind a visible outgoing note',t=>{
 const {store,a,b,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);
 const initial=store.requestMessages(a,q.id);
 store.requestMessage(b,{id:q.id,version:1,kind:'answer',body:'delayed answer',key:'answer'});
 store.requestMessage(a,{id:q.id,version:1,kind:'note',body:'outgoing note',key:'note'});
 const blocked=store.requestMessages(a,q.id,initial.next);assert.equal(blocked.items.length,0);assert.equal(blocked.next,initial.next);
 advance(5000);store.receive(a);const resumed=store.requestMessages(a,q.id,blocked.next);
 assert.deepEqual(resumed.items.map(m=>m.body),['delayed answer','outgoing note']);
});
test('deadline reached during result submission cannot overwrite timeout with completion',t=>{
 const {store,a,b,clock,advance}=fixture(t);const q=store.requestCreate(a,{to:b.id,body:'q',key:'q',deadlineMs:10000});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted');
 let reads=0;clock.now=()=>++reads===1?q.deadline_at-1:q.deadline_at;
 const result=store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'late',key:'r'});
 assert.equal(result.late,true);assert.equal(store.requestGet(a,q.id).state,'timed_out');
 assert.equal(store.requestControls(b).items[0]?.reason,'timed_out');
});
test('checkpoint cannot jump past an earlier unobserved control notice',async t=>{
 const {store,a,b,dir}=fixture(t);
 for(let i=0;i<2;i++){const q=store.requestCreate(a,{to:b.id,body:'q',key:`q${i}`});store.requestTransition(a,q.id,1,'cancelled');}
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(dir,'runtime.sqlite'));
 const first=db.prepare('SELECT cursor FROM request_controls WHERE recipient=? ORDER BY cursor LIMIT 1').get(b.id)!.cursor as number;db.close();
 const later=store.requestControls(b,first,1).items[0]!;
 assert.throws(()=>store.checkpointSet(b,{consumer:'runner',version:0,messageCursor:0,controlCursor:later.cursor}),/unobserved_cursor/);
 store.requestControls(b);assert.equal(store.checkpointSet(b,{consumer:'runner',version:0,messageCursor:0,controlCursor:later.cursor}).version,1);
});
test('conversation JSON budget accounts for metadata as well as escaped body previews',t=>{
 const {store,a,b}=fixture(t,'w'.repeat(200));const q=store.requestCreate(a,{to:b.id,body:'x'.repeat(400),key:'q'});
 for(let i=0;i<20;i++)store.requestMessage(a,{id:q.id,version:1,kind:'note',body:'x'.repeat(400),key:`n${i}`});
 let page=store.requestMessages(a,q.id,0,20);assert(Buffer.byteLength(JSON.stringify(page))<16384);
 const ids=new Set(page.items.map(m=>m.id));while(page.has_more){page=store.requestMessages(a,q.id,page.next,20);assert(Buffer.byteLength(JSON.stringify(page))<16384);for(const m of page.items)ids.add(m.id);}
 assert.equal(ids.size,21);
});

test('request creation and completion roll back together with their queued message on storage failure',t=>{
 const {store,a,b,dir,advance}=fixture(t);const db=new DatabaseSync(join(dir,'runtime.sqlite'));
 try{
  db.exec("CREATE TRIGGER fail_request BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END");
  assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q'}),/injected_storage_failure/);
  assert.equal(db.prepare('SELECT count(*) n FROM messages').get()!.n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE kind='message.queued'").get()!.n,0);
  db.exec('DROP TRIGGER fail_request');
  const q=store.requestCreate(a,{to:b.id,body:'q',key:'q'});advance(5000);store.receive(b);store.requestTransition(b,q.id,1,'accepted');
  db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE OF state ON requests WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'injected_storage_failure'); END");
  assert.throws(()=>store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'r',key:'r'}),/injected_storage_failure/);
  assert.equal(store.requestGet(a,q.id).state,'accepted');
  assert.equal(db.prepare('SELECT count(*) n FROM request_messages').get()!.n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM messages').get()!.n,1);
  db.exec('DROP TRIGGER fail_completion');
  assert.equal(store.requestMessage(b,{id:q.id,version:2,kind:'result',body:'r',key:'r'}).late,false);
 }finally{db.close();}
});
test('independent released schema4 fixture upgrades while preserving messages, credentials and delivery cursors',t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-schema4-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'runtime.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec(readFileSync(new URL('./fixtures/schema4.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES(?,?,?,?,?)").run('old-a','w','a','codex','fixture-credential-hash');
 db.prepare("INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES(?,?,?,?,?)").run('old-b','w','b','claude','fixture-credential-hash-b');
 db.exec("INSERT INTO messages(id,workspace,sender,recipient,body,status,created_at,key,digest,delivered_at) VALUES('old-message','w','old-a','old-b','fixture message','read','2026-01-01T00:00:00Z','old-key','fixture-digest',1); INSERT INTO delivery_audit(cursor,message_id,recipient) VALUES(17,'old-message','old-b');");
 const before=db.prepare('SELECT * FROM messages').get();db.close();
 const store=new Store(dir);try{
  const after=new DatabaseSync(file);try{
   assert.equal(after.prepare('PRAGMA user_version').get()!.user_version,13);
   assert.deepEqual(after.prepare('SELECT * FROM messages').get(),before);
   assert.equal(after.prepare('SELECT token_hash FROM sessions WHERE id=?').get('old-a')!.token_hash,'fixture-credential-hash');
   assert.equal(after.prepare('SELECT cursor FROM delivery_audit').get()!.cursor,17);
  }finally{after.close();}
  const a=store.sessions({id:'old-a',workspace:'w',alias:'a',provider:'codex',revoked:0}).items.find(s=>s.id==='old-a')!;
  assert.equal(store.requestCreate(a,{to:'old-b',body:'new request',key:'new'}).state,'pending');
 }finally{store.close();}
});

test('request metadata rejects an encoded workspace too large for a bounded response',t=>{
 const {store,a,b}=fixture(t,'\n'.repeat(4096));
 assert.throws(()=>store.requestCreate(a,{to:b.id,body:'q',key:'q'}),/request_scope_too_large/);
 assert.equal(store.requestList(a).items.length,0);
});
