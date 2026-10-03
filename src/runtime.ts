import { resolveHarness, legacyProvider } from './harnesses/registry.js';
import { version, protocolVersion } from './version.js';
import { schemaVersion } from './migrations.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from './store.js';
import { DomainError, fail, sendSchema, taskSchema, type Session } from './domain.js';
import { privateDirectory } from './database.js';

const identifier = z.string().min(1).max(200);
const page = z.object({ after: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(10) }).strict();
const source = z.object({ id: identifier, offset: z.number().int().min(0).default(0), limit: z.number().int().min(4).max(4096).default(4096) }).strict();
const taskVersion = z.object({ id: identifier, version: z.number().int().positive() }).strict();
const empty = z.object({}).strict();
export const operations = {
  runtime_info: empty,
  bridge_touch: z.object({instance:z.string().uuid(),epoch:z.string().regex(/^[a-f0-9]{32}$/)}).strict(),
  bridge_close: z.object({instance:z.string().uuid(),epoch:z.string().regex(/^[a-f0-9]{32}$/)}).strict(),
  session_health: z.object({id:identifier.optional()}).strict(),
  sessions: z.object({ after:z.string().max(200).default(''), limit:z.number().int().min(1).max(20).default(10) }).strict(),
  send: sendSchema,
  inbox: page,
  receive: z.object({limit:z.number().int().min(1).max(10).default(5)}).strict(),
  queue_status: empty,
  session_state: z.object({state:z.enum(['available','busy','paused'])}).strict(),
  message_status: z.object({id:identifier}).strict(),
  message_read: source,
  ack: z.object({ id: identifier, receipt: identifier }).strict(),
  task_create: taskSchema,
  task_get: z.object({ id: identifier }).strict(),
  tasks: z.object({ after: z.string().max(200).default(''), limit: z.number().int().min(1).max(20).default(10) }).strict(),
  task_claim: taskVersion,
  task_complete: taskVersion.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  task_cancel: taskVersion,
  artifact_put: z.object({ content: z.string().min(1).refine(v => Buffer.byteLength(v) <= 65536) }).strict(),
  artifact_read: source,
  cache_clear: empty,
  events: page,
  record: z.object({ id: identifier }).strict(),
};
export type Operation = keyof typeof operations;

function dispatch(store: Store, actor: Session, operation: Operation, input: unknown, epoch: string): unknown {
  // Each branch parses at the trust boundary before entering the store.
  switch (operation) {
    case 'runtime_info': empty.parse(input); return { version, protocol_version: protocolVersion, schema_version: schemaVersion, session_id: actor.id, daemon_epoch: epoch, capabilities:['session_health_v1'] };
    case 'session_health': {const a=operations.session_health.parse(input);return store.sessionHealth(actor,a.id??actor.id,epoch);}
    case 'bridge_touch': {const a=operations.bridge_touch.parse(input);if(a.epoch!==epoch)fail('daemon_epoch_mismatch');return store.bridgeTouch(actor,a.instance,epoch);}
    case 'bridge_close': {const a=operations.bridge_close.parse(input);if(a.epoch!==epoch)fail('daemon_epoch_mismatch');return store.bridgeClose(actor,a.instance,epoch);}
    case 'sessions': { const a = operations.sessions.parse(input); return { ...store.sessions(actor,a.after,a.limit), mode:'cooperative', auto_wake:false }; }
    case 'send': { const result = store.send(actor, operations.send.parse(input)); return { id: result.id, seq: result.seq, status: result.status, reply_to: result.reply_to }; }
    case 'inbox': { const a = operations.inbox.parse(input); return store.inbox(actor, a.after, a.limit); }
    case 'message_read': { const a = source.parse(input); return store.readMessage(actor, a.id, a.offset, a.limit); }
    case 'ack': { const a=operations.ack.parse(input);return store.ack(actor,a.id,a.receipt); }
    case 'receive': return store.receive(actor,operations.receive.parse(input).limit);
    case 'queue_status': empty.parse(input);return store.queueStatus(actor);
    case 'session_state': return store.setSessionState(actor,operations.session_state.parse(input).state);
    case 'message_status': return store.messageStatus(actor,operations.message_status.parse(input).id);
    case 'task_create': return store.createTask(actor, taskSchema.parse(input));
    case 'task_get': return store.getTask(actor, operations.task_get.parse(input).id);
    case 'tasks': { const a = operations.tasks.parse(input); return store.tasks(actor, a.after, a.limit); }
    case 'task_claim': { const a = taskVersion.parse(input); return store.claim(actor, a.id, a.version); }
    case 'task_complete': { const a = operations.task_complete.parse(input); return store.complete(actor, a.id, a.version, a.hash); }
    case 'task_cancel': { const a = taskVersion.parse(input); return store.cancel(actor, a.id, a.version); }
    case 'artifact_put': return store.putArtifact(actor, operations.artifact_put.parse(input).content);
    case 'artifact_read': { const a = source.parse(input); return store.readArtifact(actor, a.id, a.offset, a.limit); }
    case 'cache_clear': empty.parse(input); return store.clearCache(actor);
    case 'events': { const a = page.parse(input); return store.events(actor, a.after, a.limit); }
    case 'record': return store.record(actor, operations.record.parse(input).id);
  }
}

