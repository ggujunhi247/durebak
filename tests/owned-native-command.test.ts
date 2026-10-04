import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedNativeCommand} from '../src/owned-native-command.js';
const options={cwd:process.cwd(),env:{PATH:'/usr/bin:/bin'},timeoutMs:200,maxBytes:4096};
test('successful command waits for stdio and retires an inherited process group',async()=>{
 const command=new OwnedNativeCommand(process.execPath,['-e',`const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]}); console.log(child.pid); process.exit(0);`],options);
 const result=await command.result;const pid=Number(result.stdout.trim());assert.ok(pid>0);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});await command.close();
});
test('abort waits for actual child close and process group disappearance',async()=>{
 const command=new OwnedNativeCommand(process.execPath,['-e','setInterval(()=>{},1000)'],options);const pid=command.pid;const result=command.result;await command.close();await assert.rejects(result);assert.ok(pid);assert.throws(()=>process.kill(-pid!,0),{code:'ESRCH'});
});
test('output bound fails and still confirms owned retirement',async()=>{
 const command=new OwnedNativeCommand(process.execPath,['-e',`process.stdout.write('x'.repeat(9000));setInterval(()=>{},1000)`],options);await assert.rejects(command.result);await command.close();assert.throws(()=>process.kill(-command.pid!,0),{code:'ESRCH'});
});
test('uncertain group inspection rejects cleanup and supports an explicit retry',async t=>{
 const command=new OwnedNativeCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,timeoutMs:5000});const original=process.kill;const mock=t.mock.method(process,'kill',((pid:number,signal?:NodeJS.Signals|number)=>{if(pid===-command.pid!){throw Object.assign(new Error('denied'),{code:'EPERM'});}return original(pid,signal);}) as typeof process.kill);
 try{await assert.rejects(command.close(),/native_command_cleanup_unknown/);assert.equal(command.retired,false);}finally{mock.mock.restore();await command.close();await assert.rejects(command.result);}assert.equal(command.retired,true);
});
test('timeout retires a still running command group before rejection',async()=>{const command=new OwnedNativeCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,timeoutMs:50});await assert.rejects(command.result);assert.equal(command.retired,true);assert.throws(()=>process.kill(-command.pid!,0),{code:'ESRCH'});});
