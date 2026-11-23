import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {version} from './version.js';
import {DomainError,fail} from './domain.js';
import {checkUpdates,updateChannel,channelForVersion,compareVersions} from './updates.js';
import {loadUpdateState,changeUpdateState,runUpdateWorker,type UpdateState} from './update-state.js';
import {installUpdateSchedule,removeUpdateSchedule,type ScheduleRunner} from './update-scheduler.js';
import {automaticUpdateBlockers} from './update-trust.js';
import {applyAutomaticUpdate,verifyAutomaticPolicy} from './update-auto.js';
export interface UpdateCommandContext {directory:string;current:string;platform:string;home:string;uid:number;node:string;cli:string}
export interface UpdateCommandOptions {mode?:string;channel?:string;target?:string}
const automatic={verify:verifyAutomaticPolicy,apply:applyAutomaticUpdate};
export function updateCommandContext(directory?:string):UpdateCommandContext{return {directory:resolve(directory??join(homedir(),'.durebak-updater')),current:version,platform:process.platform,home:homedir(),uid:process.geteuid?.()??-1,node:process.execPath,cli:fileURLToPath(new URL('./cli.js',import.meta.url))};}
function newerVersions(state:UpdateState,current:string){return state.report?[state.report.npm,state.report.github].filter(s=>s.status==='update_available'&&s.version!==null&&compareVersions(s.version,current)>0).map(s=>s.version):[];}
function status(state:UpdateState,context:UpdateCommandContext){return {current:context.current,mode:state.mode,channel:state.channel,pin:state.pin,last_checked_at:state.last_checked_at,next_check_at:state.next_check_at,report:state.report,scheduler:state.scheduler,pending_notice:state.mode==='notify'&&newerVersions(state,context.current).length>0&&state.last_notice!==null&&state.last_notice!==state.last_shown_notice,automatic_apply:state.mode==='auto'&&state.auto_path!==undefined,last_apply:state.last_apply??null,apply_blockers:automaticUpdateBlockers(context.platform)};}

async function applyTarget(context:UpdateCommandContext,state:UpdateState,target:string,installer:typeof automatic){
 if(state.mode!=='auto'||!state.auto_path)fail('automatic_apply_not_configured');
 if(state.pin!==null)fail('update_version_pinned');
 try{
  await installer.apply(context,state.auto_path,state.channel,target,install=>{
   changeUpdateState(context.directory,context.current,current=>{
    if(current.revision!==state.revision||current.mode!=='auto')fail('update_policy_changed');
    install();
    return {...current,last_apply:{version:target,phase:'applied',reason:null}};
   });
  });
 }catch(error){
  if(error instanceof DomainError&&error.code==='update_policy_changed')return {version:target,phase:'blocked',reason:error.code};
  const result={version:target,phase:'blocked' as const,reason:error instanceof DomainError?error.code:'update_apply_failed'};
  changeUpdateState(context.directory,context.current,current=>current.revision===state.revision&&current.mode==='auto'?{...current,last_apply:result}:current);
  return result;
 }
 return {version:target,phase:'applied',reason:null};
}
export async function handleUpdateCommand(action:string,args:string[],options:UpdateCommandOptions,context:UpdateCommandContext=updateCommandContext(),run?:ScheduleRunner,installer=automatic):Promise<unknown>{
 const directory=context.directory,current=context.current;
 if(!['check','status','enable','disable','pin','unpin','worker','apply'].includes(action))fail('unknown_update_command');
 if(args.length!==(action==='pin'?1:0))fail('invalid_update_arguments');
 if(options.channel!==undefined)updateChannel(options.channel);
 if(action==='apply'){
  if(!options.target)fail('missing_update_version');channelForVersion(options.target);return applyTarget(context,loadUpdateState(directory,current),options.target,installer);
 }
 if(action==='enable'){
  const mode=options.mode;
  if(mode!=='notify'&&mode!=='auto')fail('invalid_update_mode');if(!options.channel)fail('missing_update_channel');
  const channel=updateChannel(options.channel);
  const autoPath=process.env.PATH??'';
  if(mode==='auto')installer.verify(context,autoPath);
  const state=changeUpdateState(directory,current,state=>{
   const cache=state.channel===channel?{}:{report:null,last_notice:null,last_shown_notice:null,last_checked_at:null};
   const receipt=installUpdateSchedule({...context,directory},run);
   return {...state,...cache,mode,channel,next_check_at:null,scheduler:receipt.kind,scheduler_digest:receipt.digest,...(mode==='auto'?{auto_path:autoPath}:{})};
  });return status(state,context);
 }
 if(action==='disable'){
  const disabled=changeUpdateState(directory,current,state=>({...state,mode:'disabled',next_check_at:null}));
  if(disabled.scheduler!=='none'){
   const state=changeUpdateState(directory,current,state=>{
    if(state.mode!=='disabled'||state.scheduler==='none')return state;
    if(!state.scheduler_digest)fail('invalid_update_state');
    removeUpdateSchedule({...context,directory},{kind:state.scheduler,digest:state.scheduler_digest},run);
    return {...state,scheduler:'none',scheduler_digest:null};
   });return status(state,context);
  }return status(disabled,context);
 }
 if(action==='pin'||action==='unpin'){
  const pin=action==='pin'?args[0]!:null;if(pin!==null)channelForVersion(pin);
  return status(changeUpdateState(directory,current,state=>({...state,pin,next_check_at:null,last_notice:null,last_shown_notice:null})),context);
 }
 const state=loadUpdateState(directory,current);
 if(action==='status')return status(state,context);
 if(action==='worker'){
  const result=await runUpdateWorker(directory,current);
  const selected=loadUpdateState(directory,current),report=result.report;
  if(result.checked&&selected.mode==='auto'&&selected.pin===null&&selected.channel===report?.channel&&report.npm.status==='update_available'&&report.github.status==='update_available'&&report.npm.version!==null&&report.npm.version===report.github.version){
   return {...result,apply:await applyTarget(context,selected,report.npm.version,installer)};
  }
  return result;
 }
 return checkUpdates({current,channel:options.channel===undefined?state.channel:updateChannel(options.channel),...(state.pin===null?{}:{pin:state.pin})});
}
// Called only for an interactive terminal. Uses cached data and never fetches.
export function cachedUpdateNotice(directory:string,current:string):string|null{
 const state=loadUpdateState(directory,current);
 if(state.mode!=='notify'||state.last_notice===null||state.last_notice===state.last_shown_notice||!state.report)return null;
 const versions=newerVersions(state,current);if(versions.length===0)return null;
 let shown=false;
 changeUpdateState(directory,current,next=>{
  if(next.revision!==state.revision||next.mode!=='notify')return next;shown=true;return {...next,last_shown_notice:state.last_notice};
 });
 return shown?`Durebak: 새 버전 ${[...new Set(versions)].join(', ')} — durebak update status로 배포처와 설치 방법을 확인하세요.\n`:null;
}
