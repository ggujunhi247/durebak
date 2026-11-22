import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {configFile,probeCommand,safeTool,usage} from './common.mjs';
import {runBounded} from '../host-lab.mjs';

const tools=['durebak_receive','durebak_ack','durebak_send'];
const unverified=()=>new Error('configuration_unverified');

export function validateAgyHome(path){
 if(!path||typeof process.getuid!=='function')throw unverified();
 const home=resolve(path);
 const gemini=join(home,'.gemini'),profile=join(gemini,'antigravity-cli'),config=join(gemini,'config');
 try{
  if(home===realpathSync(homedir()))throw unverified();
  for(const dir of [home,gemini,profile]){
   const stat=lstatSync(dir);
   if(realpathSync(dir)!==dir||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw unverified();
  }
  if(readdirSync(home).some(name=>name!=='.gemini')||readdirSync(gemini).some(name=>!['antigravity-cli','config'].includes(name)))throw unverified();
  if(readdirSync(profile).some(name=>name==='settings.json'||name==='plugins'||name==='hooks.json'))throw unverified();
  if(existsSync(config)&&(realpathSync(config)!==config||readdirSync(config).length))throw unverified();
 }catch{throw unverified();}
 return {home,profile,config};
}

export default {
 id:'antigravity-cli',
 probe:({signal}={})=>probeCommand('agy',null,signal),
 buildInvocation({sessionFile,configDir,allowedTools,model,agyHome}){
  if(allowedTools.map(name=>'durebak_'+name).join(',')!==tools.join(','))throw unverified();
  const {home,profile,config}=validateAgyHome(agyHome);
  const bridge=JSON.parse(readFileSync(configFile('claude-code',sessionFile,configDir),'utf8')).mcpServers.durebak;
  const permission={allow:tools.map(tool=>'mcp(durebak/'+tool+')'),deny:['command','unsandboxed','read_file','write_file','read_url','execute_url','download_url'].map(action=>action+'(*)')};
  const settings={toolPermission:'request-review',agentMode:'',permissions:permission};
  const mcp={mcpServers:{durebak:{...bridge,enabledTools:tools,tools:Object.fromEntries(tools.map(tool=>[tool,{eager:true}])),timeoutSeconds:20}}};
  const env={...process.env,HOME:home,AGY_CLI_DISABLE_AUTO_UPDATE:'true'};
  for(const name of ['CONFIG','DATA','CACHE','STATE']){
   const path=join(configDir,'agy-'+name.toLowerCase());mkdirSync(path,{mode:0o700});env['XDG_'+name+'_HOME']=path;
  }
  mkdirSync(config,{recursive:true,mode:0o700});
  const owned=[];
  function dispose(){for(const [path,text] of owned)if(existsSync(path)&&!lstatSync(path).isSymbolicLink()&&readFileSync(path,'utf8')===text)unlinkSync(path);}
  try{
   for(const [path,value] of [[join(profile,'settings.json'),settings],[join(config,'mcp_config.json'),mcp]]){
    const text=JSON.stringify(value);
    writeFileSync(path,text,{flag:'wx',mode:0o600});owned.push([path,text]);
   }
  }catch(error){dispose();throw error;}
  return {command:'/bin/sh',args:['-c','exec "$@" --print "$(cat)"','durebak-agy','agy','--sandbox','--disable-slash-commands','--print-timeout','60s','--output-format','stream-json','--log-file',join(configDir,'agy.log'),...(model?['--model',model]:[])],env,dispose};
 },
 async verifyConfiguration(invocation,{cwd,signal}){
  const result=await runBounded('agy',['mcp','list'],{cwd,signal,env:invocation.env,timeoutMs:10000});
  return result.code===0&&!result.reason&&/\bdurebak\b/.test(result.stdout);
 },
 classifyFrame(frame){
  if(frame.event==='init'){
   const init=frame.init;
   if(init?.permission_mode!=='request-review'||!Array.isArray(init.tools)||init.tools.some(name=>typeof name==='string'&&name.startsWith('mcp_')&&!tools.includes(name.replace(/^mcp_durebak_/,''))))return {error:'configuration_unverified'};
  }
  if(frame.event==='step_update'&&frame.step_update?.state==='DONE'&&frame.step_update.step_type==='tool'){
   const step=frame.step_update;
   const name=(step.tool_name??step.tool_info?.name)?.replace(/^mcp_durebak_/,'');
   if(!tools.includes(name))return {error:'configuration_unverified'};
   return {tool:{name:safeTool(name),status:step.tool_info?.error?'failed':'completed'}};
  }
  if(frame.event==='result'){
   const result=frame.result;
   const error=result?.status==='SUCCESS'?null:/authentication required|not authenticated|sign in/i.test(String(result?.error??''))?'authentication_failed':'host_reported_error';
   return {error,usage:usage('antigravity-cli',result?.usage,['input_tokens','output_tokens','cache_read_tokens'])};
  }
  return null;
 }
};
