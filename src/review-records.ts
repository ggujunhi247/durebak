import {randomUUID} from 'node:crypto';
import type {DatabaseSync,SQLInputValue} from 'node:sqlite';
import {z} from 'zod';
import {fail,hash,short,type Session} from './domain.js';
import type {CollaborationRequest} from './requests.js';
import {transaction} from './transactions.js';

const decision=z.enum(['approved','changes_requested','needs_review']);
const outcome=z.enum(['published','failed']);
const evidenceUrl=z.string().max(1024).refine(value=>{
  if(Buffer.byteLength(JSON.stringify(value))>1024||/[\s\x00-\x1f\x7f\\]/u.test(value)||!/^https:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value))return false;
  const url=URL.parse(value);
  return !!url&&url.protocol==='https:'&&!url.username&&!url.password;
},'expected a bounded HTTPS URL without credentials');

export const reviewSchema=z.object({
  id:short,revisionId:short,decision,note:z.string().min(1).max(512).refine(value=>Buffer.byteLength(JSON.stringify(value))<=512).optional(),key:short
}).strict();
export const deploymentSchema=z.object({
  id:short,revisionId:short,commitSha:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  artifactSha:z.string().regex(/^[a-f0-9]{64}$/),outcome,evidenceUrl,key:short
}).strict();

interface RecordFields {
  cursor:number;id:string;request_id:string;revision_id:string;author:string;created_ms:number;
}
export interface ReviewRecord extends RecordFields {
  decision:z.output<typeof decision>;note:string|null;source:'independent_review';
}
export interface DeploymentRecord extends RecordFields {
  review_id:string;commit_sha:string;artifact_sha:string;outcome:z.output<typeof outcome>;evidence_url:string;source:'self_reported';
}
interface Head {id:string;author:string;delivered_at:number|null}

const reviewSelect="SELECT cursor,id,request_id,revision_id,author,decision,note,created_ms,'independent_review' AS source";
const deploymentSelect="SELECT cursor,id,request_id,revision_id,review_id,author,commit_sha,artifact_sha,outcome,evidence_url,created_ms,'self_reported' AS source";
const historyLimit=5;
const recordLimit=100;

export class ReviewRecords {
  constructor(private db:DatabaseSync,private clock:{now():number},private get:(actor:Session,id:string,now?:number)=>CollaborationRequest){}

