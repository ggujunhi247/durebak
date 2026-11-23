import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {handleUpdateCommand,cachedUpdateNotice} from '../src/update-cli.js';
import {loadUpdateState,runUpdateWorker} from '../src/update-state.js';
import {installUpdateSchedule,scheduleFiles} from '../src/update-scheduler.js';
function context(t:any){const home=mkdtempSync(join(tmpdir(),'durebak-policy-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return {home,directory:join(home,'updates'),current:'0.1.0-alpha.23',platform:'darwin',uid:process.geteuid!(),node:process.execPath,cli:join(home,'cli.js')};}
test('enable, pin, disable preserve notification policy and remove only owned scheduling',async t=>{
 const ctx=context(t);let calls=0;const run=()=>{calls++;return 0;};
 await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,run);
 assert.equal(loadUpdateState(ctx.directory,ctx.current).mode,'notify');assert.ok(calls>0);
 await handleUpdateCommand('pin',['0.1.0-alpha.23'],{},ctx,run);assert.equal(loadUpdateState(ctx.directory,ctx.current).pin,'0.1.0-alpha.23');
 await handleUpdateCommand('disable',[],{},ctx,run);const state=loadUpdateState(ctx.directory,ctx.current);assert.equal(state.mode,'disabled');assert.equal(state.scheduler,'none');
});
test('disabling notifications leaves an independent recovery schedule intact',async t=>{
 const ctx={...context(t),platform:'linux'};
 const run=()=>0;
 const recovery={...ctx,cli:join(ctx.home,'recovery.mjs'),recoveryRoot:join(ctx.home,'prefix','lib','node_modules')};
 const recoveryFiles=scheduleFiles(recovery);
 assert.match(recoveryFiles[0]!.text,/--recover/);
 assert.throws(()=>scheduleFiles({...recovery,cli:join(recovery.recoveryRoot,'durebak','dist','recovery.mjs')}),/unsafe_update_schedule_path/);
 installUpdateSchedule(recovery,run);
 await handleUpdateCommand('enable',[],{mode:'notify',channel:'alpha'},ctx,run);
 await handleUpdateCommand('disable',[],{},ctx,run);
 assert.ok(recoveryFiles.every(file=>existsSync(file.path)));
 assert.ok(scheduleFiles(ctx).every(file=>!existsSync(file.path)));
});
test('auto/apply never install or create state when operational trust and safety gates are missing',async t=>{
 const ctx=context(t);let calls=0;const run=()=>{calls++;return 0;};
 await assert.rejects(handleUpdateCommand('enable',[],{mode:'auto',channel:'alpha'},ctx,run),/automatic_apply_not_configured/);
 await assert.rejects(handleUpdateCommand('apply',[],{target:'0.1.0-alpha.24'},ctx,run),/automatic_apply_not_configured/);
 assert.equal(calls,0);assert.equal(existsSync(ctx.directory),false);
});
test('auto is opt-in, pin blocks apply, and disabling during staging prevents the swap',async t=>{
 const ctx=context(t),run=()=>0;
 let swapped=0;
 let resume!:()=>void;
 let staged!:()=>void;
 const atStage=new Promise<void>(resolve=>{staged=resolve;});
 const installer={verify(){},async apply(_context:unknown,_path:string,_channel:string,_target:string,commit:(install:()=>void)=>void){
  await new Promise<void>(resolve=>{resume=resolve;staged();});
  commit(()=>{swapped++;});
 }};
 const command=(action:string,options:{mode?:string;channel?:string;target?:string}={},args:string[]=[])=>handleUpdateCommand(action,args,options,ctx,run,installer);
 await command('enable',{mode:'auto',channel:'alpha'});
 assert.equal(loadUpdateState(ctx.directory,ctx.current).mode,'auto');
 await command('pin',{},[ctx.current]);
 await assert.rejects(command('apply',{target:'0.1.0-alpha.24'}),/update_version_pinned/);
 await command('unpin');
 const pending=command('apply',{target:'0.1.0-alpha.24'});
 await atStage;
 await command('disable');
 resume();
 assert.deepEqual(await pending,{version:'0.1.0-alpha.24',phase:'blocked',reason:'update_policy_changed'});
 assert.equal(swapped,0);
 assert.equal(loadUpdateState(ctx.directory,ctx.current).mode,'disabled');
 await assert.rejects(command('apply',{target:'0.1.0-alpha.24'}),/automatic_apply_not_configured/);
});
test('the scheduled worker applies only an auto-enabled matching registry and GitHub candidate',async t=>{
 const ctx=context(t),run=()=>0,target='0.1.0-alpha.24';
 const repo='https://github.com/ggujunhi247/durebak/releases';
 t.mock.method(globalThis,'fetch',async (url:string)=>Response.json(url.startsWith('https://registry.npmjs.org')?{name:'durebak',version:target}:[{
  tag_name:`v${target}`,draft:false,prerelease:true,html_url:`${repo}/tag/v${target}`,
  assets:[{name:`durebak-${target}.tgz`,browser_download_url:`${repo}/download/v${target}/durebak-${target}.tgz`}]
 }]));
 let applied=0;
 const installer={verify(){},async apply(_context:unknown,_path:string,_channel:string,version:string,commit:(install:()=>void)=>void){
  assert.equal(version,target);commit(()=>{applied++;});
 }};
 const command=(action:string,options:{mode?:string;channel?:string}={})=>handleUpdateCommand(action,[],options,ctx,run,installer);
 await command('enable',{mode:'notify',channel:'alpha'});
 await command('worker');
 assert.equal(applied,0);
 await command('enable',{mode:'auto',channel:'alpha'});
 await command('worker');
 assert.equal(applied,1);
 assert.deepEqual(loadUpdateState(ctx.directory,ctx.current).last_apply,{version:target,phase:'applied',reason:null});
 await command('disable');
 await command('worker');
 assert.equal(applied,1);
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
