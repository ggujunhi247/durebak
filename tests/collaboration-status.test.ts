import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {renderCollaborationStatus} from '../src/collaboration-status.js';
function fixture(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'durebak-dashboard-'));let now=100000;const store=new Store(dir,{now:()=>now});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,c=store.register('w','c','opencode').session,d=store.register('other','d','codex').session;return {store,a,b,c,d,advance:(ms:number)=>now+=ms};}
test('collaboration status separates observed contact from host health and keeps requests participant-only',t=>{
 const {store,a,b,c,d}=fixture(t);store.requestCreate(a,{to:b.id,body:'private question',key:'q',task:{title:'private title',criteria:'private criteria'}});store.setSessionState(b,'paused');
 const view=store.collaborationStatus(a,'epoch');assert.equal(view.mode,'cooperative');assert.equal(view.auto_wake,false);assert.equal(view.self.host,'unknown');assert.equal(view.self.bridge.state,'unknown');assert.equal(view.requests.items.length,1);
 assert.equal(store.collaborationStatus(c,'epoch').requests.items.length,0);assert.ok(!view.sessions.items.some(s=>s.id===d.id));assert.ok(!JSON.stringify(view).includes('private question'));assert.ok(!JSON.stringify(view).includes('private title'));assert.ok(!JSON.stringify(view).includes('private criteria'));assert.equal(store.queueStatus(b).counts.queued,1);
});
test('dashboard is bounded and explicitly provides next-page cursors',t=>{
 const {store,a,b}=fixture(t);for(let i=0;i<23;i++)store.register('w',`s${i}`,'other');for(let i=0;i<11;i++)store.requestCreate(a,{to:b.id,body:'q',key:`q${i}`});const view=store.collaborationStatus(a,'epoch');assert.equal(view.sessions.items.length,20);assert.equal(view.sessions.has_more,true);assert.equal(view.requests.items.length,10);assert.equal(view.requests.has_more,true);assert.ok(Buffer.byteLength(JSON.stringify(view))<16384);const next=store.collaborationStatus(a,'epoch',{sessionAfter:view.sessions.next,requestAfter:view.requests.next});assert.equal(next.requests.items.length,1);assert.ok(next.sessions.items.length>0);
});
test('terminal dashboard safely renders malicious aliases and does not turn peer text into terminal controls',t=>{
 const {store,a}=fixture(t);store.register('w','evil\x1b[2J\n\u202etext','other');const rendered=renderCollaborationStatus(store.collaborationStatus(a,'epoch'));assert.ok(!rendered.includes('\x1b'));assert.ok(!rendered.includes('\u202e'));assert.ok(rendered.includes('\\u001b'));assert.ok(rendered.includes('cooperative'));assert.ok(rendered.includes('host=unknown'));assert.ok(rendered.includes('auto_wake=false'));
});
test('terminal dashboard escapes DEL and C1 control sequences',t=>{
 const {store,a}=fixture(t);store.register('w','evil\u009b2J\u009d0;spoofed\u009c\u007f','other');const text=renderCollaborationStatus(store.collaborationStatus(a,'epoch'));assert.ok(!/[\u007f-\u009f]/.test(text));assert.ok(text.includes('\\u009b'));
});
test('one observation boundary keeps snapshot states consistent with its maintenance',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'durebak-status-time-'));let now=100000,advancing=false;const store=new Store(dir,{now:()=>advancing?now++:now});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});const a=store.register('w','a','codex').session,b=store.register('w','b','claude').session,q=store.requestCreate(a,{to:b.id,body:'q',key:'q',deadlineMs:10000,task:{title:'task',criteria:'test'}});now=q.deadline_at-1;advancing=true;const view=store.collaborationStatus(a,'epoch'),row=view.requests.items[0]!;const db=new DatabaseSync(join(dir,'runtime.sqlite'));try{const persisted=db.prepare('SELECT state,version FROM requests WHERE id=?').get(q.id)!;assert.equal(row.state,persisted.state);assert.equal(row.version,persisted.version);assert.equal(row.state,view.observed_at>=q.deadline_at?'timed_out':'pending');}finally{db.close();}
});
