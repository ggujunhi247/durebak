import {execFile,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {promisify} from 'node:util';
import {fail} from './domain.js';
import {schemaVersion} from './migrations.js';
import {downloadVerifiedUpdate} from './update-download.js';
import {npmRootForCli,verifyNpmUpdateOwner} from './update-installation.js';
import {acquireNpmInventory} from './update-inventory.js';
import {readPackageSwapPhase} from './update-package-swap.js';
import {applyStagedNpmUpdate} from './update-recovery.js';
import type {ScheduleRunner} from './update-scheduler.js';
import {automaticUpdateBlockers,trustedUpdateKeys} from './update-trust.js';
import type {UpdateChannel} from './updates.js';
import {protocolVersion} from './version.js';

const exec=promisify(execFile);
interface Context {directory:string;current:string;platform:string;home:string;uid:number;node:string;cli:string}
interface InstallerIo {keys?:typeof trustedUpdateKeys;fetcher?:typeof fetch;schedule?:ScheduleRunner}

export function automaticInstallation(context:Context,path:string) {
 const npmRoot=npmRootForCli(context.cli);
 if(!npmRoot||automaticUpdateBlockers(context.platform).length)fail('automatic_apply_not_configured');
 const options={...context,npmRoot,path,dataDirectories:[]};
 const owner=verifyNpmUpdateOwner(options);
 const node=realpathSync(context.node);
 const npm=join(dirname(dirname(node)),'lib','node_modules','npm','bin','npm-cli.js');
 const stat=lstatSync(npm,{throwIfNoEntry:false});
 if(!stat?.isFile()||stat.nlink!==1||![0,context.uid].includes(stat.uid)||(stat.mode&0o022)!==0||realpathSync(npm)!==npm)fail('update_npm_unavailable');
 return {options,owner,node,npm};
}

export function verifyAutomaticPolicy(context:Context,path:string){
 // Runtime inventory can be busy when the user opts in; worker checks it before staging.
 automaticInstallation(context,path);
}

export async function applyAutomaticUpdate(context:Context,path:string,channel:UpdateChannel,target:string,commit:(install:()=>void)=>void,io:InstallerIo={}) {
 const {options,owner,node,npm}=automaticInstallation(context,path);
 const inventory=acquireNpmInventory(options.npmRoot,[]);
 try{if(!inventory.directories.length)fail('maintenance_gate_unavailable');}finally{inventory.release();}
 const bytes=await downloadVerifiedUpdate(target,io.keys??trustedUpdateKeys,{current:context.current,channel,platform:context.platform,arch:process.arch,schema:schemaVersion,protocol:protocolVersion,now:Date.now()},io.fetcher);
 const staging=mkdtempSync(join(options.npmRoot,'.durebak-stage-'));
 const artifact=join(staging,'candidate.tgz'),emptyUser=join(staging,'user.npmrc'),emptyGlobal=join(staging,'global.npmrc');
 const environment={PATH:'/usr/bin:/bin',HOME:staging,TMPDIR:staging};
 try{
  for(const [file,content] of [[artifact,bytes],[emptyUser,''],[emptyGlobal,'']] as const)writeFileSync(file,content,{mode:0o600,flag:'wx'});
  const prefix=join(staging,'prefix');
  await exec(node,[npm,'install','--global','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=10000','--registry=https://registry.npmjs.org',`--userconfig=${emptyUser}`,`--globalconfig=${emptyGlobal}`,`--cache=${join(staging,'cache')}`,artifact],{cwd:staging,env:environment,timeout:12000,maxBuffer:262144});
  const candidate=join(prefix,'lib','node_modules','durebak');
  const probe=(cli:string,args:string[])=>execFileSync(node,[cli,...args],{cwd:staging,encoding:'utf8',env:environment,timeout:3000,maxBuffer:262144});
  if(probe(join(candidate,'dist','cli.js'),['--version']).trim()!==target||!probe(join(candidate,'dist','cli.js'),['--help']).includes('durebak dashboard'))fail('update_candidate_probe_failed');
  commit(()=>{
   applyStagedNpmUpdate(options,()=>probe(owner.launcher,['--version']).trim()===target,io.schedule,()=>{
    const transaction=join(options.npmRoot,'.durebak-update');
    if(readPackageSwapPhase(options.npmRoot)==='applying')fail('update_recovery_required');
    if(lstatSync(transaction,{throwIfNoEntry:false}))renameSync(transaction,join(options.npmRoot,'.durebak-previous-'+randomUUID()));
    mkdirSync(transaction,{mode:0o700});
    renameSync(candidate,join(transaction,'candidate'));
   });
  });
 }finally{rmSync(staging,{recursive:true,force:true});}
}
