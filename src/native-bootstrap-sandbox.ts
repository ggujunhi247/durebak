import {lstatSync,realpathSync,readdirSync} from 'node:fs';
import {isAbsolute,resolve,dirname,join} from 'node:path';
import {z} from 'zod';
import {fail} from './domain.js';
const pathSchema=z.string().min(1).max(4096).refine(p=>isAbsolute(p)&&!/[\x00-\x1f\x7f]/.test(p));
const optionsSchema=z.object({binary:pathSchema,runtimeRoot:pathSchema,inputRoot:pathSchema,ownerProfile:pathSchema,port:z.number().int().min(1).max(65535)}).strict();
const runtimeReads=['/System','/usr','/bin','/sbin','/opt/homebrew','/private/var/db/dyld','/private/var/db/timezone'];
const within=(path:string,root:string)=>path===root||path.startsWith(root+'/');
const overlap=(a:string,b:string)=>within(a,b)||within(b,a);
function canonical(path:string,directory:boolean){
 const normalized=resolve(path),stat=lstatSync(normalized),actual=realpathSync.native(normalized);
 if(stat.isSymbolicLink()||actual!==normalized)fail('native_bootstrap_invalid');
 if(directory){if(!stat.isDirectory()||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())fail('native_bootstrap_invalid');}
 else if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o022)!==0||(stat.mode&0o111)===0||(stat.uid!==0&&stat.uid!==process.getuid?.()))fail('native_bootstrap_invalid');
 return actual;
}
function stagedTree(root:string){
 let count=0;const visit=(path:string,depth:number)=>{if(depth>16)fail('native_bootstrap_invalid');for(const name of readdirSync(path)){if(++count>1024)fail('native_bootstrap_invalid');const entry=join(path,name),stat=lstatSync(entry);if(stat.uid!==process.getuid?.()||stat.isSymbolicLink())fail('native_bootstrap_invalid');if(stat.isDirectory())visit(entry,depth+1);else if(!stat.isFile()||stat.nlink!==1)fail('native_bootstrap_invalid');}};visit(root,0);
}
// Experimental macOS bootstrap boundary only. This compiles a command; it does
// not spawn, filter inherited environment, confer ownership or authorize tools.
// Stage private regular files only; caller must exclude concurrent mutations
// and revalidate immediately before spawn. These checks are not an OS lease.
// The caller must validate the environment, executable and live owner again.
export function compileNativeBootstrap(raw:unknown){
 try{
  const options=optionsSchema.parse(raw),binary=canonical(options.binary,false),runtime=canonical(options.runtimeRoot,true),input=canonical(options.inputRoot,true),owner=canonical(options.ownerProfile,true),roots=[runtime,input,owner];
  for(let i=0;i<roots.length;i++){const root=roots[i]!;if(runtimeReads.some(read=>overlap(root,read)))fail('native_bootstrap_invalid');for(let j=i+1;j<roots.length;j++)if(overlap(root,roots[j]!))fail('native_bootstrap_invalid');}
  if(roots.some(root=>within(binary,root)))fail('native_bootstrap_invalid');
  for(const root of roots)stagedTree(root);
  const parents=new Set<string>(['/','/private/var/db']);for(const path of [runtime,input,binary]){let parent=dirname(path);while(parent!=='/'){parents.add(parent);parent=dirname(parent);}}
  if(parents.size>128)fail('native_bootstrap_invalid');
  const literal=(p:string)=>`(literal ${JSON.stringify(p)})`,subpath=(p:string)=>`(subpath ${JSON.stringify(p)})`;
  const policy=['(version 1)','(deny default)','(deny process-info*)','(deny sysctl*)','(allow process-info-pidinfo (target self))','(allow process-exec)','(allow process-fork)','(allow signal (target same-sandbox))','(allow sysctl-read (sysctl-name-regex #"^hw[.]") (sysctl-name "kern.osrelease"))','(allow file-read-metadata)',`(allow file-read* ${[...parents].sort().map(literal).join(' ')} ${runtimeReads.map(subpath).join(' ')} ${literal(binary)})`,`(allow file-read* file-write* ${subpath(runtime)} ${subpath(input)})`,`(allow network-bind network-inbound (local ip "localhost:${options.port}"))`].join('\n');
  if(Buffer.byteLength(policy)>32768)fail('native_bootstrap_invalid');
  return Object.freeze({policy,binary,cwd:input});
 }catch{return fail('native_bootstrap_invalid');}
}
export function nativeBootstrapCommand(raw:unknown){
 if(process.platform!=='darwin')fail('native_bootstrap_unsupported');
 const compiled=compileNativeBootstrap(raw);return Object.freeze({command:'/usr/bin/sandbox-exec',args:Object.freeze(['-p',compiled.policy,compiled.binary]),cwd:compiled.cwd});
}
