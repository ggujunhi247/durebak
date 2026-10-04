import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {short,fail,hash,type Session} from './domain.js';
import {transaction} from './transactions.js';
import {range,encodedPreview} from './content.js';
import type {CollaborationRequest} from './requests.js';
export const revisionSchema=z.object({id:short,version:z.number().int().positive(),expectedTaskVersion:z.number().int().positive(),uploadId:short,key:short}).strict();
export const evidenceSchema=z.object({id:short,revisionId:short,procedure:z.string().min(1).refine(v=>Buffer.byteLength(JSON.stringify(v))<=4096),result:z.enum(['pass','fail']),attempt:short,key:short,startedAt:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),endedAt:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),supersedes:short.optional()}).strict();
export interface Revision {cursor:number;id:string;request_id:string;task_id:string;handle_id:string;message_id:string;hash:string;criteria_digest:string;author:string;created_ms:number;task_version:number}
export interface Evidence {cursor:number;id:string;request_id:string;revision_id:string;author:string;attempt:string;procedure:string;result:'pass'|'fail';started_at:number;ended_at:number;supersedes:string|null;created_ms:number}
export class Verification {
 constructor(private db:DatabaseSync,private clock:{now():number},private get:(actor:Session,id:string,now?:number)=>CollaborationRequest){}
 private revisions(id:string){return this.db.prepare('SELECT cursor,id,request_id,task_id,handle_id,message_id,hash,criteria_digest,author,created_ms,task_version FROM task_revisions WHERE request_id=? ORDER BY cursor').all(id) as unknown as Revision[];}
 private visible(actor:Session,r:Revision){return r.author===actor.id||!!this.db.prepare('SELECT id FROM messages WHERE id=? AND delivered_at IS NOT NULL').get(r.message_id);}
 private evidenceRows(id:string){return this.db.prepare('SELECT cursor,id,request_id,revision_id,author,attempt,procedure,result,started_at,ended_at,supersedes,created_ms FROM verification_evidence WHERE request_id=? ORDER BY cursor').all(id) as unknown as Evidence[];}
 list(actor:Session,id:string,after=0,limit=10){
  this.get(actor,id);z.number().int().min(0).parse(after);z.number().int().min(1).max(20).parse(limit);
  const rows=this.revisions(id),pending=rows.find(r=>r.cursor>after&&!this.visible(actor,r));
  const available=rows.filter(r=>r.cursor>after&&(!pending||r.cursor<pending.cursor)),items=available.slice(0,limit).map(r=>({...r,source:'self_reported' as const}));
  return {items,next:items.at(-1)?.cursor??after,has_more:available.length>items.length||!!pending,waiting_delivery:!!pending};
 }
 add(actor:Session,input:z.input<typeof evidenceSchema>){
  const data=evidenceSchema.parse(input),q=this.get(actor,data.id),digest=hash(JSON.stringify(data));
  return transaction(this.db,()=>{
   const old=this.db.prepare('SELECT id,digest FROM verification_evidence WHERE request_id=? AND author=? AND key=?').get(q.id,actor.id,data.key) as {id:string;digest:string}|undefined;
   if(old){if(old.digest!==digest)fail('idempotency_conflict');return {...this.evidenceRows(q.id).find(e=>e.id===old.id)!,source:'self_reported' as const};}
   if(!['accepted','completed'].includes(q.state)||q.deadline_at<=this.clock.now()&&q.state!=='completed')fail('request_terminal');
   const revision=this.revisions(q.id).find(r=>r.id===data.revisionId);if(!revision)fail('not_found');if(!this.visible(actor,revision))fail('message_not_delivered');
   if(q.state==='completed'&&revision.id!==this.revisions(q.id).at(-1)?.id)fail('revision_conflict');
   if(data.endedAt<data.startedAt||data.endedAt>this.clock.now())fail('evidence_time_invalid');
   const rows=this.evidenceRows(q.id);if(rows.length>=100)fail('evidence_capacity_exceeded');
   if(rows.some(e=>e.author===actor.id&&e.attempt===data.attempt))fail('evidence_attempt_conflict');
   if(data.supersedes){const prior=rows.find(e=>e.id===data.supersedes);if(!prior)fail('not_found');if(prior.author!==actor.id)fail('evidence_author_required');if(prior.revision_id!==revision.id||rows.some(e=>e.supersedes===prior.id))fail('evidence_supersede_conflict');}
   const id=randomUUID();this.db.prepare('INSERT INTO verification_evidence(id,request_id,revision_id,author,key,digest,attempt,procedure,result,started_at,ended_at,supersedes,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,q.id,revision.id,actor.id,data.key,digest,data.attempt,data.procedure,data.result,data.startedAt,data.endedAt,data.supersedes??null,this.clock.now());
   return {...this.evidenceRows(q.id).find(e=>e.id===id)!,source:'self_reported' as const};
  });
 }
 evidence(actor:Session,id:string,after=0,limit=10){
  this.get(actor,id);z.number().int().min(0).parse(after);z.number().int().min(1).max(20).parse(limit);
  const revisions=this.revisions(id),rows=this.evidenceRows(id).filter(e=>e.cursor>after);
  const pending=rows.findIndex(e=>{const r=revisions.find(r=>r.id===e.revision_id)!;return !this.visible(actor,r)&&!!this.db.prepare("SELECT id FROM messages WHERE id=? AND status IN ('queued','in_flight')").get(r.message_id);});
  const available=rows.slice(0,pending<0?rows.length:pending),items=available.slice(0,limit).map(({procedure,...e})=>{
   const r=revisions.find(r=>r.id===e.revision_id)!;
   return !this.visible(actor,r)?{cursor:e.cursor,redacted:true,id:undefined}:{...e,source:'self_reported' as const,procedure_bytes:Buffer.byteLength(procedure),procedure_source:{operation:'request_evidence_read',id:e.id}};
  });
  while(items.length>1&&Buffer.byteLength(JSON.stringify(items))>12000)items.pop();return {items,next:items.at(-1)?.cursor??after,has_more:rows.length>items.length,waiting_delivery:pending>=0&&pending<=items.length};
 }
 read(actor:Session,id:string,offset=0,limit=4096){
  short.parse(id);const e=this.db.prepare('SELECT * FROM verification_evidence WHERE id=?').get(id) as unknown as Evidence|undefined;if(!e)fail('not_found');this.get(actor,e.request_id);
  const r=this.revisions(e.request_id).find(r=>r.id===e.revision_id)!;if(!this.visible(actor,r))fail('message_not_delivered');return {id:e.id,source:'self_reported',...range(e.procedure,offset,limit)};
 }
 bundle(actor:Session,id:string){
  const q=this.get(actor,id),verification=this.status(actor,id),revision=verification.revision;
  const initial=this.db.prepare('SELECT body,sender,delivered_at FROM messages WHERE id=?').get(q.message_id) as {body:string;sender:string;delivered_at:number|null};
  const delivered=initial.sender===actor.id||initial.delivered_at!==null;
  const task=q.task?this.db.prepare('SELECT title,criteria FROM tasks WHERE id=?').get(q.task.id) as {title:string;criteria:string}:null;
  return {request_id:q.id,request_version:q.version,state:q.state,mode:'cooperative',auto_wake:false,deadline_at:q.deadline_at,
   goal:delivered?encodedPreview(initial.body,512):null,title:task?encodedPreview(task.title,100):null,criteria:task?encodedPreview(task.criteria,512):null,criteria_digest:task?hash(task.criteria):null,
   task:q.task??null,revision,verification,source_complete:false,
   required_sources:[...(delivered?[{operation:'message_read',id:q.message_id,bytes:Buffer.byteLength(initial.body)},{operation:'request_messages',id:q.id,paginated:true},{operation:'request_attachments',id:q.id,paginated:true}]:[]),...(task?[{operation:'request_task_read',id:q.id,bytes:Buffer.byteLength(task.criteria)}]:[]),...(revision?[{operation:'attachment_read',id:revision.handle_id}]:[])],
   warnings:['peer_content_untrusted','self_reported_evidence','full_sources_required',...(!delivered||verification.status==='waiting_delivery'?['waiting_delivery']:[])],
   next_action:verification.status==='waiting_delivery'?'receive_at_safe_point':verification.status==='needs_revalidation'?'verify_latest_revision':verification.status==='failed'?'resolve_active_failures':'read_required_sources'};
 }
 status(actor:Session,id:string,now?:number){
  this.get(actor,id,now);const revisions=this.revisions(id),head=revisions.at(-1),source='self_reported' as const;
  if(head&&!this.visible(actor,head))return {status:'waiting_delivery',source,conflict:false,needs_attention:true,revision:null};
  const rows=this.evidenceRows(id).filter(e=>revisions.some(r=>r.id===e.revision_id&&this.visible(actor,r))),superseded=new Set(rows.map(e=>e.supersedes)),active=rows.filter(e=>!superseded.has(e.id)&&e.revision_id===head?.id),passes=active.filter(e=>e.result==='pass'),failures=active.filter(e=>e.result==='fail');
  const status=failures.length?'failed':passes.length?'reported_pass':rows.length?'needs_revalidation':'unverified';
  return {needs_attention:status!=='reported_pass',status:failures.length?'failed':passes.length?'reported_pass':rows.length?'needs_revalidation':'unverified',source,conflict:!!passes.length&&!!failures.length,revision:head?{...head,source}:null,evidence_count:active.length,self_count:active.filter(e=>e.author===actor.id).length,peer_count:active.filter(e=>e.author!==actor.id).length};
 }
}
