import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sendSchema,short,body,fail,hash,type Session,type Message} from './domain.js';
import {transaction} from './transactions.js';
import {encodedPreview} from './content.js';
import {queuePolicy} from './queue-policy.js';

export const requestPayloadSchema=sendSchema.omit({replyTo:true}).extend({deadlineMs:z.number().int().min(1).max(3600000).default(600000)}).strict();
export const requestCreateSchema=requestPayloadSchema.extend({previewId:short.optional()}).strict();
export const requestMessageSchema=z.object({id:short,version:z.number().int().positive(),kind:z.enum(['answer','note','result']),body,key:short}).strict();
export const checkpointSchema=z.object({consumer:short,version:z.number().int().min(0),messageCursor:z.number().int().min(0),controlCursor:z.number().int().min(0)}).strict();
export interface Checkpoint {consumer:string;version:number;message_cursor:number;control_cursor:number}
export interface ControlNotice {cursor:number;request_id:string;reason:string;created_ms:number;observed_ms:number|null;acked_ms:number|null}
export const requestTransitionSchema=z.object({id:short,version:z.number().int().positive(),state:z.enum(['accepted','rejected','failed','cancelled']),reasonCode:short.optional(),detail:z.string().min(1).max(4000).refine(v=>Buffer.byteLength(JSON.stringify(v))<=4096).optional()}).strict();
export type RequestState='pending'|'accepted'|'completed'|'rejected'|'failed'|'cancelled'|'timed_out';
export interface CollaborationRequest {id:string;workspace:string;creator:string;recipient:string;message_id:string;state:RequestState;version:number;created_ms:number;deadline_at:number;reason_code:string|null;detail:string|null}
interface StoredRequest extends CollaborationRequest {key:string;digest:string}
const terminal=(state:RequestState)=>!['pending','accepted'].includes(state);
export class RequestRepository {
 constructor(private db:DatabaseSync,private clock:{now():number},private enqueue:(actor:Session,input:z.input<typeof sendSchema>,now:number)=>Message,private validatePreview:(actor:Session,id:string,payload:z.output<typeof requestPayloadSchema>,now:number)=>void){}
 private one<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).get(...args) as T|undefined;}
 private all<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).all(...args) as T[];}
 private run(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).run(...args);}
 private visible(actor:Session,id:string){
  const q=this.one<StoredRequest>('SELECT * FROM requests WHERE id=? AND workspace=? AND (creator=? OR recipient=?)',id,actor.workspace,actor.id,actor.id);
  if(!q)fail('not_found');return q;
 }
 private snapshot(q:StoredRequest):CollaborationRequest {const {key:_,digest:__,...result}=q;return result;}
 private notice(q:StoredRequest,reason:string,now:number){
  for(const recipient of [q.creator,q.recipient])this.run('INSERT OR IGNORE INTO request_controls(request_id,recipient,reason,created_ms) VALUES(?,?,?,?)',q.id,recipient,reason,now);
 }
 // Only call this method inside the caller's transaction. No nested transaction.
 expireWithinTransaction(now=this.clock.now()){
  const rows=this.all<StoredRequest>("SELECT * FROM requests WHERE state IN ('pending','accepted') AND deadline_at<=?",now);
  for(const q of rows){
   this.run("UPDATE requests SET state='timed_out',version=version+1 WHERE id=?",q.id);
   this.notice(q,'timed_out',now);
   this.run("UPDATE messages SET status='expired',lease_until=NULL WHERE status='queued' AND id IN (SELECT message_id FROM request_messages WHERE request_id=?)",q.id);
  }
  // Preserve an active delivery receipt for ack, but never requeue a closed request.
  this.run("UPDATE messages SET status='expired',lease_until=NULL WHERE (status='queued' OR (status='in_flight' AND lease_until<=?)) AND id IN (SELECT rm.message_id FROM request_messages rm JOIN requests r ON r.id=rm.request_id WHERE r.state IN ('cancelled','timed_out','rejected','failed'))",now);
 }
 expire(){transaction(this.db,()=>this.expireWithinTransaction());}
 messageMetadata(id:string){return this.one<{request_id:string;kind:string}>('SELECT request_id,kind FROM request_messages WHERE message_id=?',id);}
 create(actor:Session,input:z.input<typeof requestCreateSchema>){
  if(Buffer.byteLength(JSON.stringify(actor.workspace))>4096)fail('request_scope_too_large');
  const {previewId,...data}=requestCreateSchema.parse(input);const digest=hash(JSON.stringify(data));this.expire();
  return transaction(this.db,()=>{
   const old=this.one<StoredRequest>('SELECT * FROM requests WHERE creator=? AND key=?',actor.id,data.key);
   if(old){if(old.digest!==digest)fail('idempotency_conflict');return this.snapshot(old);}
   if(data.to===actor.id)fail('distinct_participants_required');
   if(this.one<{n:number}>("SELECT count(*) n FROM requests WHERE creator=? AND state IN ('pending','accepted')",actor.id)!.n>=100)fail('request_capacity_exceeded');
   const now=this.clock.now(),deadline=now+data.deadlineMs;
   if(previewId)this.validatePreview(actor,previewId,data,now);
   if(now+Math.max(queuePolicy.delay_ms[data.priority],data.delayMs)>=deadline)fail('deadline_before_delivery');
   const id=randomUUID();
   const message=this.enqueue(actor,{to:data.to,body:data.body,key:`request:${id}:initial`,priority:data.priority,...(data.urgentReason?{urgentReason:data.urgentReason}:{}),delayMs:data.delayMs,ttlMs:data.ttlMs},now);
   this.run('INSERT INTO requests(id,workspace,creator,recipient,message_id,created_ms,deadline_at,key,digest) VALUES(?,?,?,?,?,?,?,?,?)',id,actor.workspace,actor.id,data.to,message.id,now,deadline,data.key,digest);
   this.run("INSERT INTO request_messages(message_id,request_id,kind) VALUES(?,?,'question')",message.id,id);
   return this.snapshot(this.visible(actor,id));
  });
 }
 get(actor:Session,id:string){short.parse(id);this.expire();return this.snapshot(this.visible(actor,id));}
 list(actor:Session,after='',limit=10){
  z.string().max(200).parse(after);z.number().int().min(1).max(20).parse(limit);this.expire();
  const rows=this.all<StoredRequest>('SELECT * FROM requests WHERE workspace=? AND (creator=? OR recipient=?) AND id>? ORDER BY id LIMIT ?',actor.workspace,actor.id,actor.id,after,limit+1);
  const items=rows.slice(0,limit).map(q=>this.snapshot(q));
  while(items.length>1&&Buffer.byteLength(JSON.stringify(items))>12000)items.pop();
  return {items,next:items.at(-1)?.id??after,has_more:rows.length>items.length};
 }
 messages(actor:Session,id:string,after=0,limit=10){
  z.number().int().min(0).parse(after);z.number().int().min(1).max(20).parse(limit);this.get(actor,id);
  const rows=this.all<Message&{kind:string;delivered_at:number|null}>('SELECT m.seq,m.id,m.workspace,m.sender,m.recipient,m.body,m.reply_to,m.status,m.created_at,m.delivered_at,r.kind FROM request_messages r JOIN messages m ON m.id=r.message_id WHERE r.request_id=? AND m.seq>? ORDER BY m.seq LIMIT ?',id,after,limit+1);
  const barrier=rows.findIndex(row=>row.sender!==actor.id&&row.delivered_at===null&&['queued','in_flight'].includes(row.status));
  const visible=rows.slice(0,barrier<0?limit:Math.min(limit,barrier));
  const items=visible.map(row=>row.sender!==actor.id&&row.delivered_at===null?{id:row.id,seq:row.seq,kind:row.kind,status:row.status,body:null,redacted:true}:{...row,body:encodedPreview(row.body,400),body_bytes:Buffer.byteLength(row.body),truncated:row.body!==encodedPreview(row.body,400)});
  while(items.length>1&&Buffer.byteLength(JSON.stringify(items))>12000)items.pop();
  return {items,next:items.at(-1)?.seq??after,has_more:rows.length>items.length,waiting_delivery:barrier>=0&&barrier<=items.length};
 }
 transition(actor:Session,id:string,version:number,state:Exclude<RequestState,'pending'|'completed'|'timed_out'>,reason:{reasonCode?:string;detail?:string}={}){
  const data=requestTransitionSchema.parse({id,version,state,...reason});this.expire();
  return transaction(this.db,()=>{
   const now=this.clock.now();this.expireWithinTransaction(now);
   const q=this.visible(actor,id);if(terminal(q.state))fail('request_terminal');if(q.version!==version)fail('request_conflict');
   if(state==='cancelled'){if(actor.id!==q.creator)fail('request_role_required');}
   else{
    if(actor.id!==q.recipient)fail('request_role_required');
    if(!this.one('SELECT id FROM messages WHERE id=? AND delivered_at IS NOT NULL',q.message_id))fail('message_not_delivered');
    if(state==='failed'?q.state!=='accepted':q.state!=='pending')fail('request_conflict');
   }
   if(['rejected','failed'].includes(state)&&(!data.reasonCode||!data.detail))fail('reason_required');
   this.run('UPDATE requests SET state=?,version=version+1,reason_code=?,detail=? WHERE id=?',state,data.reasonCode??null,data.detail??null,id);
   if(state==='cancelled')this.notice(q,state,now);
   if(state!=='accepted')this.run("UPDATE messages SET status='expired',lease_until=NULL WHERE status='queued' AND id IN (SELECT message_id FROM request_messages WHERE request_id=?)",id);
   return this.snapshot(this.visible(actor,id));
  });
 }
 message(actor:Session,input:z.input<typeof requestMessageSchema>){
  const data=requestMessageSchema.parse(input);this.expire();
  return transaction(this.db,()=>{
   const now=this.clock.now();this.expireWithinTransaction(now);
   const q=this.visible(actor,data.id);const digest=hash(JSON.stringify(data));
   const delivered=this.one<{message_id:string;digest:string}>('SELECT message_id,digest FROM request_messages WHERE request_id=? AND author=? AND key=?',q.id,actor.id,data.key);
   if(delivered){if(delivered.digest!==digest)fail('idempotency_conflict');return {id:delivered.message_id,request_id:q.id,late:false};}
   if(terminal(q.state)){
    if(data.kind!=='result'||actor.id!==q.recipient||!['cancelled','timed_out'].includes(q.state))fail('request_terminal');
    const old=this.one<{digest:string}>('SELECT digest FROM request_late WHERE request_id=? AND author=? AND key=?',q.id,actor.id,data.key);
    if(old){if(old.digest!==digest)fail('idempotency_conflict');return {late:true,id:q.id};}
    if(this.one<{n:number}>('SELECT count(*) n FROM request_late WHERE request_id=?',q.id)!.n>=100)fail('late_capacity_exceeded');
    this.run('INSERT INTO request_late VALUES(?,?,?,?,?,?)',q.id,actor.id,data.key,digest,data.body,now);return {late:true,id:q.id};
   }
   if(q.version!==data.version)fail('request_conflict');
   if(data.kind==='result'&&(actor.id!==q.recipient||q.state!=='accepted'))fail('request_role_required');
   if(actor.id===q.recipient&&!this.one('SELECT id FROM messages WHERE id=? AND delivered_at IS NOT NULL',q.message_id))fail('message_not_delivered');
   const n=this.one<{n:number;bytes:number}>('SELECT count(*) n,coalesce(sum(length(CAST(m.body AS BLOB))),0) bytes FROM request_messages r JOIN messages m ON m.id=r.message_id WHERE r.request_id=?',q.id)!;
   if(n.n>=1000||n.bytes+Buffer.byteLength(data.body)>1048576)fail('conversation_capacity_exceeded');
   const m=this.enqueue(actor,{to:actor.id===q.creator?q.recipient:q.creator,body:data.body,key:`rq:${hash(JSON.stringify([q.id,data.key,data.kind]))}`,priority:'normal'},now);
   this.run('INSERT INTO request_messages(message_id,request_id,kind,author,key,digest) VALUES(?,?,?,?,?,?)',m.id,q.id,data.kind,actor.id,data.key,digest);
   if(data.kind==='result')this.run("UPDATE requests SET state='completed',version=version+1 WHERE id=?",q.id);
   return {id:m.id,request_id:q.id,late:false};
  });
 }
 controls(actor:Session,after=0,limit=10){
  z.number().int().min(0).parse(after);z.number().int().min(1).max(20).parse(limit);this.expire();
  return transaction(this.db,()=>{
   const rows=this.all<ControlNotice>('SELECT cursor,request_id,reason,created_ms,observed_ms,acked_ms FROM request_controls WHERE recipient=? AND cursor>? ORDER BY cursor LIMIT ?',actor.id,after,limit+1);
   const items=rows.slice(0,limit).map(row=>{if(row.observed_ms===null){row.observed_ms=this.clock.now();this.run('UPDATE request_controls SET observed_ms=? WHERE cursor=?',row.observed_ms,row.cursor);}return row;});
   return {items,next:items.at(-1)?.cursor??after,has_more:rows.length>limit};
  });
 }
 controlAck(actor:Session,cursor:number){
  z.number().int().positive().parse(cursor);
  return transaction(this.db,()=>{
   const row=this.one<ControlNotice>('SELECT * FROM request_controls WHERE cursor=? AND recipient=?',cursor,actor.id);
   if(!row)fail('not_found');if(row.observed_ms===null)fail('control_not_observed');
   this.run('UPDATE request_controls SET acked_ms=coalesce(acked_ms,?) WHERE cursor=?',this.clock.now(),cursor);
   return {cursor,acknowledged:true,host_stopped:'unknown' as const};
  });
 }
 checkpointGet(actor:Session,consumer:string):Checkpoint {
  short.parse(consumer);return this.one<Checkpoint>('SELECT consumer,version,message_cursor,control_cursor FROM consumer_checkpoints WHERE session_id=? AND consumer=?',actor.id,consumer)??{consumer,version:0,message_cursor:0,control_cursor:0};
 }
 checkpointSet(actor:Session,input:z.input<typeof checkpointSchema>):Checkpoint {
  const data=checkpointSchema.parse(input);
  return transaction(this.db,()=>{
   const old=this.checkpointGet(actor,data.consumer);
   if(old.version!==data.version)fail('checkpoint_conflict');
   if(data.messageCursor<old.message_cursor||data.controlCursor<old.control_cursor)fail('checkpoint_regression');
   if(data.messageCursor!==0&&!this.one('SELECT cursor FROM delivery_audit WHERE cursor=? AND recipient=?',data.messageCursor,actor.id))fail('unobserved_cursor');
   if(data.controlCursor!==0&&!this.one('SELECT cursor FROM request_controls WHERE cursor=? AND recipient=? AND observed_ms IS NOT NULL',data.controlCursor,actor.id))fail('unobserved_cursor');
   if(this.one('SELECT cursor FROM request_controls WHERE recipient=? AND cursor>? AND cursor<=? AND observed_ms IS NULL LIMIT 1',actor.id,old.control_cursor,data.controlCursor))fail('unobserved_cursor');
   if(old.version===0&&this.one<{n:number}>('SELECT count(*) n FROM consumer_checkpoints WHERE session_id=?',actor.id)!.n>=20)fail('checkpoint_capacity_exceeded');
   this.run('INSERT INTO consumer_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(session_id,consumer) DO UPDATE SET version=excluded.version,message_cursor=excluded.message_cursor,control_cursor=excluded.control_cursor',actor.id,data.consumer,old.version+1,data.messageCursor,data.controlCursor);
   return this.checkpointGet(actor,data.consumer);
  });
 }
}
