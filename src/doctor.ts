import { z } from 'zod';
import { credential, request } from './client.js';
import { DomainError } from './domain.js';
import { version, protocolVersion } from './version.js';
import { schemaVersion } from './migrations.js';
import type {SessionHealth} from './health.js';
type CheckName='credential'|'runtime'|'identity'|'compatibility'|'bridge';
interface Check {name:CheckName;status:'pass'|'fail'|'unknown';reason_code:string;action:string}
const actions:Record<string,string>={
 unsupported_node:'Use Node.js 24 or later.',credential_unavailable:'Check the private session credential file.',
 daemon_unavailable:'Start the Durebak daemon and retry.',unauthorized:'Ask the user to register a new session credential.',
 incompatible_runtime:'Use a compatible Durebak client and daemon.',identity_mismatch:'Use the credential for the intended Durebak session.',
 version_mismatch:'Use matching Durebak client and daemon versions.',ready:'Durebak transport is ready; host readiness remains unverified.',
 bridge_unknown:'Connect a session-scoped MCP bridge; this does not resume a native session.',
 bridge_fresh:'Bridge contact is recent; check declared availability separately.',bridge_stale:'Check the MCP bridge connection and retry later.',
 bridge_offline:'Reconnect the MCP bridge; native process state remains unverified.',
};
const healthSchema=z.object({session_id:z.string(),bridge:z.object({state:z.enum(['unknown','fresh','stale','offline']),last_seen_at:z.number().nullable(),active_count:z.number().int().nonnegative(),duplicate:z.boolean()}),last_activity_at:z.number().nullable(),availability:z.enum(['available','busy','paused']),host:z.literal('unknown'),readiness:z.literal('unknown'),progress:z.literal('unknown'),auto_wake:z.literal(false)});
export interface DoctorResult {client_version:string;protocol_version:number;ok:boolean;code:string;checks:Check[];runtime_version?:string;schema_version?:number;session_id?:string;health?:SessionHealth}
export async function doctor(file: string):Promise<DoctorResult> {
 const base={client_version:version,protocol_version:protocolVersion};
 const checks:Check[]=(['credential','runtime','identity','compatibility','bridge'] as const).map(name=>({name,status:'unknown',reason_code:'not_checked',action:'Resolve earlier checks first.'}));
 const mark=(name:CheckName,status:Check['status'],code:string)=>{Object.assign(checks.find(x=>x.name===name)!,{status,reason_code:code,action:actions[code]??'Check Durebak session authorization and retry.'});};
 const failure=(code:string,name:CheckName,extra:{runtime_version?:string}={})=>{mark(name,'fail',code);return {...base,ok:false,code,checks,...extra};};
 if(Number(process.versions.node.split('.')[0])<24)return failure('unsupported_node','compatibility');
 let identity:ReturnType<typeof credential>;
 try{identity=credential(file);}catch{return failure('credential_unavailable','credential');}
 mark('credential','pass','ready');
 try{
  const result=await request(identity.data_dir,identity.token,'/v1/session',{operation:'runtime_info',args:{}});
  const info=z.object({version:z.string(),protocol_version:z.number(),schema_version:z.number(),session_id:z.string(),daemon_epoch:z.string().optional(),capabilities:z.array(z.string()).optional()}).safeParse(result);
  if(!info.success)return failure('incompatible_runtime','compatibility');
  mark('runtime','pass','ready');
  if(info.data.protocol_version!==protocolVersion||info.data.schema_version!==schemaVersion)return failure('incompatible_runtime','compatibility');
  if(info.data.session_id!==identity.session.id)return failure('identity_mismatch','identity');
  mark('identity','pass','ready');
  if(info.data.version!==version)return failure('version_mismatch','compatibility',{runtime_version:info.data.version});
  mark('compatibility','pass','ready');
  let health:SessionHealth|undefined;
  if(info.data.capabilities?.includes('session_health_v1')){
   const observed=healthSchema.safeParse(await request(identity.data_dir,identity.token,'/v1/session',{operation:'session_health',args:{}}));
   if(observed.success&&observed.data.session_id===identity.session.id)health=observed.data;
  }
  mark('bridge',health?.bridge.state==='fresh'?'pass':'unknown',`bridge_${health?.bridge.state??'unknown'}`);
  return {...base,ok:true,code:'ready',runtime_version:info.data.version,schema_version:info.data.schema_version,session_id:info.data.session_id,checks,...(health?{health}:{})};
 }catch(error){
  const code=error instanceof DomainError?(error.code==='invalid_input'?'incompatible_runtime':error.code):'daemon_unavailable';
  return failure(code,'runtime');
 }
}
