import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID,createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startRuntime } from '../dist/runtime.js';
import { safeFailure } from './lib/host-adapters/common.mjs';
import { getHostAdapter,summarizeFrames } from './lib/host-adapters/index.mjs';
import { adminCall,sessionCall } from '../dist/client.js';
import { runBounded,inspectExchange,reserveReport } from './lib/host-lab.mjs';

const {values}=parseArgs({options:{mode:{type:'string',default:'mcp'},worker:{type:'string',default:'codex'},reviewer:{type:'string',default:'claude'},'worker-model':{type:'string'},'reviewer-model':{type:'string'},report:{type:'string'},'timeout-ms':{type:'string',default:'90000'}}});
if(!['mcp','live'].includes(values.mode))throw new Error('mode must be mcp or live');
values.worker=getHostAdapter(values.worker).id;values.reviewer=getHostAdapter(values.reviewer).id;
const timeoutMs=Number(values['timeout-ms']);
if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)throw new Error('timeout must be 1000..180000 ms');
const reportSink=values.report?reserveReport(resolve(values.report)):null;
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const cli=join(root,'dist','cli.js');
const directory=mkdtempSync(join(tmpdir(),'durebak-host-lab-'));
const workspace=join(directory,'workspace');mkdirSync(workspace,{mode:0o700});
const data=join(directory,'data');
const nonce=randomUUID();
const expected={request:`Review candidate 41 for 6*7. Probe ${nonce}`,reply:`Correction: 6*7=42. Probe ${nonce}`,content:`Verified result: 6*7=42. Probe ${nonce}`};
expected.hash=createHash('sha256').update(expected.content).digest('hex');
const report={schema_version:2,mode:values.mode,worker:values.worker,reviewer:values.reviewer,started_at:new Date().toISOString(),node:process.version,platform:process.platform,status:'running',hosts:{},steps:[],checks:[],warnings:[],native_session_continuity:false,limitations:['OpenCode uses isolated native state; stored global OAuth is not copied.','Each live invocation is a new native host run; worker runs share one Durebak identity.','This tests cooperative routing, not provider auto-wake or a production workflow scheduler.']};
let runtime;const clients=[];const controller=new AbortController();
const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
const emit=(text)=>process.stderr.write(`[host-lab] ${text}\n`);
const call=async(client,name,args)=>{
  const response=await client.callTool({name:`durebak_${name}`,arguments:args});
  if(response.isError)throw new Error(`mcp_${name}_failed`);
  return JSON.parse(response.content[0].text);
};
const connect=async(file)=>{
  const client=new Client({name:'durebak-host-lab',version:'1.0.0'});
  clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'mcp','--session',file],stderr:'pipe'}));
  return client;
};
async function register(alias,provider) {
  const result=await adminCall(data,'/v1/register',{workspace:createHash('sha256').update(workspace).digest('hex'),alias,provider});
  const file=join(directory,`session-${alias}.json`);
  writeFileSync(file,JSON.stringify({data_dir:data,...result}),{mode:0o600});
  return {file,...result};
}
async function hostStep(provider,label,file,allowedTools,prompt) {
  controller.signal.throwIfAborted();
  emit(`${label}: running ${provider} (deadline ${timeoutMs} ms)`);
  const adapter=getHostAdapter(provider);
  const model=label==='review'?values['reviewer-model']:values['worker-model'];
  let invocation;
  try {invocation=adapter.buildInvocation({sessionFile:file,workspace,configDir:directory,allowedTools,model});}
  catch(error){if(error.message==='model_required'){report.blocked_harness=provider;report.status='blocked';}throw error;}
  if(adapter.verifyConfiguration&&!await adapter.verifyConfiguration(invocation,{cwd:workspace,signal:controller.signal})){
    report.blocked_harness=provider;report.status='blocked';throw new Error('configuration_unverified');
  }
  const result=await runBounded(invocation.command,invocation.args,{cwd:workspace,env:invocation.env,input:`Synthetic Durebak integration test. Use only the provided MCP tools. No shell, files, web, other servers, or delegation. Perform exactly the requested tool actions, then finish briefly.\n${prompt}\n`,timeoutMs,signal:controller.signal,classifyLine:line=>adapter.classifyFrame(JSON.parse(line))?.error==='authentication_failed'?'authentication_failed':null});
  const frames=result.stdout.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
  const summary=summarizeFrames(provider,frames);
  const step={label,harness:provider,duration_ms:result.duration_ms,exit_code:result.code,reason:result.reason??summary.error,reported_usage:summary.usage,reported_cost_usd:summary.cost_usd??null,tool_calls:summary.tools,model_selection:model?'explicit':'host_default',budget_enforcement:provider==='claude-code'?'max_1_usd':'deadline_only'};
  report.steps.push(step);
  if(result.code!==0||step.reason){
    if(step.reason==='authentication_failed'){report.status='blocked';report.blocked_harness=provider;}
    emit(`${label}: ${step.reason??'host_failed'} (raw transcripts discarded)`);
    throw new Error(step.reason??'host_failed');
  }
}
async function waitForQueue(file) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    controller.signal.throwIfAborted();
    const status=await sessionCall(file,'queue_status',{});
    if(status.retry_after_ms===0)return;
    if(status.retry_after_ms===null)throw new Error('queue_not_pending');
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000,status.retry_after_ms)));
  }
  throw new Error('queue_wait_timeout');
}
try {
  controller.signal.throwIfAborted();
  if(values.mode==='live'){
    for(const provider of new Set([values.worker,values.reviewer])){
      const probe=await getHostAdapter(provider).probe({signal:controller.signal});
      report.hosts[provider]=probe;controller.signal.throwIfAborted();
      if(!probe.installed||probe.authEvidence==='none'){
        report.status='blocked';report.blocked_harness=provider;
        throw new Error(!probe.installed?'not_installed':'authentication_required');
      }
    }
  }
  controller.signal.throwIfAborted();
  runtime=await startRuntime(data);
  const worker=await register('worker',values.mode==='live'?(values.worker==='claude-code'?'claude':values.worker):'other');
  const reviewer=await register('reviewer',values.mode==='live'?(values.reviewer==='claude-code'?'claude':values.reviewer):'other');
  const task=await sessionCall(worker.file,'task_create',{title:'Review and correct arithmetic candidate',criteria:'Persist the exact corrected result only after a correlated reviewer correction.',key:'probe-task'});
  if(values.mode==='live'){
    await hostStep(values.worker,'request',worker.file,['send'],`Call durebak_send with exactly ${JSON.stringify({to:reviewer.session.id,body:expected.request,key:'probe-request'})}.`);
    await waitForQueue(reviewer.file);
    await hostStep(values.reviewer,'review',reviewer.file,['receive','ack','send'],`Call durebak_receive with {"limit":5}. Verify the request says candidate 41 for 6*7. Immediately call durebak_ack with that message id and its receipt. Then call durebak_send with to=${worker.session.id}, replyTo equal to the received id, body exactly ${JSON.stringify(expected.reply)}, and key "probe-reply".`);
    await waitForQueue(worker.file);
    await hostStep(values.worker,'submit',worker.file,['receive','ack','task_get','task_claim','artifact_put','task_complete'],`Call durebak_receive with {"limit":5} and immediately acknowledge the correction using its id and receipt. Get task ${task.id}, claim its current version, put an artifact with content exactly ${JSON.stringify(expected.content)}, then complete that task using the version returned by claim and the hash returned by artifact_put. Do not invent hashes, receipts or versions.`);
  } else {
    const a=await connect(worker.file),b=await connect(reviewer.file);
    const sent=await call(a,'send',{to:reviewer.session.id,body:expected.request,key:'probe-request'});
    await waitForQueue(reviewer.file);
    const requestBatch=await call(b,'receive',{});await call(b,'ack',{id:sent.id,receipt:requestBatch.items[0].receipt});
    await call(b,'send',{to:worker.session.id,replyTo:sent.id,body:expected.reply,key:'probe-reply'});
    await waitForQueue(worker.file);
    const replies=await call(a,'receive',{});await call(a,'ack',{id:replies.items[0].id,receipt:replies.items[0].receipt});
    const claimed=await call(a,'task_claim',{id:task.id,version:1});
    const artifact=await call(a,'artifact_put',{content:expected.content});
    await call(a,'task_complete',{id:task.id,version:claimed.version,hash:artifact.hash});
    report.steps.push({label:'scripted_mcp_exchange',provider:'official-mcp-sdk',status:'passed'});
  }
  const request=(await sessionCall(reviewer.file,'inbox',{})).items[0];
  const reply=(await sessionCall(worker.file,'inbox',{})).items[0];
  const completed=await sessionCall(worker.file,'task_get',{id:task.id});
  const artifact=completed.result_hash?await sessionCall(worker.file,'artifact_read',{id:completed.result_hash}):null;
  report.checks=inspectExchange({worker:worker.session.id,reviewer:reviewer.session.id,request,reply,task:completed,artifact,expected});
  const repeated=await sessionCall(worker.file,'artifact_read',{id:completed.result_hash});
  const record=await sessionCall(worker.file,'record',{id:task.id});
  report.checks.push({name:'derived_cache_hit',passed:repeated.cache_hit===true},{name:'zero_model_record',passed:record.llm_calls===0&&record.markdown.includes(completed.result_hash)});
  report.status=report.checks.every(check=>check.passed)?'passed':'failed';
} catch(error) {
  report.status=controller.signal.aborted?'cancelled':report.status==='blocked'?'blocked':'failed';report.error=controller.signal.aborted?'cancelled':safeFailure(error.message);
} finally {
  const cleanup=await Promise.allSettled([...clients.map(client=>client.close()),runtime?.close()]);
  try{rmSync(directory,{recursive:true,force:true});}catch{cleanup.push({status:'rejected'});}
  if(cleanup.some(result=>result.status==='rejected')){report.status='failed';report.error='cleanup_failed';}
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  report.finished_at=new Date().toISOString();
  try{reportSink?.write(report);}finally{reportSink?.close();}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status!=='passed')process.exitCode=1;
}
