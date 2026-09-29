import { readFileSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { configFile,probeCommand,usage,safeTool } from './common.mjs';
import { runBounded } from '../host-lab.mjs';
export function configurationMatches(actual,expected) {
  return isDeepStrictEqual(actual.mcp,expected.mcp)&&isDeepStrictEqual(actual.permission,expected.permission)&&(!actual.plugin||actual.plugin.length===0)&&(!actual.agent||Object.keys(actual.agent).length===0)&&(!actual.instructions||actual.instructions.length===0)&&actual.model===expected.model;
}
export default {
  id:'opencode',
  probe:({signal}={})=>probeCommand('opencode',null,signal),
  buildInvocation({sessionFile,workspace,configDir,allowedTools,model}) {
    if(!model)throw new Error('model_required');
    const file=configFile('opencode',sessionFile,configDir);
    const config=JSON.parse(readFileSync(file,'utf8'));
    config.permission={'*':'deny',...Object.fromEntries(allowedTools.map(tool=>[`durebak_durebak_${tool}`,'allow']))};
    config.model=model;config.plugin=[];config.instructions=[];
    // Isolate native state; OAuth from the user's global data directory is not copied.
    const env={...process.env,OPENCODE_CONFIG:file,OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_PROJECT_CONFIG:'true'};
    for(const name of ['CONFIG','DATA','CACHE','STATE']){
      const path=join(configDir,`opencode-${name.toLowerCase()}`);mkdirSync(path,{recursive:true,mode:0o700});env[`XDG_${name}_HOME`]=path;
    }
    return {command:'opencode',args:['--pure','run','--format','json','--dir',workspace,'--model',model],env,expectedConfig:config};
  },
  async verifyConfiguration(invocation,{cwd,signal}={}) {
    const result=await runBounded(invocation.command,['--pure','debug','config'],{cwd,env:invocation.env,signal,timeoutMs:20000});
    try{return result.code===0&&!result.reason&&configurationMatches(JSON.parse(result.stdout),invocation.expectedConfig);}catch{return false;}
  },
  classifyFrame(frame) {
    if(frame.type==='error')return {error:(frame.error?.name==='ProviderAuthError'||frame.error?.data?.statusCode===401)?'authentication_failed':'host_reported_error'};
    if(frame.type==='tool_use')return {tool:{name:safeTool(frame.part?.tool),status:frame.part?.state?.status==='completed'?'completed':'failed'}};
    if(frame.type==='step_finish')return {usage:usage('opencode',frame.part?.tokens,['input','output','reasoning']),cost_usd:Number.isFinite(frame.part?.cost)?frame.part.cost:null};
    return null;
  }
};
