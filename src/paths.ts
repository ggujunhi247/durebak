import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory } from './database.js';
import { fail, hash } from './domain.js';

// Explicit locations keep their existing precedence. Never move a live database.
export function dataDirectory(value?: string, env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  if (value !== undefined) return resolve(value);
  if (env.DUREBAK_DATA_DIR !== undefined) return resolve(env.DUREBAK_DATA_DIR);
  if (env.XDG_DATA_HOME !== undefined) return resolve(env.XDG_DATA_HOME, 'durebak');
  const current = join(home, '.durebak');
  const legacy = join(home, '.local', 'share', 'durebak');
  if (existsSync(join(legacy, 'runtime.sqlite'))) {
    if (existsSync(join(current, 'runtime.sqlite'))) fail('ambiguous_data_directory');
    return legacy;
  }
  return current;
}

export function storagePaths(directory: string) {
  const data_dir = resolve(directory);
  return { data_dir, database: join(data_dir, 'runtime.sqlite'), credentials_dir: join(data_dir, 'credentials'), records_dir: join(data_dir, 'records') };
}

export function managedCredentialPath(directory: string) {
  const paths = storagePaths(directory);
  privateDirectory(paths.data_dir);
  privateDirectory(paths.credentials_dir);
  return join(paths.credentials_dir, `session-${randomUUID()}.json`);
}

export function managedRecordPath(directory: string, workspace: string, taskId: string, markdown: string) {
  const paths = storagePaths(directory);
  privateDirectory(paths.data_dir);
  privateDirectory(paths.records_dir);
  const workspaceDirectory = join(paths.records_dir, hash(workspace));
  privateDirectory(workspaceDirectory);
  // Untrusted identifiers never become path segments; revisions remain immutable.
  return join(workspaceDirectory, `${hash(taskId)}-${hash(markdown)}.md`);
}
