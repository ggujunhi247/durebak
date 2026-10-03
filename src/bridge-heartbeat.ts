import {DomainError} from './domain.js';
export interface HeartbeatDependencies {
 instance:string;
 runtimeInfo():Promise<{daemon_epoch?:string|undefined;capabilities?:string[]|undefined}>;
 touch(instance:string,epoch:string):Promise<void>;
 close(instance:string,epoch:string):Promise<void>;
 schedule(fn:()=>void,delayMs:number):unknown;
 cancel(handle:unknown):void;
}
export function startBridgeHeartbeat(deps:HeartbeatDependencies):{stop():Promise<void>} {
 let stopped=false,handle:unknown,epoch:string|undefined,failures=0;
 let pending:Promise<void>=Promise.resolve();let stopping:Promise<void>|undefined;
 const schedule=(delay:number)=>{if(!stopped)handle=deps.schedule(()=>{handle=undefined;pending=run();},delay);};
 async function run():Promise<void>{
  try{
   const info=await deps.runtimeInfo();if(stopped)return;
   if(!info.daemon_epoch||!info.capabilities?.includes('session_health_v1')){schedule(60000);return;}
   epoch=info.daemon_epoch;await deps.touch(deps.instance,epoch);if(stopped)return;
   failures=0;schedule(10000);
  }catch(error){
   if(error instanceof DomainError&&error.code==='unauthorized'){stopped=true;return;}
   schedule(Math.min(60000,10000*2**Math.min(failures++,3)));
  }
 }
 pending=run();
 return {stop(){
  if(stopping)return stopping;
  stopped=true;if(handle!==undefined){deps.cancel(handle);handle=undefined;}
  stopping=(async()=>{await pending;if(epoch){try{await deps.close(deps.instance,epoch);}catch{/* Contact expiry remains authoritative if graceful close fails. */}}})();
  return stopping;
 }};
}
