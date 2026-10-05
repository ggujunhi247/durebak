import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sendSchema,fail,hash,type Message,type QueuedMessage,type Session} from './domain.js';
import {queuePolicy,retryDelay} from './queue-policy.js';
import {expireRequestsWithinTransaction} from './requests.js';
export function messageQueue(db:DatabaseSync){
 const one=<T>(sql:string,...args:SQLInputValue[])=>db.prepare(sql).get(...args) as T|undefined;
 const all=<T>(sql:string,...args:SQLInputValue[])=>db.prepare(sql).all(...args) as T[];
 const run=(sql:string,...args:SQLInputValue[])=>db.prepare(sql).run(...args);
 const event=(workspace:string,kind:string,entity:string)=>run('INSERT INTO events(workspace,kind,entity,created_at) VALUES(?,?,?,?)',workspace,kind,entity,new Date().toISOString());
 const message=(id:string)=>one<Message>('SELECT seq,id,workspace,sender,recipient,body,reply_to,status,created_at FROM messages WHERE id=?',id)!;
 const maintain=(recipient:string,now:number)=>{

    expireRequestsWithinTransaction(db,now);
    const rows=all<Pick<QueuedMessage,'id'|'workspace'|'status'|'attempts'|'expires_at'|'lease_until'>>("SELECT id,workspace,status,attempts,expires_at,lease_until FROM messages WHERE recipient=? AND status IN ('queued','in_flight')",recipient);
    for (const row of rows) {
      if (row.expires_at!==null && row.expires_at<=now) {
        run("UPDATE messages SET status='expired',lease_until=NULL WHERE id=?",row.id);
        event(row.workspace,'message.expired',row.id);
      } else if(row.status==='in_flight' && row.lease_until!<=now) {
        const status=row.attempts>=queuePolicy.max_attempts?'dead_letter':'queued';
        run('UPDATE messages SET status=?,due_at=?,lease_until=NULL WHERE id=?',status,row.lease_until!+retryDelay(row.attempts),row.id);
        event(row.workspace,`message.${status}`,row.id);
      }
    }
  
 };
 const enqueue=(actor:Session,input:z.input<typeof sendSchema>,decisionTime:number):Message=>{

    const data = sendSchema.parse(input);
    if (data.priority === 'urgent' && !data.urgentReason) fail('urgent_reason_required');
    const digest = hash(JSON.stringify([data.to, data.body, data.replyTo ?? null, data.priority, data.urgentReason ?? null, data.delayMs, data.ttlMs]));
    const old = one<QueuedMessage>('SELECT * FROM messages WHERE sender=? AND key=?', actor.id, data.key);
    if (old) {
      const legacyMatch = old.legacy && data.priority==='normal' && !data.urgentReason && data.delayMs===0 && data.ttlMs===86400000 && old.digest===hash(JSON.stringify([data.to,data.body,data.replyTo??null]));
      if (old.digest !== digest && !legacyMatch) fail('idempotency_conflict'); return message(old.id);
    }
    if (!one('SELECT id FROM sessions WHERE id=? AND workspace=? AND revoked=0', data.to, actor.workspace)) fail('not_found');
    if (data.replyTo && !one('SELECT id FROM messages WHERE id=? AND workspace=? AND recipient=? AND sender=?', data.replyTo, actor.workspace, actor.id, data.to)) fail('invalid_reply');
    const now = decisionTime;
    const due = now + Math.max(queuePolicy.delay_ms[data.priority], data.delayMs);
    if (now + data.ttlMs <= due) fail('expiry_before_delivery');
    maintain(data.to, now);
    if (data.priority==='urgent' && one<{n:number}>("SELECT count(*) n FROM messages WHERE sender=? AND priority='urgent' AND created_ms>?", actor.id, now-queuePolicy.urgent_window_ms)!.n >= queuePolicy.urgent_limit) fail('urgent_quota_exceeded');
    const count = one<{ n: number }>("SELECT count(*) n FROM messages WHERE recipient=? AND status IN ('queued','in_flight')", data.to)!.n;
    if (count >= queuePolicy.capacity) fail('inbox_full');
    const messageId = randomUUID();
    run("INSERT INTO messages(id,workspace,sender,recipient,body,reply_to,created_at,key,digest,status,priority,urgent_reason,created_ms,due_at,expires_at,legacy) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,0)", messageId, actor.workspace, actor.id, data.to, data.body, data.replyTo ?? null, new Date(now).toISOString(), data.key, digest, data.priority, data.urgentReason??null, now, due, now+data.ttlMs);
    event(actor.workspace, 'message.queued', messageId);
    return message(messageId);
  
 };return {enqueue,maintain};
}
