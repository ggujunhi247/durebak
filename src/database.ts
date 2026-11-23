import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, openSync, closeSync, realpathSync, constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fail } from './domain.js';
import { migrate, schemaVersion } from './migrations.js';

export function privateDirectory(path: string) {
  // POSIX mode bits cannot establish private storage on Windows. Refuse
  // before creating anything until an OS-specific ACL backend is available.
  if (typeof process.geteuid !== 'function') fail('unsupported_storage_platform');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path.replace(/\/+$/,'')||'/');
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.geteuid?.()) fail('unsafe_data_directory');
}

export function acquireKnownMaintenance(directories:readonly string[]):()=>void {
  if(directories.length===0||directories.length>64||directories.some(path=>!isAbsolute(path)))fail('maintenance_gate_unavailable');
  const known=[...new Set(directories.map(path=>realpathSync(path)))].sort();
  const releases:(()=>void)[]=[];
  try{
    for(const directory of known)releases.push(acquireMaintenanceGate(directory,'maintenance'));
  }catch(error){release();throw error;}
  return release;

  function release(){while(releases.length)releases.pop()!();}
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

export function acquireMaintenanceGate(directory:string,mode:'runtime'|'maintenance'):()=>void {
  const file=join(directory,'maintenance.lock.sqlite');
  if(mode==='maintenance'&&!lstatSync(file,{throwIfNoEntry:false}))fail('maintenance_gate_unavailable');
  privateDirectory(directory);
  if(mode==='runtime'){
    try{closeSync(openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }
  privateDatabaseFiles(file);
  const before=lstatSync(file,{bigint:true});
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA busy_timeout=0;');
    db.exec(mode==='maintenance'?'BEGIN EXCLUSIVE;':'BEGIN DEFERRED;');
    // In rollback-journal mode a real read holds a shared lock until close.
    // WAL would let an exclusive transaction coexist with readers.
    if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('unsafe_maintenance_gate');
    db.prepare('SELECT name FROM sqlite_schema LIMIT 1').get();
    privateDatabaseFiles(file);
    const after=lstatSync(file,{bigint:true});
    if(before.dev!==after.dev||before.ino!==after.ino)fail('unsafe_maintenance_gate');
    if(mode==='maintenance')assertIdle(directory);
  }catch(error){
    db.close();
    if((error as {errcode?:number}).errcode===5||(error as Error).message.includes('database is locked'))fail(mode==='maintenance'?'runtime_active':'maintenance_in_progress');
    throw error;
  }
  return release;

  function release(){if(db.isOpen)db.close();}
}

function assertIdle(directory:string) {
  if(lstatSync(join(directory,'runtime.lock'),{throwIfNoEntry:false}))fail('runtime_active');
  const file=join(directory,'runtime.sqlite');
  if(![file,file+'-wal',file+'-shm',file+'-journal'].some(path=>lstatSync(path,{throwIfNoEntry:false})))return;
  privateDatabaseFiles(file);
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    if(db.prepare('PRAGMA user_version').get()?.user_version!==schemaVersion)fail('manual_migration_required');
    if(db.prepare("SELECT 1 FROM work_attempts WHERE state NOT IN ('completed','cancelled') OR active_released<>1 LIMIT 1").get())fail('update_execution_unresolved');
    if(db.prepare("SELECT 1 FROM requests WHERE state='accepted' LIMIT 1").get())fail('update_request_unresolved');
  }finally{db.close();}
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
