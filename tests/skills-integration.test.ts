import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startRuntime} from '../src/runtime.js';
import {adminCall} from '../src/client.js';
import {createSetup} from '../src/setup.js';
const exec=promisify(execFile),cli=resolve('dist/cli.js');
test('installed CLI skills and three generated MCP bridges exchange correlated requests in all six directions',async t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-skill-protocol ')),data=join(root,'data'),runtime=await startRuntime(data),clients:Client[]=[];
 t.after(async()=>{for(const c of clients)await c.close();await runtime.close();rmSync(root,{recursive:true,force:true});});
 const installed=JSON.parse((await exec(process.execPath,[cli,'skills','--harness','all','--workspace',root])).stdout);assert.equal(installed.created.length,5);assert.equal(installed.mcp_connected,false);
 const repeated=JSON.parse((await exec(process.execPath,[cli,'skills','--harness','all','--workspace',root])).stdout);assert.deepEqual(repeated.created,[]);
 const peers:{id:string;client:Client}[]=[];
 for(const host of ['codex','claude-code','opencode'] as const){
  const registered=await adminCall(data,'/v1/register',{workspace:'same-workspace',alias:host,provider:host==='claude-code'?'claude':host}) as {session:{id:string};token:string};
  const file=join(root,host+'.session');writeFileSync(file,JSON.stringify({data_dir:data,...registered}),{mode:0o600});const config=join(root,host+'.config');createSetup(host,file,config);const text=readFileSync(config,'utf8');assert.ok(!text.includes(registered.token));
  const bridge=host==='codex'?{command:JSON.parse(text.match(/^command = (.+)$/m)![1]!),args:JSON.parse(text.match(/^args = (.+)$/m)![1]!)}:host==='claude-code'?JSON.parse(text).mcpServers.durebak:{command:JSON.parse(text).mcp.durebak.command[0],args:JSON.parse(text).mcp.durebak.command.slice(1)};
  const client=new Client({name:'skill-protocol-'+host,version:'1'});clients.push(client);await client.connect(new StdioClientTransport({...bridge,stderr:'pipe'}));peers.push({id:registered.session.id,client});
 }
 const call=async(peer:typeof peers[number],op:string,args:Record<string,unknown>={})=>{const response=await peer.client.callTool({name:'durebak_'+op,arguments:args});assert.ok(!response.isError,JSON.stringify(response));return JSON.parse((response.content as {text:string}[])[0]!.text);};
 for(const p of peers){assert.equal((await call(p,'runtime_info')).session_id,p.id);assert.equal((await call(p,'sessions')).items.length,3);}
 const routes=new Map<string,{sender:typeof peers[number];recipient:typeof peers[number];body:string}>();
 for(const sender of peers)for(const recipient of peers.filter(p=>p!==sender)){
  const body='Explicit review from '+sender.id+' to '+recipient.id,input={to:recipient.id,body,key:sender.id+'-'+recipient.id,priority:'urgent',urgentReason:'protocol fixture immediate delivery'};
  const preview=await call(sender,'request_preview',{request:input}),q=await call(sender,'request_create',{...input,previewId:preview.id});routes.set(q.id,{sender,recipient,body});
 }
 assert.equal(routes.size,6);
 for(const recipient of peers){const batch=await call(recipient,'receive');assert.equal(batch.items.length,2);for(const item of batch.items){
  const route=routes.get(item.request_id)!;assert.equal(route.recipient.id,recipient.id);assert.equal(item.sender,route.sender.id);assert.equal((await call(recipient,'message_read',{id:item.id})).content,route.body);
  await call(recipient,'ack',{id:item.id,receipt:item.receipt});const q=await call(recipient,'request_get',{id:item.request_id});await call(recipient,'request_transition',{id:q.id,version:q.version,state:'accepted'});const accepted=await call(recipient,'request_get',{id:q.id});await call(recipient,'request_message',{id:q.id,version:accepted.version,kind:'result',body:'Review findings for '+q.id,key:'result'});
 }}
 await new Promise(r=>setTimeout(r,5100));
 for(const sender of peers){const batch=await call(sender,'receive');assert.equal(batch.items.length,2);for(const item of batch.items){const route=routes.get(item.request_id)!;assert.equal(item.sender,route.recipient.id);assert.equal(route.sender.id,sender.id);assert.equal(item.message_kind,'result');assert.equal((await call(sender,'request_get',{id:item.request_id})).state,'completed');await call(sender,'ack',{id:item.id,receipt:item.receipt});}}
 assert.ok(existsSync(join(root,'.agents/skills/durebak/references/operations.md')));assert.equal((await call(peers[0]!,'managed_status')).auto_wake,false);
});
