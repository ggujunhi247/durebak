import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {applyPackageSwap,recoverPackageSwap} from '../src/update-package-swap.js';
import {assertNoPendingNpmUpdate} from '../src/update-installation.js';
import {acquireMaintenanceGate} from '../src/database.js';
import {acquireNpmRuntime} from '../src/update-inventory.js';

const unsupported=process.platform==='win32'||process.geteuid?.()===0;

function fixture(t:test.TestContext){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'durebak-package-swap-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const active=join(root,'durebak'),transaction=join(root,'.durebak-update'),staged=join(transaction,'candidate');
 mkdirSync(active,{mode:0o700});
 mkdirSync(transaction,{mode:0o700});
 mkdirSync(staged,{mode:0o700});
 writeFileSync(join(active,'version'),'old');
 writeFileSync(join(staged,'version'),'new');
 const version=(directory=active)=>readFileSync(join(directory,'version'),'utf8');
 return {root,active,transaction,staged,version};
}

test('successful switch keeps the verified candidate active and the old package as backup',{skip:unsupported},t=>{
 const {root,transaction,version}=fixture(t);
 applyPackageSwap(root,path=>version(path)==='new');
 assert.equal(version(),'new');
 assert.equal(version(join(transaction,'previous')),'old');
 assert.equal(recoverPackageSwap(root),'committed');
});

test('failed verification restores the previous package and leaves a rollback receipt',{skip:unsupported},t=>{
 const {root,staged,version}=fixture(t);
 assert.throws(()=>applyPackageSwap(root,()=>{throw new Error('verification_failed');}),/verification_failed/);
 assert.equal(version(),'old');
 assert.equal(version(staged),'new');
 assert.equal(recoverPackageSwap(root),'rolled_back');
});

test('a fresh process can recover after the installer is killed with the new package active',{skip:unsupported},t=>{
 const {root,version}=fixture(t);
 const moduleUrl=pathToFileURL(resolve('dist/update-package-swap.js')).href;
 const script=`const {applyPackageSwap}=await import(process.argv[1]);applyPackageSwap(process.argv[2],()=>{process.kill(process.pid,'SIGKILL');return false;});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script,moduleUrl,root],{timeout:5000});
 assert.equal(result.signal,'SIGKILL',result.stderr.toString());
 assert.equal(version(),'new');
 const recovery=join(root,'recovery.mjs');
 copyFileSync(new URL(moduleUrl),recovery);
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,[recovery,'--recover',root],{encoding:'utf8',timeout:5000})),{phase:'rolled_back'});
 assert.equal(version(),'old');
 assert.equal(recoverPackageSwap(root),'rolled_back');
});

test('recovery preserves a replacement package it cannot identify',{skip:unsupported},t=>{
 const {root,active,version}=fixture(t);
 assert.throws(()=>applyPackageSwap(root,()=>{
  renameSync(active,join(root,'moved'));
  mkdirSync(active,{mode:0o700});
  writeFileSync(join(active,'version'),'replacement');
  throw new Error('verification_failed');
 }),/update_swap_repair_required/);
 assert.equal(version(),'replacement');
 assert.throws(()=>recoverPackageSwap(root),/update_swap_repair_required/);
});

test('a staged npm global installation switches only after registering independent recovery',{skip:unsupported},async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'durebak-npm-swap-')));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const npm=(...args:string[])=>execFileSync('npm',args,{cwd:directory,encoding:'utf8',timeout:15000,env:{...process.env,npm_config_cache:join(directory,'cache')}}).trim();
 const prefix=join(directory,'live'),staging=join(directory,'staging');
 for(const [version,target] of [['1.0.0',prefix],['1.0.1',staging]] as const){
  const source=join(directory,version),dist=join(source,'dist');
  mkdirSync(dist,{recursive:true});
  writeFileSync(join(dist,'cli.js'),`#!/usr/bin/env node\nconsole.log('${version}');\n`);
  writeFileSync(join(source,'package.json'),JSON.stringify({name:'durebak',version,bin:{durebak:'dist/cli.js'}}));
  const tarball=npm('pack',source,'--ignore-scripts','--offline');
  npm('install','--global','--prefix',target,'--ignore-scripts','--offline','--no-audit','--no-fund',join(directory,tarball));
 }
 const npmRoot=npm('root','--global','--prefix',prefix);
 const stagedRoot=npm('root','--global','--prefix',staging);
 const transaction=join(npmRoot,'.durebak-update');
 mkdirSync(transaction,{mode:0o700});
 renameSync(join(stagedRoot,'durebak'),join(transaction,'candidate'));
 const run=()=>execFileSync(process.execPath,[join(prefix,'bin','durebak')],{encoding:'utf8',timeout:5000}).trim();
 assert.equal(run(),'1.0.0');
 const {applyStagedNpmUpdate}=await import(pathToFileURL(resolve('dist/update-recovery.js')).href) as typeof import('../src/update-recovery.js');
 const cli=join(npmRoot,'durebak','dist','cli.js'),data=join(directory,'data');
 acquireMaintenanceGate(data,'runtime')();
 const options={home:directory,cli,npmRoot,path:join(prefix,'bin'),uid:process.geteuid!(),node:process.execPath,platform:'linux',directory:join(directory,'updates'),dataDirectories:[data]};
 const observed=join(directory,'previously-used');
 const installed=acquireNpmRuntime(observed,cli,directory);
 try{assert.throws(()=>applyStagedNpmUpdate(options,()=>false,()=>0),/runtime_active/);}
 finally{installed();}
 acquireMaintenanceGate(observed,'runtime')();
 assert.throws(()=>applyStagedNpmUpdate(options,()=>false,()=>1),/update_schedule_failed/);
 assert.equal(run(),'1.0.0');
 const calls:string[]=[];
 const receipt=applyStagedNpmUpdate(options,()=>{
  assert.throws(()=>assertNoPendingNpmUpdate(cli),/update_recovery_required/);
  assert.throws(()=>acquireMaintenanceGate(observed,'runtime'),/maintenance_in_progress/);
  assert.throws(()=>acquireNpmRuntime(join(directory,'another-new-directory'),cli,directory),/maintenance_in_progress/);
  assert.ok(calls.some(call=>call.includes('enable --now com.durebak.recovery.')));
  return run()==='1.0.1';
 },(_executable,args)=>{calls.push(args.join(' '));return 0;});
 assert.deepEqual(receipt,{phase:'committed',recovery_scheduled:false});
 assertNoPendingNpmUpdate(cli);
 assert.equal(run(),'1.0.1');
 assert.equal(recoverPackageSwap(npmRoot),'committed');
});
