import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {handleUpdateCommand,cachedUpdateNotice} from '../src/update-cli.js';
import {loadUpdateState,runUpdateWorker} from '../src/update-state.js';
function context(t:any){const home=mkdtempSync(join(tmpdir(),'durebak-policy-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return {home,directory:join(home,'updates'),current:'0.1.0-alpha.23',platform:'darwin',uid:process.geteuid!(),node:process.execPath,cli:join(home,'cli.js')};}
test('enable, pin, disable preserve notification policy and remove only owned scheduling',async t=>{
 const ctx=context(t);let calls=0;const run=()=>{calls++;return 0;};
 await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,run);
 assert.equal(loadUpdateState(ctx.directory,ctx.current).mode,'notify');assert.ok(calls>0);
 await handleUpdateCommand('pin',['0.1.0-alpha.23'],{},ctx,run);assert.equal(loadUpdateState(ctx.directory,ctx.current).pin,'0.1.0-alpha.23');
 await handleUpdateCommand('disable',[],{},ctx,run);const state=loadUpdateState(ctx.directory,ctx.current);assert.equal(state.mode,'disabled');assert.equal(state.scheduler,'none');
});
test('auto/apply never install or create state when operational trust and safety gates are missing',async t=>{
 const ctx=context(t);let calls=0;const run=()=>{calls++;return 0;};
 await assert.rejects(handleUpdateCommand('enable',[],{mode:'auto',channel:'alpha'},ctx,run),/automatic_apply_not_configured/);
 await assert.rejects(handleUpdateCommand('apply',[],{target:'0.1.0-alpha.24'},ctx,run),/automatic_apply_not_configured/);
 assert.equal(calls,0);assert.equal(existsSync(ctx.directory),false);
});
test('failed scheduler registration does not leave notify enabled',async t=>{
 const ctx=context(t);await assert.rejects(handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>1),/update_schedule_failed/);
 assert.equal(loadUpdateState(ctx.directory,ctx.current).mode,'disabled');
});
test('cached notices appear once per new result and disabled suppresses them',async t=>{
 const ctx=context(t);await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>0);
 await runUpdateWorker(ctx.directory,ctx.current,async url=>url.includes('registry')?{name:'durebak',version:'0.1.0-alpha.24'}:[],1000);
 assert.match(cachedUpdateNotice(ctx.directory,ctx.current)??'',/0\.1\.0-alpha\.24/);assert.equal(cachedUpdateNotice(ctx.directory,ctx.current),null);
 await handleUpdateCommand('disable',[],{},ctx,()=>0);assert.equal(cachedUpdateNotice(ctx.directory,ctx.current),null);
});
test('changing the notification channel clears cached candidates and old notices',async t=>{
 const ctx=context(t);await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>0);
 await runUpdateWorker(ctx.directory,ctx.current,async url=>url.includes('registry')?{name:'durebak',version:'0.1.0-alpha.24'}:[],1000);
 await handleUpdateCommand('enable',[],{mode:'notify',channel:'stable'},ctx,()=>0);
 assert.equal(loadUpdateState(ctx.directory,ctx.current).report,null);assert.equal(cachedUpdateNotice(ctx.directory,ctx.current),null);
});

test('a manually upgraded CLI never announces an equal or older cached candidate',async t=>{
 const ctx=context(t);await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>0);
 await runUpdateWorker(ctx.directory,ctx.current,async url=>url.includes('registry')?{name:'durebak',version:'0.1.0-alpha.24'}:[],1000);
 assert.equal(cachedUpdateNotice(ctx.directory,'0.1.0-alpha.24'),null);
 assert.equal(cachedUpdateNotice(ctx.directory,'0.1.0-alpha.25'),null);
});
test('re-enable repairs a missing owned scheduler config after interrupted removal',async t=>{
 const ctx={...context(t),platform:'linux'};
 await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>0);
 // Simulate a crash after scheduling was removed, before the policy receipt commit.
 const {scheduleFiles}=await import('../src/update-scheduler.js');
 const {rmSync}=await import('node:fs');for(const file of scheduleFiles(ctx))rmSync(file.path);
 let calls=0;await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,()=>{calls++;return 0;});
 assert.ok(calls>0);for(const file of scheduleFiles(ctx))assert.equal(existsSync(file.path),true);
 await handleUpdateCommand('disable',[],{},ctx,()=>0);
});
