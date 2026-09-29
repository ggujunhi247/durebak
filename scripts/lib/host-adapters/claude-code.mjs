import { configFile,probeCommand,usage } from './common.mjs';
export default {
  id:'claude-code',
  probe:({signal}={})=>probeCommand('claude',['auth','status'],signal),
  buildInvocation({sessionFile,configDir,allowedTools,model}) {
    const file=configFile('claude-code',sessionFile,configDir);
    return {command:'claude',args:['--print','--output-format','stream-json','--verbose','--no-session-persistence','--strict-mcp-config','--mcp-config',file,'--setting-sources','','--settings','{"disableAllHooks":true}','--disable-slash-commands','--tools','','--permission-mode','dontAsk','--allowedTools',allowedTools.map(tool=>'mcp__durebak__durebak_'+tool).join(','),'--max-budget-usd','1','--effort','low',...(model?['--model',model]:[])]};
  },
  classifyFrame(frame) {
    if(frame.error==='authentication_failed')return {error:'authentication_failed'};
    if(frame.type==='result')return {error:frame.is_error?'host_reported_error':null,usage:usage('claude-code',frame.usage,['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens']),cost_usd:Number.isFinite(frame.total_cost_usd)?frame.total_cost_usd:null};
    if(frame.type==='user'&&frame.message?.content?.some(part=>part.type==='tool_result'&&part.is_error))return {error:'tool_failed'};
    return null;
  }
};
