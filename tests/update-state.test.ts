import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,symlinkSync,linkSync,existsSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadUpdateState,changeUpdateState,runUpdateWorker} from '../src/update-state.js';
const current='0.1.0-alpha.23';
function root(t:any){const dir=mkdtempSync(join(tmpdir(),'durebak-update-state-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('status read does not create storage and policy persists privately',t=>{
 const dir=join(root(t),'new');assert.equal(loadUpdateState(dir,current).mode,'disabled');assert.equal(existsSync(dir),false);
 changeUpdateState(dir,current,s=>({...s,mode:'notify',channel:'alpha'}));assert.equal(loadUpdateState(dir,current).mode,'notify');
 assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'state.json')).mode&0o777,0o600);
});
test('policy files refuse links, broad permissions and oversized input without touching targets',t=>{
 const dir=root(t),outside=join(dir,'outside');writeFileSync(outside,'private fixture',{mode:0o600});
 for(const kind of ['symbolic','hard','mode','size']){
  const store=join(dir,kind);mkdirSync(store,{mode:0o700});const file=join(store,'state.json');
  if(kind==='symbolic')symlinkSync(outside,file);else if(kind==='hard')linkSync(outside,file);else writeFileSync(file,kind==='size'?'x'.repeat(16385):'{}',{mode:kind==='mode'?0o644:0o600});
  assert.throws(()=>loadUpdateState(store,current));assert.throws(()=>changeUpdateState(store,current,s=>s));
 }
 assert.equal(readFileSync(outside,'utf8'),'private fixture');
});
test('writer collision preserves coordination and invalid state is not repaired',t=>{
 const dir=root(t);changeUpdateState(dir,current,s=>s);const lock=join(dir,'writer.lock.sqlite');const connection=new DatabaseSync(lock);connection.exec('BEGIN EXCLUSIVE');
 assert.throws(()=>changeUpdateState(dir,current,s=>({...s,mode:'notify'})),/update_state_busy/);connection.close();
 writeFileSync(join(dir,'state.json'),'{bad',{mode:0o600});assert.throws(()=>changeUpdateState(dir,current,s=>s));assert.equal(readFileSync(join(dir,'state.json'),'utf8'),'{bad');
});
test('disabled workers make no network calls and due enabled workers persist safe notices',async t=>{
 const dir=root(t);let calls=0;const request=async(url:string)=>{calls++;return url.includes('registry')?{name:'durebak',version:'0.1.0-alpha.24'}:[];};
 const disabled=await runUpdateWorker(dir,current,request,1000);assert.equal(disabled.checked,false);assert.equal(calls,0);
 changeUpdateState(dir,current,s=>({...s,mode:'notify'}));
 const first=await runUpdateWorker(dir,current,request,1000);assert.equal(first.checked,true);assert.equal(first.notice,true);assert.equal(calls,2);
 const early=await runUpdateWorker(dir,current,request,2000);assert.equal(early.checked,false);assert.equal(calls,2);
 const again=await runUpdateWorker(dir,current,request,3601000);assert.equal(again.checked,true);assert.equal(again.notice,false);assert.equal(calls,4);
 assert.equal(loadUpdateState(dir,current).report?.npm.version,'0.1.0-alpha.24');
});
test('policy changes during lookup discard stale worker result',async t=>{
 const dir=root(t);changeUpdateState(dir,current,s=>({...s,mode:'notify'}));let changed=false;
 await runUpdateWorker(dir,current,async(url:string)=>{if(!changed){changed=true;changeUpdateState(dir,current,s=>({...s,mode:'disabled'}));}return url.includes('registry')?{name:'durebak',version:'0.1.0-alpha.24'}:[];},1000);
 const state=loadUpdateState(dir,current);assert.equal(state.mode,'disabled');assert.equal(state.report,null);
});

test('process death releases worker and writer coordination without deleting uncertain locks',async t=>{
 const dir=root(t);changeUpdateState(dir,current,s=>({...s,mode:'notify'}));
 const moduleUrl=new URL('../src/update-state.ts',import.meta.url).href;
 for(const action of ['worker','writer']){
  const signal=join(dir,action+'-ready');
  const code=`import {writeFileSync} from 'node:fs';import {runUpdateWorker,changeUpdateState} from ${JSON.stringify(moduleUrl)};
   const signal=()=>writeFileSync(${JSON.stringify(signal)},'ready');
   ${action==='worker'?`await runUpdateWorker(${JSON.stringify(dir)},${JSON.stringify(current)},async()=>{signal();await new Promise(()=>{});},1000);`:`changeUpdateState(${JSON.stringify(dir)},${JSON.stringify(current)},s=>{signal();process.kill(process.pid,'SIGKILL');return s;});`}`;
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:'ignore'});t.after(()=>child.kill('SIGKILL'));const exited=once(child,'exit');
  for(let i=0;i<100&&!existsSync(signal);i++)await delay(20);
  assert.ok(existsSync(signal),'child reached coordination boundary');child.kill('SIGKILL');await exited;
  assert.doesNotThrow(()=>changeUpdateState(dir,current,s=>s));
  assert.equal((await runUpdateWorker(dir,current,async()=>({}),1000)).checked,true);
  changeUpdateState(dir,current,s=>({...s,next_check_at:null}));
 }
});
