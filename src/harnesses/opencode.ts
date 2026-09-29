import type { HarnessAdapter } from './types.js';
export const opencode: HarnessAdapter = {
  id: 'opencode',
  renderMcpConfig: ({command,args}) => ({format:'json',text:JSON.stringify({$schema:'https://opencode.ai/config.json',mcp:{durebak:{type:'local',command:[command,...args],enabled:true}}},null,2)+'\n'}),
};
