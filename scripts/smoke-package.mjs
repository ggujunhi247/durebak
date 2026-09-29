import {parseArgs} from 'node:util';
import {inspectTarball} from './lib/package-check.mjs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const directory=mkdtempSync(join(tmpdir(),'durebak-installed-'));
const {values}=parseArgs({options:{tarball:{type:'string'}}});
const manifest=JSON.parse(readFileSync('package.json','utf8'));
let daemon;
try {
  let tarball=values.tarball?resolve(values.tarball):null;
  if(!tarball){const [pack]=JSON.parse((await exec('npm',['pack','--json','--ignore-scripts','--pack-destination',directory,'--cache',join(directory,'cache')])).stdout);tarball=join(directory,pack.filename);}
  const artifact=inspectTarball(tarball,manifest);
  const install=join(directory,'install'); mkdirSync(install);
  await exec('npm',['install','--prefix',install,'--ignore-scripts','--omit=dev','--no-audit','--no-fund',tarball],{timeout:120000});
  const cli=join(install,'node_modules',manifest.name,'dist','cli.js');
  const command=(...args)=>exec(process.execPath,[cli,...args],{timeout:15000});
  assert.equal((await command('--version')).stdout.trim(),manifest.version);
  const data=join(directory,'data');
  daemon=spawn(process.execPath,[cli,'serve','--data-dir',data],{stdio:['ignore','ignore','pipe']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('daemon_start_timeout')),15000);
    daemon.once('exit',()=>{clearTimeout(timer);reject(new Error('daemon_exited'));});
    daemon.stderr.on('data',chunk=>{if(chunk.toString().includes('Durebak listening')){clearTimeout(timer);resolve();}});
  });
  const file=join(directory,'session-worker.json');
  const registered=JSON.parse((await command('register','--data-dir',data,'--workspace',directory,'--alias','worker','--provider','other','--out',file)).stdout);
  assert.equal(JSON.parse((await command('doctor','--session',file)).stdout).ok,true);
  const setup=join(directory,'codex.toml');
  await command('setup','--host','codex','--session',file,'--out',setup);
  await command('call','send','--session',file,'--json',JSON.stringify({to:registered.session.id,body:'Installed package works',key:'smoke'}));
  await new Promise(resolve=>setTimeout(resolve,5100));
  const inbox=JSON.parse((await command('call','receive','--session',file)).stdout);
  assert.equal(inbox.items[0].body,'Installed package works');
  console.log(JSON.stringify({status:'passed',...artifact,checks:['version','daemon','registration','doctor','setup','send','receive']}));
} finally {
  if(daemon && daemon.exitCode===null && daemon.signalCode===null){const exited=once(daemon,'exit');daemon.kill('SIGTERM');await exited;}
  rmSync(directory,{recursive:true,force:true});
}
