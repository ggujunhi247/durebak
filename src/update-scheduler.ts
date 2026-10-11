import {spawnSync} from 'node:child_process';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,unlinkSync,type Stats} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fail} from './domain.js';
export interface ScheduleOptions {home:string;platform:string;directory:string;node:string;cli:string;uid:number}
export interface ScheduleReceipt {kind:'launchd'|'systemd';digest:string}
export type ScheduleRunner=(command:string,args:string[])=>number;
const runner:ScheduleRunner=(command,args)=>{const result=spawnSync(command,args,{stdio:'ignore',timeout:10000,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME??'',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??'',DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS??''}});return result.status??-1;};
function id(options:ScheduleOptions){return 'com.durebak.updates.'+createHash('sha256').update(resolve(options.directory)).digest('hex').slice(0,20);}
function validate(options:ScheduleOptions){
 if(!['darwin','linux'].includes(options.platform)||options.uid===0||!Number.isSafeInteger(options.uid)||options.uid<0)fail('unsupported_update_scheduler');
 for(const value of [options.home,options.directory,options.node,options.cli])if(!isAbsolute(value)||/[\x00-\x1f\x7f]/.test(value))fail('unsafe_update_schedule_path');
}
const xml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const unitArg=(value:string)=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"';
export function scheduleFiles(options:ScheduleOptions):{path:string;text:string}[]{
 validate(options);const label=id(options);const args=[options.node,options.cli,'update','worker','--update-dir',resolve(options.directory)];
 if(options.platform==='darwin')return [{path:join(options.home,'Library','LaunchAgents',label+'.plist'),text:`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>\n`}];
 const base=join(options.home,'.config','systemd','user',label);
 return [{path:base+'.service',text:`[Unit]\nDescription=Durebak update notification check\n[Service]\nType=oneshot\nExecStart=${args.map(unitArg).join(' ')}\nTimeoutStartSec=30\n`},{path:base+'.timer',text:`[Unit]\nDescription=Durebak update notification timer\n[Timer]\nOnCalendar=*-*-* *:*:00\nPersistent=true\nUnit=${label}.service\n[Install]\nWantedBy=timers.target\n`}];
}
function safe(stat:Stats,directory:boolean){if(stat.uid!==process.geteuid?.()||(stat.mode&0o022)!==0||stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>16384))fail('unsafe_update_schedule');}
function parent(options:ScheduleOptions){
 safe(lstatSync(options.home),true);let path=options.home;
 for(const component of options.platform==='darwin'?['Library','LaunchAgents']:['.config','systemd','user']){path=join(path,component);try{mkdirSync(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}safe(lstatSync(path),true);}
}
const digest=(texts:string[])=>createHash('sha256').update(texts.join('\0')).digest('hex');
function read(path:string){safe(lstatSync(path),false);return readFileSync(path,'utf8');}
function command(options:ScheduleOptions,action:'install'|'remove',run:ScheduleRunner){
 const label=id(options);
 if(options.platform==='darwin'&&action==='install'&&run('/bin/launchctl',['print',`gui/${options.uid}/${label}`])===0)return;
 const commands=options.platform==='darwin'?action==='install'?[['/bin/launchctl','bootstrap',`gui/${options.uid}`,scheduleFiles(options)[0]!.path]]:[['/bin/launchctl','bootout',`gui/${options.uid}/${label}`]]:action==='install'?[['/usr/bin/systemctl','--user','daemon-reload'],['/usr/bin/systemctl','--user','enable','--now',label+'.timer']]:[['/usr/bin/systemctl','--user','disable','--now',label+'.timer']];
 for(const [exe,...args] of commands)if(run(exe!,args)!==0)fail('update_schedule_failed');
}
export function installUpdateSchedule(options:ScheduleOptions,run:ScheduleRunner=runner):ScheduleReceipt{
 validate(options);parent(options);const files=scheduleFiles(options),created:string[]=[];let registering=false;
 try{
  for(const file of files){try{const existing=read(file.path);if(existing!==file.text)fail('update_schedule_conflict');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;writeFileSync(file.path,file.text,{flag:'wx',mode:0o600});created.push(file.path);}}
  registering=true;command(options,'install',run);return {kind:options.platform==='darwin'?'launchd':'systemd',digest:digest(files.map(f=>f.text))};
 }catch(error){
  if(created.length){if(registering){try{command(options,'remove',run);}catch{/* disabled policy keeps any partial registration inert */}}for(const path of created){try{if(read(path)===files.find(f=>f.path===path)!.text)unlinkSync(path);}catch{/* preserve uncertain file */}}}
  throw error;
 }
}
export function removeUpdateSchedule(options:ScheduleOptions,receipt:ScheduleReceipt,run:ScheduleRunner=runner){
 validate(options);parent(options);const files=scheduleFiles(options);
 if(receipt.kind!==(options.platform==='darwin'?'launchd':'systemd')||digest(files.map(f=>read(f.path)))!==receipt.digest)fail('update_schedule_conflict');
 command(options,'remove',run);for(const file of files)unlinkSync(file.path);
 // The timer was already disabled and stopped before deleting its config.
 // A cache-refresh failure does not undo that completed removal.
 if(options.platform==='linux')run('/usr/bin/systemctl',['--user','daemon-reload']);
}
