import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {version} from './version.js';
import {fail} from './domain.js';
import {checkUpdates,updateChannel,channelForVersion,compareVersions} from './updates.js';
import {loadUpdateState,changeUpdateState,runUpdateWorker,type UpdateState} from './update-state.js';
import {installUpdateSchedule,removeUpdateSchedule,type ScheduleRunner} from './update-scheduler.js';
import {automaticUpdateBlockers} from './update-trust.js';
export interface UpdateCommandContext {directory:string;current:string;platform:string;home:string;uid:number;node:string;cli:string}
export interface UpdateCommandOptions {mode?:string;channel?:string;target?:string}
export function updateCommandContext(directory?:string):UpdateCommandContext{return {directory:resolve(directory??join(homedir(),'.durebak-updater')),current:version,platform:process.platform,home:homedir(),uid:process.geteuid?.()??-1,node:process.execPath,cli:fileURLToPath(new URL('./cli.js',import.meta.url))};}
function newerVersions(state:UpdateState,current:string){return state.report?[state.report.npm,state.report.github].filter(s=>s.status==='update_available'&&s.version!==null&&compareVersions(s.version,current)>0).map(s=>s.version):[];}
function status(state:UpdateState,context:UpdateCommandContext){return {current:context.current,mode:state.mode,channel:state.channel,pin:state.pin,last_checked_at:state.last_checked_at,next_check_at:state.next_check_at,report:state.report,scheduler:state.scheduler,pending_notice:state.mode==='notify'&&newerVersions(state,context.current).length>0&&state.last_notice!==null&&state.last_notice!==state.last_shown_notice,automatic_apply:false,apply_blockers:automaticUpdateBlockers(context.platform)};}
export async function handleUpdateCommand(action:string,args:string[],options:UpdateCommandOptions,context:UpdateCommandContext=updateCommandContext(),run?:ScheduleRunner):Promise<unknown>{
 const directory=context.directory,current=context.current;
 if(!['check','status','enable','disable','pin','unpin','worker','apply'].includes(action))fail('unknown_update_command');
 if(args.length!==(action==='pin'?1:0))fail('invalid_update_arguments');
 if(options.channel!==undefined)updateChannel(options.channel);
 if(action==='apply'){
  if(!options.target)fail('missing_update_version');channelForVersion(options.target);fail('automatic_apply_not_configured');
 }
 if(action==='enable'){
  if(options.mode==='auto')fail('automatic_apply_not_configured');
  if(options.mode!=='notify')fail('invalid_update_mode');if(!options.channel)fail('missing_update_channel');
  const channel=updateChannel(options.channel);
  const state=changeUpdateState(directory,current,state=>{
   const cache=state.channel===channel?{}:{report:null,last_notice:null,last_shown_notice:null,last_checked_at:null};
   const receipt=installUpdateSchedule({...context,directory},run);
   return {...state,...cache,mode:'notify',channel,next_check_at:null,scheduler:receipt.kind,scheduler_digest:receipt.digest};
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
 if(action==='worker')return runUpdateWorker(directory,current);
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
