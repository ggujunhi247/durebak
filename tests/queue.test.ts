import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
function fixture(t: test.TestContext) {
  const dir=mkdtempSync(join(tmpdir(),'durebak-queue-')); let now=1700000000000;
  const clock={now:()=>now}; const s=new Store(dir,clock);
  t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
  const a=s.register('w','a','codex').session,b=s.register('w','b','claude').session;
  return {s,a,b,dir,clock,advance:(ms:number)=>{now+=ms;}};
}
test('default queue waits, hides undelivered bodies and uses delivery receipts',t=>{
  const {s,a,b,advance}=fixture(t);const m=s.send(a,{to:b.id,body:'hello',key:'1'});
  assert.equal(m.status,'queued');assert.equal(s.receive(b).items.length,0);
  assert.equal(s.queueStatus(b).retry_after_ms,5000);assert.equal(s.inbox(b).items.length,0);
  assert.throws(()=>s.readMessage(b,m.id),/message_not_delivered/);
  advance(5000);const d=s.receive(b).items[0]!;assert.equal(d.id,m.id);
  assert.equal(s.receive(b).items.length,0);assert.throws(()=>s.ack(b,m.id,'wrong'),/receipt_conflict/);
  assert.equal(s.ack(b,m.id,d.receipt).status,'read');assert.equal(s.ack(b,m.id,d.receipt).status,'read');
});
test('availability and urgent quota cannot bypass paused state',t=>{
  const {s,a,b,advance}=fixture(t);s.setSessionState(b,'busy');
  s.send(a,{to:b.id,body:'normal',key:'normal'});advance(5000);
  assert.equal(s.receive(b).items.length,0);
  assert.throws(()=>s.send(a,{to:b.id,body:'urgent',key:'bad',priority:'urgent'}));
  for(let i=0;i<3;i++)s.send(a,{to:b.id,body:'urgent',key:String(i),priority:'urgent',urgentReason:'blocking incident'});
  s.send(a,{to:b.id,body:'urgent',key:'0',priority:'urgent',urgentReason:'blocking incident'});
  assert.throws(()=>s.send(a,{to:b.id,body:'urgent',key:'4',priority:'urgent',urgentReason:'incident'}),/urgent_quota_exceeded/);
  s.setSessionState(b,'paused');assert.equal(s.receive(b).items.length,0);
  s.setSessionState(b,'busy');assert.equal(s.receive(b).items.length,3);
  s.setSessionState(b,'available');assert.equal(s.receive(b).items.length,1);
});
test('leases retry with new receipts and terminate after five deliveries',t=>{
  const {s,a,b,advance}=fixture(t);const m=s.send(a,{to:b.id,body:'work',key:'1'});advance(5000);
  let old='';for(let attempt=1;attempt<=5;attempt++){
    const d=s.receive(b).items[0]!;assert.equal(d.attempts,attempt);assert.notEqual(d.receipt,old);
    if(old)assert.throws(()=>s.ack(b,m.id,old),/receipt_conflict/);old=d.receipt;
    advance(30000);assert.throws(()=>s.ack(b,m.id,old),/receipt_conflict/);
    advance(1000*2**(attempt-1));
  }
  assert.equal(s.receive(b).items.length,0);assert.equal(s.messageStatus(a,m.id).status,'dead_letter');
});
test('expiry, delayed lower sequence, starvation and durable state',t=>{
  const {s,a,b,advance,dir,clock}=fixture(t);
  const low=s.send(a,{to:b.id,body:'low',key:'low',priority:'low'});
  s.send(a,{to:b.id,body:'expires',key:'expiry',ttlMs:6000});advance(7000);
  assert.equal(s.receive(b).items.length,0);advance(143000);
  s.send(a,{to:b.id,body:'urgent',key:'urgent',priority:'urgent',urgentReason:'incident'});
  const other=new Store(dir,clock);try{assert.equal(other.receive(b,1).items[0]!.id,low.id);}finally{other.close();}
});

test('retry hints stay attached to their message after final-attempt filtering',t=>{
  const {s,a,b,advance}=fixture(t);
  s.send(a,{to:b.id,body:'retry',key:'retry',ttlMs:200000});advance(5000);
  for(let i=1;i<5;i++){s.receive(b);advance(30000+1000*2**(i-1));}
  s.receive(b);
  s.send(a,{to:b.id,body:'later',key:'later',delayMs:100000,ttlMs:200000});
  assert.equal(s.queueStatus(b).retry_after_ms,100000);
});

test('minimum delay, age promotion, bounded batch and delayed sequence preservation',t=>{
  const {s,a,b,advance}=fixture(t);
  const low=s.send(a,{to:b.id,body:'low',key:'low',priority:'low',delayMs:0});
  const normal=s.send(a,{to:b.id,body:'normal',key:'normal'});advance(5000);
  const first=s.receive(b,1).items[0]!;assert.equal(first.id,normal.id);s.ack(b,first.id,first.receipt);
  advance(85000);s.send(a,{to:b.id,body:'high',key:'high',priority:'high'});advance(1000);
  assert.equal(s.receive(b,1).items[0]!.id,low.id);
  for(let i=0;i<12;i++)s.send(a,{to:b.id,body:'\u0000'.repeat(1000),key:`batch-${i}`});advance(5000);
  const batch=s.receive(b,10);assert.equal(batch.items.length,10);
  assert.ok(Buffer.byteLength(JSON.stringify(batch))<16384);
  assert.equal(s.receive(b,10).items.length,3);
  assert.throws(()=>s.send(a,{to:b.id,body:'bad ttl',key:'bad-ttl',ttlMs:86400001}));
});

