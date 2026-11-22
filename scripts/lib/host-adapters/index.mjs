import codex from './codex.mjs';
import claude from './claude-code.mjs';
import opencode from './opencode.mjs';
import agy from './antigravity-cli.mjs';
import {hostBlockReasons} from './common.mjs';
const adapters=new Map([['codex',codex],['claude-code',claude],['claude',claude],['opencode',opencode],['agy',agy],['antigravity-cli',agy]]);
export function getHostAdapter(id){const adapter=adapters.get(id);if(!adapter)throw new Error('unsupported_harness');return adapter;}
export function summarizeFrames(id,frames) {
  const adapter=getHostAdapter(id),summary={tools:[],usage:null,error:null};
  for(const frame of frames){const event=adapter.classifyFrame(frame);if(!event)continue;
    if(event.tool){summary.tools.push(event.tool);if(event.tool.status==='failed')summary.error??='tool_failed';}
    if(event.usage)summary.usage=event.usage;
    if(event.cost_usd!=null)summary.cost_usd=event.cost_usd;
    if(event.error&&!hostBlockReasons.has(summary.error))summary.error=event.error;
  }
  return summary;
}
