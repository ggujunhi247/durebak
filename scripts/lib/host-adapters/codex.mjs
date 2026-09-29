import { readFileSync } from 'node:fs';
import { configFile,probeCommand,usage,safeTool } from './common.mjs';
export default {
  id:'codex',
  probe:({signal}={})=>probeCommand('codex',['login','status'],signal),
  buildInvocation({sessionFile,workspace,configDir,allowedTools,model}) {
    const file=configFile('codex',sessionFile,configDir);
    const fragment=readFileSync(file,'utf8').trim().split('\n').slice(1).join(',');
    const toml=`{durebak={${fragment},enabled_tools=${JSON.stringify(allowedTools.map(tool=>'durebak_'+tool))},startup_timeout_sec=20,tool_timeout_sec=20,default_tools_approval_mode="approve"}}`;
    return {command:'codex',args:['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','-C',workspace,'-c',`mcp_servers=${toml}`,'-c','approval_policy="never"','-c','web_search="disabled"',...['shell_tool','apps','plugins','hooks','multi_agent','browser_use','computer_use','image_generation','skill_search'].flatMap(flag=>['--disable',flag]),...(model?['--model',model]:[]),'-']};
  },
  classifyFrame(frame) {
    if(frame.type==='error'||frame.type==='turn.failed'){
      const error=frame.error??frame;
      const message=typeof error.message==='string'?error.message:'';
      // Codex 0.146 JSONL drops typed unauthorized information. Match only known
      // authentication forms in memory, never retain the raw message in reports.
      const auth=error.codex_error_info==='unauthorized'||error.status_code===401||/^Your access token could not be refreshed\b/.test(message)||/\b401 Unauthorized\b/.test(message);
      return {error:auth?'authentication_failed':'host_reported_error'};
    }
    if(frame.type==='item.completed'&&frame.item?.type==='mcp_tool_call')return {tool:{name:safeTool(frame.item.tool),status:frame.item.status==='completed'?'completed':'failed'}};
    if(frame.type==='turn.completed')return {usage:usage('codex',frame.usage,['input_tokens','cached_input_tokens','output_tokens'])};
    return null;
  }
};