test('schema one migrates atomically, preserves dedup and read history without retroactive expiry',async t=>{
  const { DatabaseSync }=await import('node:sqlite');
  const { hash }=await import('../src/store.js');
  const {chmodSync}=await import('node:fs');
  const dir=mkdtempSync(join(tmpdir(),'durebak-migrate-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const db=new DatabaseSync(join(dir,'runtime.sqlite'));chmodSync(join(dir,'runtime.sqlite'),0o600);
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,alias TEXT NOT NULL,provider TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,revoked INTEGER NOT NULL DEFAULT 0,UNIQUE(workspace,alias)) STRICT;
    CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,workspace TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,body TEXT NOT NULL,reply_to TEXT,status TEXT NOT NULL DEFAULT 'sent',created_at TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(sender,key)) STRICT;
    INSERT INTO sessions VALUES('a','w','a','codex','a',0),('b','w','b','claude','b',0); PRAGMA user_version=1;`);
  for(const [id,status]of [['old','sent'],['read','read']])db.prepare('INSERT INTO messages(id,workspace,sender,recipient,body,status,created_at,key,digest) VALUES(?,?,?,?,?,?,?,?,?)').run(id!,'w','a','b','hello',status!,'2020-01-01T00:00:00.000Z',id!,hash(JSON.stringify(['b','hello',null])));
  db.close();const s=new Store(dir);try{
    const a={id:'a',workspace:'w',alias:'a',provider:'codex',revoked:0},b={...a,id:'b',alias:'b'};
    assert.equal(s.send(a,{to:'b',body:'hello',key:'old'}).id,'old');
    assert.equal(s.inbox(b).items[0]!.id,'read');assert.equal(s.receive(b).items[0]!.id,'old');
    s.setSessionState(b,'paused');const reopened=new Store(dir);try{assert.equal(reopened.queueStatus(b).state,'paused');}finally{reopened.close();}
  }finally{s.close();}
});

test('ack never writes read after its lease expires between database transactions',t=>{
  const {s,a,b,advance}=fixture(t);
  s.send(a,{to:b.id,body:'work',key:'atomic-ack'});advance(5000);
  const delivery=s.receive(b).items[0]!;
  // Inject a scheduling pause after the first commit. A SQL trigger observes
  // the time of the real state write; no production operation is mocked away.
  const db=(s as unknown as {db:import('node:sqlite').DatabaseSync}).db;
  let observedWrite=Infinity;let elapsed=0;
  db.function('observe_ack',()=>{observedWrite=elapsed;return 0;});
  db.exec("CREATE TEMP TRIGGER observe_read AFTER UPDATE OF status ON messages WHEN NEW.status='read' BEGIN SELECT observe_ack(); END");
  const execute=db.exec.bind(db);let paused=false;
  t.mock.method(db,'exec',(sql:string)=>{
    const result=execute(sql);
    if(sql==='COMMIT'&&!paused){paused=true;advance(30000);elapsed=30000;}
    return result;
  });
  s.ack(b,delivery.id,delivery.receipt);
  assert.ok(observedWrite<30000,'read mutation must occur while its receipt lease is valid');
});

test('audit cursor follows first delivery order across delayed messages and restart',t=>{
  const {s,a,b,advance,dir,clock}=fixture(t);
  const low=s.send(a,{to:b.id,body:'later',key:'low',priority:'low'});
  const high=s.send(a,{to:b.id,body:'first',key:'high',priority:'high'});
  advance(1000);const first=s.receive(b,1).items[0]!;s.ack(b,first.id,first.receipt);
  const page=s.inbox(b,0,1);assert.equal(page.items[0]!.id,high.id);
  advance(29000);s.receive(b,1);
  const reopened=new Store(dir,clock);
  try{
    const next=reopened.inbox(b,page.next,1);assert.equal(next.items[0]?.id,low.id);
    advance(31000);reopened.receive(b,1);
    assert.equal(reopened.inbox(b,next.next).items.length,0,'redelivery must not duplicate first-delivery history');
  }finally{reopened.close();}
});

test('schema two audit backfill preserves delivered history and pending messages',async t=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {s,a,b,advance,dir,clock}=fixture(t);
  const first=s.send(a,{to:b.id,body:'delivered',key:'first'});
  const pending=s.send(a,{to:b.id,body:'pending',key:'pending',priority:'low'});
  advance(5000);const delivered=s.receive(b,1).items[0]!;s.ack(b,first.id,delivered.receipt);
  s.close();
  const db=new DatabaseSync(join(dir,'runtime.sqlite'));
  db.exec('DROP TABLE consumer_checkpoints; DROP TABLE request_controls; DROP TABLE request_late; DROP TABLE request_messages; DROP TABLE requests; DROP TABLE session_activity; DROP TABLE bridge_observations; DROP TABLE delivery_audit; PRAGMA user_version=2;');db.close();
  const upgraded=new Store(dir,clock);
  try{
    const page=upgraded.inbox(b);assert.equal(page.cursor_version,2);
    assert.equal(page.items.length,1);assert.equal(page.items[0]!.id,first.id);
    advance(25000);upgraded.receive(b);
    assert.equal(upgraded.inbox(b,page.next).items[0]!.id,pending.id);
  }finally{upgraded.close();}
});