  private one<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).get(...args) as T|undefined;}
  private all<T>(sql:string,...args:SQLInputValue[]){return this.db.prepare(sql).all(...args) as unknown as T[];}
  private head(id:string){
    return this.one<Head>('SELECT r.id,r.author,m.delivered_at FROM task_revisions r JOIN messages m ON m.id=r.message_id WHERE r.request_id=? ORDER BY r.cursor DESC LIMIT 1',id);
  }
  private visible(actor:Session,head:Head){return head.author===actor.id||head.delivered_at!==null;}
  private writableHead(actor:Session,q:CollaborationRequest,revisionId:string){
    if(q.state!=='accepted'&&q.state!=='completed')fail('request_terminal');
    const head=this.head(q.id);
    if(!head)fail('not_found');
    if(!this.visible(actor,head))fail('message_not_delivered');
    if(head.id!==revisionId)fail('revision_conflict');
    return head;
  }
  private activeReview(q:CollaborationRequest,revisionId:string){
    return this.one<ReviewRecord>(reviewSelect+' FROM revision_reviews WHERE request_id=? AND revision_id=? AND author=? ORDER BY cursor DESC LIMIT 1',q.id,revisionId,q.creator);
  }
  private count(table:'revision_reviews'|'deployment_evidence',id:string){
    return this.one<{n:number}>('SELECT COUNT(*) AS n FROM '+table+' WHERE request_id=?',id)!.n;
  }

  addReview(actor:Session,input:z.input<typeof reviewSchema>){
    const data=reviewSchema.parse(input),digest=hash(JSON.stringify(data));
    return transaction(this.db,()=>{
      const q=this.get(actor,data.id);
      if(q.creator!==actor.id)fail('request_role_required');
      const old=this.one<ReviewRecord&{digest:string}>(reviewSelect+',digest FROM revision_reviews WHERE request_id=? AND author=? AND key=?',q.id,actor.id,data.key);
      if(old){
        if(old.digest!==digest)fail('idempotency_conflict');
        const {digest:_,...record}=old;
        return record;
      }
      if(this.writableHead(actor,q,data.revisionId).author===actor.id)fail('review_author_required');
      if(this.count('revision_reviews',q.id)>=recordLimit)fail('review_capacity_exceeded');
      const id=randomUUID();
      this.db.prepare('INSERT INTO revision_reviews(id,request_id,revision_id,author,key,digest,decision,note,created_ms) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id,q.id,data.revisionId,actor.id,data.key,digest,data.decision,data.note??null,this.clock.now());
      return {...this.one<ReviewRecord>(reviewSelect+' FROM revision_reviews WHERE id=?',id)!};
    });
  }

  addDeployment(actor:Session,input:z.input<typeof deploymentSchema>){
    const data=deploymentSchema.parse(input),digest=hash(JSON.stringify(data));
    return transaction(this.db,()=>{
      const q=this.get(actor,data.id);
      if(q.creator!==actor.id)fail('request_role_required');
      const old=this.one<DeploymentRecord&{digest:string}>(deploymentSelect+',digest FROM deployment_evidence WHERE request_id=? AND author=? AND key=?',q.id,actor.id,data.key);
      if(old){
        if(old.digest!==digest)fail('idempotency_conflict');
        const {digest:_,...record}=old;
        return record;
      }
      this.writableHead(actor,q,data.revisionId);
      const review=this.activeReview(q,data.revisionId);
      if(review?.decision!=='approved')fail('review_approval_required');
      if(this.count('deployment_evidence',q.id)>=recordLimit)fail('deployment_capacity_exceeded');
      const id=randomUUID();
      this.db.prepare('INSERT INTO deployment_evidence(id,request_id,revision_id,review_id,author,key,digest,commit_sha,artifact_sha,outcome,evidence_url,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,q.id,data.revisionId,review.id,actor.id,data.key,digest,data.commitSha,data.artifactSha,data.outcome,data.evidenceUrl,this.clock.now());
      return {...this.one<DeploymentRecord>(deploymentSelect+' FROM deployment_evidence WHERE id=?',id)!};
    });
  }

  history(actor:Session,id:string,reviewAfter=0,deploymentAfter=0,limit=historyLimit){
    this.get(actor,id);
    z.number().int().min(0).parse(reviewAfter);
    z.number().int().min(0).parse(deploymentAfter);
    z.number().int().min(1).max(historyLimit).parse(limit);
    return this.readHistory(id,reviewAfter,deploymentAfter,limit);
  }
  private readHistory(id:string,reviewAfter:number,deploymentAfter:number,limit:number){
    // Only the creator writes receipts, after the recipient's revision has been delivered.
    const page=' WHERE request_id=? AND (?=0 OR cursor<?) ORDER BY cursor DESC LIMIT ?';
    const reviews=this.all<ReviewRecord>(reviewSelect+' FROM revision_reviews'+page,id,reviewAfter,reviewAfter,limit+1);
    const deployments=this.all<DeploymentRecord>(deploymentSelect+' FROM deployment_evidence'+page,id,deploymentAfter,deploymentAfter,limit+1);
    const reviewHistory=reviews.slice(0,limit),deploymentHistory=deployments.slice(0,limit);
    return {
      review_history:reviewHistory,review_next:reviewHistory.at(-1)?.cursor??reviewAfter,review_has_more:reviews.length>limit,
      deployment_history:deploymentHistory,deployment_next:deploymentHistory.at(-1)?.cursor??deploymentAfter,deployment_has_more:deployments.length>limit
    };
  }

  summary(actor:Session,id:string,now?:number){
    const q=this.get(actor,id,now),head=this.head(id),visible=head&&this.visible(actor,head)?head:null;
    const review=visible?this.activeReview(q,visible.id):undefined;
    const deployment=visible?this.one<DeploymentRecord>(deploymentSelect+' FROM deployment_evidence WHERE request_id=? AND revision_id=? ORDER BY cursor DESC LIMIT 1',id,visible.id):undefined;
    return {
      status:!head?'not_applicable' as const:!visible?'waiting_delivery' as const:review?.decision??'needs_review' as const,
      revision_id:visible?.id??null,active_reviews:review?[review]:[],latest_deployment:deployment??null
    };
  }

  status(actor:Session,id:string,now?:number){
    return {
      ...this.summary(actor,id,now),
      ...this.readHistory(id,0,0,historyLimit),review_count:this.count('revision_reviews',id),deployment_count:this.count('deployment_evidence',id)
    };
  }
}
