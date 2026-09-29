import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRuntime } from '../src/runtime.js';

async function setup(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'durebak-http-'));
  const runtime = await startRuntime(dir);
  t.after(async () => { await runtime.close(); rmSync(dir, { recursive: true, force: true }); });
  const post = (path: string, token: string, body: unknown, headers: Record<string,string> = {}) => fetch(runtime.url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { dir, runtime, post };
}

test('real HTTP bus derives sender from credential and rejects forged identity and browser origins', async t => {
  const { runtime, post } = await setup(t);
  const a = await (await post('/v1/register', runtime.adminToken, { workspace:'a', alias:'builder', provider:'codex' })).json();
  const b = await (await post('/v1/register', runtime.adminToken, { workspace:'a', alias:'reviewer', provider:'claude' })).json();
  assert.equal((await post('/v1/register', a.token, { workspace:'a', alias:'fake', provider:'other' })).status, 401);
  assert.equal((await post('/v1/session', 'invalid', { operation:'sessions', args:{} })).status, 401);
  assert.equal((await post('/v1/session', a.token, { operation:'sessions', args:{} }, { origin:'https://evil.example' })).status, 403);
  assert.equal((await post('/v1/session', a.token, { operation:'send', args:{ to:b.session.id, body:'hello', key:'k', sender:b.session.id } })).status, 400);
  const sent = await (await post('/v1/session', a.token, { operation:'send', args:{ to:b.session.id, body:'hello', key:'k' } })).json();
  assert.ok(sent.id);
  assert.equal((await (await post('/v1/session',b.token,{operation:'receive',args:{}})).json()).items.length,0);
  await new Promise(resolve=>setTimeout(resolve,5100));
  const inbox = await (await post('/v1/session', b.token, { operation:'receive', args:{} })).json();
  assert.equal(inbox.items[0].sender, a.session.id);
  assert.equal(inbox.items[0].body, 'hello');
});

test('runtime rejects duplicate daemon and oversized requests without revealing tokens', async t => {
  const { dir, runtime, post } = await setup(t);
  await assert.rejects(startRuntime(dir), /runtime_locked/);
  assert.equal((await post('/v1/session', runtime.adminToken, { body: 'x'.repeat(140000) })).status, 413);
  const endpoint = readFileSync(join(dir, 'connection.json'), 'utf8');
  assert.ok(!endpoint.includes(runtime.adminToken));
  assert.ok(!readFileSync(join(dir, 'runtime.sqlite'), 'utf8').includes(runtime.adminToken));
});

test('session discovery paginates without hiding identities or exceeding response budget', async t => {
  const { runtime, post } = await setup(t);
  let token = '';
  for (let i=0;i<105;i++) {
    const result = await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:String(i).padStart(3,'0')+'x'.repeat(190),provider:'codex'})).json();
    token ||= result.token;
  }
  const ids = new Set<string>(); let after=''; let more=true;
  while (more) {
    const response = await post('/v1/session',token,{operation:'sessions',args:{after,limit:10}});
    assert.equal(response.status,200);
    const page = await response.json();
    for (const row of page.items) ids.add(row.id);
    after=page.next; more=page.has_more;
  }
  assert.equal(ids.size,105);
});

test('oversized encoded criteria is rejected before task mutation', async t => {
  const {runtime,post} = await setup(t);
  const a = await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:'builder',provider:'codex'})).json();
  const response = await post('/v1/session',a.token,{operation:'task_create',args:{title:'test',criteria:'\u001b'.repeat(4000),key:'k'}});
  assert.equal(response.status,400);
  const tasks = await (await post('/v1/session',a.token,{operation:'tasks',args:{}})).json();
  assert.equal(tasks.items.length,0);
});

