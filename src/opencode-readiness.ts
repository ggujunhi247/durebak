import {z} from 'zod';
import {fail,short} from './domain.js';
const identitySchema=z.object({nativeId:z.string().regex(/^ses_[A-Za-z0-9]+$/).max(200),providerId:short,modelId:short}).strict();
const statusSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('idle')}),z.object({type:z.literal('busy')}),
 z.object({type:z.literal('retry'),attempt:z.number().int().nonnegative(),next:z.number().int().nonnegative(),message:z.string().max(65536)})
]);
const statusesSchema=z.record(z.string().regex(/^ses_[A-Za-z0-9]+$/).max(200),statusSchema).refine(v=>Object.keys(v).length<=1000);
const providersSchema=z.object({all:z.array(z.object({id:short,models:z.record(short,z.unknown())})).max(256),connected:z.array(short).max(256)});
export function opencodeSessionState(raw:unknown,nativeId:string){const id=identitySchema.shape.nativeId.safeParse(nativeId),statuses=statusesSchema.safeParse(raw);if(!id.success||!statuses.success)fail('native_readiness_invalid');return statuses.data[id.data]?.type??'idle';}
// A native state snapshot and configured model are observations only. Callers
// must first verify the exact owned session; idle omissions are instance-local.
// Provider connected may include public-key bootstrapping: never auth/entitlement.
export function normalizeOpencodeReadiness(rawStatuses:unknown,rawProviders:unknown,rawIdentity:unknown){
 const identity=identitySchema.safeParse(rawIdentity),statuses=statusesSchema.safeParse(rawStatuses),providers=providersSchema.safeParse(rawProviders);
 if(!identity.success||!statuses.success||!providers.success)fail('native_readiness_invalid');
 const id=identity.data,all=providers.data.all,connected=providers.data.connected;if(new Set(all.map(p=>p.id)).size!==all.length||new Set(connected).size!==connected.length)fail('native_readiness_invalid');
 const selected=all.find(p=>p.id===id.providerId);if(selected&&Object.keys(selected.models).length>2048)fail('native_readiness_invalid');
 const model=selected&&Object.hasOwn(selected.models,id.modelId)?selected.models[id.modelId]:undefined;
 if(model!==undefined){const parsed=z.object({id:short}).safeParse(model);if(!parsed.success||parsed.data.id!==id.modelId)fail('native_readiness_invalid');}
 return {nativeState:opencodeSessionState(statuses.data,id.nativeId),model:model===undefined?'missing' as const:'available' as const,connection:connected.includes(id.providerId)?'present' as const:'absent' as const,auth:'unknown' as const,entitlement:'unverified' as const};
}
