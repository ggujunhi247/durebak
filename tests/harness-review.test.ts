import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {request} from '../src/client.js';
import {startRuntime,type Operation} from '../src/runtime.js';
import {Store} from '../src/store.js';

test('review recorded by MCP and deployment reported by HTTP appear separately on the participant dashboard',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-review-e2e-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.now()-30000;
 const store=new Store(dir,{now:()=>now});
 const creator=store.register('workspace','reviewer','codex');
 const author=store.register('workspace','author','claude');
 const other=store.register('workspace','other','opencode');
 let id:string, revisionId:string;
 try{
  const q=store.requestCreate(creator.session,{to:author.session.id,body:'review request',key:'request',task:{title:'Review result',criteria:'Verify package digest'}});
  id=q.id;
  now+=5000;
  store.receive(author.session);
  store.requestTransition(author.session,id,1,'accepted',{expectedTaskVersion:1});
  const upload=store.attachmentPut(author.session,{name:'result.txt',content:'private revision',key:'upload'});
  revisionId=store.requestRevision(author.session,{id,version:2,expectedTaskVersion:2,uploadId:upload.id,key:'revision'}).id;
  now+=5000;
  store.receive(creator.session);
 }finally{store.close();}
 const runtime=await startRuntime(dir);
 const client=new Client({name:'review-test',version:'1.0.0'});
 try{
  const file=join(dir,'reviewer.json');
  writeFileSync(file,JSON.stringify({data_dir:dir,...creator}),{mode:0o600});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'mcp','--session',file],stderr:'pipe'}));
  const decision=await client.callTool({name:'durebak_request_review',arguments:{id,revisionId,decision:'approved',note:'review detail',key:'review'}});
  assert.ok(!decision.isError,JSON.stringify(decision));
  const call=(token:string,operation:Operation,args:unknown)=>request(dir,token,'/v1/session',{operation,args});
  const evidenceUrl='https://example.com/releases/1';
  await call(creator.token,'request_deployment',{id,revisionId,commitSha:'a'.repeat(40),artifactSha:'b'.repeat(64),outcome:'published',evidenceUrl,key:'deployment'});
  const status=await call(author.token,'request_review_status',{id}) as {status:string;latest_deployment:{outcome:string}};
  assert.equal(status.status,'approved');
  assert.equal(status.latest_deployment.outcome,'published');
  const dashboard=await call(author.token,'collaboration_status',{}) as {requests:{items:Record<string,unknown>[]} };
  const row=dashboard.requests.items.find(item=>item.id===id);
  assert.equal(row?.execution,'not_observed');
  assert.equal(row?.execution_source,null);
  assert.equal(row?.verification,'unverified');
  assert.equal(row?.review,'approved');
  assert.equal(row?.deployment,'reported_published');
  assert.doesNotMatch(JSON.stringify(row),/review detail|example\.com|private revision/);
  await assert.rejects(call(other.token,'request_review_status',{id}),/not_found/);
 }finally{await client.close();await runtime.close();}
});
