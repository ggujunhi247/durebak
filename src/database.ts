import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, openSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { fail } from './domain.js';
import { migrate } from './migrations.js';

export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path.replace(/\/+$/,'')||'/');
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.geteuid?.()) fail('unsafe_data_directory');
}

function privateDatabaseFile(path:string,optional=false) {
  let stat:ReturnType<typeof lstatSync>;
  try{stat=lstatSync(path);}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.uid!==process.geteuid?.())fail('unsafe_database');
}

function privateDatabaseFiles(file:string) {
  privateDatabaseFile(file);
  // SQLite reads recovery files during open; inspect them before touching data.
  for(const suffix of ['-wal','-shm','-journal'])privateDatabaseFile(file+suffix,true);
}

export function openDatabase(directory: string): DatabaseSync {
  privateDirectory(directory);
  const file = join(directory, 'runtime.sqlite');
  try { closeSync(openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  privateDatabaseFiles(file);
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    privateDatabaseFiles(file);
    migrate(db);
    privateDatabaseFiles(file);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
