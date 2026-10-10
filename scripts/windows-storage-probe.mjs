// Investigation only: no production ACL or platform gates are changed here.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {release} from 'node:os';
if(process.platform!=='win32'){
 console.log(JSON.stringify({status:'unsupported',reason:'windows_required'}));
 process.exit(2);
}
const shell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
// A pwsh7 -> Node -> powershell5 chain otherwise imports incompatible pwsh7
// modules. Restrict module lookup to this exact Windows PowerShell install.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
env.PSModulePath=join(dirname(shell),'Modules');
const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows/storage-probe.ps1',import.meta.url)),'-NodeExecutable',process.execPath],{env,encoding:'utf8',timeout:45000,maxBuffer:131072,windowsHide:true});
if(result.error||result.status!==0){
 // PowerShell errors may contain local paths; keep public diagnostics bounded.
 let detail={};
 try{const parsed=JSON.parse(result.stdout.trim());if(typeof parsed.stage==='string'&&/^[a-z_]+$/.test(parsed.stage))detail.stage=parsed.stage;if(typeof parsed.error_type==='string'&&/^[a-z]+$/.test(parsed.error_type))detail.error_type=parsed.error_type;if(typeof parsed.error_category==='string'&&/^[a-z]+$/.test(parsed.error_category))detail.error_category=parsed.error_category;if(typeof parsed.error_id==='string'&&/^[a-zA-Z0-9_.,]+$/.test(parsed.error_id))detail.error_id=parsed.error_id;if(Number.isInteger(parsed.error_code))detail.error_code=parsed.error_code;}catch{}
 console.log(JSON.stringify({status:'failed',reason:result.error?'probe_process_failed':'probe_failed',...detail,platform:'win32',arch:process.arch,product_support:false}));
 process.exit(1);
}
const evidence=JSON.parse(result.stdout.trim().replace(/^\uFEFF/,''));
console.log(JSON.stringify({...evidence,platform:'win32',arch:process.arch,os_release:release(),node:process.version,product_support:false,cross_user_access:'not_tested',desktop_validation:'not_tested'}));
if(evidence.cases.some(item=>item.passed!==true))process.exitCode=1;
