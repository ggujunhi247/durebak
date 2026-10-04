import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {fail,hash,type Session,type Task} from './domain.js';
import {range} from './content.js';
import type {CollaborationRequest} from './requests.js';
export type ProtectedTaskSummary=Pick<Task,'id'|'state'|'version'|'owner'|'result_hash'>&{result_visibility:'workspace-visible'|null};
export class ProtectedTasks {
 constructor(private db:DatabaseSync){}
 private task(id:string){return this.db.prepare('SELECT t.* FROM request_tasks rt JOIN tasks t ON t.id=rt.task_id WHERE rt.request_id=?').get(id) as Task|undefined;}
 create(q:CollaborationRequest,input:{title:string;criteria:string},now:number){
  const id=randomUUID();
  this.db.prepare('INSERT INTO tasks(id,workspace,creator,title,criteria,created_at,key,digest) VALUES(?,?,?,?,?,?,?,?)').run(id,q.workspace,q.creator,input.title,input.criteria,new Date(now).toISOString(),`request:${q.id}:task`,hash(JSON.stringify(input)));
  this.db.prepare('INSERT INTO request_tasks VALUES(?,?)').run(q.id,id);
 }
 authorize(actor:Session,taskId:string){
  const q=this.db.prepare('SELECT r.*,m.delivered_at FROM request_tasks rt JOIN requests r ON r.id=rt.request_id JOIN messages m ON m.id=r.message_id WHERE rt.task_id=?').get(taskId) as (CollaborationRequest&{delivered_at:number|null})|undefined;
  if(!q)return false;
  if(q.workspace!==actor.workspace||![q.creator,q.recipient].includes(actor.id))fail('not_found');
  if(actor.id===q.recipient&&q.delivered_at===null)fail('message_not_delivered');
  return true;
 }
 guardLegacyMutation(actor:Session,id:string){if(this.authorize(actor,id))fail('linked_request_operation_required');}
 summary(actor:Session,q:CollaborationRequest):ProtectedTaskSummary|undefined {
  const task=this.task(q.id);if(!task)return;
  if(actor.id===q.recipient&&!this.db.prepare('SELECT id FROM messages WHERE id=? AND delivered_at IS NOT NULL').get(q.message_id))return;
  return {id:task.id,state:task.state,version:task.version,owner:task.owner,result_hash:task.result_hash,result_visibility:task.result_hash?'workspace-visible':null};
 }
 read(actor:Session,q:CollaborationRequest,offset:number,limit:number){
  const task=this.task(q.id);if(!task)fail('not_found');this.authorize(actor,task.id);
  return {id:task.id,request_id:q.id,version:task.version,title:task.title,...range(task.criteria,offset,limit)};
 }
 apply(q:CollaborationRequest,state:string,expected:number|undefined,resultHash?:string){
  const task=this.task(q.id);if(!task){if(expected!==undefined)fail('unexpected_task_version');return;}
  if(expected===undefined)fail('task_version_required');if(task.version!==expected)fail('task_conflict');
  if(!['pending','claimed'].includes(task.state))fail('task_terminal');
  if(task.state!==(q.state==='accepted'?'claimed':'pending'))fail('task_conflict');
  if(state==='accepted'){
   if(task.state!=='pending')fail('task_conflict');
   this.db.prepare("UPDATE tasks SET state='claimed',owner=?,version=version+1 WHERE id=?").run(q.recipient,task.id);
  }else if(state==='completed'){
   if(task.state!=='claimed'||task.owner!==q.recipient)fail('task_conflict');
   if(!resultHash)fail('result_hash_required');
   if(!this.db.prepare('SELECT hash FROM artifacts WHERE workspace=? AND hash=?').get(q.workspace,resultHash))fail('artifact_not_found');
   this.db.prepare("UPDATE tasks SET state='completed',result_hash=?,version=version+1 WHERE id=?").run(resultHash,task.id);
  }else this.db.prepare("UPDATE tasks SET state='cancelled',version=version+1 WHERE id=?").run(task.id);
 }
 timeout(id:string){this.db.prepare("UPDATE tasks SET state='cancelled',version=version+1 WHERE state IN ('pending','claimed') AND id=(SELECT task_id FROM request_tasks WHERE request_id=?)").run(id);}
}
