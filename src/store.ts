import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, hash, short, body, sendSchema, taskSchema, type Session, type Message, type QueuedMessage, type Task } from './domain.js';
import { bridgeHealth, type BridgeObservation, type SessionHealth } from './health.js';
import { openDatabase } from './database.js';
import { transaction } from './transactions.js';
import { encodedPreview, preview, range } from './content.js';
import {ScopedAttachments,attachmentPutSchema} from './scoped-attachments.js';
import {ManagedControl,managedBindSchema,managedPolicySchema} from './managed-control.js';
import type {CollaborationStatus} from './collaboration-status.js';
import {Verification,revisionSchema,evidenceSchema} from './verification.js';
import {ProtectedTasks} from './protected-tasks.js';
import {RequestPreviewRepository} from './request-preview.js';
import { RequestRepository,requestPayloadSchema,requestCreateSchema,requestMessageSchema,checkpointSchema,type RequestState } from './requests.js';
import { queuePolicy, retryDelay, canDeliver, deliveryRank } from './queue-policy.js';

// Compatibility facade: CLI, HTTP, MCP and existing consumers keep their API.
export { DomainError, fail, hash, sendSchema, taskSchema, type Session, type Message, type Task } from './domain.js';
export { privateDirectory } from './database.js';
export { range } from './content.js';
export { queuePolicy } from './queue-policy.js';

