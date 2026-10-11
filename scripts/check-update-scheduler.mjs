// Opt-in integration check on a disposable Linux CI user with a live user manager.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
if(process.platform!=='linux'||process.geteuid?.()===0)throw Error('linux_user_manager_required');
const directory=mkdtempSync(join(tmpdir(),'durebak update 한글 $100%-'));
const command=(...args)=>{
 const result=spawnSync(process.execPath,[resolve('dist/cli.js'),'update',...args,'--update-dir',directory],{encoding:'utf8',timeout:30000});
 if(result.status!==0)throw Error('update_command_failed');return JSON.parse(result.stdout);
};
let enabled=false;
try{
 const state=command('enable','--mode','notify','--channel','alpha');enabled=true;
 if(state.scheduler!=='systemd')throw Error('scheduler_not_registered');
 const label='com.durebak.updates.'+createHash('sha256').update(directory).digest('hex').slice(0,20);
 const worker=spawnSync('/usr/bin/systemctl',['--user','start',label+'.service'],{timeout:30000});
 if(worker.status!==0)throw Error('scheduled_worker_failed');
 const checked=command('status');
 if(checked.last_checked_at===null||!checked.report)throw Error('worker_result_missing');
 console.log(JSON.stringify({scheduler:'systemd',worker_checked:true}));
}finally{
 // A failed registration already rolls back its new schedule files.
 if(enabled){const disabled=command('disable');if(disabled.scheduler!=='none'||disabled.mode!=='disabled')throw Error('scheduler_cleanup_failed');}
 rmSync(directory,{recursive:true,force:true});
}
