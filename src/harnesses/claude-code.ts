import type { HarnessAdapter } from './types.js';
export const claudeCode: HarnessAdapter = {
  id: 'claude-code',
  renderMcpConfig: bridge => ({format:'json',text:JSON.stringify({mcpServers:{durebak:bridge}},null,2)+'\n'}),
};
