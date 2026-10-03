import { writeFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHarness, resolveHarness } from './harnesses/registry.js';
import { credential } from './client.js';
import { fail } from './domain.js';

export function createSetup(host: string, sessionFile: string, outputFile: string) {
  const harness=resolveHarness(host);
  if(harness==='other') fail('unsupported_harness');
  credential(sessionFile);
  const session = realpathSync(sessionFile);
  credential(session); // Reject unsafe credentials before writing any config.
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  if (!existsSync(cli)) fail('build_required');
  const args = [cli, 'mcp', '--session', session];
  const command = process.execPath;
  const {text}=getHarness(harness).renderMcpConfig({command,args});
  const path = resolve(outputFile);
  writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
  return { host, path, status: 'created', scope: 'config_fragment', discovery_scope: 'host_configuration', isolation_strategy: 'distinct_credential_per_bridge', isolation_evidence: 'renderer_tested', native_session_isolation: 'unverified', auto_installed: false };
}
