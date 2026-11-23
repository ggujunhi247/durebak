import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentSchema,reviewSchema} from '../src/review-records.js';
import {Store} from '../src/store.js';

function fixture(t:test.TestContext){
  const dir=mkdtempSync(join(tmpdir(),'durebak-review-'));
  let now=100000;
  const clock={now:()=>now};
  let store=new Store(dir,clock);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const creator=store.register('w','creator','codex').session;
  const author=store.register('w','author','claude').session;
  const outsider=store.register('w','outsider','opencode').session;
  const q=store.requestCreate(creator,{to:author.id,body:'Review this result',key:'q',task:{title:'Review',criteria:'Inspect the artifact.'}});
  now+=5000;
  store.receive(author);
  store.requestTransition(author,q.id,1,'accepted',{expectedTaskVersion:1});
  function submit(key:string,expectedTaskVersion:number){
    const upload=store.attachmentPut(author,{name:key,content:key,key});
    return store.requestRevision(author,{id:q.id,version:2,expectedTaskVersion,uploadId:upload.id,key});
  }
  function deliver(){now+=5000;store.receive(creator);}
  return {get store(){return store;},creator,author,outsider,id:q.id,submit,deliver,
    reopen(){store.close();store=new Store(dir,clock);}};
}

test('independent review requires the creator and delivery of the current revision',t=>{
  const f=fixture(t);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'not_applicable');
  const r=f.submit('one',2),input={id:f.id,revisionId:r.id,decision:'approved',key:'approval'} as const;
  assert.throws(()=>f.store.requestReview(f.outsider,input),/not_found/);
  assert.throws(()=>f.store.requestReviewStatus(f.outsider,f.id),/not_found/);
  assert.throws(()=>f.store.requestReview(f.author,input),/request_role_required/);
  assert.throws(()=>f.store.requestReview(f.creator,input),/message_not_delivered/);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).revision_id,null);
  f.deliver();
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'needs_review');
  const approval=f.store.requestReview(f.creator,input);
  assert.equal(approval.source,'independent_review');
  assert.equal(f.store.requestReviewStatus(f.author,f.id).status,'approved');
  assert.throws(()=>f.store.requestReview(f.creator,{...input,decision:'changes_requested'}),/idempotency_conflict/);
  const changes=f.store.requestReview(f.creator,{...input,decision:'changes_requested',note:'Fix the race',key:'changes'});
  assert.deepEqual(f.store.requestReviewStatus(f.creator,f.id).active_reviews.map(item=>item.id),[changes.id]);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'changes_requested');
  f.reopen();
  assert.deepEqual(f.store.requestReview(f.creator,input),approval);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'changes_requested');
});

test('manually reported deployment is scoped to the exact approved revision and preserves prior attempts',t=>{
  const f=fixture(t),r=f.submit('one',2);
  f.deliver();
  const input={id:f.id,revisionId:r.id,commitSha:'a'.repeat(40),artifactSha:'b'.repeat(64),outcome:'failed',evidenceUrl:'https://example.com/build/1',key:'failure'} as const;
  assert.throws(()=>f.store.requestDeployment(f.creator,input),/review_approval_required/);
  const review=f.store.requestReview(f.creator,{id:f.id,revisionId:r.id,decision:'approved',key:'approval'});
  assert.throws(()=>f.store.requestDeployment(f.author,input),/request_role_required/);
  assert.throws(()=>f.store.requestDeployment(f.outsider,input),/not_found/);
  const failed=f.store.requestDeployment(f.creator,input);
  assert.equal(failed.review_id,review.id);
  assert.equal(failed.source,'self_reported');
  assert.equal(f.store.requestReviewStatus(f.author,f.id).latest_deployment?.outcome,'failed');
  assert.throws(()=>f.store.requestDeployment(f.creator,{...input,outcome:'published'}),/idempotency_conflict/);
  const published=f.store.requestDeployment(f.creator,{...input,outcome:'published',key:'published'});
  const reevaluate=f.store.requestReview(f.creator,{id:f.id,revisionId:r.id,decision:'needs_review',key:'reevaluate'});
  assert.throws(()=>f.store.requestDeployment(f.creator,{...input,key:'needs-approval'}),/review_approval_required/);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'needs_review');
  const newHead=f.submit('two',3);
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).status,'waiting_delivery');
  assert.equal(f.store.requestReviewStatus(f.creator,f.id).latest_deployment,null);
  assert.deepEqual(f.store.requestDeployment(f.creator,input),failed);
  f.deliver();
  assert.throws(()=>f.store.requestReview(f.creator,{id:f.id,revisionId:r.id,decision:'approved',key:'stale'}),/revision_conflict/);
  assert.throws(()=>f.store.requestDeployment(f.creator,{...input,key:'stale'}),/revision_conflict/);
  assert.throws(()=>f.store.requestDeployment(f.creator,{...input,revisionId:newHead.id,key:'unapproved'}),/review_approval_required/);
  const status=f.store.requestReviewStatus(f.creator,f.id);
  assert.equal(status.status,'needs_review');
  assert.equal(status.revision_id,newHead.id);
  assert.deepEqual(status.active_reviews,[]);
  assert.equal(status.latest_deployment,null);
  assert.deepEqual(status.review_history.map(item=>item.id),[reevaluate.id,review.id]);
  assert.deepEqual(status.deployment_history.map(item=>item.id),[published.id,failed.id]);
});

test('evidence inputs bound notes, require full hashes and reject unsafe URL forms',()=>{
  assert.equal(reviewSchema.safeParse({id:'q',revisionId:'r',decision:'approved',key:'k',note:'가'.repeat(200)}).success,false);
  const input={id:'q',revisionId:'r',commitSha:'a'.repeat(64),artifactSha:'b'.repeat(64),outcome:'published',key:'k'};
  for(const evidenceUrl of ['http://example.com','https://user:secret@example.com','https://@example.com',
    'https://example.com\\@another.example','https:///example.com','https://example.com/a\nb',' https://example.com',
    'https://example.com/'+'가'.repeat(400),'https://example.com/'+'"'.repeat(510)]){
    assert.equal(deploymentSchema.safeParse({...input,evidenceUrl}).success,false,evidenceUrl);
  }
  const evidenceUrl='https://example.com/build/42?job=publish';
  assert.equal(deploymentSchema.safeParse({...input,evidenceUrl}).success,true);
  assert.equal(deploymentSchema.safeParse({...input,evidenceUrl,commitSha:'abcdef0'}).success,false);
  assert.equal(deploymentSchema.safeParse({...input,evidenceUrl,artifactSha:input.commitSha.slice(0,40)}).success,false);
});
