import type {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {short,fail,hash,type Session} from './domain.js';
import {transaction} from './transactions.js';
export const managedBindSchema=z.object({sessionId:short,harness:z.literal('codex'),profile:short,nativeId:short,instance:short,key:short}).strict();
export const managedPolicySchema=z.object({bindingId:short,version:z.number().int().positive(),enabled:z.boolean(),key:short,maxTurns:z.number().int().min(1).max(30).optional(),maxConcurrent:z.number().int().min(1).max(3).optional(),allowedPeers:z.array(short).max(20).refine(v=>new Set(v).size===v.length,'duplicate peer').optional(),ttlMs:z.number().int().min(1).max(3600000).optional()}).strict();
export const managedRenewSchema=z.object({bindingId:short,epoch:z.number().int().positive(),ownerToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export interface ManagedPolicy {binding_id:string;version:number;enabled:boolean;scope_id:string;max_turns:number;max_concurrent:number;expires_at:number|null;grant_ttl_ms:number;expired:boolean;spent_turns:number;active_turns:number;allowed_peers:string}
interface Binding {id:string;session_id:string;workspace:string;harness:string;profile:string;native_id:string;instance:string;epoch:number;lease_until:number;created_ms:number;last_owner_contact_ms:number;last_observed_ms:number;execution_state:string;owner_hash:string;key:string;digest:string}
export class ManagedControl {
 constructor(private db:DatabaseSync,private clock:{now():number}){}
 private binding(id:string){const row=this.db.prepare('SELECT * FROM native_bindings WHERE id=?').get(id) as unknown as Binding|undefined;if(!row)fail('not_found');return row;}
 private metadata(row:Binding){const {owner_hash:_,key:__,digest:___,...metadata}=row;return metadata;}
 private policy(id:string):ManagedPolicy {const row=this.db.prepare('SELECT * FROM managed_policies WHERE binding_id=?').get(id) as unknown as Omit<ManagedPolicy,'enabled'|'expired'>&{enabled:number;expired:number};return {...row,enabled:!!row.enabled,expired:!!row.expired};}
 private observe(row:Binding,now:number){
  if(now>=row.lease_until||now<row.last_observed_ms)row.execution_state='unknown';
  row.last_observed_ms=Math.max(now,row.last_observed_ms);
  this.db.prepare('UPDATE native_bindings SET execution_state=?,last_observed_ms=? WHERE id=?').run(row.execution_state,row.last_observed_ms,row.id);
  this.db.prepare('UPDATE managed_policies SET expired=1 WHERE binding_id=? AND expires_at IS NOT NULL AND expires_at<=?').run(row.id,now);
  return row;
 }
 bind(input:z.input<typeof managedBindSchema>){const data=managedBindSchema.parse(input),digest=hash(JSON.stringify(data));return transaction(this.db,()=>{
  const old=this.db.prepare('SELECT * FROM native_bindings WHERE key=?').get(data.key) as unknown as Binding|undefined;
  if(old){if(old.digest!==digest)fail('idempotency_conflict');return {binding:this.metadata(old),ownerToken:null};}
  const session=this.db.prepare('SELECT workspace,provider,revoked FROM sessions WHERE id=?').get(data.sessionId) as {workspace:string;provider:string;revoked:number}|undefined;if(!session||session.revoked)fail('not_found');if(session.provider!=='codex')fail('provider_identity_mismatch');
  if(this.db.prepare('SELECT id FROM native_bindings WHERE harness=? AND profile=? AND native_id=?').get(data.harness,data.profile,data.nativeId))fail('native_owner_exists');
  if(this.db.prepare('SELECT id FROM native_bindings WHERE session_id=?').get(data.sessionId))fail('binding_exists');
  const id=randomUUID(),ownerToken=randomBytes(32).toString('hex'),now=this.clock.now();
  this.db.prepare('INSERT INTO native_bindings(id,session_id,workspace,harness,profile,native_id,instance,owner_hash,lease_until,created_ms,last_owner_contact_ms,last_observed_ms,key,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,data.sessionId,session.workspace,data.harness,data.profile,data.nativeId,data.instance,hash(ownerToken),now+60000,now,now,now,data.key,digest);
  this.db.prepare('INSERT INTO managed_policies(binding_id,scope_id) VALUES(?,?)').run(id,randomUUID());return {binding:this.metadata(this.binding(id)),ownerToken};
 });}
 setPolicy(input:z.input<typeof managedPolicySchema>){const data=managedPolicySchema.parse(input),digest=hash(JSON.stringify(data)),now=this.clock.now();
  // Observation must remain durable even if the requested policy mutation is rejected.
  transaction(this.db,()=>this.observe(this.binding(data.bindingId),now));
  return transaction(this.db,()=>{
  const binding=this.binding(data.bindingId),old=this.db.prepare('SELECT digest,snapshot FROM managed_policy_updates WHERE binding_id=? AND key=?').get(binding.id,data.key) as {digest:string;snapshot:string}|undefined;
  if(old){if(old.digest!==digest)fail('idempotency_conflict');return JSON.parse(old.snapshot) as ManagedPolicy;}
  const policy=this.policy(binding.id);if(policy.version!==data.version)fail('policy_conflict');const revoked=(this.db.prepare('SELECT revoked FROM sessions WHERE id=?').get(binding.session_id) as {revoked:number}).revoked;
  if(data.enabled&&revoked)fail('binding_revoked');if(data.enabled&&policy.expired)fail('grant_expired');if(data.enabled&&binding.execution_state==='unknown')fail('execution_unknown');
  if(data.ttlMs!==undefined&&policy.expires_at!==null)fail('grant_scope_immutable');
  const maxTurns=data.maxTurns??policy.max_turns,maxConcurrent=data.maxConcurrent??policy.max_concurrent;if(maxTurns<policy.spent_turns)fail('budget_below_spent');
  const peers=data.allowedPeers??JSON.parse(policy.allowed_peers) as string[];for(const id of peers)if(id===binding.session_id||!this.db.prepare('SELECT id FROM sessions WHERE id=? AND workspace=? AND revoked=0').get(id,binding.workspace))fail('invalid_allowed_peer');
  const ttl=data.ttlMs??policy.grant_ttl_ms,expires=policy.expires_at??(data.enabled?now+ttl:null);
  this.db.prepare('UPDATE managed_policies SET version=version+1,enabled=?,max_turns=?,max_concurrent=?,expires_at=?,grant_ttl_ms=?,allowed_peers=? WHERE binding_id=?').run(data.enabled?1:0,maxTurns,maxConcurrent,expires,ttl,JSON.stringify([...peers].sort()),binding.id);
  const snapshot=this.policy(binding.id);this.db.prepare('INSERT INTO managed_policy_updates(binding_id,key,digest,snapshot) VALUES(?,?,?,?)').run(binding.id,data.key,digest,JSON.stringify(snapshot));return snapshot;
 });}
 renew(bindingId:string,epoch:number,ownerToken:string){const data=managedRenewSchema.parse({bindingId,epoch,ownerToken});return transaction(this.db,()=>{
  const row=this.binding(data.bindingId),candidate=Buffer.from(hash(data.ownerToken)),expected=Buffer.from(row.owner_hash);if(candidate.length!==expected.length||!timingSafeEqual(candidate,expected))fail('unauthorized');if(row.epoch!==data.epoch)fail('owner_epoch_conflict');
  const now=this.clock.now();this.observe(row,now);if(row.execution_state==='unknown')return {renewed:false,reason:'execution_unknown',epoch:row.epoch};
  if((this.db.prepare('SELECT revoked FROM sessions WHERE id=?').get(row.session_id) as {revoked:number}).revoked)return {renewed:false,reason:'binding_revoked',epoch:row.epoch};
  this.db.prepare('UPDATE native_bindings SET lease_until=?,last_owner_contact_ms=? WHERE id=?').run(now+60000,now,row.id);return {renewed:true,epoch:row.epoch};
 });}
 status(actor:Session){return transaction(this.db,()=>{
  const row=this.db.prepare('SELECT * FROM native_bindings WHERE session_id=? AND workspace=?').get(actor.id,actor.workspace) as unknown as Binding|undefined;
  if(!row)return {configured:false,binding_id:null,enabled:false,auto_wake:false,host_readiness:'unverified',execution_state:'unverified',host_stopped:'unknown',scope_id:null,blocked_reason:'not_configured'};
  const now=this.clock.now();this.observe(row,now);const policy=this.policy(row.id),revoked=(this.db.prepare('SELECT revoked FROM sessions WHERE id=?').get(actor.id) as {revoked:number}).revoked;
  const reason=!policy.enabled?'policy_off':revoked?'binding_revoked':row.execution_state==='unknown'?'execution_unknown':policy.expired?'grant_expired':'driver_unverified';
  return {configured:true,...policy,auto_wake:false,host_readiness:'unverified',execution_state:row.execution_state,host_stopped:'unknown',epoch:row.epoch,blocked_reason:reason};
 });}
}

export function managedPolicyDigest(p:ManagedPolicy){return hash(JSON.stringify({binding:p.binding_id,version:p.version,enabled:!!p.enabled,scope:p.scope_id,maxTurns:p.max_turns,maxConcurrent:p.max_concurrent,expires:p.expires_at,expired:!!p.expired,peers:JSON.parse(p.allowed_peers)}));}
