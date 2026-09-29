import test from 'node:test';
import assert from 'node:assert/strict';
import { runBounded, inspectExchange } from '../scripts/lib/host-lab.mjs';

test('a hanging subprocess is terminated within the explicit deadline', async () => {
  const result = await runBounded(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100});
  assert.equal(result.reason,'timeout');
  assert.notEqual(result.code,0);
});

test('excessive subprocess output is stopped without retaining unlimited transcripts', async () => {
  const result = await runBounded(process.execPath,['-e',"process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"],{timeoutMs:1000,maxBytes:1024});
  assert.equal(result.reason,'output_limit');
  assert.ok(Buffer.byteLength(result.stdout)<=1024);
});

test('host success text cannot replace persisted correlated messages and task evidence', () => {
  const fixture={worker:'worker',reviewer:'reviewer',request:{id:'request',sender:'worker',recipient:'reviewer',status:'read',body:'candidate'},reply:{id:'reply',sender:'reviewer',recipient:'worker',reply_to:'request',body:'correction',status:'read'},task:{state:'completed',owner:'worker',result_hash:'expected'},artifact:{content:'42'},expected:{request:'candidate',reply:'correction',hash:'expected',content:'42'}};
  assert.equal(inspectExchange(fixture).every(x=>x.passed),true);
  const wrong={...fixture,reply:{...fixture.reply,reply_to:'unrelated'}};
  assert.equal(inspectExchange(wrong).find(x=>x.name==='correlated_reply').passed,false);
  const stale={...fixture,task:{...fixture.task,result_hash:'stale'}};
  assert.equal(inspectExchange(stale).find(x=>x.name==='result_hash').passed,false);
});

test('a failed MCP tool is reported even when the host process exits successfully', async () => {
  const { summarizeCodex } = await import('../scripts/lib/host-lab.mjs');
  const summary=summarizeCodex([
    {type:'item.completed',item:{type:'mcp_tool_call',server:'durebak',tool:'durebak_send',status:'failed',arguments:{secret:'not-for-report'},error:{message:'user cancelled MCP tool call'}}},
    {type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:10}},
  ]);
  assert.equal(summary.failed,true);
  assert.deepEqual(summary.tools,[{server:'durebak',tool:'durebak_send',status:'failed'}]);
  assert.equal(JSON.stringify(summary).includes('not-for-report'),false);
  assert.equal(summary.usage.input_tokens,100);
});


test('reply must be acknowledged, not merely present', () => {
  const checks=inspectExchange({worker:'a',reviewer:'b',request:{id:'r',sender:'a',recipient:'b',body:'q',status:'read'},reply:{sender:'b',recipient:'a',reply_to:'r',body:'answer',status:'sent'},task:{state:'completed',owner:'a',result_hash:'h'},artifact:{content:'42'},expected:{request:'q',reply:'answer',hash:'h',content:'42'}});
  assert.equal(checks.some(check=>!check.passed),true);
});

test('timed-out host cannot leave a SIGTERM-resistant descendant running', async t => {
  const childCode="process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const parentCode=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});setTimeout(()=>console.log(child.pid),100);setInterval(()=>{},1000)`;
  const result=await runBounded(process.execPath,['-e',parentCode],{timeoutMs:400});
  const pid=Number(result.stdout.trim());
  assert.ok(pid>0);
  t.after(()=>{try{process.kill(pid,'SIGKILL');}catch{}});
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('streamed authentication errors stop retrying before the general deadline', async () => {
  const result=await runBounded(process.execPath,['-e',`console.log(JSON.stringify({error:'authentication_failed'}));setInterval(()=>{},1000)`],{timeoutMs:10000,classifyLine:line=>JSON.parse(line).error==='authentication_failed'?'authentication_failed':null});
  assert.equal(result.reason,'authentication_failed');
  assert.ok(result.duration_ms<5000);
});

test('an already cancelled run never attempts to launch the command', async () => {
  const controller=new AbortController();controller.abort();
  const result=await runBounded('this-command-must-never-be-spawned',[],{signal:controller.signal});
  assert.equal(result.reason,'cancelled');
  assert.equal(result.started,false);
});

test('report destination is reserved exclusively before any host execution', async t => {
  const {reserveReport}=await import('../scripts/lib/host-lab.mjs');
  const {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'durebak-report-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'report.json');writeFileSync(file,'keep');
  assert.throws(()=>reserveReport(file),{code:'EEXIST'});
  assert.equal(readFileSync(file,'utf8'),'keep');
  assert.throws(()=>reserveReport(join(dir,'missing','report.json')),{code:'ENOENT'});
  const output=join(dir,'new.json');const sink=reserveReport(output);
  assert.throws(()=>reserveReport(output),{code:'EEXIST'});
  sink.write({status:'passed'});
  assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),{status:'passed'});
  assert.equal(statSync(output).mode&0o777,0o600);
});

test('outer cancellation gives nested host termination time to finish',async t=>{
  const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');
  const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const dir=mkdtempSync(join(tmpdir(),'durebak-nested-')),file=join(dir,'pid');let pid;
  t.after(()=>{if(pid){try{process.kill(-pid,'SIGKILL');}catch{}}rmSync(dir,{recursive:true,force:true});});
  const host=`require('node:fs').writeFileSync(${JSON.stringify(file)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const outer=`import {runBounded} from ${JSON.stringify(new URL('../scripts/lib/host-lab.mjs',import.meta.url).href)};const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());await runBounded(process.execPath,['-e',${JSON.stringify(host)}],{signal:controller.signal,timeoutMs:90000});`;
  const result=await runBounded(process.execPath,['--input-type=module','-e',outer],{timeoutMs:600,killGraceMs:3000});
  pid=Number(readFileSync(file,'utf8'));assert.equal(result.reason,'timeout');
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
