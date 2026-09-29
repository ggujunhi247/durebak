import test from 'node:test';
import assert from 'node:assert/strict';
import { pairs,runMatrix } from '../scripts/lib/host-matrix.mjs';
const ready=async()=>({installed:true,authEvidence:'credentials_present'});
const checks=['request_sender_and_recipient','request_body','request_acknowledged','correlated_reply','correction_body','correction_acknowledged','completed_by_owner','result_hash','result_content','derived_cache_hit','zero_model_record'].map(name=>({name,passed:true}));
test('six unique directed pairs and probe never invokes a model',async()=>{
  assert.equal(pairs.length,6);assert.equal(new Set(pairs.map(p=>p.join(':'))).size,6);
  const result=await runMatrix({probe:ready,runPair:()=>{throw Error('paid call');}});
  assert.equal(result.status,'not-tested');assert.ok(result.pairs.every(pair=>pair.status==='not-tested'));
});
test('authentication failure blocks later combinations without repeated paid attempts',async()=>{
  let calls=0;const result=await runMatrix({live:true,probe:ready,runPair:async(worker,reviewer)=>{calls++;return worker==='claude-code'||reviewer==='claude-code'?{status:'blocked',blocked_harness:'claude-code',error:'authentication_failed'}:{status:'passed',mode:'live',worker,reviewer,checks};}});
  assert.equal(calls,3);assert.equal(result.status,'blocked');assert.equal(result.pairs.filter(p=>p.status==='blocked').length,4);
});
test('exit success and claimed pass cannot replace all persisted checks or live identity',async()=>{
  for(const invalid of [{status:'passed'},{status:'passed',mode:'mcp',checks},{status:'passed',mode:'live',checks:checks.slice(1)}]){
    const result=await runMatrix({live:true,probe:ready,runPair:async(worker,reviewer)=>({worker,reviewer,...invalid})});assert.equal(result.status,'failed');
  }
  const result=await runMatrix({live:true,probe:ready,runPair:async(worker,reviewer)=>({status:'passed',mode:'live',worker,reviewer,checks})});assert.equal(result.status,'passed');
});

test('Codex authentication classification suppresses subsequent Codex pairs',async()=>{
  const {summarizeFrames}=await import('../scripts/lib/host-adapters/index.mjs');
  let calls=0;
  const result=await runMatrix({live:true,probe:ready,runPair:async(worker,reviewer)=>{
    calls++;
    if([worker,reviewer].includes('codex')){
      const error=summarizeFrames('codex',[{type:'turn.failed',error:{message:'Your access token could not be refreshed.'}}]).error;
      return {status:error==='authentication_failed'?'blocked':'failed',blocked_harness:error==='authentication_failed'?'codex':undefined,error};
    }
    return {status:'passed',mode:'live',worker,reviewer,checks};
  }});
  assert.equal(calls,3);assert.equal(result.pairs.filter(p=>p.status==='blocked').length,4);
});

test('contradictory and malformed evidence fails a pair without aborting the matrix',async t=>{
  for(const malformed of [null,{status:'passed',mode:'live',checks:{}},{status:'passed',mode:'live',checks:[...checks,{name:'request_body',passed:false}]},{status:'passed',mode:'live',checks:[...checks,{name:'additional_invariant',passed:false}]}]){
    await t.test(JSON.stringify(malformed),async()=>{
      const result=await runMatrix({live:true,probe:ready,runPair:async(worker,reviewer)=>malformed===null?null:{worker,reviewer,...malformed}});
      assert.equal(result.status,'failed');assert.equal(result.pairs.length,6);
    });
  }
});
