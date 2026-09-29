import { z } from 'zod';
import { credential, request } from './client.js';
import { DomainError } from './domain.js';
import { version, protocolVersion } from './version.js';
import { schemaVersion } from './migrations.js';

export async function doctor(file: string) {
  const base = { client_version: version, protocol_version: protocolVersion };
  if (Number(process.versions.node.split('.')[0]) < 24) return { ...base, ok: false, code: 'unsupported_node' };
  let identity: ReturnType<typeof credential>;
  try { identity = credential(file); }
  catch { return { ...base, ok: false, code: 'credential_unavailable' }; }
  try {
    const result = await request(identity.data_dir, identity.token, '/v1/session', { operation: 'runtime_info', args: {} });
    const info = z.object({ version: z.string(), protocol_version: z.number(), schema_version: z.number(), session_id: z.string() }).safeParse(result);
    if (!info.success) return { ...base, ok: false, code: 'incompatible_runtime' };
    if (info.data.protocol_version !== protocolVersion || info.data.schema_version !== schemaVersion) return { ...base, ok: false, code: 'incompatible_runtime' };
    if (info.data.session_id !== identity.session.id) return { ...base, ok: false, code: 'identity_mismatch' };
    if (info.data.version !== version) return { ...base, ok: false, code: 'version_mismatch', runtime_version: info.data.version };
    return { ...base, ok: true, code: 'ready', runtime_version: info.data.version, schema_version: info.data.schema_version, session_id: info.data.session_id };
  } catch (error) {
    const code = error instanceof DomainError ? (error.code === 'invalid_input' ? 'incompatible_runtime' : error.code) : 'daemon_unavailable';
    return { ...base, ok: false, code };
  }
}