test('clean daemon restart preserves session credentials and messages at a new endpoint', async t => {
  const dir=mkdtempSync(join(tmpdir(),'durebak-restart-'));
  let runtime=await startRuntime(dir);
  t.after(async()=>{ await runtime.close(); rmSync(dir,{recursive:true,force:true}); });
  const a=await (await fetch(runtime.url+'/v1/register',{method:'POST',headers:{authorization:`Bearer ${runtime.adminToken}`,'content-type':'application/json'},body:JSON.stringify({workspace:'a',alias:'worker',provider:'codex'})})).json();
  const post=async(operation:string,args:unknown)=>fetch(runtime.url+'/v1/session',{method:'POST',headers:{authorization:`Bearer ${a.token}`,'content-type':'application/json'},body:JSON.stringify({operation,args})});
  await post('send',{to:a.session.id,body:'durable',key:'k'});
  await runtime.close(); runtime=await startRuntime(dir);
  await new Promise(resolve=>setTimeout(resolve,5100));
  const response=await post('receive',{});
  assert.equal(response.status,200);
  assert.equal((await response.json()).items[0].body,'durable');
});

test('escaped message and artifact bodies can be fully paged within the HTTP budget', async t => {
  const {runtime,post}=await setup(t);
  const a=await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:'reader',provider:'codex'})).json();
  const call=async(operation:string,args:unknown)=>{
    const response=await post('/v1/session',a.token,{operation,args});
    assert.equal(response.status,200,`${operation} must fit response budget`);
    return response.json();
  };
  const content=('\u0000'.repeat(3000)+'가🙂').repeat(2);
  const artifact=await call('artifact_put',{content});
  const message=await call('send',{to:a.session.id,body:content,key:'escaped'});
  for(const [operation,id] of [['artifact_read',artifact.hash],['message_read',message.id]]) {
    let offset=0,restored='';
    do {
      const page=await call(operation!,{id,offset,limit:4096});
      assert.ok(page.next>offset);restored+=page.content;offset=page.next;
      if(!page.has_more)break;
    }while(offset<Buffer.byteLength(content));
    assert.equal(restored,content);
  }
});

test('audit inbox automatically fits escaped previews without losing pagination entries', async t => {
  const {runtime,post}=await setup(t);
  const a=await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:'reader',provider:'codex'})).json();
  const call=async(operation:string,args:unknown)=>{
    const response=await post('/v1/session',a.token,{operation,args});
    assert.equal(response.status,200);return response.json();
  };
  for(let i=0;i<20;i++)await call('send',{to:a.session.id,body:'\u0000'.repeat(512),key:String(i),priority:'high'});
  await new Promise(resolve=>setTimeout(resolve,1100));
  await call('receive',{limit:10});await call('receive',{limit:10});
  let after=0;const ids=new Set<string>();
  for(let i=0;i<20;i++){
    const page=await call('inbox',{after,limit:20});
    for(const item of page.items)ids.add(item.id);
    assert.ok(page.next>after);after=page.next;if(!page.has_more)break;
  }
  assert.equal(ids.size,20);
});

test('revocation during a slow request body prevents the pending mutation', async t => {
  const {request}=await import('node:http');
  const {default:EventEmitter}=await import('node:events');
  const {runtime,post}=await setup(t);
  const a=await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:'slow',provider:'codex'})).json();
  const b=await (await post('/v1/register',runtime.adminToken,{workspace:'a',alias:'recipient',provider:'claude'})).json();
  const payload=JSON.stringify({operation:'send',args:{to:b.session.id,body:'must not be queued',key:'revoked'}});
  let resolveResponse!:(value:number)=>void;
  const responseStatus=new Promise<number>(resolve=>{resolveResponse=resolve;});
  const req=request(runtime.url+'/v1/session',{method:'POST',headers:{authorization:`Bearer ${a.token}`,'content-type':'application/json','content-length':Buffer.byteLength(payload),expect:'100-continue'}},res=>{res.resume();resolveResponse(res.statusCode!);});
  t.after(()=>req.destroy());
  const acceptedHeaders=EventEmitter.once(req,'continue');req.flushHeaders();await acceptedHeaders;
  assert.equal((await post('/v1/revoke',runtime.adminToken,{id:a.session.id})).status,200);
  req.end(payload);
  assert.equal(await responseStatus,401);
  const queue=await (await post('/v1/session',b.token,{operation:'queue_status',args:{}})).json();
  assert.equal(queue.counts.queued??0,0);
});
