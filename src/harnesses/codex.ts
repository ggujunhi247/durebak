import type { HarnessAdapter } from './types.js';
export const codex: HarnessAdapter = {
  id: 'codex',
  renderMcpConfig: ({command,args}) => ({format:'toml',text:`[mcp_servers.durebak]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`}),
};
