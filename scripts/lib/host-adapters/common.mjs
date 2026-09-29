import { runBounded } from '../host-lab.mjs';
import { createSetup } from '../../../dist/setup.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export function configFile(id,sessionFile,configDir) {
  const file=join(configDir,`host-${randomUUID()}.json`);
  createSetup(id,sessionFile,file);return file;
}
export function usage(source,value,fields) {
  if(!value||typeof value!=='object')return null;
  const result={source,semantics:'last_usage_event_not_aggregate'};
  for(const key of fields)result[key]=Number.isFinite(value[key])&&value[key]>=0?value[key]:null;
  return result;
}
export async function probeCommand(command,authArgs,signal) {
  const version=await runBounded(command,['--version'],{timeoutMs:10000,signal});
  // Never retain arbitrary command output as a version (it can contain paths).
  const number=version.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0]??null;
  if(version.code!==0||version.reason)return {installed:false,version:null,authEvidence:'unknown'};
  if(!authArgs)return {installed:true,version:number,authEvidence:'unknown'};
  const auth=await runBounded(command,authArgs,{timeoutMs:10000,signal});
  let present=auth.code===0&&!auth.reason;
  if(command==='claude'){try{present=present&&JSON.parse(auth.stdout).loggedIn===true;}catch{present=false;}}
  return {installed:true,version:number,authEvidence:present?'credentials_present':'none'};
}
const toolNames=new Set(['send','receive','ack','task_get','task_claim','artifact_put','task_complete'].flatMap(name=>[`durebak_${name}`,`durebak_durebak_${name}`]));
export const safeTool=name=>toolNames.has(name)?name:'unknown';
const failures=new Set(['authentication_failed','authentication_required','not_installed','model_required','configuration_unverified','timeout','cancelled','output_limit','spawn_failed','tool_failed','host_reported_error','host_failed','queue_not_pending','queue_wait_timeout','cleanup_failed']);
export const safeFailure=message=>failures.has(message)?message:'lab_failed';
