import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRuntime } from '../src/runtime.js';
const exec=promisify(execFile);

test('SIGKILL preserves committed data and requires explicit dead-process lock recovery', async t => {
  const dir=mkdtempSync(join(tmpdir(),'durebak-crash-'));
  const data=join(dir,'data');
  const args=['--import','tsx',resolve('src/cli.ts')];
  const child=spawn(process.execPath,[...args,'serve','--data-dir',data],{stdio:['ignore','ignore','pipe']});
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
    await runtime?.close();rmSync(dir,{recursive:true,force:true});
  });
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('start timeout')),10000);
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('unexpected exit'));});
    child.stderr.on('data',chunk=>{if(chunk.toString().includes('Durebak listening')){clearTimeout(timer);resolve();}});
  });
  const file=join(dir,'session-worker.json');
  const result=JSON.parse((await exec(process.execPath,[...args,'register','--data-dir',data,'--workspace',dir,'--alias','worker','--provider','codex','--out',file])).stdout);
  await exec(process.execPath,[...args,'call','send','--session',file,'--json',JSON.stringify({to:result.session.id,body:'committed before crash',key:'k'})]);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await assert.rejects(startRuntime(data),/runtime_locked/);
  const lock=JSON.parse(readFileSync(join(data,'runtime.lock'),'utf8'));
  assert.equal(lock.pid,child.pid);
  assert.throws(()=>process.kill(lock.pid,0),{code:'ESRCH'});
  unlinkSync(join(data,'runtime.lock'));
  runtime=await startRuntime(data);
  await new Promise(resolve=>setTimeout(resolve,5100));
  const inbox=JSON.parse((await exec(process.execPath,[...args,'call','receive','--session',file])).stdout);
  assert.equal(inbox.items[0].body,'committed before crash');
});
