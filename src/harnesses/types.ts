export type HarnessId = 'claude-code' | 'codex' | 'opencode';
export interface BridgeConfig { command: string; args: string[] }
export interface RenderedConfig { format: 'json' | 'toml'; text: string }
export interface HarnessAdapter { id: HarnessId; renderMcpConfig(bridge: BridgeConfig): RenderedConfig }
