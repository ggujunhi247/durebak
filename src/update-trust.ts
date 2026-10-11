import {verify,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {fail} from './domain.js';
import {releaseVersion,channelForVersion,compareVersions,type UpdateChannel} from './updates.js';
// No operational signing identity has been approved or published yet. Do not
// accept keys from downloaded metadata, environment variables, or CLI input.
const trustedUpdateKeys:Readonly<Record<string,KeyObject>>=Object.freeze({});
export function automaticUpdateBlockers(platform:string):string[]{
 return [...(platform==='win32'?['unsupported_storage_platform']:[]),...(Object.keys(trustedUpdateKeys).length===0?['release_trust_not_configured']:[]),'installation_owner_unverified','maintenance_gate_unavailable','recovery_worker_unavailable'];
}
const envelopeSchema=z.object({key_id:z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),payload:z.string().max(350000),signature:z.string().max(100)}).strict();
const timestamp=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const manifestSchema=z.object({schema:z.literal(1),package:z.literal('durebak'),version:releaseVersion,channel:z.enum(['alpha','beta','rc','stable']),platform:z.enum(['darwin','linux','win32']),arch:z.enum(['x64','arm64']),min_updater:releaseVersion,database_schema:z.number().int().nonnegative(),protocol:z.number().int().nonnegative(),issued_at:timestamp,expires_at:timestamp,artifact:z.object({url:z.string().max(300),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(67108864)}).strict()}).strict();
export interface UpdateManifestContext {current:string;channel:UpdateChannel;platform:string;arch:string;schema:number;protocol:number;now:number}
function base64(value:string){const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)fail('invalid_update_manifest');return bytes;}
export function verifyUpdateManifest(input:unknown,keys:Readonly<Record<string,KeyObject>>,context:UpdateManifestContext){
 const parsed=envelopeSchema.safeParse(input);if(!parsed.success)fail('invalid_update_manifest');const envelope=parsed.data;
 const key=Object.hasOwn(keys,envelope.key_id)?keys[envelope.key_id]:undefined;if(!key||key.asymmetricKeyType!=='ed25519')fail('unknown_update_key');
 const payload=base64(envelope.payload),signature=base64(envelope.signature);if(payload.length>262144||signature.length!==64)fail('invalid_update_manifest');
 if(!verify(null,payload,key,signature))fail('invalid_update_signature');
 let decoded:unknown;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}catch{fail('invalid_update_manifest');}
 const result=manifestSchema.safeParse(decoded);if(!result.success)fail('invalid_update_manifest');const release=result.data;
 if(!Number.isSafeInteger(context.now)||context.now<release.issued_at||release.expires_at<=context.now||release.expires_at<=release.issued_at||release.expires_at-release.issued_at>604800000)fail('expired_update_manifest');
 if(release.channel!==context.channel||channelForVersion(release.version)!==context.channel||release.platform!==context.platform||release.arch!==context.arch)fail('incompatible_update_manifest');
 if(release.database_schema!==context.schema||release.protocol!==context.protocol)fail('manual_migration_required');
 if(compareVersions(release.version,context.current)<=0||compareVersions(release.min_updater,context.current)>0)fail('incompatible_update_version');
 const url=`https://github.com/ggujunhi247/durebak/releases/download/v${release.version}/durebak-${release.version}.tgz`;
 if(release.artifact.url!==url)fail('unsafe_update_artifact');return release;
}
