import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=(...args)=>spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8'});
test('unknown CLI commands report the command error before requiring a session',()=>{
 const result=run('typo');assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{error:'unknown_command'});
});
test('malformed JSON from arguments and files reports invalid_json without exposing input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-invalid-input-'));
 try{
  const input=join(dir,'input.json');const body='{"private-test-value":';writeFileSync(input,body);
  for(const args of [['--json',body],['--input',input]]){
   const result=run('call','sessions','--session',join(dir,'unused.json'),...args);
   assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{error:'invalid_json'});assert.equal(result.stdout,'');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
