// Investigation only: no production ACL or platform gates are changed here.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {release} from 'node:os';
import {sanitizeProbeResult} from './windows/probe-report.mjs';
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
const output=sanitizeProbeResult(result,{platform:'win32',arch:process.arch,os_release:release(),node:process.version});
console.log(JSON.stringify(output.report));
process.exitCode=output.exitCode;
