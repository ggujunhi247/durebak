// Investigation only: no production ACL or platform gates are changed here.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {release} from 'node:os';
if(process.platform!=='win32'){
 console.log(JSON.stringify({status:'unsupported',reason:'windows_required'}));
 process.exit(2);
}
const shell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows/storage-probe.ps1',import.meta.url)),'-NodeExecutable',process.execPath],{encoding:'utf8',timeout:45000,maxBuffer:131072,windowsHide:true});
if(result.error||result.status!==0){
 // PowerShell errors may contain local paths; keep public diagnostics bounded.
 console.log(JSON.stringify({status:'failed',reason:result.error?'probe_process_failed':'probe_failed',platform:'win32',arch:process.arch,product_support:false}));
 process.exit(1);
}
const evidence=JSON.parse(result.stdout.trim().replace(/^\uFEFF/,''));
console.log(JSON.stringify({...evidence,platform:'win32',arch:process.arch,os_release:release(),node:process.version,product_support:false,cross_user_access:'not_tested',desktop_validation:'not_tested'}));
if(evidence.cases.some(item=>item.passed!==true))process.exitCode=1;
