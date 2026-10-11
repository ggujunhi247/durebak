import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,fstatSync,lstatSync,readSync,writeFileSync,renameSync,unlinkSync,fsyncSync,constants,type Stats} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {privateDirectory} from './database.js';
import {fail} from './domain.js';
import {checkUpdates,channelForVersion,releaseVersion,type UpdateReport,type UpdateRequest} from './updates.js';
const channel=z.enum(['stable','alpha','beta','rc']);
const source=z.object({status:z.enum(['update_available','up_to_date','installed_ahead','unavailable','pinned']),version:releaseVersion.nullable(),release_url:z.string().max(250).nullable(),install_command:z.string().max(250).nullable()}).strict().refine(s=>{
 if(s.version===null)return s.status==='unavailable'&&s.release_url===null&&s.install_command===null;
 return s.release_url===`https://github.com/ggujunhi247/durebak/releases/tag/v${s.version}`&&(s.install_command===null||s.install_command===`npm install --global durebak@${s.version} --registry=https://registry.npmjs.org`);
});
const reportSchema=z.object({current:releaseVersion,channel,automatic_apply:z.literal(false),installation_owner:z.literal('unverified'),installation_guide_url:z.literal('https://github.com/ggujunhi247/durebak/blob/main/docs/INSTALLATION.md'),npm:source,github:source}).strict();
const stateSchema=z.object({schema:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),mode:z.enum(['disabled','notify']),channel,pin:releaseVersion.nullable(),last_checked_at:z.number().int().nonnegative().nullable(),next_check_at:z.number().int().nonnegative().nullable(),report:reportSchema.nullable(),last_notice:z.string().regex(/^[a-f0-9]{64}$/).nullable(),scheduler:z.enum(['none','launchd','systemd']),scheduler_digest:z.string().regex(/^[a-f0-9]{64}$/).nullable(),last_shown_notice:z.string().regex(/^[a-f0-9]{64}$/).nullable()}).strict();
export type UpdateState=z.infer<typeof stateSchema>;
export function defaultUpdateState(current:string):UpdateState{return {schema:1,revision:0,mode:'disabled',channel:channelForVersion(current),pin:null,last_checked_at:null,next_check_at:null,report:null,last_notice:null,scheduler:'none',scheduler_digest:null,last_shown_notice:null};}
function missing(error:unknown){return (error as NodeJS.ErrnoException).code==='ENOENT';}
function checkFile(stat:Stats){if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.geteuid?.()||(stat.mode&0o077)!==0||stat.size>16384)fail('unsafe_update_state');}
function same(a:Stats,b:Stats){return a.dev===b.dev&&a.ino===b.ino;}
export function loadUpdateState(directory:string,current:string):UpdateState{
 try{lstatSync(directory);}catch(error){if(missing(error))return defaultUpdateState(current);throw error;}
 privateDirectory(directory);const file=join(directory,'state.json');let fd:number;
 try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(missing(error))return defaultUpdateState(current);throw error;}
 try{
  const stat=fstatSync(fd);checkFile(stat);const buffer=Buffer.alloc(16385);const count=readSync(fd,buffer,0,buffer.length,0);
  if(count>16384||!same(stat,lstatSync(file))||fstatSync(fd).size!==stat.size||count!==stat.size)fail('unsafe_update_state');
  const result=stateSchema.safeParse(JSON.parse(buffer.subarray(0,count).toString('utf8')));if(!result.success)fail('invalid_update_state');return result.data;
 }catch(error){if(error instanceof SyntaxError)fail('invalid_update_state');throw error;}finally{closeSync(fd);}
}
// SQLite owns the OS locks: process death releases coordination automatically.
// These files are never removed or reclaimed using PID/age guesses.
function lock(directory:string,name:string){
 privateDirectory(directory);const file=join(directory,name+'.sqlite');
 try{closeSync(openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const inspect=()=>{checkFile(lstatSync(file));for(const suffix of ['-wal','-shm','-journal']){try{checkFile(lstatSync(file+suffix));}catch(error){if(!missing(error))throw error;}}};
 inspect();const db=new DatabaseSync(file);
 try{db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');inspect();}
 catch(error){db.close();if((error as Error).message.includes('database is locked'))fail('update_state_busy');throw error;}
 return ()=>db.close();
}
export function changeUpdateState(directory:string,current:string,change:(state:UpdateState)=>UpdateState):UpdateState{
 const unlock=lock(directory,'writer.lock');let temporary:string|undefined;
 try{
  const previous=loadUpdateState(directory,current),next=stateSchema.parse({...change(previous),revision:previous.revision+1});
  const text=JSON.stringify(next)+'\n';if(Buffer.byteLength(text)>16384)fail('update_state_too_large');
  temporary=join(directory,`.state-${randomUUID()}.json`);const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,join(directory,'state.json'));temporary=undefined;
  const directoryFd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{fsyncSync(directoryFd);}finally{closeSync(directoryFd);}
  return next;
 }finally{if(temporary!==undefined)unlinkSync(temporary);unlock();}
}
export async function runUpdateWorker(directory:string,current:string,request?:UpdateRequest,now=Date.now()):Promise<{checked:boolean;notice:boolean;report?:UpdateReport;reason?:string}>{
 const initial=loadUpdateState(directory,current);
 if(initial.mode!=='notify'||(initial.next_check_at!==null&&initial.next_check_at>now))return {checked:false,notice:false};
 if(initial.last_checked_at!==null&&now<initial.last_checked_at)return {checked:false,notice:false,reason:'clock_reversed'};
 const unlock=lock(directory,'worker.lock');
 try{
  const before=loadUpdateState(directory,current);
  if(before.mode!=='notify'||before.revision!==initial.revision)return {checked:false,notice:false};
  const report=await checkUpdates({current,channel:before.channel,...(before.pin===null?{}:{pin:before.pin})},request);
  const fingerprint=createHash('sha256').update(JSON.stringify([report.channel,report.npm.status,report.npm.version,report.github.status,report.github.version])).digest('hex');
  let notice=false,committed=false;
  changeUpdateState(directory,current,state=>{
   if(state.revision!==before.revision||state.mode!=='notify')return state;
   notice=[report.npm.status,report.github.status].includes('update_available')&&fingerprint!==state.last_notice;committed=true;
   return {...state,report,last_checked_at:now,next_check_at:now+3600000,last_notice:notice?fingerprint:state.last_notice};
  });
  return committed?{checked:true,notice,report}:{checked:false,notice:false,reason:'policy_changed'};
 }finally{unlock();}
}
