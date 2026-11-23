import {closeSync,constants,fsyncSync,lstatSync,openSync,realpathSync,renameSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

type Phase='applying'|'committed'|'rolled_back';
interface Swap {phase:Phase;old_identity:string;new_identity:string}

function stop(reason:string):never {throw new Error(reason);}

function packageIdentity(path:string,uid:number):string|null {
 const stat=lstatSync(path,{bigint:true,throwIfNoEntry:false});
 if(!stat)return null;
 if(!stat.isDirectory()||stat.uid!==BigInt(uid)||(stat.mode&0o022n)!==0n||stat.ino===0n)stop('unsafe_update_swap_directory');
 return `${stat.dev}:${stat.ino}`;
}

function swapPaths(root:string) {
 const uid=process.geteuid?.();
 if(!uid||!isAbsolute(root)||realpathSync(root)!==root||!packageIdentity(root,uid))stop('unsafe_update_swap_directory');
 const directory=join(root,'.durebak-update');
 const stat=lstatSync(directory);
 if(!stat.isDirectory()||stat.uid!==uid||(stat.mode&0o077)!==0||realpathSync(directory)!==directory)stop('unsafe_update_swap_directory');
 return {uid,root,directory,active:join(root,'durebak'),candidate:join(directory,'candidate'),previous:join(directory,'previous'),file:join(directory,'swap.sqlite')};
}
type Paths=ReturnType<typeof swapPaths>;

function withJournal<T>(paths:Paths,run:(db:DatabaseSync)=>T):T {
 try{closeSync(openSync(paths.file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600));}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 inspectJournal(paths);
 const db=new DatabaseSync(paths.file);
 try{
  db.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=EXTRA;');
  if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')stop('unsafe_update_swap_journal');
  db.exec(`CREATE TABLE IF NOT EXISTS package_swap (
    id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL CHECK(phase IN ('applying','committed','rolled_back')),
    old_identity TEXT NOT NULL, new_identity TEXT NOT NULL
  ) STRICT;`);
  return run(db);
 }finally{db.close();}
}

function inspectJournal(paths:Paths) {
 for(const suffix of ['','-journal','-shm','-wal']){
  const stat=lstatSync(paths.file+suffix,{throwIfNoEntry:false});
  if(!stat&&suffix)continue;
  if(!stat?.isFile()||stat.nlink!==1||stat.uid!==paths.uid||(stat.mode&0o077)!==0)stop('unsafe_update_swap_journal');
 }
}

function syncDirectory(directory:string) {
 const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{fsyncSync(fd);}finally{closeSync(fd);}
}

function durableRename(from:string,to:string,paths:Paths) {
 renameSync(from,to);
 syncDirectory(paths.directory);
 syncDirectory(paths.root);
}

function readSwap(db:DatabaseSync){return db.prepare('SELECT phase,old_identity,new_identity FROM package_swap WHERE id=1').get() as Swap|undefined;}

function rollBack(paths:Paths,db:DatabaseSync,swap:Swap) {
 let active=packageIdentity(paths.active,paths.uid);
 let candidate=packageIdentity(paths.candidate,paths.uid);
 const previous=packageIdentity(paths.previous,paths.uid);
 if(previous===swap.old_identity&&active===swap.new_identity&&candidate===null){
  durableRename(paths.active,paths.candidate,paths);
  active=null;
  candidate=swap.new_identity;
 }
 if(candidate!==swap.new_identity)stop('update_swap_repair_required');
 if(previous===swap.old_identity&&active===null)durableRename(paths.previous,paths.active,paths);
 else if(previous!==null||active!==swap.old_identity)stop('update_swap_repair_required');
 db.exec("UPDATE package_swap SET phase='rolled_back' WHERE id=1; COMMIT;");
 return 'rolled_back' as const;
}

// Accept only a staged, verified candidate. The journal is outside the active package.
export function applyPackageSwap(root:string,verify:(directory:string)=>boolean) {
 const paths=swapPaths(root);
 withJournal(paths,db=>{
  db.exec('BEGIN IMMEDIATE;');
  if(readSwap(db))stop('update_swap_exists');
  const active=packageIdentity(paths.active,paths.uid),candidate=packageIdentity(paths.candidate,paths.uid);
  if(!active||!candidate||active===candidate||active.split(':')[0]!==candidate.split(':')[0]||packageIdentity(paths.previous,paths.uid))stop('unsafe_update_swap_directory');
  db.prepare("INSERT INTO package_swap VALUES (1,'applying',?,?)").run(active,candidate);
  db.exec('COMMIT;');
  syncDirectory(paths.directory);
  syncDirectory(paths.root);
  db.exec('BEGIN IMMEDIATE;');
  const swap=readSwap(db);
  if(swap?.phase!=='applying')stop('update_swap_interrupted');
  try{
   if(packageIdentity(paths.active,paths.uid)!==active||packageIdentity(paths.candidate,paths.uid)!==candidate||packageIdentity(paths.previous,paths.uid))stop('update_swap_repair_required');
   durableRename(paths.active,paths.previous,paths);
   durableRename(paths.candidate,paths.active,paths);
   if(verify(paths.active)!==true)stop('update_swap_verification_failed');
   if(packageIdentity(paths.active,paths.uid)!==candidate||packageIdentity(paths.previous,paths.uid)!==active||packageIdentity(paths.candidate,paths.uid))stop('update_swap_repair_required');
  }catch(error){rollBack(paths,db,swap);throw error;}
  db.exec("UPDATE package_swap SET phase='committed' WHERE id=1; COMMIT;");
 });
}

export function recoverPackageSwap(root:string) {
 const paths=swapPaths(root);
 if(!lstatSync(paths.file,{throwIfNoEntry:false}))return 'no_transaction';
 return withJournal(paths,db=>{
  db.exec('BEGIN IMMEDIATE;');
  const swap=readSwap(db);
  if(swap?.phase==='applying')return rollBack(paths,db,swap);
  return swap?.phase??'no_transaction';
 });
}

export function readPackageSwapPhase(root:string) {
 if(!lstatSync(join(root,'.durebak-update'),{throwIfNoEntry:false}))return 'no_transaction';
 const paths=swapPaths(root);
 if(!lstatSync(paths.file,{throwIfNoEntry:false}))return 'no_transaction';
 inspectJournal(paths);
 const db=new DatabaseSync(paths.file,{readOnly:true});
 try{return readSwap(db)?.phase??'no_transaction';}finally{db.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,root]=process.argv.slice(2);
 if((action!=='--recover'&&action!=='--status')||!root||process.argv.length!==4)stop('update_swap_invalid_arguments');
 try{process.stdout.write(JSON.stringify({phase:action==='--recover'?recoverPackageSwap(root):readPackageSwapPhase(root)})+'\n');}
 catch(error){
  const busy=(error as {errcode?:number}).errcode===5;
  process.stdout.write(JSON.stringify({phase:busy?'busy':'repair_required'})+'\n');
  process.exitCode=1;
 }
}
