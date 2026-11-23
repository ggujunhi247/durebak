import {execFileSync} from 'node:child_process';
import {closeSync,constants,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {acquireKnownMaintenance,privateDirectory} from './database.js';
import {fail} from './domain.js';
import {verifyNpmUpdateOwner} from './update-installation.js';
import {acquireNpmInventory} from './update-inventory.js';
import {applyPackageSwap,readPackageSwapPhase} from './update-package-swap.js';
import {installUpdateSchedule,removeUpdateSchedule,scheduleFiles,type ScheduleOptions,type ScheduleRunner} from './update-scheduler.js';

type StagedUpdate=Parameters<typeof verifyNpmUpdateOwner>[0]&{
 platform:string;node:string;directory:string;dataDirectories:readonly string[];
};

function createRecoveryEntry(path:string) {
 const source=readFileSync(new URL('./update-package-swap.js',import.meta.url));
 let fd:number|undefined;
 try{
  fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 }catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 if(fd!==undefined){try{writeFileSync(fd,source);fsyncSync(fd);}finally{closeSync(fd);}}
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.geteuid?.()||(stat.mode&0o077)!==0||stat.size!==source.length||!readFileSync(path).equals(source))fail('unsafe_update_recovery_entry');
}

function recoverySchedule(options:StagedUpdate):ScheduleOptions {
 const fingerprint=createHash('sha256').update(options.npmRoot).digest('hex').slice(0,20);
 const file=`recover-${fingerprint}.mjs`;
 const schedule={...options,node:realpathSync(options.node),cli:join(options.directory,file),recoveryRoot:options.npmRoot};
 scheduleFiles(schedule);
 if(readPackageSwapPhase(options.npmRoot)!=='no_transaction')fail('update_recovery_required');
 privateDirectory(options.directory);
 const directory=realpathSync(options.directory);
 const canonical={...schedule,directory,cli:join(directory,file)};
 scheduleFiles(canonical);
 createRecoveryEntry(canonical.cli);
 const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{fsyncSync(fd);}finally{closeSync(fd);}
 const status=execFileSync(canonical.node,[canonical.cli,'--status',options.npmRoot],{
  encoding:'utf8',timeout:5000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',HOME:options.home},
 });
 if(JSON.parse(status).phase!=='no_transaction')fail('update_recovery_required');
 return canonical;
}

// The caller has already verified and staged the candidate in the same npm root.
export function applyStagedNpmUpdate(options:StagedUpdate,verify:(directory:string)=>boolean,run?:ScheduleRunner,prepare?:()=>void) {
 verifyNpmUpdateOwner(options);
 const inventory=acquireNpmInventory(options.npmRoot,options.dataDirectories);
 let release:(()=>void)|undefined;
 try{
  release=acquireKnownMaintenance(inventory.directories);
  verifyNpmUpdateOwner(options);
  prepare?.();
  const schedule=recoverySchedule(options);
  const receipt=installUpdateSchedule(schedule,run);
  let recoveryScheduled=true;
  try{applyPackageSwap(options.npmRoot,verify);}
  finally{
   try{
    if(readPackageSwapPhase(options.npmRoot)!=='applying'){
     removeUpdateSchedule(schedule,receipt,run);
     recoveryScheduled=false;
    }
   }catch{/* A pending or unreadable transaction retains the independent recovery schedule. */}
  }
  return {phase:'committed' as const,recovery_scheduled:recoveryScheduled};
 }finally{try{release?.();}finally{inventory.release();}}
}
