import test from 'node:test';
import assert from 'node:assert/strict';
import {getHarness,resolveHarness,legacyProvider} from '../src/harnesses/registry.js';

test('harness registry renders distinct unicode and space paths without changing bridge arguments',()=>{
 for(const id of ['codex','claude-code','opencode'] as const){
  const a={command:'/path with spaces/node',args:['/두레박/cli.js','mcp','--session','/private/첫 세션.json']};
  const b={...a,args:[...a.args.slice(0,-1),'/private/둘째 세션.json']};
  const rendered=getHarness(id).renderMcpConfig(a);
  assert.notEqual(rendered.text,getHarness(id).renderMcpConfig(b).text);
  if(rendered.format==='json'){
   const value=JSON.parse(rendered.text);
   if(id==='opencode')assert.deepEqual(value.mcp.durebak.command,[a.command,...a.args]);
   else assert.deepEqual(value.mcpServers.durebak,a);
  }else{
   const lines=rendered.text.trim().split('\n');
   assert.equal(JSON.parse(lines[1]!.split(' = ')[1]!),a.command);
   assert.deepEqual(JSON.parse(lines[2]!.split(' = ')[1]!),a.args);
  }
 }
});
test('legacy names normalize without confusing a model provider with a harness',()=>{
 assert.equal(resolveHarness('claude-code','claude'),'claude-code');
 assert.equal(resolveHarness(undefined,'codex'),'codex');
 assert.equal(resolveHarness('other'),'other');
 assert.equal(legacyProvider('claude-code'),'claude');
 for(const args of [[undefined,undefined],['openai',undefined],['codex','claude']] as const)assert.throws(()=>resolveHarness(...args));
 assert.throws(()=>getHarness('other' as never));
});
