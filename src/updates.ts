import {z} from 'zod';
import {fail} from './domain.js';

export type UpdateChannel='stable'|'alpha'|'beta'|'rc';
export const releaseVersion=z.string().max(80).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/);
export function updateChannel(value:string):UpdateChannel {
 if(!['stable','alpha','beta','rc'].includes(value))fail('invalid_update_channel');return value as UpdateChannel;
}
function parts(value:string){if(!releaseVersion.safeParse(value).success)fail('invalid_update_version');return value.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/)!;}
export function channelForVersion(value:string):UpdateChannel{return (parts(value)[4]??'stable') as UpdateChannel;}
export function compareVersions(a:string,b:string):number {
 const x=parts(a),y=parts(b);
 for(const i of [1,2,3]){const p=BigInt(x[i]!),q=BigInt(y[i]!);if(p!==q)return p>q?1:-1;}
 const order=['alpha','beta','rc','stable'];const p=order.indexOf(x[4]??'stable'),q=order.indexOf(y[4]??'stable');
 if(p!==q)return p>q?1:-1;
 const n=BigInt(x[5]??'0'),m=BigInt(y[5]??'0');return n===m?0:n>m?1:-1;
}
export type SourceStatus='update_available'|'up_to_date'|'installed_ahead'|'unavailable'|'pinned';
export interface UpdateSource {status:SourceStatus;version:string|null;release_url:string|null;install_command:string|null}
export interface UpdateReport {current:string;channel:UpdateChannel;automatic_apply:false;installation_owner:'unverified';installation_guide_url:'https://github.com/ggujunhi247/durebak/blob/main/docs/INSTALLATION.md';npm:UpdateSource;github:UpdateSource}
export type UpdateRequest=(url:string)=>Promise<unknown>;
const repository='https://github.com/ggujunhi247/durebak';
const registry='https://registry.npmjs.org/durebak/';
const releases='https://api.github.com/repos/ggujunhi247/durebak/releases?per_page=10';
export async function readUpdateJson(url:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 if(![`${registry}alpha`,`${registry}beta`,`${registry}rc`,`${registry}latest`,releases,...[2,3,4,5].map(page=>`${releases}&page=${page}`)].includes(url))fail('unsafe_update_endpoint');
 const response=await fetcher(url,{redirect:'error',credentials:'omit',headers:{accept:'application/json','user-agent':'durebak-update-check'},signal:AbortSignal.timeout(5000)});
 if(!response.ok||!response.body){await response.body?.cancel();fail('update_fetch_failed');}
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>262144)){await response.body.cancel();fail('update_response_too_large');}
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)fail('update_response_too_large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel();}
 return JSON.parse(text) as unknown;
}
const empty=():UpdateSource=>({status:'unavailable',version:null,release_url:null,install_command:null});
function source(current:string,target:string,pin:string|undefined):UpdateSource{
 const cmp=compareVersions(target,current);
 return {status:pin?'pinned':cmp>0?'update_available':cmp<0?'installed_ahead':'up_to_date',version:target,release_url:`${repository}/releases/tag/v${target}`,install_command:null};
}
async function readReleasePages(request:UpdateRequest):Promise<unknown>{
 const all:unknown[]=[];
 for(let page=1;page<=5;page++){
  const value=await request(releases+(page===1?'':`&page=${page}`));
  if(!Array.isArray(value)||value.length>10)return null;
  all.push(...value);if(value.length<10)break;
 }
 return all;
}
export async function checkUpdates(options:{current:string;channel:UpdateChannel;pin?:string},request:UpdateRequest=readUpdateJson):Promise<UpdateReport>{
 channelForVersion(options.current);updateChannel(options.channel);if(options.pin!==undefined)channelForVersion(options.pin);
 const report:UpdateReport={current:options.current,channel:options.channel,automatic_apply:false,installation_owner:'unverified',installation_guide_url:'https://github.com/ggujunhi247/durebak/blob/main/docs/INSTALLATION.md',npm:empty(),github:empty()};
 const results=await Promise.allSettled([request(registry+(options.channel==='stable'?'latest':options.channel)),readReleasePages(request)]);
 const npm=results[0],github=results[1];
 if(npm?.status==='fulfilled'){
  const parsed=z.object({name:z.literal('durebak'),version:releaseVersion}).safeParse(npm.value);
  if(parsed.success&&channelForVersion(parsed.data.version)===options.channel)report.npm=source(options.current,parsed.data.version,options.pin);
 }
 if(github?.status==='fulfilled'){
  const parsed=z.array(z.object({tag_name:z.string().max(81),draft:z.boolean(),prerelease:z.boolean(),html_url:z.string().max(250),assets:z.array(z.object({name:z.string().max(150),browser_download_url:z.string().max(300)})).max(100)})).max(50).safeParse(github.value);
  if(parsed.success){const candidates=parsed.data.filter(item=>{
   const v=item.tag_name.slice(1);if(!item.tag_name.startsWith('v')||!releaseVersion.safeParse(v).success)return false;
   return !item.draft&&item.prerelease===(channelForVersion(v)!=='stable')&&channelForVersion(v)===options.channel&&item.html_url===`${repository}/releases/tag/v${v}`&&item.assets.some(a=>a.name===`durebak-${v}.tgz`&&a.browser_download_url===`${repository}/releases/download/v${v}/durebak-${v}.tgz`);
  }).map(item=>item.tag_name.slice(1)).sort((a,b)=>compareVersions(b,a));
  if(candidates[0])report.github=source(options.current,candidates[0],options.pin);
  }
 }
 return report;
}
