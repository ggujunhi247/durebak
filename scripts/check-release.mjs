import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateRelease(manifest,{tag,channel,repository,allowPrivate=false}) {
 const version=manifest.version;
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)||tag!==`v${version}`)throw new Error('release_version_mismatch');
 if(!allowPrivate && manifest.private===true)throw new Error('package_is_private');
 if(!['alpha','beta','rc','latest'].includes(channel))throw new Error('invalid_channel');
 const prerelease=version.split('-')[1]?.split('.')[0];
 if((prerelease??'latest')!==channel)throw new Error('release_channel_mismatch');
 if(typeof repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(repository))throw new Error('repository_required');
 if(manifest.repository?.url!==`https://github.com/${repository}.git`)throw new Error('repository_mismatch');
 if(!allowPrivate && manifest.publishConfig?.access!=='public')throw new Error('public_access_required');
 return {name:manifest.name,version,tag,channel,repository};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{tag:{type:'string'},channel:{type:'string',default:'alpha'},repository:{type:'string'},publish:{type:'boolean',default:false}}});
 const result=validateRelease(JSON.parse(readFileSync('package.json','utf8')),{...values,allowPrivate:!values.publish});
 const tagCommit=execFileSync('git',['rev-parse',`refs/tags/${result.tag}^{commit}`],{encoding:'utf8'}).trim();
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(tagCommit!==head)throw new Error('tag_head_mismatch');
 execFileSync('git',['merge-base','--is-ancestor',head,'origin/main']);
 console.log(JSON.stringify({...result,commit:head,publish:values.publish}));
}
