import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function channelForTag(tag) {
 const match=/^v\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/.exec(tag);
 if(!match)throw new Error('invalid_release_tag');
 return match[1]??'latest';
}
export function assertRegistryArtifact(bytes,dist) {
 if(typeof dist?.integrity!=='string'||!dist.integrity.startsWith('sha512-'))throw new Error('registry_integrity_required');
 if(dist.integrity!==`sha512-${createHash('sha512').update(bytes).digest('base64')}`)throw new Error('registry_artifact_mismatch');
}
export async function publishVerified({bytes,readDist,publish,download}) {
 let dist=await readDist();
 const existed=dist!==null;
 if(!existed){await publish();dist=await readDist();}
 if(dist===null)throw new Error('registry_version_missing');
 assertRegistryArtifact(bytes,dist);
 if(!bytes.equals(await download(dist.tarball)))throw new Error('registry_tarball_mismatch');
 return existed?'already_published':'published';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{tarball:{type:'string'},channel:{type:'string'}}});
 const manifest=JSON.parse(readFileSync('package.json','utf8'));
 if(values.channel!==channelForTag(`v${manifest.version}`))throw new Error('release_channel_mismatch');
 const bytes=readFileSync(values.tarball);
 const request=async url=>fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
 const readDist=async()=>{
  const response=await request(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}`);
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`registry_read_failed_${response.status}`);
  const metadata=await response.json();
  if(metadata.name!==manifest.name||metadata.version!==manifest.version)throw new Error('registry_identity_mismatch');
  return metadata.dist;
 };
 const result=await publishVerified({bytes,readDist,
  publish:async()=>execFileSync('npm',['publish',resolve(values.tarball),'--access','public','--tag',values.channel,'--provenance','--registry=https://registry.npmjs.org'],{stdio:'inherit'}),
  download:async url=>{
   const target=new URL(url);
   if(target.origin!=='https://registry.npmjs.org'||target.username||target.password)throw new Error('invalid_registry_tarball_url');
   const response=await request(target);
   if(!response.ok)throw new Error(`registry_download_failed_${response.status}`);
   return Buffer.from(await response.arrayBuffer());
  }});
 console.log(JSON.stringify({name:manifest.name,version:manifest.version,status:result,registry_bytes_verified:true}));
}
