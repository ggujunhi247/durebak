import { spawn } from 'node:child_process';
import { openSync, closeSync, writeSync, ftruncateSync, fsyncSync } from 'node:fs';

export function runBounded(command,args,{cwd,env,timeoutMs=90000,killGraceMs=1000,maxBytes=2*1024*1024,input='',signal,classifyLine}={}) {
  if(signal?.aborted)return Promise.resolve({code:null,signal:null,reason:'cancelled',stdout:'',stderr:'',duration_ms:0,started:false});
  return new Promise(resolve=>{
    const started=Date.now(); let stdout='',stderr='',lineBuffer='',size=0,reason=null,terminationDone=Promise.resolve(),startedProcess=false;
    const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    child.once('spawn',()=>{startedProcess=true;});
    const terminate=(why)=>{
      if(reason)return;reason=why;
      const kill=sig=>{try{if(process.platform==='win32')child.kill(sig);else process.kill(-child.pid,sig);}catch{}};
      kill('SIGTERM');terminationDone=new Promise(done=>setTimeout(()=>{kill('SIGKILL');done();},killGraceMs));
    };
    const collect=(kind,data)=>{
      const room=Math.max(0,maxBytes-size);size+=data.length;
      if(kind==='stdout')stdout+=data.subarray(0,room).toString('utf8');else stderr+=data.subarray(0,room).toString('utf8');
      if(size>maxBytes)terminate('output_limit');
      if(kind==='stdout'&&classifyLine){
        lineBuffer+=data.subarray(0,room).toString('utf8');
        let newline;
        while((newline=lineBuffer.indexOf('\n'))>=0){
          const line=lineBuffer.slice(0,newline);lineBuffer=lineBuffer.slice(newline+1);
          let cause;try{cause=classifyLine(line);}catch{}
          if(cause)terminate(cause);
        }
      }
    };
    child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
    child.stdin.on('error',()=>{});child.stdin.end(input);
    const timer=setTimeout(()=>terminate('timeout'),timeoutMs);
    const abort=()=>terminate('cancelled');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.once('error',()=>{reason??='spawn_failed';});
    child.once('close',async(code,exitSignal)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);await terminationDone;
      resolve({code,signal:exitSignal,reason,stdout,stderr,started:startedProcess,duration_ms:Date.now()-started});
    });
  });
}

export function inspectExchange({worker,reviewer,request,reply,task,artifact,expected}) {
  return [
    {name:'request_sender_and_recipient',passed:request?.sender===worker && request?.recipient===reviewer},
    {name:'request_body',passed:request?.body===expected.request},
    {name:'request_acknowledged',passed:request?.status==='read'},
    {name:'correlated_reply',passed:!!request?.id && reply?.reply_to===request.id && reply?.sender===reviewer && reply?.recipient===worker},
    {name:'correction_body',passed:reply?.body===expected.reply},
    {name:'correction_acknowledged',passed:reply?.status==='read'},
    {name:'completed_by_owner',passed:task?.state==='completed' && task?.owner===worker},
    {name:'result_hash',passed:task?.result_hash===expected.hash},
    {name:'result_content',passed:artifact?.content===expected.content},
  ];
}

export function summarizeCodex(frames) {
  const tools=frames.filter(frame=>frame.type==='item.completed'&&frame.item?.type==='mcp_tool_call').map(({item})=>({server:item.server,tool:item.tool,status:item.status}));
  return {tools,failed:tools.some(tool=>tool.status==='failed')||frames.some(frame=>frame.type==='turn.failed'||frame.type==='error'),usage:frames.findLast(frame=>frame.type==='turn.completed')?.usage??null};
}


// Reserve before paid work. An interrupted run leaves an explicit incomplete report.
export function reserveReport(path) {
  const fd=openSync(path,'wx',0o600);
  let closed=false;
  const write=value=>{
    const data=Buffer.from(JSON.stringify(value,null,2)+'\n');
    ftruncateSync(fd,0);
    let offset=0;
    while(offset<data.length)offset+=writeSync(fd,data,offset,data.length-offset,offset);
    fsyncSync(fd);
  };
  const close=()=>{if(!closed){closeSync(fd);closed=true;}};
  try{write({status:'running',complete:false});}catch(error){close();throw error;}
  return {
    write(value){if(closed)throw new Error('report_already_closed');try{write(value);}finally{close();}},
    close,
  };
}
