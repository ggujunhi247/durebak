import { parseArgs } from 'node:util';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHostAdapter } from './lib/host-adapters/index.mjs';
import { runMatrix } from './lib/host-matrix.mjs';
import { runBounded,reserveReport } from './lib/host-lab.mjs';
const {values}=parseArgs({options:{live:{type:'boolean',default:false},report:{type:'string'},'codex-model':{type:'string'},'claude-code-model':{type:'string'},'opencode-model':{type:'string'}}});
const sink=values.report?reserveReport(resolve(values.report)):null;
const directory=mkdtempSync(join(tmpdir(),'durebak-matrix-'));
const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
let report;
try {
  report=await runMatrix({live:values.live,signal:controller.signal,probe:id=>getHostAdapter(id).probe({signal:controller.signal}),runPair:async(worker,reviewer)=>{
    if([worker,reviewer].includes('opencode')&&!values['opencode-model'])return {status:'blocked',blocked_harness:'opencode',error:'model_required'};
    const file=join(directory,`${worker}-${reviewer}.json`);
    const args=[fileURLToPath(new URL('./host-lab.mjs',import.meta.url)),'--mode','live','--worker',worker,'--reviewer',reviewer,'--report',file];
    for(const [role,id] of [['worker',worker],['reviewer',reviewer]])if(values[`${id}-model`])args.push(`--${role}-model`,values[`${id}-model`]);
    const result=await runBounded(process.execPath,args,{timeoutMs:360000,killGraceMs:10000,signal:controller.signal});
    if(result.reason)return {status:'failed',error:result.reason};
    try{return JSON.parse(readFileSync(file,'utf8'));}catch{return {status:'failed',error:'report_missing'};}
  }});
} catch {report={schema_version:1,status:controller.signal.aborted?'cancelled':'failed',error:controller.signal.aborted?'cancelled':'matrix_failed'};}
finally {
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  rmSync(directory,{recursive:true,force:true});
  try{sink?.write(report);}finally{sink?.close();}
}
process.stdout.write(JSON.stringify(report,null,2)+'\n');
if(report.status==='failed'||report.status==='cancelled'||(values.live&&report.status!=='passed'))process.exitCode=1;
