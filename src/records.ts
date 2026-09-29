import { writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { fail, hash } from './domain.js';

export function exportRecord(path: string, markdown: string) {
  try { writeFileSync(path, markdown, { flag:'wx', mode:0o600 }); return { status:'created', hash:hash(markdown), path }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || readFileSync(path,'utf8') !== markdown) fail('export_conflict');
  return { status:'unchanged', hash:hash(markdown), path };
}
