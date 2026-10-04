import type {Readable,Writable} from 'node:stream';
import {TextDecoder} from 'node:util';
export interface RpcNotification {method:string;params?:unknown}
interface Options {timeoutMs?:number;maxLineBytes?:number;maxPending?:number;onNotification?:(message:RpcNotification)=>void}
const ignoreLateStreamError=()=>{};
interface Pending {resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
// Internal transport only, not execution authority. The owned driver must
// validate native identity, permission provenance and durable attempt receipts.
export class CodexRpc {
 private pending=new Map<number,Pending>();private sequence=0;private buffer=Buffer.alloc(0);private closed=false;
 private readonly timeoutMs:number;private readonly maxLineBytes:number;private readonly maxPending:number;
 constructor(private input:Readable,private output:Writable,private options:Options={}){
  this.timeoutMs=options.timeoutMs??20000;this.maxLineBytes=options.maxLineBytes??262144;this.maxPending=options.maxPending??32;
  for(const n of [this.timeoutMs,this.maxLineBytes,this.maxPending])if(!Number.isSafeInteger(n)||n<1)throw new Error('rpc_invalid_limits');
  input.on('data',this.data);input.on('end',this.end);input.on('close',this.end);input.on('error',this.readError);output.on('error',this.writeError);output.on('close',this.end);
 }
 private terminate(code:string){if(this.closed)return;this.closed=true;this.buffer=Buffer.alloc(0);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(code));}this.pending.clear();this.detach();}
 private end=()=>this.terminate('rpc_closed');private readError=()=>this.terminate('rpc_read_failed');private writeError=()=>this.terminate('rpc_write_failed');
 private write(value:unknown){const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length-1>this.maxLineBytes)throw new Error('rpc_frame_too_large');try{if(!this.output.write(bytes,error=>{if(error)this.writeError();}))this.terminate('rpc_backpressure');}catch{this.writeError();}}
 private message(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('rpc_protocol_error');const m=raw as Record<string,unknown>,hasId=Object.hasOwn(m,'id'),hasMethod=Object.hasOwn(m,'method'),hasResult=Object.hasOwn(m,'result'),hasError=Object.hasOwn(m,'error');
  if(hasId&&!(typeof m.id==='string'||Number.isSafeInteger(m.id)))throw new Error('rpc_protocol_error');
  if(hasMethod){if(typeof m.method!=='string'||!m.method.length||hasResult||hasError)throw new Error('rpc_protocol_error');
   // Host requests use a separate id namespace. Never treat an approval or
   // dynamic tool request as a response; no peer data grants local execution.
   if(hasId){this.write({id:m.id,error:{code:-32601,message:'unsupported_host_request'}});return;}
   try{this.options.onNotification?.({method:m.method,...(Object.hasOwn(m,'params')?{params:m.params}:{})});}catch{throw new Error('rpc_notification_failed');}return;
  }
  if(!hasId||hasResult===hasError||Object.hasOwn(m,'params'))throw new Error('rpc_protocol_error');
  if(hasError&&(!m.error||typeof m.error!=='object'||!Number.isSafeInteger((m.error as {code?:unknown}).code)))throw new Error('rpc_protocol_error');
  const p=typeof m.id==='number'?this.pending.get(m.id):undefined;if(!p)return;this.pending.delete(m.id as number);clearTimeout(p.timer);
  if(hasError)p.reject(new Error(`rpc_remote_error:${(m.error as {code:number}).code}`));else p.resolve(m.result);
 }
 private data=(chunk:Buffer|string)=>{if(this.closed)return;try{
  this.buffer=Buffer.concat([this.buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);let newline:number;
  while((newline=this.buffer.indexOf(10))>=0){if(newline>this.maxLineBytes)throw new Error('rpc_frame_too_large');const line=this.buffer.subarray(0,newline);this.buffer=this.buffer.subarray(newline+1);this.message(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line)));if(this.closed)return;}
  if(this.buffer.length>this.maxLineBytes)throw new Error('rpc_frame_too_large');this.buffer=this.buffer.length?Buffer.from(this.buffer):Buffer.alloc(0);
 }catch(error){this.terminate(error instanceof Error&&['rpc_frame_too_large','rpc_notification_failed'].includes(error.message)?error.message:'rpc_protocol_error');}};
 call(method:string,params:unknown):Promise<unknown>{
  if(this.closed)return Promise.reject(new Error('rpc_closed'));if(typeof method!=='string'||!method.length)return Promise.reject(new Error('rpc_invalid_method'));if(this.pending.size>=this.maxPending)return Promise.reject(new Error('rpc_pending_limit'));
  const id=++this.sequence;let frame:Buffer;try{frame=Buffer.from(JSON.stringify({id,method,params})+'\n');if(frame.length-1>this.maxLineBytes)throw new Error('rpc_frame_too_large');}catch{return Promise.reject(new Error('rpc_frame_too_large'));}
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('rpc_timeout'));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});try{if(!this.output.write(frame,error=>{if(error)this.writeError();}))this.terminate('rpc_backpressure');}catch{this.writeError();}});
 }
 notify(method:string,params:unknown){if(this.closed)throw new Error('rpc_closed');this.write({method,params});}
 private detach(){this.input.off('data',this.data);this.input.off('end',this.end);this.input.off('close',this.end);this.input.off('error',this.readError);this.output.off('error',this.writeError);this.output.off('close',this.end);for(const stream of [this.input,this.output])if(!stream.listeners('error').includes(ignoreLateStreamError))stream.on('error',ignoreLateStreamError);}
 close(){this.terminate('rpc_closed');}
}
