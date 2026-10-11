import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installUpdateSchedule,removeUpdateSchedule,scheduleFiles} from '../src/update-scheduler.js';
function fixture(t:any,platform:'darwin'|'linux'){
 const home=mkdtempSync(join(tmpdir(),'durebak-scheduler-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 return {home,platform,directory:join(home,'한글 data'),node:process.execPath,cli:join(home,'cli $variable%".js'),uid:process.geteuid!()};
}
test('user schedules preserve arguments and owned config is removable with its receipt',t=>{
 for(const platform of ['darwin','linux'] as const){const options=fixture(t,platform);const calls:{command:string;args:string[]}[]=[];
  const run=(command:string,args:string[])=>{calls.push({command,args});return 0;};
  const receipt=installUpdateSchedule(options,run);const files=scheduleFiles(options);
  assert.equal(calls.some(c=>c.args.some(a=>a.includes('sudo'))),false);
  for(const file of files){assert.equal(statSync(file.path).mode&0o777,0o600);assert.equal(readFileSync(file.path,'utf8'),file.text);}
  if(platform==='darwin')assert.ok(files[0]!.text.includes('&quot;'));else{assert.ok(files[0]!.text.includes('$$variable%%'));assert.ok(files[0]!.text.includes('\\"'));}
  removeUpdateSchedule(options,receipt,run);for(const file of files)assert.equal(existsSync(file.path),false);
 }
});
test('foreign or changed scheduler config is never overwritten or removed',t=>{
 const options=fixture(t,'darwin');const receipt=installUpdateSchedule(options,()=>0);const file=scheduleFiles(options)[0]!.path;
 writeFileSync(file,'user edited',{mode:0o600});
 assert.throws(()=>installUpdateSchedule(options,()=>0),/update_schedule_conflict/);
 assert.throws(()=>removeUpdateSchedule(options,receipt,()=>0),/update_schedule_conflict/);assert.equal(readFileSync(file,'utf8'),'user edited');
});
test('registration failure cleans new files, and Windows and root scheduling are refused',t=>{
 const options=fixture(t,'linux');assert.throws(()=>installUpdateSchedule(options,()=>1),/update_schedule_failed/);
 for(const file of scheduleFiles(options))assert.equal(existsSync(file.path),false);
 assert.throws(()=>installUpdateSchedule({...options,platform:'win32'},()=>0),/unsupported_update_scheduler/);
 assert.throws(()=>installUpdateSchedule({...options,uid:0},()=>0),/unsupported_update_scheduler/);
});
