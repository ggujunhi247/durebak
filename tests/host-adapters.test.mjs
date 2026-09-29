import test from 'node:test';
import assert from 'node:assert/strict';
import { getHostAdapter, summarizeFrames } from '../scripts/lib/host-adapters/index.mjs';

test('all three harnesses have symmetric adapters and legacy claude alias',()=>{
  for(const id of ['codex','claude-code','opencode']) {
    const adapter=getHostAdapter(id);assert.equal(adapter.id,id);
    for(const method of ['probe','buildInvocation','classifyFrame'])assert.equal(typeof adapter[method],'function');
  }
  assert.equal(getHostAdapter('claude').id,'claude-code');
  assert.throws(()=>getHostAdapter('other'));
});
test('unknown events and missing usage are not fabricated as successful evidence',()=>{
  for(const id of ['codex','claude-code','opencode']){
    assert.equal(getHostAdapter(id).classifyFrame({type:'future-event',text:'secret'}),null);
    assert.deepEqual(summarizeFrames(id,[]),{tools:[],usage:null,error:null});
  }
});
test('authentication failure and failed tools survive successful process exits without retaining text',()=>{
  assert.equal(summarizeFrames('claude',[{type:'result',error:'authentication_failed',result:'secret'}]).error,'authentication_failed');
  const codex=summarizeFrames('codex',[{type:'item.completed',item:{type:'mcp_tool_call',server:'durebak',tool:'durebak_send',status:'failed',arguments:'secret'}}]);
  assert.equal(codex.error,'tool_failed');assert.ok(!JSON.stringify(codex).includes('secret'));
  const open=summarizeFrames('opencode',[{type:'tool_use',part:{tool:'durebak_durebak_send',state:{status:'error',input:'secret'}}}]);
  assert.equal(open.error,'tool_failed');assert.ok(!JSON.stringify(open).includes('secret'));
});
test('usage is allowlisted and retains harness semantics, not arbitrary fields',()=>{
  const summary=summarizeFrames('codex',[{type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:8,output_tokens:2,secret:'private'}}]);
  assert.equal(summary.usage.source,'codex');assert.equal(summary.usage.input_tokens,12);
  assert.ok(!JSON.stringify(summary).includes('private'));
});

test('effective OpenCode config rejects changed identity and broadened permissions',async()=>{
  const {configurationMatches}=await import('../scripts/lib/host-adapters/opencode.mjs');
  const expected={mcp:{durebak:{command:['node','bridge','--session','private']}},permission:{'*':'deny',durebak_durebak_send:'allow'},model:'example/model'};
  assert.equal(configurationMatches({...expected},expected),true);
  for(const changed of [{mcp:{}},{permission:{'*':'allow'}},{plugin:['external']},{agent:{unsafe:{}}},{instructions:['external']},{model:'other/model'}])assert.equal(configurationMatches({...expected,...changed},expected),false);
});

test('launch configs preserve private unicode paths and constrain all hosts',async t=>{
  const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {startRuntime}=await import('../dist/runtime.js');const {adminCall}=await import('../dist/client.js');
  const root=mkdtempSync(join(tmpdir(),'durebak 한글 ')),data=join(root,'data');
  const runtime=await startRuntime(data);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true,force:true});});
  const registration=await adminCall(data,'/v1/register',{workspace:'test',alias:'test',provider:'other'});
  const file=join(root,'session.json');writeFileSync(file,JSON.stringify({data_dir:data,...registration}),{mode:0o600});
  for(const id of ['codex','claude-code','opencode']){
    const invocation=getHostAdapter(id).buildInvocation({sessionFile:file,workspace:root,configDir:root,allowedTools:['send'],model:'example/model'});
    assert.ok(invocation.args.includes('--model'));assert.ok(invocation.args.includes('example/model'));
    assert.ok(!JSON.stringify(invocation).includes(registration.token));
    if(id==='opencode'){assert.equal(invocation.expectedConfig.permission['*'],'deny');assert.equal(invocation.expectedConfig.permission.durebak_durebak_send,'allow');assert.notEqual(invocation.env.XDG_DATA_HOME,process.env.XDG_DATA_HOME);}
    if(id==='claude-code')assert.ok(invocation.args.includes('--strict-mcp-config'));
    if(id==='codex')assert.ok(invocation.args.includes('--ignore-user-config'));
  }
});

test('unrecognized tool names and unexpected errors cannot leak into public reports',async()=>{
  const {safeFailure}=await import('../scripts/lib/host-adapters/common.mjs');
  assert.equal(safeFailure('ENOENT /private/user/session-secret.json'),'lab_failed');
  assert.equal(safeFailure('authentication_failed'),'authentication_failed');
  const s=summarizeFrames('codex',[{type:'item.completed',item:{type:'mcp_tool_call',tool:'durebak_secret-private',status:'completed'}}]);
  assert.equal(s.tools[0].name,'unknown');
});

test('Codex expired login and OpenCode HTTP401 classify as authentication failures without retaining messages',()=>{
  for(const frame of [{type:'error',message:'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'},{type:'turn.failed',error:{codex_error_info:'unauthorized',message:'private'}}])assert.equal(summarizeFrames('codex',[frame]).error,'authentication_failed');
  assert.equal(summarizeFrames('opencode',[{type:'error',error:{name:'APIError',data:{statusCode:401,message:'private'}}}]).error,'authentication_failed');
  assert.equal(summarizeFrames('codex',[{type:'error',message:'upstream timeout'}]).error,'host_reported_error');
});

test('authentication failure remains authoritative after a later generic error',async t=>{
  for(const [id,frames] of [
    ['codex',[{type:'error',message:'Your access token could not be refreshed.'},{type:'turn.failed',error:{message:'turn stopped'}}]],
    ['claude-code',[{error:'authentication_failed'},{type:'result',is_error:true}]],
    ['opencode',[{type:'error',error:{name:'ProviderAuthError'}},{type:'error',error:{name:'UnknownError'}}]],
  ])await t.test(id,()=>assert.equal(summarizeFrames(id,frames).error,'authentication_failed'));
});
