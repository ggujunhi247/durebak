import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {Store} from '../dist/store.js';

// Synthetic local data only. Compare the same runtime/machine across revisions;
// absolute timings are observations, not a CI performance threshold.
// Build each revision first: npm run build && node scripts/benchmark-queue.mjs
const directory=mkdtempSync(join(tmpdir(),'durebak-queue-bench-'));
let store;
try {
 const now=1700000000000;store=new Store(directory,{now:()=>now});
 const sender=store.register('bench','sender','codex').session,receiver=store.register('bench','receiver','opencode').session;
 const text='x'.repeat(65536),messages=100,iterations=300;
 for(let i=0;i<messages;i++)store.send(sender,{to:receiver.id,body:text,key:String(i)});
 for(let i=0;i<30;i++)store.queueStatus(receiver);
 const times=[];
 for(let i=0;i<iterations;i++){const started=performance.now();store.queueStatus(receiver);times.push(performance.now()-started);}
 times.sort((a,b)=>a-b);
 console.log(JSON.stringify({runtime:process.version,messages,body_bytes:Buffer.byteLength(text),iterations,p50_ms:times[Math.floor(times.length*.5)],p95_ms:times[Math.floor(times.length*.95)]}));
}finally{store?.close();rmSync(directory,{recursive:true,force:true});}
