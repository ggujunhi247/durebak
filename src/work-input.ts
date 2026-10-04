import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {fail,hash,short,type QueuedMessage} from './domain.js';
import {transaction} from './transactions.js';
import {canDeliver} from './queue-policy.js';
interface SourceMessage {id:string;seq:number;sender:string;recipient:string;body:string;kind:string;delivered_at:number|null;status:string;due_at:number;expires_at:number|null}
interface SourceAttachment {id:string;message_id:string;name:string;hash:string;bytes:number;content:string|null}
interface SourceTask {id:string;version:number;title:string;criteria:string;result_hash:string|null}
interface SourceRevision {id:string;message_id:string;hash:string;criteria_digest:string;seq:number}
// Internal input preparation only. This is neither a session operation nor a
// native execution authorization. The controller must reserve and revalidate
// this exact digest before submission; preparing it never marks delivery/read.
export class WorkInput {
 constructor(private db:DatabaseSync,private clock:{now():number}){}
 private one<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).get(...args) as T|undefined;}
 private all<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).all(...args) as T[];}
 assemble(sessionId:string,messageId:string){
  short.parse(sessionId);short.parse(messageId);
  const operation=()=>this.snapshot(sessionId,messageId,this.clock.now());
  return this.db.isTransaction?operation():transaction(this.db,operation);
 }
 private snapshot(sessionId:string,messageId:string,now:number){
  const actor=this.one<{workspace:string;revoked:number;availability:string}>('SELECT workspace,revoked,availability FROM sessions WHERE id=?',sessionId);if(!actor)fail('not_found');if(actor.revoked)fail('binding_revoked');
  const trigger=this.one<QueuedMessage>("SELECT * FROM messages WHERE id=? AND workspace=? AND recipient=?",messageId,actor.workspace,sessionId);if(!trigger)fail('not_found');
  const linked=this.one<{request_id:string;kind:string}>('SELECT request_id,kind FROM request_messages WHERE message_id=?',messageId);if(!linked||!['question','answer','result'].includes(linked.kind))fail('not_a_work_trigger');
  if(trigger.status!=='queued'||trigger.delivered_at!==null)fail('trigger_unavailable');if(trigger.expires_at!==null&&now>=trigger.expires_at)fail('trigger_expired');if(trigger.due_at>now)fail('waiting_delay');if(!canDeliver(actor.availability,trigger.priority))fail('recipient_unavailable');
  const q=this.one<{id:string;workspace:string;creator:string;recipient:string;state:string;version:number;deadline_at:number;message_id:string}>('SELECT id,workspace,creator,recipient,state,version,deadline_at,message_id FROM requests WHERE id=?',linked.request_id);
  if(!q||q.workspace!==actor.workspace||![q.creator,q.recipient].includes(sessionId))fail('not_found');
  if(q.deadline_at<=now||!['pending','accepted','completed'].includes(q.state))fail('request_closed');
  if(linked.kind==='question'&&(trigger.id!==q.message_id||q.recipient!==sessionId||q.state!=='pending'))fail('not_a_work_trigger');
  if(linked.kind==='result'&&(q.state!=='completed'||q.creator!==sessionId))fail('not_a_work_trigger');
  if(linked.kind==='answer'&&q.state!=='accepted')fail('not_a_work_trigger');
  const rows=this.all<SourceMessage>('SELECT m.id,m.seq,m.sender,m.recipient,m.body,m.delivered_at,m.status,m.due_at,m.expires_at,rm.kind FROM request_messages rm JOIN messages m ON m.id=rm.message_id WHERE rm.request_id=? AND m.seq<=? ORDER BY m.seq LIMIT 1001',q.id,trigger.seq);
  if(rows.length>1000||rows[0]?.id!==q.message_id||!rows.some(m=>m.id===trigger.id))fail('context_unavailable');
  // The controller prepares delivery of the entire incoming prefix, including
  // notes that never trigger a turn. Ordinary session ACLs stay unchanged.
  const pending=rows.filter(m=>m.sender!==sessionId&&m.delivered_at===null);
  if(pending.some(m=>m.recipient!==sessionId||m.status!=='queued'||m.due_at>now||(m.expires_at!==null&&m.expires_at<=now)))fail('context_unavailable');
  const task=this.one<SourceTask>('SELECT t.id,t.version,t.title,t.criteria,t.result_hash FROM request_tasks rt JOIN tasks t ON t.id=rt.task_id WHERE rt.request_id=?',q.id)??null;
  const revisions=this.all<SourceRevision>('SELECT r.id,r.message_id,r.hash,r.criteria_digest,m.seq FROM task_revisions r JOIN messages m ON m.id=r.message_id WHERE r.request_id=? ORDER BY r.cursor LIMIT 101',q.id);
  if(revisions.length>100||revisions.some(r=>r.seq>trigger.seq||!task||r.criteria_digest!==hash(task.criteria)||!rows.some(m=>m.id===r.message_id)))fail('context_unavailable');
  const revision=revisions.at(-1)??null;
  const attachments=this.all<SourceAttachment>('SELECT h.id,h.message_id,u.name,u.hash,u.bytes,u.content FROM request_attachment_handles h JOIN messages m ON m.id=h.message_id LEFT JOIN private_uploads u ON u.id=h.upload_id WHERE h.request_id=? AND m.seq<=? ORDER BY h.cursor LIMIT 101',q.id,trigger.seq);
  if(attachments.length>100||attachments.some(a=>typeof a.content!=='string'||hash(a.content)!==a.hash||Buffer.byteLength(a.content)!==a.bytes||!rows.some(m=>m.id===a.message_id)))fail('context_unavailable');
  const evidence=this.all<{id:string;revision_id:string;author:string;attempt:string;procedure:string;result:string;started_at:number;ended_at:number;supersedes:string|null}>('SELECT id,revision_id,author,attempt,procedure,result,started_at,ended_at,supersedes FROM verification_evidence WHERE request_id=? ORDER BY cursor LIMIT 101',q.id);
  if(evidence.length>100||evidence.some(e=>!revisions.some(r=>r.id===e.revision_id)))fail('context_unavailable');
  const publicResult=task?.result_hash&&!revision?this.one<{hash:string;content:string;bytes:number}>('SELECT hash,content,bytes FROM artifacts WHERE workspace=? AND hash=?',q.workspace,task.result_hash):null;
  if(task?.result_hash&&!revision&&(!publicResult||hash(publicResult.content)!==publicResult.hash||Buffer.byteLength(publicResult.content)!==publicResult.bytes))fail('context_unavailable');
  if(revisions.some(r=>!attachments.some(a=>a.message_id===r.message_id&&a.hash===r.hash))||(revision&&task?.result_hash&&task.result_hash!==revision.hash))fail('context_unavailable');
  const input={schema:'durebak-work-input-v1',source_complete:true,scope:'request-prefix',through_seq:trigger.seq,trigger:{id:trigger.id,kind:linked.kind},request:q,task,latest_revision:revision,revisions:revisions.map(r=>({...r,verification_kind:'self_reported'})),public_result:publicResult?{...publicResult,visibility:'workspace-visible'}:null,messages:rows.map(({delivered_at:_,status:__,due_at:___,expires_at:____,...m})=>m),attachments,evidence:evidence.map(e=>({...e,verification_kind:'self_reported'}))};
  const encoded=JSON.stringify(input),bytes=Buffer.byteLength(encoded);if(bytes>16384)fail('context_unavailable');return {input,encoded,bytes,digest:hash(encoded),pending_delivery_ids:pending.map(m=>m.id)};
 }
}
