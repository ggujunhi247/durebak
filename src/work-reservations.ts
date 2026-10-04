import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {fail,hash,short} from './domain.js';
import {transaction} from './transactions.js';
import {childPermission,expireWaiters} from './continuations.js';
import {expireRequestsWithinTransaction} from './requests.js';
import {WorkInput} from './work-input.js';
import {managedPolicyDigest,type ManagedPolicy} from './managed-control.js';
const ownerSchema=z.object({bindingId:short,epoch:z.number().int().positive(),instance:short,ownerToken:z.string().regex(/^[a-f0-9]{64}$/)});
const reserveSchema=ownerSchema.extend({messageId:short,key:short,driver:z.string()}).strict();
const submitSchema=reserveSchema.extend({attemptId:short}).strict();
type Intent=z.input<typeof reserveSchema>;
interface Binding {id:string;session_id:string;workspace:string;epoch:number;instance:string;owner_hash:string;lease_until:number;last_observed_ms:number;execution_state:string}
interface Scope {request_id:string;scope_id:string;owner_binding:string;max_turns:number;max_concurrent:number;expires_at:number;spent_turns:number;active_turns:number;root_request_id:string|null}
interface Attempt {id:string;binding_id:string;workspace:string;request_id:string;message_id:string;epoch:number;instance:string;key:string;intent_digest:string;policy_digest:string;root_policy_digest:string;source_digest:string;source:string;created_ms:number;state:string}
// Internal mock-only controller gate. No public operation, provider call or
// ordinary delivery receipt is created by reservation/submission preparation.
export class WorkReservations {
 constructor(private db:DatabaseSync,private clock:{now():number}){}
 private one<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).get(...args) as T|undefined;}
 private policy(id:string){const p=this.one<ManagedPolicy>('SELECT * FROM managed_policies WHERE binding_id=?',id);if(!p)fail('not_found');return p;}
 private digest(p:ManagedPolicy){return managedPolicyDigest(p);}
 private owner(data:Intent){const b=this.one<Binding>('SELECT * FROM native_bindings WHERE id=?',data.bindingId);if(!b)fail('not_found');const expected=Buffer.from(b.owner_hash),actual=Buffer.from(hash(data.ownerToken));if(expected.length!==actual.length||!timingSafeEqual(expected,actual))fail('unauthorized');if(data.epoch!==b.epoch)fail('owner_epoch_conflict');if(data.instance!==b.instance)fail('owner_instance_conflict');return b;}
 private observe(data:Intent,now:number){
  // An observed expiry/rollback must survive a rejected reserve/submit operation.
  transaction(this.db,()=>{const b=this.owner(data);this.db.prepare("UPDATE native_bindings SET execution_state=CASE WHEN lease_until<=? OR last_observed_ms>? THEN 'unknown' ELSE execution_state END,last_observed_ms=max(last_observed_ms,?) WHERE id=?").run(now,now,now,b.id);this.db.prepare('UPDATE managed_policies SET expired=1 WHERE binding_id=? AND expires_at IS NOT NULL AND expires_at<=?').run(b.id,now);const root=this.one<{owner_binding:string}>('SELECT ws.owner_binding FROM work_scopes ws JOIN request_messages rm ON rm.request_id=ws.request_id WHERE rm.message_id=?',data.messageId);if(root)this.db.prepare('UPDATE managed_policies SET expired=1 WHERE binding_id=? AND expires_at IS NOT NULL AND expires_at<=?').run(root.owner_binding,now);this.db.prepare('UPDATE managed_policies SET expired=1 WHERE expires_at IS NOT NULL AND expires_at<=?').run(now);expireRequestsWithinTransaction(this.db,now);expireWaiters(this.db,now);});
 }
 private allowed(data:Intent,now:number){
  const b=this.owner(data),p=this.policy(b.id);if(data.driver!=='read-only-mock')fail('driver_unverified');if(b.execution_state==='unknown'||b.lease_until<=now||b.last_observed_ms>now)fail('execution_unknown');if(!p.enabled)fail('policy_off');if(p.expired||p.expires_at===null||p.expires_at<=now)fail('grant_expired');if(this.one<{revoked:number}>('SELECT revoked FROM sessions WHERE id=?',b.session_id)?.revoked)fail('binding_revoked');return {b,p};
 }
 private root(scope:Scope,now:number){const p=this.policy(scope.owner_binding);if(!p.enabled)fail('root_policy_off');if(p.expired||p.expires_at===null||p.expires_at<=now||scope.expires_at<=now)fail('grant_expired');const binding=this.one<Binding>('SELECT * FROM native_bindings WHERE id=?',scope.owner_binding);if(!binding||this.one<{revoked:number}>('SELECT revoked FROM sessions WHERE id=?',binding.session_id)?.revoked)fail('binding_revoked');return p;}
 private publicAttempt(a:Attempt){return {id:a.id,state:a.state,request_id:a.request_id,message_id:a.message_id,source_digest:a.source_digest,native_verified:false,model_started:false};}
 reserve(input:Intent){const data=reserveSchema.parse(input),now=this.clock.now();this.observe(data,now);return transaction(this.db,()=>{
  const {b,p}=this.allowed(data,now),intentDigest=hash(JSON.stringify({...data,ownerToken:undefined}));
  const previous=this.one<Attempt>('SELECT * FROM work_attempts WHERE binding_id=? AND key=?',b.id,data.key);if(previous){if(previous.intent_digest!==intentDigest)fail('idempotency_conflict');return this.publicAttempt(previous);}
  if(this.one('SELECT message_id FROM work_reservations WHERE message_id=?',data.messageId))fail('trigger_reserved');
  const closed=this.one<{state:string;deadline_at:number}>('SELECT r.state,r.deadline_at FROM requests r JOIN request_messages rm ON rm.request_id=r.id WHERE rm.message_id=?',data.messageId);if(closed&&(closed.deadline_at<=now||!['pending','accepted','completed'].includes(closed.state)))fail('request_closed');
  const envelope=new WorkInput(this.db,{now:()=>now}).assemble(b.session_id,data.messageId),q=envelope.input.request;
  // A request ID or completed result does not establish a living waiter.
  // Require the exact durable correlation recorded by the trusted driver.
  const continuation=envelope.input.trigger.kind!=='question';let waiter:{policy_digest:string;root_policy_digest:string;deadline_at:number;status:string}|undefined;
  if(continuation){waiter=this.one("SELECT policy_digest,root_policy_digest,deadline_at,status FROM work_waiters WHERE request_id=? AND binding_id=? AND epoch=? AND instance=?",q.id,b.id,b.epoch,b.instance);if(!waiter)fail('continuation_waiter_missing');if(waiter.status!=='waiting')fail('continuation_consumed');if(waiter.deadline_at<=now)fail('continuation_expired');}
  let scope=this.one<Scope>('SELECT * FROM work_scopes WHERE request_id=?',q.id);
  if(!scope){if(envelope.input.trigger.kind!=='question')fail('continuation_scope_missing');scope={request_id:q.id,scope_id:p.scope_id,owner_binding:b.id,max_turns:p.max_turns,max_concurrent:p.max_concurrent,expires_at:p.expires_at!,spent_turns:0,active_turns:0,root_request_id:q.id};this.db.prepare('INSERT INTO work_scopes(request_id,scope_id,owner_binding,max_turns,max_concurrent,expires_at,root_request_id) VALUES(?,?,?,?,?,?,?)').run(q.id,scope.scope_id,b.id,scope.max_turns,scope.max_concurrent,scope.expires_at,q.id);}
  const child=this.one<{parent_attempt:string;root_request_id:string}>('SELECT parent_attempt,root_request_id FROM work_children WHERE request_id=?',q.id);if(scope.owner_binding!==b.id||scope.scope_id!==p.scope_id){if(!child)fail('scope_provenance_unverified');}
  const rootId=scope.root_request_id??q.id,rootScope=this.one<Scope>('SELECT * FROM work_scopes WHERE request_id=?',rootId)!;
  const permission=childPermission(this.db,q.id,now);if(permission)fail(permission);const root=this.root(rootScope,now);if(child){const rootRequest=this.one<{state:string}>('SELECT state FROM requests WHERE id=?',rootId)!;if(!['pending','accepted'].includes(rootRequest.state))fail('root_request_closed');const targetRoot=this.one<{session_id:string}>('SELECT session_id FROM native_bindings WHERE id=?',rootScope.owner_binding)!;if(targetRoot.session_id!==b.session_id&&!JSON.parse(root.allowed_peers).includes(b.session_id))fail('peer_not_allowed');}
  if(waiter&&(waiter.policy_digest!==this.digest(p)||waiter.root_policy_digest!==this.digest(root)))fail('continuation_policy_changed');
  if(p.spent_turns>=p.max_turns||root.spent_turns>=root.max_turns||rootScope.spent_turns>=Math.min(rootScope.max_turns,root.max_turns))fail('turn_budget_exhausted');
  if(this.one<{n:number}>("SELECT count(*) n FROM work_attempts WHERE binding_id=? AND state IN ('reserved','submitting','unknown')",b.id)!.n>0)fail('native_busy');
  if(p.active_turns>=p.max_concurrent||root.active_turns>=root.max_concurrent||rootScope.active_turns>=Math.min(rootScope.max_concurrent,root.max_concurrent))fail('concurrency_exhausted');
  if(this.one<{n:number}>("SELECT count(*) n FROM work_attempts WHERE workspace=? AND state IN ('reserved','submitting','unknown')",b.workspace)!.n>=3)fail('workspace_busy');
  for(const id of envelope.pending_delivery_ids)if(this.one('SELECT message_id FROM work_reservations WHERE message_id=?',id))fail('trigger_reserved');
  const id=randomUUID(),charged=[...new Set([b.id,rootScope.owner_binding])];this.db.prepare("INSERT INTO work_attempts(id,binding_id,workspace,request_id,message_id,epoch,instance,key,intent_digest,policy_digest,root_policy_digest,source_digest,source,created_ms,state,charged_bindings) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?)").run(id,b.id,b.workspace,q.id,data.messageId,b.epoch,b.instance,data.key,intentDigest,this.digest(p),this.digest(root),envelope.digest,envelope.encoded,now,JSON.stringify(charged));
  for(const messageId of envelope.pending_delivery_ids)this.db.prepare('INSERT INTO work_reservations(message_id,attempt_id) VALUES(?,?)').run(messageId,id);
  for(const bindingId of charged)this.db.prepare('UPDATE managed_policies SET spent_turns=spent_turns+1,active_turns=active_turns+1 WHERE binding_id=?').run(bindingId);for(const requestId of new Set([q.id,rootId]))this.db.prepare('UPDATE work_scopes SET spent_turns=spent_turns+1,active_turns=active_turns+1 WHERE request_id=?').run(requestId);if(waiter&&this.db.prepare("UPDATE work_waiters SET status='claimed',claim_attempt=? WHERE request_id=? AND status='waiting'").run(id,q.id).changes!==1)fail('continuation_consumed');
  return this.publicAttempt(this.one<Attempt>('SELECT * FROM work_attempts WHERE id=?',id)!);
 });}
 submitting(input:z.input<typeof submitSchema>){const data=submitSchema.parse(input),now=this.clock.now();this.observe(data,now);return transaction(this.db,()=>{
  const {b,p}=this.allowed(data,now),attempt=this.one<Attempt>('SELECT * FROM work_attempts WHERE id=? AND binding_id=?',data.attemptId,b.id);if(!attempt)fail('not_found');if(attempt.state!=='reserved')fail('submission_uncertain');if(attempt.message_id!==data.messageId||attempt.key!==data.key)fail('idempotency_conflict');if(attempt.epoch!==b.epoch||attempt.instance!==b.instance)fail('owner_epoch_conflict');
  const permission=childPermission(this.db,attempt.request_id,now);if(permission)fail(permission);const localScope=this.one<Scope>('SELECT * FROM work_scopes WHERE request_id=?',attempt.request_id)!,scope=this.one<Scope>('SELECT * FROM work_scopes WHERE request_id=?',localScope.root_request_id??attempt.request_id)!;const linked=this.one<{kind:string}>('SELECT kind FROM request_messages WHERE message_id=?',attempt.message_id)!;if(linked.kind!=='question'&&!this.one("SELECT request_id FROM work_waiters WHERE request_id=? AND status='claimed' AND claim_attempt=? AND deadline_at>?",attempt.request_id,attempt.id,now))fail('continuation_consumed');if(attempt.policy_digest!==this.digest(p)||attempt.root_policy_digest!==this.digest(this.root(scope,now)))fail('policy_changed');
  if(scope.request_id!==attempt.request_id&&!this.one("SELECT id FROM requests WHERE id=? AND state IN ('pending','accepted') AND deadline_at>?",scope.request_id,now))fail('root_request_closed');
  const envelope=new WorkInput(this.db,{now:()=>now}).assemble(b.session_id,attempt.message_id);if(envelope.digest!==attempt.source_digest||envelope.encoded!==attempt.source)fail('source_changed');
  const locked=this.db.prepare('SELECT message_id FROM work_reservations WHERE attempt_id=? ORDER BY message_id').all(attempt.id).map(r=>r.message_id);if(JSON.stringify(locked)!==JSON.stringify([...envelope.pending_delivery_ids].sort()))fail('reservation_changed');
  this.db.prepare("UPDATE work_attempts SET state='submitting' WHERE id=?").run(attempt.id);return this.publicAttempt({...attempt,state:'submitting'});
 });}
}
