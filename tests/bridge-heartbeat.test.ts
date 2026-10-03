import test from 'node:test';
import assert from 'node:assert/strict';
import {startBridgeHeartbeat,type HeartbeatDependencies} from '../src/bridge-heartbeat.js';
import {DomainError} from '../src/domain.js';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(overrides:Partial<HeartbeatDependencies>={}){
 const jobs:Array<{fn:()=>void;delay:number}>=[];let touches=0,closes=0;
 const deps:HeartbeatDependencies={instance:'instance',runtimeInfo:async()=>({daemon_epoch:'epoch-a',capabilities:['session_health_v1']}),touch:async()=>{touches++;},close:async()=>{closes++;},schedule:(fn,delay)=>{const job={fn,delay};jobs.push(job);return job;},cancel:handle=>{const i=jobs.indexOf(handle as any);if(i>=0)jobs.splice(i,1);},...overrides};
 return {jobs,deps,get touches(){return touches;},get closes(){return closes;}};
}
test('heartbeat submits immediately then ten seconds after completion and never overlaps',async()=>{
 let finish!:()=>void;let count=0;const f=fixture({touch:()=>{count++;return new Promise<void>(r=>{finish=r;});}});const h=startBridgeHeartbeat(f.deps);await flush();assert.equal(count,1);assert.equal(f.jobs.length,0);finish();await flush();assert.equal(f.jobs[0]!.delay,10000);const job=f.jobs.shift()!;job.fn();await flush();assert.equal(count,2);assert.equal(f.jobs.length,0);const stopped=h.stop();finish();await stopped;assert.equal(f.jobs.length,0);assert.equal(f.closes,1);
});
test('missing capability and changed epoch are checked before every contact',async()=>{
 let epoch='a';let caps:string[]=[];const seen:string[]=[];const f=fixture({runtimeInfo:async()=>({daemon_epoch:epoch,capabilities:caps}),touch:async(_i,e)=>{seen.push(e);}});const h=startBridgeHeartbeat(f.deps);await flush();assert.equal(f.jobs[0]!.delay,60000);assert.deepEqual(seen,[]);
 caps=['session_health_v1'];f.jobs.shift()!.fn();await flush();assert.deepEqual(seen,['a']);epoch='b';f.jobs.shift()!.fn();await flush();assert.deepEqual(seen,['a','b']);await h.stop();assert.equal(f.jobs.length,0);
});
test('unauthorized stops permanently and connection failures back off without loops',async()=>{
 let unauthorized=false;const f=fixture({touch:async()=>{throw unauthorized?new DomainError('unauthorized'):new Error('disconnected');}});const h=startBridgeHeartbeat(f.deps);await flush();for(const delay of [10000,20000,40000,60000]){assert.equal(f.jobs[0]!.delay,delay);f.jobs.shift()!.fn();await flush();}unauthorized=true;f.jobs.shift()!.fn();await flush();assert.equal(f.jobs.length,0);await h.stop();
});