function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 131072) fail('request_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { fail('invalid_json'); }
}
function respond(res: ServerResponse, status: number, value: unknown) {
  let text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 16384) { status = 413; text = JSON.stringify({ error: 'response_too_large', hint: 'Use smaller pages or bounded source reads.' }); }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}

export async function startRuntime(directory: string) {
  privateDirectory(directory);
  const lockPath = join(directory, 'runtime.lock');
  const instance = randomBytes(16).toString('hex');
  try { writeFileSync(lockPath, JSON.stringify({ pid: process.pid, instance }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('runtime_locked'); throw error; }
  let store: Store;
  try { store = new Store(directory); } catch (error) { unlinkSync(lockPath); throw error; }
  const adminToken = randomBytes(32).toString('hex');
  let url = '';
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.origin || req.headers.host !== new URL(url).host) { respond(res, 403, { error: 'origin_or_host_rejected' }); return; }
      if (req.method !== 'POST' || !['/v1/register', '/v1/revoke', '/v1/session'].includes(req.url ?? '')) { respond(res, 404, { error: 'not_found' }); return; }
      // Reject declared oversized input before parsing/authentication.
      if (Number(req.headers['content-length'] ?? 0) > 131072) { respond(res, 413, { error: 'request_too_large' }); return; }
      if (req.headers['content-type'] !== 'application/json') { respond(res, 415, { error: 'json_required' }); return; }
      const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '';
      if (req.url === '/v1/register' || req.url === '/v1/revoke') {
        if (!equal(token, adminToken)) { respond(res, 401, { error: 'unauthorized' }); return; }
        const input = await readBody(req);
        if (req.url === '/v1/register') {
          const args = z.object({ workspace: identifier, alias: identifier, provider:z.string().optional(), harness:z.string().optional() }).strict().parse(input);
          respond(res, 200, store.register(args.workspace, args.alias, legacyProvider(resolveHarness(args.harness,args.provider))));
        } else { const args = z.object({ id: identifier }).strict().parse(input); store.revoke(args.id); respond(res, 200, { revoked: args.id }); }
        return;
      }
      if (!store.authenticate(token)) { respond(res, 401, { error: 'unauthorized' }); return; }
      const body = await readBody(req);
      // A revoke request can finish while this body is arriving. Recheck at
      // dispatch; no asynchronous gap remains between authorization and mutation.
      const actor = store.authenticate(token);
      if (!actor) { respond(res, 401, { error: 'unauthorized' }); return; }
      const input = z.object({ operation: z.enum(Object.keys(operations) as [Operation, ...Operation[]]), args: z.unknown() }).strict().parse(body);
      if (!['runtime_info','sessions','session_health','bridge_touch','bridge_close','events'].includes(input.operation)) store.activityTouch(actor);
      respond(res, 200, dispatch(store, actor, input.operation, input.args, instance));
    } catch (error) {
      const code = error instanceof DomainError ? error.code : error instanceof z.ZodError ? 'invalid_input' : 'internal_error';
      const status = code === 'internal_error' ? 500 : code === 'request_too_large' ? 413 : code === 'not_found' ? 404 : code.endsWith('conflict') || code === 'inbox_full' || code === 'alias_exists' ? 409 : 400;
      if (!res.headersSent) respond(res, status, { error: code }); else res.destroy();
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.timeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === 'string') fail('listen_failed');
    url = `http://127.0.0.1:${address.port}`;
    writeFileSync(join(directory, 'admin.json'), JSON.stringify({ token: adminToken }), { mode: 0o600 });
    writeFileSync(join(directory, 'connection.json'), JSON.stringify({ url, instance }), { mode: 0o600 });
  } catch (error) { server.close(); store.close(); unlinkSync(lockPath); throw error; }
  let closed = false;
  return { url, adminToken, async close() {
    if (closed) return; closed = true;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    if (JSON.parse(readFileSync(lockPath, 'utf8')).instance === instance) {
      for (const file of ['runtime.lock', 'connection.json', 'admin.json']) unlinkSync(join(directory, file));
    }
  } };
}
