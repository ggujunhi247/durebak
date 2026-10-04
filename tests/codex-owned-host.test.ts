import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NativeProfileFence} from '../src/native-profile-fence.js';
import {startOwnedCodexHost} from '../src/codex-owned-host.js';
function fixture(t:test.TestContext,mode='normal'){
 const root=mkdtempSync(join(tmpdir(),'durebak-owned-host-')),profile=join(root,'profile'),input=join(root,'input'),binary=join(root,'codex-fixture');mkdirSync(profile,{mode:0o700});mkdirSync(input,{mode:0o700});const cwd=realpathSync.native(input);writeFileSync(join(profile,'config.toml'),`approval_policy = "never"\ndefault_permissions = "durebak-scoped"\n[permissions.durebak-scoped.filesystem]\n":minimal" = "read"\n${JSON.stringify(cwd)} = "read"\n[permissions.durebak-scoped.network]\nenabled = false\n`,{mode:0o600});writeFileSync(join(profile,'fixture-mode'),mode,{mode:0o600});
 writeFileSync(binary,`#!${process.execPath}
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
const profile=process.env.CODEX_HOME,mode=readFileSync(join(profile,'fixture-mode'),'utf8');
if(process.argv[2]==='--version'){console.log('codex-cli '+(mode==='version'?'0.1.0':'0.146.0'));process.exit(0);}
if(process.argv.slice(2).join(' ')!=='app-server --listen stdio://')process.exit(4);
let held=false;const db=new DatabaseSync(join(profile,'.durebak-owner-lock.sqlite'));try{db.exec('BEGIN IMMEDIATE');}catch{held=true;}finally{db.close();}
writeFileSync(join(profile,'trace.json'),JSON.stringify({pid:process.pid,held,credential_env:!!(process.env.OPENAI_API_KEY||process.env.CODEX_ACCESS_TOKEN||process.env.DUREBAK_SESSION_FILE),calls:[]}));
if(mode==='descendant'||mode==='inherited-pipes'){const ready=join(profile,'helper-pid');spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);require('node:fs').writeFileSync(process.argv[1],String(process.pid));",ready],{stdio:mode==='inherited-pipes'?['ignore','inherit','inherit']:'ignore'});while(!readFileReady(ready))await new Promise(resolve=>setTimeout(resolve,5));}
function readFileReady(path){try{return !!readFileSync(path,'utf8');}catch{return false;}}
if(mode==='ignore-term'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
const cwd=process.cwd(),thread={id:'owned-thread',cliVersion:'0.146.0',createdAt:1,updatedAt:1,cwd,ephemeral:false,modelProvider:'openai',preview:'',sessionId:'host-session',source:'appServer',status:{type:'idle'},turns:[]};
let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const message=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const trace=JSON.parse(readFileSync(join(profile,'trace.json'),'utf8'));trace.calls.push(message.method);writeFileSync(join(profile,'trace.json'),JSON.stringify(trace));let result;
if(mode==='silence'&&message.method==='initialize')continue;
if(message.method==='initialize')result={userAgent:'codex-cli/0.146.0',platformFamily:'unix',platformOs:'test'};
else if(message.method==='initialized')continue;
else if(message.method==='thread/loaded/list')result={data:mode==='loaded'?['existing-thread']:[]};
else if(message.method==='config/read')result={config:{approval_policy:'never',default_permissions:'durebak-scoped',mcp_servers:{},model_providers:{},model_provider:null,sandbox_mode:null,permissions:{'durebak-scoped':{filesystem:{':minimal':'read',[cwd]:'read',glob_scan_max_depth:null},network:{enabled:false},extends:null}}},origins:{}};
else if(message.method==='thread/start'){if(message.params.permissions!=='durebak-scoped'||message.params.approvalPolicy!=='never'||message.params.ephemeral!==false)process.exit(5);result={thread,cwd,model:'fixture-model',modelProvider:'openai',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'},activePermissionProfile:{id:mode==='permission'?'foreign':'durebak-scoped'},instructionSources:mode==='instructions'?['foreign-instructions']:[]};}
else if(message.method==='mcpServerStatus/list')result={data:mode==='mcp'?[{name:'foreign'}]:[],nextCursor:null};
else if(message.method==='command/exec'){if(message.params.permissionProfile!=='durebak-scoped'||message.params.cwd!==cwd)process.exit(6);const [command,path]=message.params.command;const allowed=path.startsWith(cwd+'/')&&!path.includes('symlink')&&command==='/bin/cat';result={stdout:allowed?readFileSync(path,'utf8'):mode==='scope'?'CANARY':'',stderr:'',exitCode:allowed?0:mode==='scope'?0:1};}
else if(message.method==='thread/read')result={thread};
else if(message.method==='account/read')result={requiresOpenaiAuth:true,account:null};
else process.exit(7);
process.stdout.write(JSON.stringify({id:message.id,result})+'\\n');}});
`,{mode:0o700});const hosts:Awaited<ReturnType<typeof startOwnedCodexHost>>[]=[];t.after(async()=>{for(const host of hosts)await host.close();if(existsSync(join(profile,'helper-pid'))){try{process.kill(Number(readFileSync(join(profile,'helper-pid'),'utf8')),'SIGKILL');}catch{}}rmSync(root,{recursive:true,force:true});});return {root,profile,cwd,binary,options:{binary,profile,cwd,instance:'owner',timeoutMs:1000,shutdownMs:50},hold(host:Awaited<ReturnType<typeof startOwnedCodexHost>>){hosts.push(host);return host;},trace(){return JSON.parse(readFileSync(join(profile,'trace.json'),'utf8')) as {pid:number;held:boolean;credential_env:boolean;calls:string[]};}};
}
test('owned factory locks before bootstrap and creates only a fresh scoped native thread',async t=>{const f=fixture(t),host=f.hold(await startOwnedCodexHost(f.options));assert.equal(host.metadata.nativeId,'owned-thread');assert.equal(host.metadata.profile,realpathSync.native(f.profile));assert.equal(host.metadata.model_verified,false);assert.equal(f.trace().held,true);assert.equal(f.trace().credential_env,false);assert.deepEqual(f.trace().calls.slice(0,5),['initialize','initialized','thread/loaded/list','config/read','thread/start']);assert.deepEqual(await host.attach('binding').health(),{readiness:'unknown',auth:'required',entitlement:'unverified'});assert.equal(f.trace().calls.some(m=>m==='turn/start'||m==='thread/resume'),false);});
test('second factory cannot start another host for a claimed profile',async t=>{const f=fixture(t);f.hold(await startOwnedCodexHost(f.options));await assert.rejects(startOwnedCodexHost(f.options),/native_owner_exists/);assert.equal(f.trace().calls.filter(m=>m==='initialize').length,1);});
test('unsupported installed version fails before app-server and leaves unknown ownership',async t=>{const f=fixture(t,'version');await assert.rejects(startOwnedCodexHost(f.options),/native_host_bootstrap_failed/);assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});
for(const mode of ['loaded','permission','instructions','mcp','scope','silence'])test('bootstrap refuses '+mode+' without native resume or model input',async t=>{const f=fixture(t,mode);await assert.rejects(startOwnedCodexHost({...f.options,timeoutMs:80}),/native_host_bootstrap_failed/);const trace=f.trace();assert.equal(trace.calls.some(m=>m==='turn/start'||m==='thread/resume'),false);assert.throws(()=>process.kill(trace.pid,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});
test('normal close waits for process exit and leaves unknown rather than reusable ownership',async t=>{const f=fixture(t),host=f.hold(await startOwnedCodexHost(f.options)),pid=f.trace().pid;host.attach('binding');await host.close();await host.close();assert.throws(()=>process.kill(pid,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');assert.throws(()=>host.attach('binding'),/native_host_closed/);});
test('host that ignores graceful stop is terminated before ownership release',async t=>{const f=fixture(t,'ignore-term'),host=f.hold(await startOwnedCodexHost(f.options)),pid=f.trace().pid;await host.close();assert.throws(()=>process.kill(pid,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});
test('changed or ambient profile configuration is refused before ownership acquisition',async t=>{const f=fixture(t);writeFileSync(join(f.profile,'config.toml'),'sandbox_mode="danger-full-access"\n',{mode:0o600});await assert.rejects(startOwnedCodexHost(f.options),/native_profile_config_mismatch/);});

test('close terminates descendants that outlive the host and ignore graceful stop',async t=>{const f=fixture(t,'descendant'),host=f.hold(await startOwnedCodexHost({...f.options,shutdownMs:1000})),helper=Number(readFileSync(join(f.profile,'helper-pid'),'utf8'));await host.close();assert.throws(()=>process.kill(helper,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});

test('unexpected leader exit also terminates its remaining owned group',async t=>{const f=fixture(t,'descendant'),host=f.hold(await startOwnedCodexHost({...f.options,shutdownMs:1000})),helper=Number(readFileSync(join(f.profile,'helper-pid'),'utf8'));process.kill(f.trace().pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,40));assert.throws(()=>host.attach('binding'),/native_host_closed/);await host.close();assert.throws(()=>process.kill(helper,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});

test('leader exit retires the host even when descendants retain stdout and stderr',async t=>{const f=fixture(t,'inherited-pipes'),host=f.hold(await startOwnedCodexHost({...f.options,shutdownMs:1000})),helper=Number(readFileSync(join(f.profile,'helper-pid'),'utf8'));process.kill(f.trace().pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,100));assert.throws(()=>host.attach('binding'),/native_host_closed/);await host.close();assert.throws(()=>process.kill(helper,0));assert.equal(NativeProfileFence.inspect(f.profile).state,'unknown');});
