import {createHash,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {fail} from './domain.js';
import {verifyUpdateManifest,type UpdateManifestContext} from './update-trust.js';
import {channelForVersion} from './updates.js';

const releaseAssets='https://github.com/ggujunhi247/durebak/releases/download/';
const registry='https://registry.npmjs.org/durebak/';
const cdn='https://release-assets.githubusercontent.com';
const npmRelease=z.object({name:z.literal('durebak'),version:z.string(),dist:z.object({tarball:z.string(),integrity:z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/)})});

async function readBytes(url:string,limit:number,fetcher:typeof fetch,allowRedirect=false) {
 const signal=AbortSignal.timeout(5000);
 for(let attempt=0;;attempt++){
  const response=await fetcher(url,{redirect:'manual',credentials:'omit',signal});
  if([301,302,303,307,308].includes(response.status)){
   await response.body?.cancel();
   const location=response.headers.get('location');
   if(!allowRedirect||attempt>=2||!location)fail('unsafe_update_redirect');
   let next:URL;
   try{next=new URL(location);}catch{fail('unsafe_update_redirect');}
   if(next.origin!==cdn||next.username||next.password||next.hash)fail('unsafe_update_redirect');
   url=next.href;
   continue;
  }
  if(!response.ok||!response.body){await response.body?.cancel();fail('update_fetch_failed');}
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){
   await response.body.cancel();fail('update_response_too_large');
  }
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    total+=value.byteLength;
    if(total>limit)fail('update_response_too_large');
    chunks.push(value);
   }
  }finally{await reader.cancel();}
  return Buffer.concat(chunks,total);
 }
}

function readJson(bytes:Buffer):unknown {
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{fail('invalid_update_response');}
}

export async function downloadVerifiedUpdate(target:string,keys:Readonly<Record<string,KeyObject>>,context:UpdateManifestContext,fetcher:typeof fetch=fetch):Promise<Buffer> {
 if(channelForVersion(target)!==context.channel||!['darwin','linux'].includes(context.platform)||!['x64','arm64'].includes(context.arch))fail('incompatible_update_manifest');
 const manifestUrl=`${releaseAssets}v${target}/update-${context.platform}-${context.arch}.json`;
 const envelope=readJson(await readBytes(manifestUrl,262144,fetcher,true));
 const release=verifyUpdateManifest(envelope,keys,context);
 if(release.version!==target)fail('incompatible_update_version');
 const metadata=npmRelease.safeParse(readJson(await readBytes(`${registry}${target}`,262144,fetcher)));
 if(!metadata.success||metadata.data.version!==target||metadata.data.dist.tarball!==`${registry}-/durebak-${target}.tgz`)fail('invalid_update_registry_metadata');
 const bytes=await readBytes(release.artifact.url,release.artifact.bytes,fetcher,true);
 if(bytes.length!==release.artifact.bytes||createHash('sha256').update(bytes).digest('hex')!==release.artifact.sha256||`sha512-${createHash('sha512').update(bytes).digest('base64')}`!==metadata.data.dist.integrity)fail('update_artifact_digest_mismatch');
 return bytes;
}
