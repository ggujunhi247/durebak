import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startRuntime } from '../src/runtime.js';
const exec = promisify(execFile);
const cli = resolve('src/cli.ts');

async function run(...args: string[]) { return exec(process.execPath, ['--import', 'tsx', cli, ...args]); }

test('two independent MCP processes exchange a request and result through CLI-issued identities', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'durebak-e2e-'));
  const runtime = await startRuntime(join(dir, 'data'));
  const clients: Client[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await runtime.close(); rmSync(dir, { recursive:true, force:true }); });
  const aFile = join(dir, 'session-a.json'); const bFile = join(dir, 'session-b.json');
  const a = JSON.parse((await run('register', '--data-dir', join(dir,'data'), '--workspace', dir, '--alias','builder','--provider','codex','--out',aFile)).stdout);
  const b = JSON.parse((await run('register', '--data-dir', join(dir,'data'), '--workspace', dir, '--alias','reviewer','--provider','claude','--out',bFile)).stdout);
  assert.ok(!JSON.stringify(a).includes(JSON.parse(readFileSync(aFile,'utf8')).token));
  for (const file of [aFile, bFile]) {
    const client = new Client({ name:'durebak-test', version:'1.0.0' });
    await client.connect(new StdioClientTransport({ command:process.execPath, args:['--import','tsx',cli,'mcp','--session',file], stderr:'pipe' }));
    clients.push(client);
    assert.equal(client.getServerVersion()?.version, JSON.parse(readFileSync('package.json','utf8')).version);
  }
  const [builder, reviewer] = clients as [Client, Client];
  const tools = await builder.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'durebak_send'));
  assert.ok(!tools.tools.some(tool => tool.name.includes('register')));
  const call = async (client:Client, name:string, args:Record<string,unknown>) => {
    const result = await client.callTool({ name:'durebak_'+name, arguments:args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as {text:string}[])[0]!.text);
  };
  const sent = await call(builder, 'send', { to:b.session.id, body:'Please review', key:'request' });
  await new Promise(resolve=>setTimeout(resolve,5100));
  const inbox = await call(reviewer, 'receive', {});
  assert.equal(inbox.items[0].id, sent.id);
  await call(reviewer, 'ack', { id:sent.id, receipt:inbox.items[0].receipt });
  await call(reviewer, 'send', { to:a.session.id, body:'Found an edge case', key:'reply', replyTo:sent.id });
  await new Promise(resolve=>setTimeout(resolve,5100));
  assert.equal((await call(builder, 'receive', {})).items[0].body, 'Found an edge case');
  const task = await call(builder, 'task_create', { title:'Fix edge case', criteria:'Regression passes', key:'task' });
  const claimed = await call(reviewer, 'task_claim', { id:task.id, version:task.version });
  const artifact = await call(reviewer, 'artifact_put', { content:'Test result: passed' });
  await call(reviewer, 'task_complete', { id:task.id, version:claimed.version, hash:artifact.hash });
  const exported = join(dir, 'record.md');
  await run('export', task.id, '--session', aFile, '--out', exported);
  assert.match(readFileSync(exported,'utf8'), /State: completed/);
  await run('revoke', b.session.id, '--data-dir',join(dir,'data'));
  const revoked = await reviewer.callTool({ name:'durebak_inbox', arguments:{} });
  assert.equal(revoked.isError,true);
  // Replacing a config path must not rebind an already running bridge.
  writeFileSync(aFile, readFileSync(bFile));
  assert.equal((await call(builder, 'task_get', { id:task.id })).state, 'completed');
});

test('new harness flags preserve legacy credentials and reject conflicts before mutations',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-harness-cli-'));const data=join(dir,'data');
 const runtime=await startRuntime(data);t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
 const file=join(dir,'session.json');
 await run('register','--data-dir',data,'--workspace',dir,'--alias','a','--harness','claude-code','--provider','claude','--out',file);
 const credential=JSON.parse(readFileSync(file,'utf8'));assert.equal(credential.session.provider,'claude');
 await run('setup','--harness','claude-code','--host','claude','--session',file,'--out',join(dir,'valid.json'));
 const conflict=join(dir,'conflict.json');
 await assert.rejects(run('register','--data-dir',data,'--workspace',dir,'--alias','bad','--harness','codex','--provider','claude','--out',conflict),/conflicting_harness/);
 await assert.rejects(run('setup','--harness','codex','--host','claude','--session',file,'--out',conflict),/conflicting_harness/);
 assert.throws(()=>readFileSync(conflict),/ENOENT/);
 const post=async(body:unknown)=>fetch(runtime.url+'/v1/register',{method:'POST',headers:{authorization:`Bearer ${runtime.adminToken}`,'content-type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{workspace:'w',alias:'http'},{workspace:'w',alias:'http',harness:'codex',provider:'claude'}])assert.equal((await post(body)).ok,false);
 const result=await post({workspace:'w',alias:'http',harness:'opencode'});assert.equal(result.ok,true);assert.equal((await result.json() as any).session.provider,'opencode');
});

test('managed credentials and immutable record snapshots stay with the session data directory',async t=>{
  const {statSync}=await import('node:fs');
  const dir=mkdtempSync(join(tmpdir(),'durebak-managed-')),data=join(dir,'data');
  let runtime=await startRuntime(data);
  t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  const registered=JSON.parse((await run('register','--data-dir',data,'--workspace',dir,'--alias','managed','--harness','codex')).stdout);
  const file=registered.credential_file;
  assert.equal(file.startsWith(join(data,'credentials')+'/'),true);assert.equal(statSync(file).mode&0o777,0o600);
  const paths=JSON.parse((await run('paths','--session',file,'--data-dir',join(dir,'unrelated'))).stdout);
  assert.equal(paths.data_dir,data);assert.equal(paths.records_dir,join(data,'records'));
  const task=JSON.parse((await run('call','task_create','--session',file,'--json',JSON.stringify({title:'Remember review',criteria:'Keep history',key:'managed-task'}))).stdout);
  const first=JSON.parse((await run('export',task.id,'--session',file)).stdout);
  assert.equal(first.path.startsWith(join(data,'records')+'/'),true);
  assert.equal(statSync(first.path).mode&0o777,0o600);
  assert.equal(JSON.parse((await run('export',task.id,'--session',file)).stdout).status,'unchanged');
  await run('call','task_claim','--session',file,'--json',JSON.stringify({id:task.id,version:task.version}));
  const second=JSON.parse((await run('export',task.id,'--session',file)).stdout);
  assert.notEqual(second.path,first.path);assert.match(readFileSync(first.path,'utf8'),/State: pending/);assert.match(readFileSync(second.path,'utf8'),/State: claimed/);
  await runtime.close();runtime=await startRuntime(data);
  const events=JSON.parse((await run('call','events','--session',file)).stdout);
  assert.ok(events.items.some((e:{kind:string})=>e.kind==='task.claimed'));
  assert.equal(JSON.parse((await run('export',task.id,'--session',file)).stdout).status,'unchanged');
});

test('an explicitly empty output path is rejected instead of selecting managed storage',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'durebak-empty-out-')),data=join(dir,'data');
  const runtime=await startRuntime(data);t.after(async()=>{await runtime.close();rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(run('register','--data-dir',data,'--workspace',dir,'--alias','empty-out','--harness','codex','--out',''),/missing_out/);
});
