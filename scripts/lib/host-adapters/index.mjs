import codex from './codex.mjs';
import claude from './claude-code.mjs';
import opencode from './opencode.mjs';
const adapters=new Map([['codex',codex],['claude-code',claude],['claude',claude],['opencode',opencode]]);
export function getHostAdapter(id){const adapter=adapters.get(id);if(!adapter)throw new Error('unsupported_harness');return adapter;}
export function summarizeFrames(id,frames) {
  const adapter=getHostAdapter(id),summary={tools:[],usage:null,error:null};
  for(const frame of frames){const event=adapter.classifyFrame(frame);if(!event)continue;
    if(event.tool){summary.tools.push(event.tool);if(event.tool.status==='failed')summary.error??='tool_failed';}
    if(event.usage)summary.usage=event.usage;
    if(event.cost_usd!=null)summary.cost_usd=event.cost_usd;
    // Authentication remains actionable even when shutdown emits a generic error.
    if(event.error&&summary.error!=='authentication_failed')summary.error=event.error;
  }
  return summary;
}
