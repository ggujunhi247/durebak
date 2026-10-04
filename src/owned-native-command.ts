import {spawn, type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fail} from './domain.js';
type Options={cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number;maxBytes:number};
/** Internal fixed-command execution. A settled callback is never retirement evidence. */
export class OwnedNativeCommand {
 readonly result:Promise<{stdout:string;stderr:string}>;
 readonly pid:number|undefined;
 #child:ChildProcess;#closed=false;#retired=false;#closing:Promise<void>|undefined;
 constructor(command:string,args:string[],options:Options){
  const child=this.#child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:true,stdio:['ignore','pipe','pipe']});this.pid=child.pid;
  const out:Buffer[]=[],err:Buffer[]=[];let bytes=0,failed=false,finished=false;
  let resolve!:(value:{stdout:string;stderr:string})=>void,reject!:(reason:unknown)=>void;
  this.result=new Promise((yes,no)=>{resolve=yes;reject=no;});
  // close() may run before a caller awaits result; retain rejection without hiding it.
  void this.result.catch(()=>{});
  const finish=async()=>{if(finished)return;finished=true;clearTimeout(timer);try{await this.close();if(failed||child.exitCode!==0)fail('native_command_failed');const decoder=new TextDecoder('utf-8',{fatal:true});resolve({stdout:decoder.decode(Buffer.concat(out)),stderr:decoder.decode(Buffer.concat(err))});}catch(error){reject(error);}};
  const collect=(target:Buffer[]) => (chunk:Buffer)=>{bytes+=chunk.length;if(bytes>options.maxBytes){failed=true;void finish();}else target.push(Buffer.from(chunk));};
  child.stdout!.on('data',collect(out));child.stderr!.on('data',collect(err));
  child.once('close',()=>{this.#closed=true;void finish();});
  child.once('exit',()=>{void finish();});child.once('error',()=>{failed=true;void finish();});
  const timer=setTimeout(()=>{failed=true;void finish();},options.timeoutMs);
 }
 get retired(){return this.#retired;}
 close(){if(this.#retired)return Promise.resolve();if(this.#closing)return this.#closing;
  this.#closing=this.retire().catch(error=>{this.#closing=undefined;throw error;});return this.#closing;
 }
 private async retire(){
  const deadline=Date.now()+1500;
  const gone=()=>{if(!this.pid)return this.#closed;try{process.kill(-this.pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}};
  // Only the detached group created here is addressed. EPERM is uncertainty.
  if(this.pid&&!gone()){try{process.kill(-this.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')fail('native_command_cleanup_unknown');}}
  while(Date.now()<deadline){if(this.#closed&&gone()){this.#retired=true;return;}await delay(10);}
  fail('native_command_cleanup_unknown');
 }
}
