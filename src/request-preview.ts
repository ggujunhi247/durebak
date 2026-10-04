import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {requestPayloadSchema} from './requests.js';
import {fail,hash,short,type Session} from './domain.js';
import {transaction} from './transactions.js';
import {encodedPreview,range} from './content.js';
import {ScopedAttachments} from './scoped-attachments.js';
import {queuePolicy} from './queue-policy.js';
interface PreviewRow {id:string;owner:string;payload:string;digest:string;created_ms:number;expires_at:number;attachment_digest:string|null}
export class RequestPreviewRepository {
 constructor(private db:DatabaseSync,private clock:{now():number},private attachments:ScopedAttachments){}
 private visible(actor:Session,id:string){
  short.parse(id);
  const row=this.db.prepare('SELECT * FROM request_previews WHERE id=? AND owner=?').get(id,actor.id) as PreviewRow|undefined;
  if(!row)fail('not_found');return row;
 }
 private valid(row:PreviewRow,now:number){if(now<row.created_ms||now>=row.expires_at)fail('preview_expired');}
 validate(actor:Session,id:string,payload:z.output<typeof requestPayloadSchema>,now:number){
  const row=this.visible(actor,id);this.valid(row,now);
  if(row.digest!==hash(JSON.stringify(payload)))fail('preview_conflict');
  const manifest=this.attachments.manifest(actor,payload.uploads);
  if(row.attachment_digest!==null&&row.attachment_digest!==hash(JSON.stringify(manifest)))fail('preview_conflict');
  if(row.attachment_digest===null&&manifest.length)fail('preview_conflict');
 }
 create(actor:Session,input:z.input<typeof requestPayloadSchema>){
  const data=requestPayloadSchema.parse(input);
  if(Buffer.byteLength(JSON.stringify(actor.workspace))>4096)fail('request_scope_too_large');
  if(data.to===actor.id)fail('distinct_participants_required');
  if(data.priority==='urgent'&&!data.urgentReason)fail('urgent_reason_required');
  return transaction(this.db,()=>{
   const now=this.clock.now(),due=now+Math.max(queuePolicy.delay_ms[data.priority],data.delayMs);
   if(due>=now+data.deadlineMs)fail('deadline_before_delivery');
   if(due>=now+data.ttlMs)fail('expiry_before_delivery');
   if(!this.db.prepare('SELECT id FROM sessions WHERE id=? AND revoked=0').get(actor.id))fail('not_found');
   const recipient=this.db.prepare('SELECT availability FROM sessions WHERE id=? AND workspace=? AND revoked=0').get(data.to,actor.workspace) as {availability:string}|undefined;
   if(!recipient)fail('not_found');
   this.db.prepare('DELETE FROM request_previews WHERE owner=? AND expires_at<=?').run(actor.id,now);
   if((this.db.prepare('SELECT count(*) n FROM request_previews WHERE owner=?').get(actor.id) as {n:number}).n>=20)fail('preview_capacity_exceeded');
   const id=randomUUID(),payload=JSON.stringify(data),digest=hash(payload),expires_at=now+60000;
   const attachmentDigest=hash(JSON.stringify(this.attachments.manifest(actor,data.uploads)));
   this.db.prepare('INSERT INTO request_previews(id,owner,payload,digest,created_ms,expires_at,attachment_digest) VALUES(?,?,?,?,?,?,?)').run(id,actor.id,payload,digest,now,expires_at,attachmentDigest);
   const warnings=['host_readiness_unknown'];
   if(recipient.availability!=='available')warnings.push(`recipient_${recipient.availability}`);
   if((this.db.prepare("SELECT count(*) n FROM messages WHERE recipient=? AND status IN ('queued','in_flight')").get(data.to) as {n:number}).n>=queuePolicy.capacity)warnings.push('inbox_full');
   return {id,digest,sender:actor.id,recipient:data.to,visibility:'request-private' as const,body:encodedPreview(data.body,400),body_bytes:Buffer.byteLength(data.body),truncated:data.body!==encodedPreview(data.body,400),expires_at,due_at:due,deadline_at:now+data.deadlineMs,timing:'tentative_until_send' as const,warnings,attachments:this.attachments.preview(actor,data.uploads),...(data.task?{task:{title:data.task.title,criteria:encodedPreview(data.task.criteria,400),criteria_bytes:Buffer.byteLength(data.task.criteria),truncated:data.task.criteria!==encodedPreview(data.task.criteria,400)}}:{})};
  });
 }
 read(actor:Session,id:string,offset=0,limit=4096,part:'body'|'criteria'='body'){
  const row=this.visible(actor,id);this.valid(row,this.clock.now());
  const data=requestPayloadSchema.parse(JSON.parse(row.payload));
  if(part==='criteria'&&!data.task)fail('not_found');
  return {id,digest:row.digest,...range(part==='criteria'?data.task!.criteria:data.body,offset,limit)};
 }
}
