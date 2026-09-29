export const pairs=Object.freeze([['codex','claude-code'],['claude-code','codex'],['codex','opencode'],['opencode','codex'],['claude-code','opencode'],['opencode','claude-code']]);
const required=['request_sender_and_recipient','request_body','request_acknowledged','correlated_reply','correction_body','correction_acknowledged','completed_by_owner','result_hash','result_content','derived_cache_hit','zero_model_record'];
function hasCompleteEvidence(evidence,worker,reviewer) {
  if(evidence.mode!=='live'||evidence.worker!==worker||evidence.reviewer!==reviewer||!Array.isArray(evidence.checks))return false;
  const names=new Set();
  for(const check of evidence.checks){
    if(!check||typeof check.name!=='string'||check.passed!==true||names.has(check.name))return false;
    names.add(check.name);
  }
  return required.every(name=>names.has(name));
}
export async function runMatrix({live=false,probe,runPair,signal}) {
  const hosts={},blocked=new Map(),results=[];
  for(const id of ['codex','claude-code','opencode']){
    signal?.throwIfAborted();hosts[id]=await probe(id);
    if(!hosts[id].installed)blocked.set(id,'not_installed');
    else if(hosts[id].authEvidence==='none')blocked.set(id,'authentication_required');
  }
  for(const [worker,reviewer] of pairs){
    signal?.throwIfAborted();
    const unavailable=[worker,reviewer].find(id=>blocked.has(id));
    if(unavailable){results.push({worker,reviewer,status:'blocked',reason:blocked.get(unavailable),evidence:null});continue;}
    if(!live){results.push({worker,reviewer,status:'not-tested',reason:'live_not_requested',evidence:null});continue;}
    const reported=await runPair(worker,reviewer);
    const evidence=reported&&typeof reported==='object'&&!Array.isArray(reported)?reported:{status:'failed',error:'evidence_invalid'};
    let status=evidence.status;
    if(status==='blocked'&&[worker,reviewer].includes(evidence.blocked_harness))blocked.set(evidence.blocked_harness,evidence.error??'host_blocked');
    else if(status!=='passed'&&status!=='blocked')status='failed';
    if(status==='passed'&&!hasCompleteEvidence(evidence,worker,reviewer))status='failed';
    results.push({worker,reviewer,status,reason:status==='passed'?null:evidence.error??'evidence_incomplete',evidence});
  }
  const status=results.every(pair=>pair.status==='passed')?'passed':results.some(pair=>pair.status==='failed')?'failed':results.some(pair=>pair.status==='blocked')?'blocked':'not-tested';
  return {schema_version:1,mode:live?'live':'probe',status,hosts,pairs:results};
}
