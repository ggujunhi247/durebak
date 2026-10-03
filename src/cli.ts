#!/usr/bin/env node
import { resolveHarness, legacyProvider } from './harnesses/registry.js';
import { harnessCatalog } from './harnesses/catalog.js';
import { version } from './version.js';
import { createSetup } from './setup.js';
import { doctor } from './doctor.js';
import { parseArgs } from 'node:util';
import { openSync, closeSync, writeFileSync, unlinkSync, realpathSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { credential, adminCall, dataDirectory, sessionCall } from './client.js';
import { DomainError, fail, hash } from './domain.js';
import { startRuntime, operations, type Operation } from './runtime.js';
import { serveMcp } from './mcp.js';
import { exportRecord } from './records.js';
import { storagePaths, managedCredentialPath, managedRecordPath } from './paths.js';

const help = `Durebak ${version} — local cooperative session bus

  durebak harnesses                              Read harness capability evidence (no host execution)
  durebak serve [--data-dir PATH]                  Run loopback daemon in foreground
  durebak register --workspace PATH --alias NAME --harness codex|claude-code|opencode|other [--out FILE] [--data-dir PATH]
  durebak revoke SESSION_ID [--data-dir PATH]      Revoke a session credential
  durebak mcp --session FILE                      Start session-scoped MCP stdio bridge
  durebak call OPERATION --session FILE [--json JSON | --input FILE]
  durebak setup --harness codex|claude-code|opencode --session FILE --out FILE
  durebak doctor --session FILE                 Check identity and runtime compatibility
  durebak export TASK_ID --session FILE [--out FILE]
  durebak paths [--session FILE | --data-dir PATH] Show local storage paths

Legacy --provider (register) and --host (setup) remain supported; claude aliases claude-code.
New installations default to ~/.durebak (explicit data-dir/environment and existing legacy data take precedence).
Register/export without --out use private credentials/ and records/ below the selected data directory.
Session credential files are private. Keep them outside your repository.
call operations: ${Object.keys(operations).join(', ')}
No provider auto-wake or managed execution in this alpha.
`;
const output = (value:unknown) => process.stdout.write(JSON.stringify(value)+'\n');
function required(value: string | undefined, name: string) { if (!value) fail(`missing_${name}`); return value; }

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals:true, options:{
    'data-dir':{type:'string'}, workspace:{type:'string'}, alias:{type:'string'}, provider:{type:'string'}, harness:{type:'string'}, out:{type:'string'}, session:{type:'string'}, json:{type:'string'}, input:{type:'string'}, host:{type:'string'}, help:{type:'boolean'}, version:{type:'boolean'},
  } });
  const command = positionals[0];
  if (values.version) { process.stdout.write(version+'\n'); return; }
  if (values.help || !command) { process.stdout.write(help); return; }
  if (command === 'harnesses') { output(harnessCatalog()); return; }
  const selectedDirectory = () => dataDirectory(values['data-dir']);
  if (command === 'paths') {
    const session = values.session ?? process.env.DUREBAK_SESSION_FILE;
    output(storagePaths(session ? credential(session).data_dir : selectedDirectory())); return;
  }
  if (command === 'serve') {
    const runtime = await startRuntime(selectedDirectory());
    process.stderr.write(`Durebak listening at ${runtime.url}\n`);
    let stopping = false;
    const stop = () => { if (stopping) return; stopping=true; void runtime.close().catch(() => { process.exitCode=1; }); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    return;
  }
  if (command === 'register') {
    const workspace = hash(realpathSync(required(values.workspace,'workspace')));
    const args = { workspace, alias:required(values.alias,'alias'), provider:legacyProvider(resolveHarness(values.harness,values.provider)) };
    const directory = selectedDirectory();
    const file = values.out !== undefined ? resolve(required(values.out,'out')) : managedCredentialPath(directory);
    const fd = openSync(file, 'wx', 0o600);
    let registered = false;
    try {
      const result = z.object({ session:z.object({ id:z.string() }).passthrough(), token:z.string() }).parse(await adminCall(directory,'/v1/register',args));
      registered = true;
      writeFileSync(fd, JSON.stringify({ data_dir:directory, ...result })+'\n');
      output({ session:result.session, credential_file:file });
    } finally { closeSync(fd); if (!registered) unlinkSync(file); }
    return;
  }
  if (command === 'revoke') { output(await adminCall(selectedDirectory(),'/v1/revoke',{ id:required(positionals[1],'session_id') })); return; }
  if (!['setup','doctor','mcp','call','export'].includes(command)) fail('unknown_command');
  const file = required(values.session ?? process.env.DUREBAK_SESSION_FILE, 'session');
  if (command === 'setup') { output(createSetup(resolveHarness(values.harness,values.host),file,required(values.out,'out'))); return; }
  if (command === 'doctor') { const result = await doctor(file); output(result); if (!result.ok) process.exitCode=1; return; }
  if (command === 'mcp') { await serveMcp(file); return; }
  if (command === 'call') {
    const operation = required(positionals[1],'operation');
    if (!Object.hasOwn(operations,operation)) fail('unknown_operation');
    if (values.json && values.input) fail('choose_json_or_input');
    const text = values.input ? readFileSync(resolve(values.input),'utf8') : values.json ?? '{}';
    if (Buffer.byteLength(text)>131072) fail('request_too_large');
    let input: unknown;
    try { input = JSON.parse(text); } catch { fail('invalid_json'); }
    output(await sessionCall(file,operation as Operation,input)); return;
  }
  if (command === 'export') {
    const result = z.object({ markdown:z.string() }).parse(await sessionCall(file,'record',{ id:required(positionals[1],'task_id') }));
    const config = credential(file);
    const destination = values.out !== undefined ? resolve(required(values.out,'out')) : managedRecordPath(config.data_dir,config.session.workspace,positionals[1]!,result.markdown);
    output(exportRecord(destination,result.markdown)); return;
  }
  fail('unknown_command');
}
main().catch(error => {
  const code = error instanceof DomainError ? error.code : error instanceof z.ZodError ? 'invalid_input' : (error as NodeJS.ErrnoException).code ?? 'operation_failed';
  process.stderr.write(JSON.stringify({ error:code })+'\n'); process.exitCode=1;
});
