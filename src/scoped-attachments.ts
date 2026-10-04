import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {short,body,hash,fail,type Session} from './domain.js';
import {range,encodedPreview} from './content.js';
import {transaction} from './transactions.js';
import type {CollaborationRequest} from './requests.js';
export const attachmentPutSchema=z.object({name:short,content:body,key:short}).strict();
export const uploadsSchema=z.array(short).max(10).optional();
interface Upload {id:string;owner:string;workspace:string;name:string;hash:string;content:string;bytes:number;key:string;digest:string}
export class ScopedAttachments {
 constructor(private db:DatabaseSync){}
 private upload(actor:Session,id:string){
  short.parse(id);const u=this.db.prepare('SELECT * FROM private_uploads WHERE id=? AND owner=? AND workspace=?').get(id,actor.id,actor.workspace) as Upload|undefined;
  if(!u)fail('not_found');return u;
 }
 private isPublic(workspace:string,digest:string){return !!this.db.prepare('SELECT hash FROM artifacts WHERE workspace=? AND hash=?').get(workspace,digest);}
 put(actor:Session,input:z.input<typeof attachmentPutSchema>){
  const data=attachmentPutSchema.parse(input),digest=hash(JSON.stringify(data));
  return transaction(this.db,()=>{
   const old=this.db.prepare('SELECT * FROM private_uploads WHERE owner=? AND key=?').get(actor.id,data.key) as Upload|undefined;
   if(old){if(old.digest!==digest)fail('idempotency_conflict');return {id:old.id,name:old.name,hash:old.hash,bytes:old.bytes};}
   if((this.db.prepare('SELECT count(*) n FROM private_uploads u WHERE u.owner=? AND NOT EXISTS(SELECT 1 FROM request_attachment_handles h WHERE h.upload_id=u.id)').get(actor.id) as {n:number}).n>=20)fail('upload_capacity_exceeded');
   const id=randomUUID(),contentHash=hash(data.content),bytes=Buffer.byteLength(data.content);
   this.db.prepare('INSERT INTO private_uploads VALUES(?,?,?,?,?,?,?,?,?)').run(id,actor.id,actor.workspace,data.name,contentHash,data.content,bytes,data.key,digest);
   return {id,name:data.name,hash:contentHash,bytes};
  });
 }
 manifest(actor:Session,ids:string[]=[]){
  uploadsSchema.parse(ids);if(new Set(ids).size!==ids.length)fail('duplicate_attachment');
  return ids.map(id=>{const u=this.upload(actor,id);return {id:u.id,name:u.name,hash:u.hash,bytes:u.bytes,visibility:'request-private' as const,public_copy_exists:this.isPublic(actor.workspace,u.hash)};});
 }
 preview(actor:Session,ids:string[]=[]){return this.manifest(actor,ids).map(u=>({...u,name:encodedPreview(u.name,100),name_truncated:u.name!==encodedPreview(u.name,100)}));}
 uploadRead(actor:Session,id:string,offset=0,limit=4096){const u=this.upload(actor,id);return {id:u.id,name:u.name,hash:u.hash,...range(u.content,offset,limit)};}
 link(actor:Session,q:CollaborationRequest,messageId:string,ids:string[]=[]){
  const manifest=this.manifest(actor,ids);if(!manifest.length)return;
  const used=this.db.prepare('SELECT count(*) n,coalesce(sum(u.bytes),0) bytes FROM request_attachment_handles h JOIN private_uploads u ON u.id=h.upload_id WHERE h.request_id=?').get(q.id) as {n:number;bytes:number};
  if(used.n+manifest.length>100||used.bytes+manifest.reduce((n,u)=>n+u.bytes,0)>1048576)fail('attachment_capacity_exceeded');
  for(const u of manifest)this.db.prepare('INSERT INTO request_attachment_handles(id,request_id,message_id,upload_id) VALUES(?,?,?,?)').run(randomUUID(),q.id,messageId,u.id);
 }
 list(actor:Session,q:CollaborationRequest,after=0,limit=10){
  z.number().int().min(0).parse(after);z.number().int().min(1).max(20).parse(limit);
  const rows=this.db.prepare('SELECT h.cursor,h.id,h.message_id,u.name,u.hash,u.bytes,m.sender,m.status,m.delivered_at FROM request_attachment_handles h JOIN private_uploads u ON u.id=h.upload_id JOIN messages m ON m.id=h.message_id WHERE h.request_id=? AND h.cursor>? ORDER BY h.cursor LIMIT ?').all(q.id,after,limit+1) as {cursor:number;id:string;message_id:string;name:string;hash:string;bytes:number;sender:string;status:string;delivered_at:number|null}[];
  const barrier=rows.findIndex(r=>r.sender!==actor.id&&r.delivered_at===null&&['queued','in_flight'].includes(r.status));
  const items=rows.slice(0,barrier<0?limit:Math.min(limit,barrier)).map(r=>r.sender!==actor.id&&r.delivered_at===null?{cursor:r.cursor,status:r.status,redacted:true,id:undefined}:{cursor:r.cursor,id:r.id,message_id:r.message_id,name:encodedPreview(r.name,100),name_truncated:r.name!==encodedPreview(r.name,100),hash:r.hash,bytes:r.bytes,visibility:'request-private',public_copy_exists:this.isPublic(actor.workspace,r.hash)});
  while(items.length>1&&Buffer.byteLength(JSON.stringify(items))>12000)items.pop();
  return {items,next:items.at(-1)?.cursor??after,has_more:rows.length>items.length,waiting_delivery:barrier>=0&&barrier<=items.length};
 }
 read(actor:Session,id:string,offset=0,limit=4096){
  short.parse(id);const row=this.db.prepare('SELECT h.id,u.content,u.hash,u.name,r.workspace,r.creator,r.recipient,m.sender,m.delivered_at FROM request_attachment_handles h JOIN private_uploads u ON u.id=h.upload_id JOIN requests r ON r.id=h.request_id JOIN messages m ON m.id=h.message_id WHERE h.id=?').get(id) as {id:string;content:string;hash:string;name:string;workspace:string;creator:string;recipient:string;sender:string;delivered_at:number|null}|undefined;
  if(!row||row.workspace!==actor.workspace||![row.creator,row.recipient].includes(actor.id))fail('not_found');
  if(row.sender!==actor.id&&row.delivered_at===null)fail('message_not_delivered');
  return {id:row.id,name:row.name,hash:row.hash,visibility:'request-private',public_copy_exists:this.isPublic(actor.workspace,row.hash),...range(row.content,offset,limit)};
 }
}