export class Store {
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly requests: RequestRepository;
  private readonly attachments:ScopedAttachments;
  private readonly protectedTasks:ProtectedTasks;
  private readonly managed:ManagedControl;
  private readonly verification:Verification;
  private readonly previews: RequestPreviewRepository;
  constructor(readonly directory: string, private readonly clock = { now: () => Date.now() }) {
    this.db = openDatabase(directory);
    this.managed=new ManagedControl(this.db,this.clock);
    this.attachments=new ScopedAttachments(this.db);
    this.protectedTasks=new ProtectedTasks(this.db);
    this.previews=new RequestPreviewRepository(this.db,this.clock,this.attachments);
    this.verification=new Verification(this.db,this.clock,(actor,id,now)=>this.requests.get(actor,id,now));
    this.requests=new RequestRepository(this.db,this.clock,(actor,input,now)=>this.enqueue(actor,input,now),(actor,id,payload,now)=>this.previews.validate(actor,id,payload,now),this.protectedTasks,this.attachments);
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
  private one<T>(sql: string, ...values: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...values) as T | undefined; }
  private all<T>(sql: string, ...values: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...values) as T[]; }
  private run(sql: string, ...values: SQLInputValue[]) { return this.db.prepare(sql).run(...values); }
  private transaction<T>(operation: () => T): T { return transaction(this.db, operation); }
  private event(workspace: string, kind: string, entity: string) {
    this.run('INSERT INTO events(workspace,kind,entity,created_at) VALUES(?,?,?,?)', workspace, kind, entity, new Date().toISOString());
  }
  register(workspace: string, alias: string, provider: string) {
    z.string().min(1).max(4096).parse(workspace); short.parse(alias);
    z.enum(['codex', 'claude', 'opencode', 'other']).parse(provider);
    const token = randomBytes(32).toString('hex');
    const session: Session = { id: randomUUID(), workspace, alias, provider, revoked: 0 };
    return this.transaction(() => {
      if (this.one('SELECT id FROM sessions WHERE workspace=? AND alias=?', workspace, alias)) fail('alias_exists');
      this.run('INSERT INTO sessions(id,workspace,alias,provider,token_hash) VALUES(?,?,?,?,?)', session.id, workspace, alias, provider, hash(token));
      this.event(workspace, 'session.registered', session.id);
      return { session, token };
    });
  }
  authenticate(token: string): Session | null {
    return this.one<Session>('SELECT id,workspace,alias,provider,revoked FROM sessions WHERE token_hash=? AND revoked=0', hash(token)) ?? null;
  }
  revoke(sessionId: string) { this.run('UPDATE sessions SET revoked=1 WHERE id=?', sessionId); }
  sessions(actor: Session, after = '', limit = 10) {
    z.string().max(200).parse(after); z.number().int().min(1).max(20).parse(limit);
    const rows = this.all<Session>('SELECT id,workspace,alias,provider,revoked FROM sessions WHERE workspace=? AND revoked=0 AND id>? ORDER BY id LIMIT ?', actor.workspace, after, limit+1);
    const items = rows.slice(0,limit);
    return { items, next:items.at(-1)?.id ?? after, has_more:rows.length>limit };
  }
  bridgeTouch(actor: Session, instance: string, epoch: string): {recorded:true} {
    z.string().uuid().parse(instance); z.string().regex(/^[a-f0-9]{32}$/).parse(epoch);
    return this.transaction(() => {
      const now=this.clock.now();
      const exists=this.one('SELECT instance FROM bridge_observations WHERE session_id=? AND instance=?',actor.id,instance);
      this.run('DELETE FROM bridge_observations WHERE session_id=? AND instance<>? AND (epoch<>? OR closed=1 OR last_seen_ms<=? OR last_seen_ms>?)',actor.id,instance,epoch,now-60000,now);
      if(!exists&&this.one<{n:number}>('SELECT count(*) n FROM bridge_observations WHERE session_id=?',actor.id)!.n>=20)fail('bridge_capacity_exceeded');
      this.run('INSERT INTO bridge_observations(session_id,instance,epoch,last_seen_ms,closed) VALUES(?,?,?,?,0) ON CONFLICT(session_id,instance) DO UPDATE SET epoch=excluded.epoch,last_seen_ms=excluded.last_seen_ms,closed=0',actor.id,instance,epoch,now);
      return {recorded:true};
    });
  }
  bridgeClose(actor: Session, instance: string, epoch: string): {closed:true} {
    z.string().uuid().parse(instance); z.string().regex(/^[a-f0-9]{32}$/).parse(epoch);
    this.run('UPDATE bridge_observations SET closed=1 WHERE session_id=? AND instance=? AND epoch=?',actor.id,instance,epoch);
    return {closed:true};
  }
  activityTouch(actor: Session): void {
    this.run('INSERT INTO session_activity(session_id,last_activity_ms) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET last_activity_ms=excluded.last_activity_ms',actor.id,this.clock.now());
  }
  sessionHealth(actor: Session,id: string,epoch: string,now=this.clock.now()): SessionHealth {
    const session=this.one<{availability:SessionHealth['availability']}>('SELECT availability FROM sessions WHERE id=? AND workspace=? AND revoked=0',id,actor.workspace);
    if(!session)fail('not_found');
    const rows=this.all<Omit<BridgeObservation,'closed'>&{closed:number}>('SELECT instance,epoch,last_seen_ms,closed FROM bridge_observations WHERE session_id=?',id);
    const activity=this.one<{last_activity_ms:number}>('SELECT last_activity_ms FROM session_activity WHERE session_id=?',id);
    return {session_id:id,bridge:bridgeHealth(rows.map(x=>({...x,closed:!!x.closed})),epoch,now),last_activity_at:activity?.last_activity_ms??null,availability:session.availability,host:'unknown',readiness:'unknown',progress:'unknown',auto_wake:false};
  }
  managedBind(input:z.input<typeof managedBindSchema>){return this.managed.bind(input);}
  managedPolicy(input:z.input<typeof managedPolicySchema>){return this.managed.setPolicy(input);}
  managedRenew(bindingId:string,epoch:number,ownerToken:string){return this.managed.renew(bindingId,epoch,ownerToken);}
  managedStatus(actor:Session){return this.managed.status(actor);}
  collaborationStatus(actor:Session,epoch:string,input:{sessionAfter?:string;requestAfter?:string}={}):CollaborationStatus {
    const data=z.object({sessionAfter:z.string().max(200).default(''),requestAfter:z.string().max(200).default('')}).strict().parse(input);
    return this.transaction(()=>{
    const now=this.clock.now(),sessions=this.sessions(actor,data.sessionAfter,20),requests=this.requests.list(actor,data.requestAfter,10,now);
    return {mode:'cooperative',auto_wake:false,observed_at:now,self:this.sessionHealth(actor,actor.id,epoch,now),
      sessions:{...sessions,items:sessions.items.map(s=>{const health=this.sessionHealth(actor,s.id,epoch,now),alias=encodedPreview(s.alias,100);return {id:s.id,alias,alias_truncated:alias!==s.alias,provider:s.provider,availability:health.availability,bridge:health.bridge.state,duplicate_bridge:health.bridge.duplicate,last_contact_at:health.bridge.last_seen_at};})},
      requests:{...requests,items:requests.items.map(q=>{const verification=this.verification.status(actor,q.id,now);return {id:q.id,state:q.state,version:q.version,creator:q.creator,recipient:q.recipient,deadline_at:q.deadline_at,task_state:q.task?.state??null,task_version:q.task?.version??null,verification:verification.status,needs_attention:verification.needs_attention};})}};
    });
  }
  send(actor: Session, input: z.input<typeof sendSchema>): Message { return this.transaction(()=>this.enqueue(actor,input)); }
  attachmentPut(actor:Session,input:z.input<typeof attachmentPutSchema>){return this.attachments.put(actor,input);}
  attachmentUploadRead(actor:Session,id:string,offset=0,limit=4096){return this.attachments.uploadRead(actor,id,offset,limit);}
  attachmentRead(actor:Session,id:string,offset=0,limit=4096){return this.attachments.read(actor,id,offset,limit);}
  requestAttachments(actor:Session,id:string,after=0,limit=10){return this.requests.attachmentList(actor,id,after,limit);}
  requestPreview(actor:Session,input:z.input<typeof requestPayloadSchema>){return this.previews.create(actor,input);}
  requestPreviewRead(actor:Session,id:string,offset=0,limit=4096,part:'body'|'criteria'='body'){return this.previews.read(actor,id,offset,limit,part);}
  requestCreate(actor:Session,input:z.input<typeof requestCreateSchema>){return this.requests.create(actor,input);}
  requestRevision(actor:Session,input:z.input<typeof revisionSchema>){return this.requests.revision(actor,input);}
  requestRevisions(actor:Session,id:string,after=0,limit=10){return this.verification.list(actor,id,after,limit);}
  requestEvidence(actor:Session,input:z.input<typeof evidenceSchema>){return this.verification.add(actor,input);}
  requestEvidenceList(actor:Session,id:string,after=0,limit=10){return this.verification.evidence(actor,id,after,limit);}
  requestEvidenceRead(actor:Session,id:string,offset=0,limit=4096){return this.verification.read(actor,id,offset,limit);}
  requestBundle(actor:Session,id:string){return this.verification.bundle(actor,id);}
  requestVerification(actor:Session,id:string){return this.verification.status(actor,id);}
  requestTaskRead(actor:Session,id:string,offset=0,limit=4096){return this.requests.taskRead(actor,id,offset,limit);}
  requestGet(actor:Session,id:string){return this.requests.get(actor,id);}
  requestList(actor:Session,after='',limit=10){return this.requests.list(actor,after,limit);}
  requestMessages(actor:Session,id:string,after=0,limit=10){return this.requests.messages(actor,id,after,limit);}
  requestTransition(actor:Session,id:string,version:number,state:Exclude<RequestState,'pending'|'completed'|'timed_out'>,reason:{reasonCode?:string;detail?:string;expectedTaskVersion?:number}={}){return this.requests.transition(actor,id,version,state,reason);}
  requestMessage(actor:Session,input:z.input<typeof requestMessageSchema>){return this.requests.message(actor,input);}
  requestControls(actor:Session,after=0,limit=10){return this.requests.controls(actor,after,limit);}
  controlAck(actor:Session,cursor:number){return this.requests.controlAck(actor,cursor);}
  checkpointGet(actor:Session,consumer:string){return this.requests.checkpointGet(actor,consumer);}
  checkpointSet(actor:Session,input:z.input<typeof checkpointSchema>){return this.requests.checkpointSet(actor,input);}
  expireRequests(){this.requests.expire();}
  private enqueue(actor: Session, input: z.input<typeof sendSchema>, decisionTime=this.clock.now()): Message {
    const data = sendSchema.parse(input);
    if (data.priority === 'urgent' && !data.urgentReason) fail('urgent_reason_required');
    const digest = hash(JSON.stringify([data.to, data.body, data.replyTo ?? null, data.priority, data.urgentReason ?? null, data.delayMs, data.ttlMs]));
    const old = this.one<QueuedMessage>('SELECT * FROM messages WHERE sender=? AND key=?', actor.id, data.key);
    if (old) {
      const legacyMatch = old.legacy && data.priority==='normal' && !data.urgentReason && data.delayMs===0 && data.ttlMs===86400000 && old.digest===hash(JSON.stringify([data.to,data.body,data.replyTo??null]));
      if (old.digest !== digest && !legacyMatch) fail('idempotency_conflict'); return this.message(old.id);
    }
    if (!this.one('SELECT id FROM sessions WHERE id=? AND workspace=? AND revoked=0', data.to, actor.workspace)) fail('not_found');
    if (data.replyTo && !this.one('SELECT id FROM messages WHERE id=? AND workspace=? AND recipient=? AND sender=?', data.replyTo, actor.workspace, actor.id, data.to)) fail('invalid_reply');
    const now = decisionTime;
    const due = now + Math.max(queuePolicy.delay_ms[data.priority], data.delayMs);
    if (now + data.ttlMs <= due) fail('expiry_before_delivery');
    this.maintain(data.to, now);
    if (data.priority==='urgent' && this.one<{n:number}>("SELECT count(*) n FROM messages WHERE sender=? AND priority='urgent' AND created_ms>?", actor.id, now-queuePolicy.urgent_window_ms)!.n >= queuePolicy.urgent_limit) fail('urgent_quota_exceeded');
    const count = this.one<{ n: number }>("SELECT count(*) n FROM messages WHERE recipient=? AND status IN ('queued','in_flight')", data.to)!.n;
    if (count >= queuePolicy.capacity) fail('inbox_full');
    const messageId = randomUUID();
    this.run("INSERT INTO messages(id,workspace,sender,recipient,body,reply_to,created_at,key,digest,status,priority,urgent_reason,created_ms,due_at,expires_at,legacy) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,0)", messageId, actor.workspace, actor.id, data.to, data.body, data.replyTo ?? null, new Date(now).toISOString(), data.key, digest, data.priority, data.urgentReason??null, now, due, now+data.ttlMs);
    this.event(actor.workspace, 'message.queued', messageId);
    return this.message(messageId);
  }
  private message(messageId: string) { return this.one<Message>('SELECT seq,id,workspace,sender,recipient,body,reply_to,status,created_at FROM messages WHERE id=?', messageId)!; }
  inbox(actor: Session, after = 0, limit = 10) {
    z.number().int().min(0).parse(after); z.number().int().min(1).max(50).parse(limit);
    const rows = this.all<Message & { delivery_cursor: number }>('SELECT m.seq,m.id,m.workspace,m.sender,m.recipient,m.body,m.reply_to,m.status,m.created_at,a.cursor AS delivery_cursor FROM delivery_audit a JOIN messages m ON m.id=a.message_id WHERE a.recipient=? AND a.cursor>? ORDER BY a.cursor LIMIT ?', actor.id, after, limit + 1);
    // Full message bodies are available separately; inbox is a bounded discovery page.
    const items = rows.slice(0, limit).map(row => ({ ...row, body: preview(row.body, 512), body_bytes: Buffer.byteLength(row.body), truncated: Buffer.byteLength(row.body) > 512 }));
    while (items.length > 1 && Buffer.byteLength(JSON.stringify(items)) > 12000) items.pop();
    return { items, next: items.at(-1)?.delivery_cursor ?? after, has_more: rows.length > items.length, cursor_version: 2 };
  }
  readMessage(actor: Session, messageId: string, offset = 0, limit = 4096) {
    const row = this.one<QueuedMessage>('SELECT * FROM messages WHERE id=? AND workspace=? AND (recipient=? OR sender=?)', messageId, actor.workspace, actor.id, actor.id);
    if (!row) fail('not_found');
    if (row.sender!==actor.id && row.delivered_at===null) fail('message_not_delivered');
    return { id: row.id, ...range(row.body, offset, limit) };
  }
  private maintain(recipient: string, now: number) {
    this.requests.expireWithinTransaction(now);
    const rows=this.all<QueuedMessage>("SELECT * FROM messages WHERE recipient=? AND status IN ('queued','in_flight')",recipient);
    for (const row of rows) {
      if (row.expires_at!==null && row.expires_at<=now) {
        this.run("UPDATE messages SET status='expired',lease_until=NULL WHERE id=?",row.id);
        this.event(row.workspace,'message.expired',row.id);
      } else if(row.status==='in_flight' && row.lease_until!<=now) {
        const status=row.attempts>=queuePolicy.max_attempts?'dead_letter':'queued';
        this.run('UPDATE messages SET status=?,due_at=?,lease_until=NULL WHERE id=?',status,row.lease_until!+retryDelay(row.attempts),row.id);
        this.event(row.workspace,`message.${status}`,row.id);
      }
    }
  }
  private availability(actor: Session) { return this.one<{availability:string}>('SELECT availability FROM sessions WHERE id=?',actor.id)!.availability; }
  setSessionState(actor: Session, state: string) {
    z.enum(['available','busy','paused']).parse(state);
    this.run('UPDATE sessions SET availability=? WHERE id=?',state,actor.id);
    return {state};
  }
  private summary(actor: Session, now: number) {
    const state=this.availability(actor);
    const counts=Object.fromEntries(this.all<{status:string;n:number}>('SELECT status,count(*) n FROM messages WHERE recipient=? GROUP BY status',actor.id).map(r=>[r.status,r.n]));
    const pending=this.all<QueuedMessage>("SELECT * FROM messages WHERE recipient=? AND status IN ('queued','in_flight')",actor.id)
      .filter(r=>canDeliver(state,r.priority));
    const times=state==='paused'?[]:pending.filter(r=>r.status==='queued'||r.attempts<queuePolicy.max_attempts).flatMap(r=>{const due=r.status==='queued'?r.due_at:r.lease_until!+retryDelay(r.attempts);return r.expires_at===null||due<r.expires_at?[due]:[];});
    return {state,counts,policy:queuePolicy,retry_after_ms:times.length?Math.max(0,Math.min(...times)-now):null};
  }
  queueStatus(actor: Session) { return this.transaction(()=>{const now=this.clock.now();this.maintain(actor.id,now);return this.summary(actor,now);}); }
  messageStatus(actor: Session, messageId: string) {
    return this.transaction(()=>{
      const row=this.one<QueuedMessage>('SELECT * FROM messages WHERE id=? AND workspace=? AND (sender=? OR recipient=?)',messageId,actor.workspace,actor.id,actor.id);
      if(!row)fail('not_found');this.maintain(row.recipient,this.clock.now());
      const current=this.one<QueuedMessage>('SELECT * FROM messages WHERE id=?',messageId)!;
      const state=this.one<{availability:string}>('SELECT availability FROM sessions WHERE id=?',current.recipient)!.availability;
      const reason=current.status!=='queued'?current.status:state==='paused'?'recipient_paused':state==='busy'&&current.priority!=='urgent'?'recipient_busy':current.due_at>this.clock.now()?'waiting_delay':'ready';
      return {id:current.id,status:current.status,priority:current.priority,due_at:current.due_at,expires_at:current.expires_at,attempts:current.attempts,reason};
    });
  }
  receive(actor: Session, limit=5) {
    z.number().int().min(1).max(10).parse(limit);
    return this.transaction(()=>{
      const now=this.clock.now();this.maintain(actor.id,now);const state=this.availability(actor);
      const rows=this.all<QueuedMessage>("SELECT * FROM messages WHERE recipient=? AND status='queued' AND due_at<=?",actor.id,now)
        .filter(r=>canDeliver(state,r.priority));
      rows.sort((a,b)=>deliveryRank(b,now)-deliveryRank(a,now)||a.seq-b.seq);
      const starving=rows.filter(r=>r.priority!=='urgent'&&now-r.due_at>=queuePolicy.starvation_ms).sort((a,b)=>a.due_at-b.due_at||a.seq-b.seq)[0];
      if(starving){rows.splice(rows.indexOf(starving),1);rows.unshift(starving);}
      const items=rows.slice(0,limit).map(row=>{
        const receipt=randomBytes(24).toString('hex');const lease=Math.min(now+queuePolicy.lease_ms,row.expires_at??Infinity);
        this.run("UPDATE messages SET status='in_flight',receipt=?,lease_until=?,attempts=attempts+1,delivered_at=coalesce(delivered_at,?) WHERE id=?",receipt,lease,now,row.id);
        this.run('INSERT OR IGNORE INTO delivery_audit(message_id,recipient) VALUES(?,?)',row.id,actor.id);
        this.event(actor.workspace,'message.delivered',row.id);
        // Cap escaped JSON as well as UTF-8 bytes, so a batch fits the HTTP budget.
        const text=encodedPreview(row.body,600);
        const linked=this.requests.messageMetadata(row.id);
        return {...(linked?{request_id:linked.request_id,message_kind:linked.kind}:{}),id:row.id,seq:row.seq,sender:row.sender,body:text,body_bytes:Buffer.byteLength(row.body),truncated:text!==row.body,reply_to:row.reply_to,priority:row.priority,urgent_reason:row.urgent_reason?encodedPreview(row.urgent_reason,300):null,receipt,lease_until:lease,attempts:row.attempts+1,status:'in_flight'};
      });
      return {items,...this.summary(actor,now)};
    });
  }
  ack(actor: Session, messageId: string, receipt?: string) {
    const result = this.transaction(() => {
      // Expiry and acknowledgement share one lock and one decision time.
      // Return domain errors so maintenance commits even for rejected receipts.
      this.maintain(actor.id, this.clock.now());
      const row = this.one<QueuedMessage>('SELECT * FROM messages WHERE id=? AND recipient=?', messageId, actor.id);
      if (!row) return { error: 'not_found' };
      if (!receipt || row.receipt !== receipt || !['in_flight', 'read'].includes(row.status)) return { error: 'receipt_conflict' };
      if (row.status === 'in_flight') {
        this.run("UPDATE messages SET status='read',lease_until=NULL WHERE id=?", messageId);
        this.event(actor.workspace, 'message.read', messageId);
      }
      return { id: messageId, status: 'read' };
    });
    if ('error' in result) fail(result.error!);
    return result;
  }
  createTask(actor: Session, input: z.input<typeof taskSchema>): Task {
    const data = taskSchema.parse(input); const digest = hash(JSON.stringify([data.title, data.criteria]));
    return this.transaction(() => {
      const old = this.one<Task & { digest: string }>('SELECT * FROM tasks WHERE creator=? AND key=?', actor.id, data.key);
      if (old) { if (old.digest !== digest) fail('idempotency_conflict'); return this.getTask(actor, old.id); }
      const taskId = randomUUID();
      this.run('INSERT INTO tasks(id,workspace,creator,title,criteria,created_at,key,digest) VALUES(?,?,?,?,?,?,?,?)', taskId, actor.workspace, actor.id, data.title, data.criteria, new Date().toISOString(), data.key, digest);
      this.event(actor.workspace, 'task.created', taskId);
      return this.getTask(actor, taskId);
    });
  }
  getTask(actor: Session, taskId: string): Task {
    if(this.db.isTransaction)this.requests.expireWithinTransaction();else this.requests.expire();
    this.protectedTasks.authorize(actor,taskId);
    const task = this.one<Task>('SELECT id,workspace,creator,title,criteria,state,owner,version,result_hash,created_at FROM tasks WHERE id=? AND workspace=?', taskId, actor.workspace);
    if (!task) fail('not_found'); return this.protectedTasks.redactResult(actor,task);
  }
  tasks(actor: Session, after = '', limit = 10) {
    this.requests.expire();
    z.number().int().min(1).max(50).parse(limit); z.string().max(200).parse(after);
    const rows = this.all<Pick<Task, 'id' | 'title' | 'state' | 'version'>>('SELECT t.id,t.title,t.state,t.version FROM tasks t WHERE t.workspace=? AND t.id>? AND NOT EXISTS (SELECT 1 FROM request_tasks rt JOIN requests r ON r.id=rt.request_id JOIN messages m ON m.id=r.message_id WHERE rt.task_id=t.id AND (r.creator<>? AND r.recipient<>? OR r.recipient=? AND m.delivered_at IS NULL)) ORDER BY t.id LIMIT ?', actor.workspace, after,actor.id,actor.id,actor.id, limit + 1);
    const items = rows.slice(0, limit); return { items, next: items.at(-1)?.id ?? after, has_more: rows.length > limit };
  }
  claim(actor: Session, taskId: string, version: number): Task {
    this.protectedTasks.guardLegacyMutation(actor,taskId);
    return this.transaction(() => {
      const changed = this.run("UPDATE tasks SET state='claimed',owner=?,version=version+1 WHERE id=? AND workspace=? AND state='pending' AND version=?", actor.id, taskId, actor.workspace, version);
      if (changed.changes !== 1) fail('claim_conflict');
      this.event(actor.workspace, 'task.claimed', taskId); return this.getTask(actor, taskId);
    });
  }
  complete(actor: Session, taskId: string, version: number, resultHash: string): Task {
    this.protectedTasks.guardLegacyMutation(actor,taskId);
    return this.transaction(() => {
      if (!this.one('SELECT hash FROM artifacts WHERE workspace=? AND hash=?', actor.workspace, resultHash)) fail('artifact_not_found');
      const changed = this.run("UPDATE tasks SET state='completed',result_hash=?,version=version+1 WHERE id=? AND workspace=? AND owner=? AND state='claimed' AND version=?", resultHash, taskId, actor.workspace, actor.id, version);
      if (changed.changes !== 1) fail('claim_conflict');
      this.event(actor.workspace, 'task.completed', taskId); return this.getTask(actor, taskId);
    });
  }
  cancel(actor: Session, taskId: string, version: number): Task {
    this.protectedTasks.guardLegacyMutation(actor,taskId);
    return this.transaction(() => {
      const changed = this.run("UPDATE tasks SET state='cancelled',version=version+1 WHERE id=? AND workspace=? AND creator=? AND state IN ('pending','claimed') AND version=?", taskId, actor.workspace, actor.id, version);
      if (changed.changes !== 1) fail('claim_conflict');
      this.event(actor.workspace, 'task.cancelled', taskId); return this.getTask(actor, taskId);
    });
  }
  putArtifact(actor: Session, content: string) {
    body.parse(content); const digest = hash(content); const bytes = Buffer.byteLength(content);
    this.run('INSERT OR IGNORE INTO artifacts(workspace,hash,content,bytes) VALUES(?,?,?,?)', actor.workspace, digest, content, bytes);
    return { hash: digest, bytes };
  }
  readArtifact(actor: Session, digest: string, offset = 0, limit = 4096) {
    const artifact = this.one<{ content: string }>('SELECT content FROM artifacts WHERE workspace=? AND hash=?', actor.workspace, digest);
    if (!artifact) fail('not_found');
    const key = hash(JSON.stringify(['range-v2', digest, offset, limit]));
    const cached = this.one<{ value: string }>('SELECT value FROM cache WHERE workspace=? AND key=?', actor.workspace, key);
    if (cached) {
      this.run('UPDATE cache SET touched=? WHERE workspace=? AND key=?', Date.now(), actor.workspace, key);
      return { ...JSON.parse(cached.value) as ReturnType<typeof range>, hash: digest, cache_hit: true };
    }
    const result = range(artifact.content, offset, limit); const value = JSON.stringify(result);
    this.transaction(() => {
      this.run('INSERT OR REPLACE INTO cache(workspace,key,value,bytes,touched) VALUES(?,?,?,?,?)', actor.workspace, key, value, Buffer.byteLength(value), Date.now());
      while (this.one<{ n: number }>('SELECT coalesce(sum(bytes),0) n FROM cache WHERE workspace=?', actor.workspace)!.n > 256 * 1024 * 1024) {
        this.run('DELETE FROM cache WHERE workspace=? AND key=(SELECT key FROM cache WHERE workspace=? ORDER BY touched,key LIMIT 1)', actor.workspace, actor.workspace);
      }
    });
    return { ...result, hash: digest, cache_hit: false };
  }
  clearCache(actor: Session) { return { deleted: Number(this.run('DELETE FROM cache WHERE workspace=?', actor.workspace).changes) }; }
  events(actor: Session, after = 0, limit = 20) {
    z.number().int().min(0).parse(after); z.number().int().min(1).max(50).parse(limit);
    const rows = this.all<{ seq: number; kind: string; entity: string; created_at: string }>('SELECT e.seq,e.kind,e.entity,e.created_at FROM events e WHERE e.workspace=? AND e.seq>? AND NOT EXISTS (SELECT 1 FROM request_messages rm JOIN requests r ON r.id=rm.request_id WHERE rm.message_id=e.entity AND r.creator<>? AND r.recipient<>?) AND NOT EXISTS (SELECT 1 FROM request_tasks rt JOIN requests r ON r.id=rt.request_id JOIN messages m ON m.id=r.message_id WHERE rt.task_id=e.entity AND (r.creator<>? AND r.recipient<>? OR r.recipient=? AND m.delivered_at IS NULL)) ORDER BY e.seq LIMIT ?', actor.workspace, after, actor.id,actor.id,actor.id,actor.id,actor.id,limit + 1);
    const items = rows.slice(0, limit); return { items, next: items.at(-1)?.seq ?? after, has_more: rows.length > limit };
  }
  record(actor: Session, taskId: string) {
    const task = this.getTask(actor, taskId);
    const linked=this.one<{request_id:string}>('SELECT request_id FROM request_tasks WHERE task_id=?',taskId);
    const verification=linked?this.requestVerification(actor,linked.request_id):null;
    // No model call; the database, not this Markdown projection, remains authoritative.
    const text = `# ${task.title}\n\nTask: ${task.id}\nState: ${task.state}\nRevision: ${task.version}\nCreated: ${task.created_at}\n\n## Criteria\n\n${task.criteria}\n\n## Result\n\n${task.result_hash ? `sha256:${task.result_hash}` : task.state==='completed'?'Result submitted; private references await delivery.':'No result submitted.'}\n\nCompletion records the owner’s submission; independent verification is not implemented.\n`;
    const markdown=verification?`${text}\nVerification: ${verification.status}\nSource: self_reported\nNeeds attention: ${verification.needs_attention}\n`:text;
    return { task_id: task.id, version: task.version, hash: hash(markdown), markdown, llm_calls: 0 };
  }
}
