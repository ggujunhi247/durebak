import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { fail } from './domain.js';
import type { Operation } from './runtime.js';

export { dataDirectory } from './paths.js';
export function privateJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 16384) fail('unsafe_credential_file');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
const credentialSchema = z.object({ data_dir: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/), session: z.object({ id:z.string(), workspace:z.string(), alias:z.string(), provider:z.string() }).passthrough() }).strict();
export function credential(path: string) { return credentialSchema.parse(privateJson(path)); }
export async function request(directory: string, token: string, path: string, payload: unknown, options?: { timeoutMs?: number }): Promise<unknown> {
  const connection = z.object({ url: z.string(), instance: z.string() }).parse(privateJson(join(directory, 'connection.json')));
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('unsafe_endpoint');
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text) > 131072) fail('request_too_large');
  const response = await fetch(new URL(path, url), { method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' }, body:text, redirect:'error', signal:AbortSignal.timeout(options?.timeoutMs ?? 15000) });
  let resultText = ''; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) fail('empty_response');
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 16384) fail('response_too_large');
      resultText += decoder.decode(value, { stream:true });
    }
    resultText += decoder.decode();
  } finally { await reader.cancel(); }
  const result: unknown = JSON.parse(resultText);
  if (!response.ok) { const error = z.object({ error:z.string() }).parse(result); fail(error.error); }
  return result;
}
export function sessionCall(file: string, operation: Operation, args: unknown) {
  const config = credential(file);
  return request(config.data_dir, config.token, '/v1/session', { operation, args });
}
export function adminCall(directory: string, path: '/v1/register' | '/v1/revoke' | '/v1/managed', args: unknown) {
  const admin = z.object({ token:z.string() }).parse(privateJson(join(directory, 'admin.json')));
  return request(directory, admin.token, path, args);
}
