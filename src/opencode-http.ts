import {request,type ClientRequest} from 'node:http';
import {realpathSync} from 'node:fs';
import {TextDecoder} from 'node:util';
import {z} from 'zod';
import {fail,short} from './domain.js';
const optionsSchema=z.object({url:z.string(),password:z.string().min(32).max(200),cwd:short,timeoutMs:z.number().int().min(10).max(20000).default(20000),maxResponseBytes:z.number().int().min(16).max(8388608).default(262144),maxPending:z.number().int().min(1).max(16).default(4)}).strict();
const nativeId=z.string().regex(/^ses_[A-Za-z0-9]+$/).max(200),messageId=z.string().regex(/^msg_[A-Za-z0-9]+$/).max(200);
const nativeInput=z.object({nativeId}).strict();
const submitInput=nativeInput.extend({messageId,providerId:short,modelId:short,text:z.string().min(1).refine(v=>Buffer.byteLength(v)<=16384)}).strict();
type Operation='health'|'config'|'agents'|'skills'|'providers'|'sessions'|'statuses'|'mcp'|'createSession'|'createOwnedSession'|'session'|'messages'|'submit'|'abort';
interface Route {path:string;method:'GET'|'POST';body?:unknown;status:number}
// Internal fixed-origin transport, not host ownership or execution authority.
// In particular, a 204 receipt is not model success and failed POSTs are never replayed.
export class OpencodeHttp {
 #authorization:string;#origin:string;#cwd:string;#timeout:number;#maxBytes:number;#maxPending:number;#closed=false;#pending=new Set<(code:string)=>void>();
 constructor(raw:unknown){const parsed=optionsSchema.safeParse(raw);if(!parsed.success)fail('http_invalid_options');const options=parsed.data;let url:URL;try{url=new URL(options.url);}catch{fail('http_invalid_origin');}if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail('http_invalid_origin');this.#origin=url.origin;try{this.#cwd=realpathSync.native(options.cwd);}catch{fail('http_invalid_options');}this.#authorization='Basic '+Buffer.from('opencode:'+options.password).toString('base64');this.#timeout=options.timeoutMs;this.#maxBytes=options.maxResponseBytes;this.#maxPending=options.maxPending;}
 get metadata(){return Object.freeze({origin:this.#origin,cwd:this.#cwd});}
 private route(operation:Operation,input:unknown):Route {
  const plain:Partial<Record<Operation,string>>={health:'/global/health',config:'/config',agents:'/agent',skills:'/skill',providers:'/provider',sessions:'/session',statuses:'/session/status',mcp:'/mcp'};
  if(Object.hasOwn(plain,operation)){z.object({}).strict().parse(input??{});return {path:plain[operation]!,method:'GET',status:200};}
  if(operation==='createSession'){const body=z.object({title:short}).strict().parse(input);return {path:'/session',method:'POST',body,status:200};}
  if(operation==='createOwnedSession'){const data=z.object({title:short,providerId:short,modelId:short,ownerNonce:short}).strict().parse(input);return {path:'/session',method:'POST',status:200,body:{title:data.title,agent:'build',model:{providerID:data.providerId,id:data.modelId},permission:[{permission:'*',pattern:'*',action:'deny'}],metadata:{durebakOwner:data.ownerNonce}}};}
  if(operation==='submit'){const data=submitInput.parse(input);return {path:`/session/${data.nativeId}/prompt_async`,method:'POST',status:204,body:{messageID:data.messageId,model:{providerID:data.providerId,modelID:data.modelId},agent:'build',parts:[{type:'text',text:data.text}]}};}
  const data=nativeInput.parse(input);if(operation==='session')return {path:`/session/${data.nativeId}`,method:'GET',status:200};if(operation==='messages')return {path:`/session/${data.nativeId}/message`,method:'GET',status:200};if(operation==='abort')return {path:`/session/${data.nativeId}/abort`,method:'POST',body:{},status:200};throw new Error('invalid_operation');
 }
 async call(operation:Operation,input?:unknown):Promise<unknown>{
  if(this.#closed)fail('http_closed');if(this.#pending.size>=this.#maxPending)fail('http_pending_limit');let route:Route,body:Buffer|undefined;try{route=this.route(operation,input);body=route.body===undefined?undefined:Buffer.from(JSON.stringify(route.body));if(body&&body.length>32768)throw new Error('size');}catch{fail('http_invalid_input');}
  const url=new URL(route.path,this.#origin);url.searchParams.set('directory',this.#cwd);
  return new Promise((resolve,reject)=>{let req:ClientRequest|undefined,settled=false;const finish=(code?:string,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);this.#pending.delete(cancel);req?.destroy();if(code)reject(new Error(code));else resolve(value);};const cancel=(code:string)=>finish(code);const timer=setTimeout(()=>finish('http_timeout'),this.#timeout);this.#pending.add(cancel);
   try{req=request(url,{method:route.method,agent:false,headers:{authorization:this.#authorization,'content-type':'application/json',...(body?{'content-length':String(body.length)}:{})}},res=>{if(res.statusCode!==route.status){finish(`http_status:${res.statusCode??0}`);return;}const declared=Number(res.headers['content-length']);if(Number.isFinite(declared)&&declared>this.#maxBytes){finish('http_response_size');return;}let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>this.#maxBytes){finish('http_response_size');return;}chunks.push(chunk);});res.on('error',()=>finish('http_transport_failed'));res.on('aborted',()=>finish('http_transport_failed'));res.on('end',()=>{if(settled)return;try{if(route.status===204){if(size)throw new Error('unexpected_body');finish(undefined,null);}else finish(undefined,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}catch{finish('http_protocol_error');}});});req.on('error',()=>finish('http_transport_failed'));req.end(body);}catch{finish('http_transport_failed');}
  });
 }
 close(){if(this.#closed)return;this.#closed=true;this.#authorization='';for(const cancel of [...this.#pending])cancel('http_closed');}
}
